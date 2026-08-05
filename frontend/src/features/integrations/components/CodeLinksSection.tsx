import { ArrowRight, GitCommitHorizontal, GitPullRequest } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { timeAgo } from '@/lib/format';
import {
  CodeLinkKind,
  PullRequestState,
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
  const links = data ?? [];
  if (links.length === 0) return null;

  // Pull requests first: a PR is the summary of the commits under it, so it's
  // the row a reader wants before the individual commits. Each group stays in
  // the API's newest-first order.
  const prs = links.filter((l) => l.kind === CodeLinkKind.PULL_REQUEST);
  const commits = links.filter((l) => l.kind === CodeLinkKind.COMMIT);

  return (
    <section className={cn('flex flex-col gap-2', className)}>
      {/* Same eyebrow heading as the SUB-TASKS / DOCS sections beside it. */}
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <GitCommitHorizontal className="size-3.5" aria-hidden />
        {t('code.development')}
        <span className="tabular-nums">({links.length})</span>
      </h3>
      <ul className="flex flex-col gap-1.5">
        {[...prs, ...commits].map((link) => (
          <li key={link.id}>
            <CodeLinkRow link={link} />
          </li>
        ))}
      </ul>
    </section>
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
