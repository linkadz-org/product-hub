import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  GitCommitHorizontal,
  GitPullRequest,
} from 'lucide-react';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { timeAgo } from '@/lib/format';
import {
  CodeLinkCiState,
  CodeLinkKind,
  PullRequestState,
  CODE_LINK_CI_STATE_COLOR,
  CODE_LINK_CI_STATE_LABEL,
  PULL_REQUEST_STATE_COLOR,
  PULL_REQUEST_STATE_LABEL,
} from '@/types/enums';
import type { CodeLinkDto } from '@/types/dto';
import { useCodeLinks } from '../api';

interface CodeLinksSectionProps {
  /** The task / bug / backlog item this panel belongs to. */
  subjectId: string | undefined;
  className?: string;
}

/**
 * The Development panel on a task / bug / backlog item detail page: the commits
 * and pull requests that named this record.
 *
 * Nothing here is entered in the app — a row exists because someone wrote the
 * record's ref (`TSK-6HCUHKX`) in a commit message, a branch name or a PR title,
 * or because a commit inside a pull request did, and GitHub told us. So it
 * renders nothing at all when there are none: most records never get a commit,
 * and an empty "Development" heading on every detail page in the app would be
 * noise. Same rule as the neighbouring Docs panel.
 */
export function CodeLinksSection({ subjectId, className }: CodeLinksSectionProps) {
  const { data } = useCodeLinks(subjectId);
  // Null until the reader picks something, so the default can be derived from
  // what actually came back. An effect that corrected it after the first paint
  // would flash the wrong list on every record that opens.
  const [picked, setPicked] = useState<readonly CodeLinkKind[] | null>(null);

  const links = data ?? [];
  const counts = {
    [CodeLinkKind.PULL_REQUEST]: links.filter((l) => l.kind === CodeLinkKind.PULL_REQUEST).length,
    [CodeLinkKind.COMMIT]: links.filter((l) => l.kind === CodeLinkKind.COMMIT).length,
  };
  // A pull request is the unit of work someone opens this panel to find; the
  // commits inside it, and the merge commit that closed it, restate the same
  // work three times. So PRs alone by default — unless the record has none, in
  // which case defaulting to them would open on an empty panel and read as a bug.
  const active =
    picked ??
    (counts[CodeLinkKind.PULL_REQUEST] > 0 ? [CodeLinkKind.PULL_REQUEST] : [CodeLinkKind.COMMIT]);
  const shown = links.filter((l) => active.includes(l.kind));

  if (links.length === 0) return null;

  const toggle = (kind: CodeLinkKind) =>
    setPicked(active.includes(kind) ? active.filter((k) => k !== kind) : [...active, kind]);

  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {/* The filter is a sibling of the heading rather than inside it — buttons
          don't belong in an <h3>, and on a narrow panel the row wraps instead
          of crushing the label. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {/* Same eyebrow heading as the SUB-TASKS / DOCS sections beside it. */}
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <GitCommitHorizontal className="size-3.5" aria-hidden />
          {t('code.development')}
          {/* What is listed, not what exists — the per-kind totals are on the
              filter itself, where they say what turning one on would reveal. */}
          <span className="tabular-nums">({shown.length})</span>
        </h3>
        <KindFilter counts={counts} active={active} onToggle={toggle} className="ml-auto" />
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('code.noKindSelected')}</p>
      ) : (
        /* Newest work first, exactly as the API sorted it — commits and pull
           requests interleaved. Grouping the PRs above the commits reads well on
           paper and lies about the sequence: a commit pushed five minutes ago
           would sit under a PR opened an hour ago. */
        <ul className="flex flex-col gap-1.5">
          {shown.map((link) => (
            <li key={link.id}>
              <CodeLinkRow link={link} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const KIND_FILTERS = [
  { kind: CodeLinkKind.PULL_REQUEST, labelKey: 'code.pullRequests', Glyph: GitPullRequest },
  { kind: CodeLinkKind.COMMIT, labelKey: 'code.commits', Glyph: GitCommitHorizontal },
] as const;

/**
 * Which kinds of work to list. Both segments can be on at once — this is a
 * filter, not a mode, and "pull requests *and* their commits" is a real thing to
 * want. That's the one way it departs from the segmented switches on the Docs
 * hub and the boards, whose segments are alternatives; the container, the brand
 * fill on an active segment and the `aria-pressed` buttons are all the same
 * idiom, because the UI kit still has no toggle-group primitive.
 *
 * Each segment carries its own total, so turning one on is a known quantity
 * rather than a guess — and a kind with nothing behind it says so with a 0.
 */
function KindFilter({
  counts,
  active,
  onToggle,
  className,
}: {
  counts: Record<CodeLinkKind, number>;
  active: readonly CodeLinkKind[];
  onToggle: (kind: CodeLinkKind) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5',
        className,
      )}
    >
      {KIND_FILTERS.map(({ kind, labelKey, Glyph }) => {
        const on = active.includes(kind);
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(kind)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Glyph className="size-3 shrink-0" aria-hidden />
            {/* The icons carry the meaning once the panel is narrow; the count
                stays, because it is the part that isn't guessable. */}
            <span className="hidden sm:inline">{t(labelKey)}</span>
            <span className="tabular-nums">{counts[kind]}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One commit or pull request. A plain `<a>` rather than a router `<Link>` — the
 * destination is github.com, and it opens in its own tab so a half-written
 * comment on this page survives the click.
 */
function CodeLinkRow({ link }: { link: CodeLinkDto }) {
  const isPr = link.kind === CodeLinkKind.PULL_REQUEST;
  const { state } = link;
  // A commit is identified by its short sha, a PR by its number.
  const ref = isPr ? `#${link.number}` : link.shortSha;
  // Repo is only worth the space once a workspace has more than one; showing it
  // always is simpler than guessing, and it's the first thing to hide on a phone.
  const meta = [link.authorName, link.repo].filter(Boolean).join(' · ');

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2 transition-colors hover:border-primary hover:bg-accent"
    >
      {isPr ? (
        <GitPullRequest
          className="size-3.5 shrink-0"
          style={state ? { color: PULL_REQUEST_STATE_COLOR[state] } : undefined}
          aria-hidden
        />
      ) : (
        <GitCommitHorizontal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}

      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{ref}</span>

      <span className="min-w-0 flex-1 truncate text-sm">{link.title}</span>

      {isPr && state && <StateChip state={state} />}

      <CiChip link={link} />

      <BranchRef link={link} />

      <span className="hidden shrink-0 truncate text-[11px] text-muted-foreground sm:inline">
        {meta}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(link.occurredAt)}</span>
    </a>
  );
}

/**
 * Which environment this piece of work reached.
 *
 * For a pull request that's the *target* branch, not the one being worked on:
 * `dev` and `main` are what a reader is actually asking about, and the source
 * branch only says who wrote it. So the target is always shown and the source
 * is context that drops away first on a narrow screen. A commit has one branch —
 * the one it landed on — which answers the same question directly.
 */
function BranchRef({ link }: { link: CodeLinkDto }) {
  const isPr = link.kind === CodeLinkKind.PULL_REQUEST;
  const target = isPr ? link.baseBranch : link.branch;
  if (!target) return null;
  const source = isPr ? link.branch : '';

  return (
    <span
      className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground"
      title={source ? `${source} → ${target}` : target}
    >
      {source && (
        <>
          <span className="hidden max-w-[8rem] truncate md:inline">{source}</span>
          <ArrowRight className="hidden size-2.5 md:inline" aria-hidden />
        </>
      )}
      <span className="max-w-[7rem] truncate rounded bg-muted px-1.5 py-0.5">{target}</span>
    </span>
  );
}

const CI_STATE_ICON: Record<CodeLinkCiState, LucideIcon> = {
  [CodeLinkCiState.PENDING]: CircleDashed,
  [CodeLinkCiState.SUCCESS]: CircleCheck,
  [CodeLinkCiState.FAILURE]: CircleX,
  [CodeLinkCiState.ERROR]: CircleAlert,
};

/**
 * What CI did with this work, and where it landed — `✓ dev` once the deploy of
 * `dev` that carried this pull request succeeded.
 *
 * Shows the environment rather than the job name, because `dev` is the thing
 * being asked about ("is my fix on dev yet?") and `ci/circleci: deploy-2` is
 * not; the job, and when it last spoke, are in the tooltip for whoever needs to
 * go and look. Renders nothing until CI has reported, which for most workspaces
 * is always: the `status` event has to be ticked on the GitHub webhook, and
 * nothing about the rest of the panel depends on it.
 */
function CiChip({ link }: { link: CodeLinkDto }) {
  const { ciState } = link;
  if (!ciState) return null;

  const color = CODE_LINK_CI_STATE_COLOR[ciState];
  const Icon = CI_STATE_ICON[ciState];
  const label = CODE_LINK_CI_STATE_LABEL[ciState];
  // The branch is the headline; without one (a status on a commit that is no
  // branch's tip) the state's own name is all there is to say.
  const text = link.ciBranch || label;
  const detail = [link.ciContext, label, link.ciAt ? timeAgo(link.ciAt) : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{ color, backgroundColor: `${color}1a` }}
      title={detail}
    >
      <Icon
        className={cn('size-2.5', ciState === CodeLinkCiState.PENDING && 'animate-pulse')}
        aria-hidden
      />
      <span className="max-w-[6rem] truncate font-mono">{text}</span>
    </span>
  );
}

/** Open / Merged / Closed / Draft, in GitHub's own colours. */
function StateChip({ state }: { state: PullRequestState }) {
  const color = PULL_REQUEST_STATE_COLOR[state];
  return (
    <span
      className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{ color, backgroundColor: `${color}1a` }}
    >
      {PULL_REQUEST_STATE_LABEL[state]}
    </span>
  );
}
