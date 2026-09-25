import { Fragment, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import type { TeamIssueType, TeamStatusConfig } from '@/types/enums';

/** The bit of an issue a compact sub-issue row needs. */
export interface SubIssueLike {
  id: string;
  title: string;
  status: string;
  shortId?: string;
  teamId?: string;
}

/** A chevron that opens/closes a branch — shared by the list rows and board cards. */
export function TreeChevron({
  expanded,
  onToggle,
  className,
}: {
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = t(expanded ? 'boards.timelineCollapse' : 'boards.timelineExpand');
  return (
    <button
      type="button"
      onClick={(e) => {
        // Rows are links/cards: toggling must not also open the issue.
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
    </button>
  );
}

interface SubIssueTreeProps<T extends SubIssueLike> {
  /** The issue whose descendants are shown. */
  issue: T;
  childrenOf: Map<string, T[]>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  issueType: TeamIssueType;
  statusesFor: (teamId: string | undefined, issueType: TeamIssueType) => TeamStatusConfig[];
  onOpen: (issue: T) => void;
}

/**
 * The sub-issues of one issue, as a compact expandable tree — what a board card
 * carries in its footer. A board groups by status, so a child can't sit in its own
 * column without leaving its parent; instead it lives *inside* the parent's card,
 * with its own status dot to say where it actually is. Closed by default; each
 * level opens on its own chevron.
 */
export function SubIssueTree<T extends SubIssueLike>(props: SubIssueTreeProps<T>) {
  const { issue, childrenOf, expanded, toggle } = props;
  const kids = childrenOf.get(issue.id) ?? [];
  if (kids.length === 0) return null;
  const open = expanded.has(issue.id);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => toggle(issue.id)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden />
        {t('boards.timelineSubCount').replace('{n}', String(kids.length))}
      </button>
      {open && <SubRows {...props} nodes={kids} depth={0} />}
    </div>
  );
}

function SubRows<T extends SubIssueLike>({
  nodes,
  depth,
  ...ctx
}: SubIssueTreeProps<T> & { nodes: T[]; depth: number }) {
  const { childrenOf, expanded, toggle, issueType, statusesFor, onOpen } = ctx;
  return (
    <ul className="flex flex-col">
      {nodes.map((n) => {
        const grand = childrenOf.get(n.id) ?? [];
        const cfg = statusesFor(n.teamId, issueType).find((c) => c.key === n.status);
        return (
          <li key={n.id}>
            <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
              {grand.length > 0 ? (
                <TreeChevron expanded={expanded.has(n.id)} onToggle={() => toggle(n.id)} />
              ) : (
                <span className="size-5 shrink-0" aria-hidden />
              )}
              <button
                type="button"
                onClick={() => onOpen(n)}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={cfg?.label ?? n.status}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: cfg?.color ?? 'hsl(var(--muted-foreground))' }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{n.title}</span>
                {n.shortId && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{n.shortId}</span>
                )}
              </button>
            </div>
            {expanded.has(n.id) && grand.length > 0 && (
              <SubRows {...ctx} issue={n} nodes={grand} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── List rows ────────────────────────────────────────────────────────────────
// The task and bug lists each own their row (checkbox, chips, link…), so the tree
// doesn't draw rows — it tells each one *where it sits* (`RowTree`) and lets the row
// render the chevron, indent and status through the two small pieces below.

/** Where a list row sits in the hierarchy. */
export interface RowTree {
  depth: number;
  /** Direct children on this list (0 = a leaf). */
  kids: number;
  open: boolean;
  /** Anything on the list has children → leaves keep an empty chevron slot. */
  reserve: boolean;
  onToggle: () => void;
  /** Set on nested rows only: they sit under their parent whatever their own
   *  status, so the row says which one it is. */
  status?: TeamStatusConfig;
}

export interface IssueTreeCtl<T> {
  childrenOf: Map<string, T[]>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  statusFor?: (item: T) => TeamStatusConfig | undefined;
}

/** Row indent for a depth — the row's own `px-4` (16) plus a step per level. */
export const rowIndent = (rt?: RowTree) => (rt ? { paddingLeft: 16 + rt.depth * 24 } : undefined);

/** Each item, then — while its branch is open — its children, recursively. */
export function renderIssueTree<T extends { id: string }>(
  items: T[],
  ctl: IssueTreeCtl<T>,
  row: (item: T, rt: RowTree) => ReactNode,
  depth = 0,
): ReactNode {
  return items.map((item) => {
    const kids = ctl.childrenOf.get(item.id) ?? [];
    const open = ctl.expanded.has(item.id);
    return (
      <Fragment key={item.id}>
        {row(item, {
          depth,
          kids: kids.length,
          open,
          reserve: ctl.childrenOf.size > 0,
          onToggle: () => ctl.toggle(item.id),
          status: depth > 0 ? ctl.statusFor?.(item) : undefined,
        })}
        {/* Depth cap: a parent loop that got past the data layer can't recurse forever. */}
        {open && kids.length > 0 && depth < 8 && renderIssueTree(kids, ctl, row, depth + 1)}
      </Fragment>
    );
  });
}

/** The chevron (or an empty slot that keeps titles aligned) at a row's start. */
export function TreeRowLead({ rt }: { rt?: RowTree }) {
  if (!rt) return null;
  if (rt.kids > 0) return <TreeChevron expanded={rt.open} onToggle={rt.onToggle} className="-ml-2 -mr-1" />;
  return rt.reserve ? <span className="-ml-2 -mr-1 size-5 shrink-0" aria-hidden /> : null;
}

/** "N sub-issues" and, on a nested row, its own status — after the title. */
export function TreeRowMeta({ rt }: { rt?: RowTree }) {
  if (!rt) return null;
  return (
    <>
      {rt.kids > 0 && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t('boards.timelineSubCount').replace('{n}', String(rt.kids))}
        </span>
      )}
      {rt.status && (
        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:flex">
          <span className="size-2 rounded-full" style={{ backgroundColor: rt.status.color }} aria-hidden />
          {rt.status.label}
        </span>
      )}
    </>
  );
}
