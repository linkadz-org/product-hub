/**
 * A workspace's link to GitHub.
 *
 * Two secrets, two different jobs. `token` rides in the webhook URL and is the
 * only thing that names the workspace — a GitHub delivery carries nothing that
 * identifies us, so without it we'd have to guess. `secret` is GitHub's HMAC key
 * and proves the delivery really came from GitHub rather than from anyone who
 * learned the URL. Losing either is recoverable: reconnecting mints both again.
 *
 * The URL is shown whenever it's asked for (it is useless on its own); the HMAC
 * secret is shown once, at connect time, the same way an API key is.
 */
export interface GitHubConnection {
  /** Opaque per-tenant id in the webhook path — resolves a delivery's workspace. */
  token: string;
  /** GitHub's "Secret" field: the HMAC-SHA256 key behind `X-Hub-Signature-256`. */
  secret: string;
  /** False until an admin connects, and again after they disconnect. */
  enabled: boolean;
  /** Repos we've accepted a delivery from — collected, never typed in. */
  connectedRepos: string[];
  /** Last accepted delivery, so Settings can show the link proving itself. */
  lastEventAt: Date | null;
  /** Repo of that delivery — the other half of "it works, and here's the proof". */
  lastEventRepo: string;
}

/** A workspace that has never connected: no secrets, nothing received. */
export function defaultGitHubConnection(): GitHubConnection {
  return {
    token: '',
    secret: '',
    enabled: false,
    connectedRepos: [],
    lastEventAt: null,
    lastEventRepo: '',
  };
}

/** Merge a stored (possibly partial, possibly absent) config over the defaults. */
export function normalizeGitHubConnection(
  stored: Partial<GitHubConnection> | undefined | null,
): GitHubConnection {
  return { ...defaultGitHubConnection(), ...(stored ?? {}) };
}

/** What a piece of linked work is. */
export enum CodeLinkKind {
  COMMIT = 'commit',
  PULL_REQUEST = 'pull_request',
}

/**
 * What a link points at. Issues (tasks and bugs) live in one collection and are
 * addressed by id; a backlog item is embedded in its roadmap, so it takes both
 * ids to reach one — which is why a link stores the pair rather than assuming
 * every subject is a top-level row.
 */
export enum CodeLinkSubject {
  ISSUE = 'issue',
  ROADMAP_ITEM = 'roadmap_item',
}

/**
 * A pull request's state as the UI shows it. GitHub splits this across three
 * fields (`state`, `merged`, `draft`) whose combinations aren't all meaningful —
 * a merged PR is also `closed`, a draft is also `open`. This collapses them to
 * the one answer a chip needs; see {@link pullRequestState}.
 */
export enum PullRequestState {
  DRAFT = 'draft',
  OPEN = 'open',
  MERGED = 'merged',
  CLOSED = 'closed',
}

/** Collapse GitHub's three flags into the single state the UI renders. */
export function pullRequestState(pr: {
  state: string;
  merged?: boolean;
  draft?: boolean;
}): PullRequestState {
  // Order matters: merged implies closed, and draft only means anything while open.
  if (pr.merged) return PullRequestState.MERGED;
  if (pr.state === 'closed') return PullRequestState.CLOSED;
  if (pr.draft) return PullRequestState.DRAFT;
  return PullRequestState.OPEN;
}

/**
 * Where in the payload we found the issue ref. Shown on the card as a quiet
 * caption, because "matched from the branch name" is the difference between a
 * link the author meant and one they got for free by branching well.
 */
export enum CodeLinkMatchedBy {
  /** The commit message body — the author typed the ref on this commit. */
  MESSAGE = 'message',
  /** The branch name — every commit on the branch inherits the link. */
  BRANCH = 'branch',
  /** A pull request's title or description. */
  TITLE = 'title',
  /**
   * A commit inside the pull request named it — the PR's own text never did.
   * Only ever set on a pull request, and it is the one value not read out of the
   * delivery in front of us: see `findSubjectsForBranch`.
   */
  COMMIT = 'commit',
}
