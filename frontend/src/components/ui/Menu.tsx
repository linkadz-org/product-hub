import { useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MenuItem {
  label: string;
  /** Renders a divider instead of a row — every other field is ignored. Lets a
   *  menu group sentinel choices apart from a long concrete list (the roadmap's
   *  sprint picker splits Current/All/None from the sprints themselves). */
  separator?: boolean;
  /** Action for a leaf item. Omit when `children` is set (it opens a submenu). */
  onClick?: () => void;
  /** Optional leading glyph (e.g. a lucide icon) shown before the label. */
  icon?: ReactNode;
  /** Nested items — renders `label` as a submenu trigger (▸), not an action. */
  children?: MenuItem[];
  danger?: boolean;
  disabled?: boolean;
  /**
   * Close the menu and let the action keep whatever focus it takes — for
   * actions that hand focus somewhere else, like opening an inline editor.
   *
   * Off by default: items that toggle a value in place (pin, environment) keep
   * the menu open so you can see the change land, and closing normally returns
   * focus to the trigger, which is what keyboard users want.
   */
  closeOnSelect?: boolean;
}

interface MenuProps {
  /** The clickable trigger (usually a kebab icon). */
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  /** Open upward (for triggers near the bottom of the viewport). */
  up?: boolean;
  /** Extra class on the trigger. */
  triggerClassName?: string;
}

// One popover surface, reused by the root menu and every submenu.
const SURFACE =
  'z-50 min-w-[11rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95';
// One row style, shared by leaf items and submenu triggers.
const ROW =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const DANGER = 'text-destructive focus:bg-destructive focus:text-destructive-foreground';

const glyph = (icon: ReactNode) => (
  <span className="grid size-4 shrink-0 place-items-center" aria-hidden>
    {icon}
  </span>
);

/**
 * One {@link MenuItem} → one Radix row. Module-level and shared by {@link Menu}
 * and {@link ContextMenu} so the two can never drift into different-looking rows:
 * a right-click menu that styles its items even slightly differently from the
 * kebab menu next to it reads as a different app.
 *
 * `yieldFocus` is the caller's ref (see {@link Menu}) — the row sets it, the
 * surface reads it on close.
 */
function renderItem(
  item: MenuItem,
  key: string,
  yieldFocus: MutableRefObject<boolean>,
): ReactNode {
  if (item.separator) {
    return <DropdownMenu.Separator key={key} className="-mx-1 my-1 h-px bg-border" />;
  }
  // A parent item opens a nested submenu (e.g. "Mark as ▸").
  if (item.children?.length) {
    return (
      <DropdownMenu.Sub key={key}>
        <DropdownMenu.SubTrigger disabled={item.disabled} className={cn(ROW, item.danger && DANGER)}>
          {item.icon && glyph(item.icon)}
          <span className="flex-1">{item.label}</span>
          <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
        </DropdownMenu.SubTrigger>
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent sideOffset={4} className={SURFACE}>
            {item.children.map((child, j) => renderItem(child, `${key}.${j}`, yieldFocus))}
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Sub>
    );
  }
  return (
    <DropdownMenu.Item
      key={key}
      disabled={item.disabled}
      onSelect={(e) => {
        if (item.closeOnSelect) yieldFocus.current = true;
        else e.preventDefault();
        item.onClick?.();
      }}
      className={cn(ROW, item.danger && DANGER)}
    >
      {item.icon && glyph(item.icon)}
      {item.label}
    </DropdownMenu.Item>
  );
}

/** Dropdown menu backed by Radix (keyboard nav, focus management, portal). */
export function Menu({
  trigger,
  items,
  align = 'right',
  up = false,
  triggerClassName = '',
}: MenuProps) {
  // Set when a `closeOnSelect` item runs, so the close that follows doesn't
  // drag focus back to the trigger. The menu unmounts only after its exit
  // animation, well after the action has focused whatever it opened — without
  // this, that late focus-return silently blurs the new field.
  const yieldFocus = useRef(false);

  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        // Fresh open, fresh intent — so a dismiss (Escape, click-away) still
        // returns focus to the trigger the normal way.
        if (open) yieldFocus.current = false;
      }}
    >
      <DropdownMenu.Trigger
        className={cn(
          'inline-flex cursor-pointer items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          triggerClassName,
        )}
      >
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align === 'right' ? 'end' : 'start'}
          side={up ? 'top' : 'bottom'}
          sideOffset={6}
          // The content is portaled out to the body, but React still bubbles
          // synthetic events up the *component* tree — so without this, picking
          // an item also fires the onClick of whatever clickable card the menu
          // is nested in (the project cards navigate on click).
          onClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => {
            if (yieldFocus.current) e.preventDefault();
          }}
          className={SURFACE}
        >
          {items.map((item, i) => renderItem(item, String(i), yieldFocus))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ---------------------------------------------------------------------------

interface ContextMenuProps {
  /**
   * The rows, or a function returning them — **prefer the function**. It runs
   * only on right-click, so a caller whose rows cost something to build (pricing
   * each target against the item, say) doesn't pay for every card on every
   * render. That matters more than it sounds: a Kanban board re-renders on every
   * drag-over, so eager rows turn a drag into thousands of throwaway
   * computations. The rows are snapshotted while the menu is open.
   */
  items: MenuItem[] | (() => MenuItem[]);
  /** The region that answers a right-click. */
  children: ReactNode;
  /**
   * Class for the wrapper that captures the right-click. Defaults to `contents`
   * (`display: contents`), so the wrapper generates **no box**: dropping a
   * `ContextMenu` around a flex/grid child leaves the layout byte-for-byte
   * identical, while `contextmenu` still bubbles up to it from the children.
   */
  className?: string;
  /** No right-click menu at all (e.g. a read-only board). */
  disabled?: boolean;
}

/**
 * Right-click menu, same rows and same surface as {@link Menu}.
 *
 * Built on `react-dropdown-menu` rather than `@radix-ui/react-context-menu`
 * because that package isn't a dependency here — and one menu implementation is
 * worth more than the primitive's small extras: rows, submenus, keyboard nav and
 * theming all come from the code above, so the two menus stay identical for free.
 *
 * The anchor is the trick. Radix positions content against a trigger, so a
 * right-click records the pointer and parks a 0×0 `pointer-events-none` span at
 * those viewport coordinates for the popper to measure — which is what makes the
 * menu open *at the cursor* like a native one, collision-flipping near an edge
 * included. `pointer-events-none` also means that span can never itself be
 * clicked, so this never turns into a left-click trigger.
 *
 * Keyboard users are not stranded: the browser fires `contextmenu` for the
 * Menu/Shift+F10 key on the focused element, and a Kanban card is focusable
 * (dnd-kit makes it a `role="button"` with a tab stop), so the same menu opens
 * from the keyboard. Even so, a right-click menu is an *accelerator* — never put
 * an action here that exists nowhere else.
 */
export function ContextMenu({ items, children, className, disabled }: ContextMenuProps) {
  // Point *and* rows together: one right-click resolves both, and holding the
  // rows keeps them stable for as long as the menu is open.
  const [menu, setMenu] = useState<{ x: number; y: number; rows: MenuItem[] } | null>(null);
  const yieldFocus = useRef(false);

  return (
    <DropdownMenu.Root
      open={menu !== null}
      onOpenChange={(open) => {
        if (open) yieldFocus.current = false;
        else setMenu(null);
      }}
    >
      <div
        className={className ?? 'contents'}
        onContextMenu={(e) => {
          if (disabled) return;
          const rows = typeof items === 'function' ? items() : items;
          // Nothing to offer: leave the browser's own menu alone rather than
          // swallowing the right-click to show an empty box.
          if (rows.length === 0) return;
          e.preventDefault(); // ours instead of the browser's
          // Nested menus: the innermost region wins, as a native menu does.
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY, rows });
        }}
      >
        {children}
      </div>
      <DropdownMenu.Trigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed h-0 w-0"
          style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side="bottom"
          sideOffset={2}
          // Portaled out, but React still bubbles synthetic events up the
          // *component* tree — without this, picking a row also fires the
          // onClick of the card the menu hangs off (every board card opens a
          // detail view on click).
          onClick={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => {
            if (yieldFocus.current) e.preventDefault();
          }}
          className={SURFACE}
        >
          {(menu?.rows ?? []).map((item, i) => renderItem(item, String(i), yieldFocus))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
