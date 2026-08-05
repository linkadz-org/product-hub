/**
 * The slices of GitHub's webhook payloads we actually read.
 *
 * Deliberately narrow: GitHub sends a few hundred fields per event and adds more
 * over time, so typing the whole envelope would be a maintenance tax with no
 * payoff. Everything here is optional-tolerant — a payload shape we didn't
 * expect must degrade to "no links found", never throw inside a webhook handler
 * that GitHub will otherwise retry.
 */

/** The event names we act on. Anything else is acknowledged and ignored. */
export enum GitHubEvent {
  /** Sent once when the webhook is created — our "connection works" signal. */
  PING = 'ping',
  PUSH = 'push',
  PULL_REQUEST = 'pull_request',
  /**
   * A commit status posted by CI — for us, CircleCI's `ci/circleci: <job>`.
   * GitHub relays it, so nothing has to be added to the CircleCI config.
   */
  STATUS = 'status',
}

export interface GitHubRepository {
  full_name?: string;
}

export interface GitHubPushCommit {
  id?: string;
  message?: string;
  url?: string;
  timestamp?: string;
  author?: { name?: string; username?: string };
}

export interface GitHubPushPayload {
  /** `refs/heads/<branch>` — also `refs/tags/...`, which carries no branch. */
  ref?: string;
  repository?: GitHubRepository;
  commits?: GitHubPushCommit[];
  /** True when the branch was deleted; its `commits` are already-seen history. */
  deleted?: boolean;
}

export interface GitHubPullRequestPayload {
  action?: string;
  repository?: GitHubRepository;
  pull_request?: {
    number?: number;
    title?: string;
    body?: string;
    html_url?: string;
    state?: string;
    merged?: boolean;
    draft?: boolean;
    created_at?: string;
    /** Branch the work is on. */
    head?: { ref?: string };
    /** Branch it is being merged *into* — `dev`, `main`: the environment. */
    base?: { ref?: string };
    user?: { login?: string; avatar_url?: string };
  };
}

/**
 * A commit status delivery — one CI job reporting on one commit.
 *
 * Fires once per job per state change, so a two-job pipeline on one commit is
 * four deliveries (pending ×2, then success ×2). `context` is what distinguishes
 * them: `ci/circleci: build-and-push-2`, `ci/circleci: deploy-2`.
 */
export interface GitHubStatusPayload {
  repository?: GitHubRepository;
  /** Commit the status is attached to — for us, a merge commit on `dev`/`main`. */
  sha?: string;
  /** pending | success | failure | error. */
  state?: string;
  /** The job's name as GitHub shows it. */
  context?: string;
  description?: string;
  /** Deep link to the job on CircleCI — what the chip opens. */
  target_url?: string;
  updated_at?: string;
  /**
   * Branches whose tip is this commit. A deploy status lands on `dev`/`main`,
   * and this is the only field that says *which* — the environment the chip names.
   */
  branches?: Array<{ name?: string }>;
  /** The commit itself, carried whole; we read only its message. */
  commit?: { commit?: { message?: string } };
}

/**
 * The pull request number a merge commit closed, or 0.
 *
 * A deploy status lands on the *merge* commit, whose message never names an
 * issue — but a code link for the PR already exists, keyed by number. Both merge
 * styles GitHub writes carry it: `Merge pull request #139 from …` on a merge
 * commit, and `title (#139)` on a squash. A rebase merge writes neither, which
 * is why the caller falls back to matching the sha.
 */
export function mergedPullRequestNumber(message: string | undefined): number {
  const m = /(?:^Merge pull request #(\d+)\b)|(?:\(#(\d+)\)\s*$)/m.exec((message ?? '').trim());
  return m ? Number(m[1] ?? m[2]) : 0;
}

/** `refs/heads/feature/x` → `feature/x`; a tag or a missing ref → `''`. */
export function branchFromRef(ref: string | undefined): string {
  if (!ref?.startsWith('refs/heads/')) return '';
  return ref.slice('refs/heads/'.length);
}

/**
 * A commit message's first line — what a card shows. Only the display is
 * truncated: refs are read from the *whole* message, because `Fixes TSK-3` on
 * its own line below the subject is the convention half of git already follows,
 * and a squash-merge body legitimately names every issue it swept up.
 */
export function commitSubject(message: string | undefined): string {
  return (message ?? '').split('\n', 1)[0].trim();
}
