import {
  CodeLinkKind,
  CodeLinkMatchedBy,
  CodeLinkSubject,
  PullRequestState,
} from '../domain/github.types';

/** One piece of source-control work attached to one task, bug or backlog item. */
export interface CodeLinkRecord {
  id: string;
  tenantId: string;
  subjectType: CodeLinkSubject;
  /** Internal id of the issue or roadmap item — resolved from the ref at write
   *  time, so reading a panel never has to parse text again. */
  subjectId: string;
  /** The roadmap holding the item, for a `roadmap_item` subject ('' otherwise).
   *  A backlog item is embedded, so its id alone doesn't locate it. */
  roadmapId: string;
  kind: CodeLinkKind;
  /** `owner/repo`. */
  repo: string;
  /** Commit sha ('' on a pull request). */
  sha: string;
  /** PR number (0 on a commit). */
  number: number;
  /** Commit subject, or the PR title. */
  title: string;
  /** Branch the commit landed on, or the PR's head branch. */
  branch: string;
  /** A pull request's target branch — `dev`, `main`: the environment it ships
   *  to, and the reason a reader cares which PR they're looking at. '' on a
   *  commit, where `branch` already says where the code ended up. */
  baseBranch: string;
  /** Only meaningful for a pull request. */
  state: PullRequestState | '';
  authorName: string;
  authorAvatarUrl: string;
  /** Where it lives on GitHub. */
  url: string;
  matchedBy: CodeLinkMatchedBy;
  /** When the work happened (commit time / PR open time) — not when we stored it. */
  occurredAt: Date;
  createdAt: Date;
}

/**
 * A link to write. `externalId` is the dedup key within (tenant, repo, kind):
 * a commit sha, or `pr-<number>`. GitHub redelivers on failure and re-sends a
 * pull request on every edit, so the same link arrives many times and must
 * collapse to one row.
 */
export interface UpsertCodeLinkData {
  tenantId: string;
  subjectType: CodeLinkSubject;
  subjectId: string;
  roadmapId: string;
  kind: CodeLinkKind;
  repo: string;
  externalId: string;
  sha: string;
  number: number;
  title: string;
  branch: string;
  baseBranch: string;
  state: PullRequestState | '';
  authorName: string;
  authorAvatarUrl: string;
  url: string;
  matchedBy: CodeLinkMatchedBy;
  occurredAt: Date;
}

/** A subject some link already points at — the "what does this touch" answer. */
export interface LinkedSubjectRef {
  subjectType: CodeLinkSubject;
  subjectId: string;
  roadmapId: string;
}

/** The same, carrying the provenance already stored — so re-writing a row to
 *  change its state doesn't rewrite the reason it exists. */
export interface ExistingLink extends LinkedSubjectRef {
  matchedBy: CodeLinkMatchedBy;
}

/** Port for code-link persistence. Every read is tenant-scoped. */
export abstract class ICodeLinkRepository {
  /** One subject's linked commits and PRs, newest work first. */
  findForSubject: (tenantId: string, subjectId: string) => Promise<CodeLinkRecord[]>;
  /** Link counts for many subjects at once — the list/board badge read. */
  countForSubjects: (tenantId: string, subjectIds: string[]) => Promise<Record<string, number>>;
  /**
   * Distinct subjects the commits on one branch are linked to.
   *
   * This is how a pull request finds the work inside it. GitHub's `pull_request`
   * payload carries a commit *count* and nothing else — reading the actual list
   * means calling their API with a token that can read the repo, which this
   * integration deliberately doesn't have. The push events that delivered those
   * commits already told us everything, so we ask ourselves instead.
   */
  findSubjectsForBranch: (
    tenantId: string,
    repo: string,
    branch: string,
  ) => Promise<LinkedSubjectRef[]>;
  /**
   * Subjects one commit or pull request is already linked to. A merged PR whose
   * text never named a ref is only reachable through this: it has to keep its
   * existing rows up to date (open → merged) even once the branch is gone.
   */
  findSubjectsForExternalId: (
    tenantId: string,
    repo: string,
    kind: CodeLinkKind,
    externalId: string,
  ) => Promise<ExistingLink[]>;
  /**
   * Insert, or update in place when this (repo, kind, externalId, subject) is
   * already known — a reopened PR must change state rather than stack up.
   */
  upsert: (data: UpsertCodeLinkData) => Promise<void>;
}
