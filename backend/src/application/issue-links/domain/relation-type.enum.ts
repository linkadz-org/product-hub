/**
 * How two issues relate *as peers*. Stored directionally source → target; the
 * four values map 1:1 to the "Mark as" menu. A link viewed from the *target*
 * side is shown with its inverse (below), so one stored row reads correctly from
 * both issues ("blocked by" ⇄ "blocking").
 *
 * **Hierarchy deliberately lives outside this enum.** "Is a sub-issue of" is
 * expressed by the child's `parentId` alone (one parent, always), never by a
 * link: two stores for one relation drifted apart — a `parentId` child was
 * invisible to the relations panel, and a link-only child was missed by the
 * parent's progress rollup. Parent/child = ownership (`parentId`), links =
 * association (here). Don't add PARENT_OF/SUB_ISSUE_OF back.
 */
export enum RelationType {
  BLOCKS = 'blocks', // source is blocking target
  BLOCKED_BY = 'blocked_by', // source is blocked by target
  RELATED_TO = 'related_to', // symmetric
  DUPLICATE_OF = 'duplicate_of', // symmetric (its own inverse)
}

/** The same link as read from the *other* endpoint. */
export const INVERSE_RELATION: Record<RelationType, RelationType> = {
  [RelationType.BLOCKS]: RelationType.BLOCKED_BY,
  [RelationType.BLOCKED_BY]: RelationType.BLOCKS,
  [RelationType.RELATED_TO]: RelationType.RELATED_TO,
  [RelationType.DUPLICATE_OF]: RelationType.DUPLICATE_OF,
};

/**
 * A kind of issue. Stored on a link as `issueType` = the *source* end's kind; the
 * two ends may differ (a bug can block a task), so the other end's kind is resolved
 * on read and returned as `targetKind`. Mirrors the frontend `IssueKind`.
 */
export enum IssueKind {
  Task = 'task',
  Bug = 'bug',
}
