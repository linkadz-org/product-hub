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
