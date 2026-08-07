import { ApiProperty } from '@nestjs/swagger';
import { IssueKind } from '@application/issues/domain/enums/issue.enums';
import { TeamIssueType, TeamStatusConfig } from '@application/teams/domain/enums/team.enums';
import { RoadmapColumn } from '@application/roadmaps/domain/types/roadmap-item.type';

/** A team an MCP client can file into, with the exact status keys it accepts. */
export class McpTeamDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: TeamIssueType })
  issueType: TeamIssueType;

  @ApiProperty({ description: 'Where issues of this kind land when no team is named' })
  isDefault: boolean;

  @ApiProperty({ description: 'The board columns — `key` is what `status` accepts' })
  statuses: TeamStatusConfig[];
}

export class McpRoadmapDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ description: 'Columns — `key` is what `phase` accepts' })
  columns: RoadmapColumn[];

  @ApiProperty()
  itemCount: number;
}

export class McpPersonDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

/**
 * Everything a client needs before its first write: who it is acting as, which
 * teams and roadmaps exist, and the exact keys their columns accept.
 */
export class McpContextResponseDto {
  @ApiProperty({ description: 'The API key label the call arrived on' })
  keyName: string;

  @ApiProperty({ description: 'The key owner — writes are attributed to them' })
  userName: string;

  @ApiProperty()
  userEmail: string;

  @ApiProperty({ type: [McpTeamDto] })
  teams: McpTeamDto[];

  @ApiProperty({ type: [McpRoadmapDto] })
  roadmaps: McpRoadmapDto[];

  @ApiProperty({ type: [McpPersonDto], description: 'Assignable people' })
  people: McpPersonDto[];
}

/** What an MCP client gets back after creating an issue — enough to quote a
 *  reference and hand the user a link, without a follow-up read. */
export class McpIssueResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: IssueKind })
  kind: IssueKind;

  @ApiProperty({ description: 'Human reference, e.g. ENG-14' })
  shortId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  teamId: string;

  @ApiProperty()
  teamName: string;

  @ApiProperty({
    type: [String],
    description: 'Names of everyone on the issue, primary first (empty = unassigned)',
  })
  assigneeNames: string[];

  @ApiProperty()
  severity: string;

  @ApiProperty()
  estimate: number;

  @ApiProperty()
  startDate: string;

  @ApiProperty()
  endDate: string;

  @ApiProperty({ description: 'In-app path, e.g. /issues/ENG-14' })
  link: string;

  @ApiProperty()
  updatedAt: Date;
}

/** One subtask line under an issue detail — enough to quote and address it. */
export class McpSubtaskDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Human reference, e.g. ENG-14' })
  shortId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  status: string;
}

/** One comment line — a flattened, excerpted view for a tool reply. Replies carry
 *  their root's id in `parentId` so a one-level thread reads back correctly. */
export class McpCommentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  authorName: string;

  @ApiProperty({ description: 'Plain-text excerpt of the body (~280 chars)' })
  excerpt: string;

  @ApiProperty({ description: 'Root comment id when this is a reply; empty for top-level' })
  parentId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/** What add_comment/update_comment hand back — enough to confirm and to link. */
export class McpCommentResultDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'The issue the comment lives on' })
  issueId: string;

  @ApiProperty({ description: 'Issue ref, e.g. ENG-14' })
  issueShortId: string;

  @ApiProperty()
  authorName: string;

  @ApiProperty({ description: 'Plain-text excerpt of the body (~280 chars)' })
  excerpt: string;

  @ApiProperty({ description: 'Root comment id when this is a reply; empty for top-level' })
  parentId: string;

  @ApiProperty({ description: 'In-app path to the issue, e.g. /issues/ENG-14' })
  link: string;
}

/** The trace delete_comment hands back — enough to confirm what went. */
export class McpDeletedCommentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Issue ref the comment was on' })
  issueShortId: string;
}

/**
 * A full read of one issue: its flat fields, its subtasks, and its most recent
 * comments (`commentCount` is the total; `comments` is capped to the latest few,
 * with `list_comments` for the whole thread).
 */
export class McpIssueDetailResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: IssueKind })
  kind: IssueKind;

  @ApiProperty({ description: 'Human reference, e.g. ENG-14' })
  shortId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  teamId: string;

  @ApiProperty()
  teamName: string;

  @ApiProperty({ type: [String] })
  assigneeNames: string[];

  @ApiProperty()
  severity: string;

  @ApiProperty()
  estimate: number;

  @ApiProperty()
  startDate: string;

  @ApiProperty()
  endDate: string;

  @ApiProperty({ type: [String], description: 'Team label keys on the issue' })
  labelKeys: string[];

  @ApiProperty({ description: "Parent issue's reference ('' when top-level)", example: 'BUG-12' })
  parentShortId: string;

  @ApiProperty({ description: "Parent issue's title ('' when top-level)" })
  parentTitle: string;

  @ApiProperty({ type: [McpSubtaskDto], description: 'Subtasks (capped); see subtaskCount for total' })
  subtasks: McpSubtaskDto[];

  @ApiProperty({ description: 'Total subtasks on the issue' })
  subtaskCount: number;

  @ApiProperty({ type: [McpCommentDto], description: 'Latest comments (capped); see commentCount for total' })
  comments: McpCommentDto[];

  @ApiProperty({ description: 'Total comments on the issue' })
  commentCount: number;

  @ApiProperty({ description: 'In-app path, e.g. /issues/ENG-14' })
  link: string;

  @ApiProperty()
  updatedAt: Date;
}

/** The trace an MCP client gets back after a delete — enough to confirm what went. */
export class McpDeletedIssueResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: IssueKind })
  kind: IssueKind;

  @ApiProperty()
  shortId: string;

  @ApiProperty()
  title: string;
}

/** A doc, plus the page its text went into — the link has to point at a page. */
export class McpDocResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'The first page, where the body was written' })
  pageId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty({ description: 'In-app path, e.g. /docs/<id>/<pageId>' })
  link: string;
}

/**
 * One row of `list_docs` — enough to recognise a doc and address it in a
 * follow-up call, without any page body.
 *
 * `publicToken` is deliberately absent here and in every shape below: it is the
 * credential for a doc's public share link, and handing it to a tool reply would
 * publish the doc to anyone who read the transcript.
 */
export class McpDocBriefDto {
  @ApiProperty({ description: 'Human reference, e.g. DOC-3 — pass it as `doc`' })
  ref: string;

  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty({ description: 'How many pages the doc holds' })
  pageCount: number;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * One page in a doc's table of contents — **no body**. `parentId` preserves the
 * nesting and `order` the sequence, so the tree reads back correctly; the body
 * is fetched one page at a time with get_doc_page.
 */
export class McpDocPageBriefDto {
  @ApiProperty({ description: 'Page id — pass it to get_doc_page or update_doc `page`' })
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ description: "Parent page id ('' when top-level)" })
  parentId: string;

  @ApiProperty({ description: 'Sequence among its siblings' })
  order: number;
}

/**
 * A doc and its page list. Carries no page bodies on purpose — a weekly report
 * with several long HTML tables would otherwise arrive in full on every lookup.
 * Read the one page you are about to rewrite with get_doc_page.
 */
export class McpDocDetailResponseDto {
  @ApiProperty({ description: 'Human reference, e.g. DOC-3' })
  ref: string;

  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty({ type: [McpDocPageBriefDto], description: 'The page tree, without bodies' })
  pages: McpDocPageBriefDto[];

  @ApiProperty()
  updatedAt: Date;
}

/** One page's body, exactly as stored — the text update_doc would replace. */
export class McpDocPageResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ description: "The page's HTML body" })
  content: string;

  @ApiProperty()
  updatedAt: Date;
}

/** What update_doc hands back — the doc's current state plus a note of what the
 *  call changed, so the assistant can confirm each part it asked for. */
export class McpUpdatedDocResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty({ description: 'In-app path to a page of the doc, e.g. /docs/<id>/<pageId>' })
  link: string;

  @ApiProperty({ description: 'Human summary of what changed, e.g. "renamed, edited a page"' })
  changed: string;

  /**
   * Empty on a clean write. Set when the write committed but something the
   * caller has to know about did not — today: the live editing session could not
   * be refreshed, so an open editor may write its stale copy back over the
   * change. Reported rather than thrown: the write already happened, and the one
   * thing worse than a warning here is a silent success.
   */
  @ApiProperty({ description: 'Set when the write committed but needs a caveat; else empty' })
  warning: string;
}

/**
 * What `list_docs` hands back. `total` is the whole workspace's doc count, so a
 * reply built from a truncated `docs` can say how many it did not show rather
 * than implying the workspace holds only these.
 */
export class McpDocListResponseDto {
  @ApiProperty({ type: [McpDocBriefDto] })
  docs: McpDocBriefDto[];

  @ApiProperty({ description: 'How many docs the workspace holds, before the limit' })
  total: number;
}

/** One backlog item in a browse listing — flat, enough to pick and link one. */
export class McpBacklogItemBriefDto {
  @ApiProperty({ example: 'RM-6', description: 'Ref to quote or link against' })
  shortId: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ description: 'The column the item sits in' })
  phase: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ description: 'RICE, derived from reach × impact × confidence ÷ effort' })
  riceScore: number;

  @ApiProperty({ description: 'The roadmap the item belongs to' })
  roadmapTitle: string;

  @ApiProperty({ description: 'In-app path, e.g. /roadmaps/<id>/items/<itemId>' })
  link: string;
}

/** One relation touching an issue — flat, with the link id needed to unlink. */
export class McpIssueLinkDto {
  @ApiProperty({ description: 'Link id — pass to unlink_issues to remove the relation' })
  id: string;

  @ApiProperty({ description: 'Relation, from the asked-about issue’s perspective' })
  relationType: string;

  @ApiProperty({ description: 'The other issue’s ref' })
  targetShortId: string;

  @ApiProperty()
  targetTitle: string;

  @ApiProperty()
  targetStatus: string;
}

/** What link_issues hands back — enough to confirm the relation it created. */
export class McpLinkResultDto {
  @ApiProperty({ description: 'Source issue ref' })
  fromShortId: string;

  @ApiProperty({ description: 'Target issue ref' })
  toShortId: string;

  @ApiProperty({ description: 'The relation stored, from `from` to `to`' })
  relationType: string;
}

/** What unlink_issues hands back — the id of the relation that was removed. */
export class McpUnlinkResultDto {
  @ApiProperty({ description: 'The link id that was removed' })
  linkId: string;
}

export class McpBacklogItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'RM-6', description: 'Ref to quote back to the user' })
  shortId: string;

  @ApiProperty()
  roadmapId: string;

  @ApiProperty()
  roadmapTitle: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  phase: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ description: 'RICE, derived from reach × impact × confidence ÷ effort' })
  riceScore: number;

  @ApiProperty({ description: 'In-app path, e.g. /roadmaps/<id>/items/<itemId>' })
  link: string;
}
