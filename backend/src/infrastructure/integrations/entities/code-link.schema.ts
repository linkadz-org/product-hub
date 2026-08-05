import { Schema } from 'mongoose';
import { v4 as uuid } from 'uuid';

/**
 * The `code_links` collection — one document per (piece of source-control work,
 * subject) pair, where a subject is a task, a bug or a backlog item. A commit
 * naming two of them is two rows, so each detail panel is a single indexed read
 * with no fan-out.
 */
export interface CodeLinkDoc {
  _id: string;
  tenantId: string;
  /** issue | roadmap_item */
  subjectType: string;
  subjectId: string;
  /** Owning roadmap for a `roadmap_item` subject; '' for an issue. */
  roadmapId: string;
  /** commit | pull_request */
  kind: string;
  repo: string;
  /** Dedup key within (tenantId, repo, kind): a sha, or `pr-<number>`. */
  externalId: string;
  sha: string;
  number: number;
  title: string;
  branch: string;
  /** A PR's target branch (`dev`, `main`); '' on a commit. */
  baseBranch: string;
  /** draft | open | merged | closed — '' on a commit. */
  state: string;
  authorName: string;
  authorAvatarUrl: string;
  url: string;
  /** message | branch | title | commit */
  matchedBy: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const CodeLinkSchema = new Schema<CodeLinkDoc>(
  {
    _id: { type: String, default: () => uuid() },
    tenantId: { type: String, required: true, index: true },
    subjectType: { type: String, required: true },
    subjectId: { type: String, required: true, index: true },
    roadmapId: { type: String, default: '' },
    kind: { type: String, required: true },
    repo: { type: String, required: true },
    externalId: { type: String, required: true },
    sha: { type: String, default: '' },
    number: { type: Number, default: 0 },
    title: { type: String, default: '', maxlength: 500 },
    branch: { type: String, default: '' },
    baseBranch: { type: String, default: '' },
    state: { type: String, default: '' },
    authorName: { type: String, default: '' },
    authorAvatarUrl: { type: String, default: '' },
    url: { type: String, default: '' },
    matchedBy: { type: String, default: '' },
    occurredAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// The dedup key behind every write. GitHub retries a failed delivery and re-sends
// a pull request on every edit, so the same link arrives repeatedly; without this
// a detail panel would fill with copies of one commit.
CodeLinkSchema.index({ tenantId: 1, repo: 1, kind: 1, externalId: 1, subjectId: 1 }, { unique: true });
// The panel read: one subject's links, newest work first.
CodeLinkSchema.index({ tenantId: 1, subjectId: 1, occurredAt: -1 });
// "What work is on this branch" — asked once per pull request event, to find the
// commits inside a PR whose own title and body named nothing.
CodeLinkSchema.index({ tenantId: 1, repo: 1, branch: 1, kind: 1 });
