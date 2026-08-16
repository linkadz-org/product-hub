import { useEffect, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, Input, Spinner } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useCommandItems } from './useCommandItems';
import { rememberRecent } from './sources/recentSource';

const DEBOUNCE_MS = 200;

/**
 * The ⌘K / Ctrl+K command palette, mounted once in `AppLayout` so it's
 * reachable from any authenticated page. Lists go-to/create/recent commands
 * immediately, and folds in remote search results once the query is 2+ chars.
 *
 * The open/close shortcut requires a modifier key (`metaKey`/`ctrlKey`), so a
 * bare `k` typed into any other field never triggers it — but the shortcut
 * itself fires from *anywhere*, including while focus sits inside another
 * input, textarea, or the rich-text editor's contenteditable. That's
 * deliberate, not an oversight: the moment someone reaches for ⌘K is usually
 * while their cursor is already parked in some other field, and a palette
 * that won't open from there is one people stop reaching for. There is no
 * editable-context guard here on purpose.
 *
 * Today nothing else in this codebase claims Cmd/Ctrl+K (checked the rich-text
 * editor's `inputRules`, `SlashMenu`, `inlineShortcuts`, and `MentionMenu`),
 * so there's nothing to conflict with yet. That's a fact about the present
 * codebase, not a guarantee — if the editor ever binds ⌘K itself (link
 * insertion is the usual reason a rich-text editor wants that combo), the two
 * handlers will fight over the same keystroke, and the editor's binding
 * should win while focus is inside it.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { items, loading, searchFailed } = useCommandItems(q);

  // Debounce: fast typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQ(raw), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [raw]);

  // Global shortcut. Dialog itself handles Esc, focus trap and scroll lock.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setActive(0), [q, open]);

  const close = () => {
    setOpen(false);
    setRaw('');
    setQ('');
  };

  const run = (index: number) => {
    const item = items[index];
    if (!item) return;
    rememberRecent(item);
    close();
    navigate(item.run.to);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      run(active);
    }
  };

  return (
    // No `title`: Dialog then renders only a visually hidden Title for screen
    // readers and skips the header bar entirely — the layout a palette needs.
    <Dialog
      open={open}
      onClose={close}
      bodyClassName="p-0"
      // Below sm it becomes a fullscreen sheet — CLAUDE.md's responsiveness rule.
      className="max-w-xl max-sm:h-[calc(100dvh-1rem)] max-sm:max-w-none"
    >
      <div className="relative">
        <Input
          autoFocus
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('palette.placeholder')}
          className={cn('rounded-none border-0 border-b focus-visible:ring-0', loading && 'pr-9')}
          aria-label={t('palette.placeholder')}
        />
        {/* In-flight search only — never blocks the list or input, just says
            "a result group may still be catching up". */}
        {loading && (
          <Spinner className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2" />
        )}
      </div>
      {/* Search dying must NOT break the palette: the local sources (go-to,
          create, recents) still render below, only the results group is lost. */}
      {searchFailed && (
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">
          {t('palette.searchUnavailable')}
        </p>
      )}
      <div role="listbox" className="max-h-96 overflow-y-auto p-1 max-sm:max-h-none">
        {items.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('palette.empty')}</p>
        )}
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => run(i)}
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm',
              i === active && 'bg-accent',
            )}
          >
            <Icon name={item.icon} className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{item.title}</span>
            {item.subtitle && (
              <span className="ml-auto truncate text-xs text-muted-foreground">{item.subtitle}</span>
            )}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
