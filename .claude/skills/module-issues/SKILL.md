---
name: module-issues
description: Use when working on Issues — the unified task/bug entity in backend/src/{presentation,application,infrastructure}/issues and frontend/src/features/issues, the central record everything else foreign-keys into. Related to module-teams, module-cycles, module-roadmaps.
---

# Module: Issues

**Apps/paths:**
`backend/src/presentation/issues`, `backend/src/application/issues`,
`backend/src/infrastructure/issues`, `frontend/src/features/issues`

## Purpose
Issue is the unified, polymorphic record that replaced the separate Task and Bug
concepts: one Mongo collection (`issues`), one API, one entity, told apart by a
`kind` discriminator (`task` | `bug`). It carries every field either kind ever
needed (a flat union), with a neutral default (`''`/`0`) on the fields that don't
apply to that kind — e.g. a bug's `estimate` is `0`, a task's `severity` is `''`.
Almost every other module in the product (teams, cycles, roadmaps, projects,
reports/test-cases, labels, custom fields) links to an issue by id.

## Where it lives
- Backend:
  - Controller: `presentation/issues/issues.controller.ts` (`@Controller()`, mounted
    at `issues` by `presentation.module.ts` → routes are `/v1/issues`)
  - Use-cases: `application/issues/use-cases/` — `create-issue`, `get-issue(s)`,
    `update-issue`, `set-issue-status`, `delete-issue`, plus `resolve-assignees`
    helper
  - Entity/domain: `application/issues/domain/entities/issue.entity.ts` +
    `issue.props.ts` (the `IssueProps` interface), enums in
    `domain/enums/issue.enums.ts`
  - Repository interface: `application/issues/repositories/issue.repository.ts`;
    Mongo impl: `infrastructure/issues/repositories/issue.repository.ts`
  - Mongoose schema: `infrastructure/issues/entities/issue.schema.ts` (collection
    `issues`)
  - DTOs: `application/issues/dtos/{create,update,update-issue-status,query}-issue.dto.ts`,
    `issue.response.dto.ts`; mapper: `application/issues/mappers/issue.mapper.ts`
- Frontend: `features/issues/` — `IssuesPage.tsx` (board/list), `IssueDetailPage.tsx`
  / `IssueDetailMain.tsx` / `IssueDetail.tsx` / `IssuePeekDrawer.tsx` (detail views),
  `IssueTimelineView.tsx`, `IssueRelations.tsx` + `useRelationActions.tsx` +
  `relations.api.ts` (issue-links), `BulkActionBar.tsx` + `bulk.api.ts`,
  `PickIssueDialog.tsx`, `issueTree.ts`, `ParentPropField.tsx` + `useParentPicker.tsx`,
  `api.ts` (queries/mutations),
  `hook-factory.ts` (`makeIssueHooks` — generates the query hooks),
  `useIssueSelection.ts`, `useIssueCrumb.ts`
  - `issueTree.ts` is the client-side hierarchy layer, because `parentId` reads
    return **one level only**: `useIssueDescendants` walks `GET /issues?parentId=…`
    a level at a time (cap `MAX_DEPTH = 5`, per-level `limit` 100 = the
    `PaginationDto` ceiling, a `seen` set breaking any cycle), `toIssueTree` puts a
    flat set into depth-annotated tree order (parent not in the set ⇒ root, so a
    row can't vanish), `subtreeIds` answers both "what comes along if I tick this"
    and "what may this **not** be re-parented under" — the same set — and
    `rootsOf` picks out what a `parentId`-writing host should actually move.
  - `PickIssueDialog` is the single picker for every "link an existing issue"
    flow (relations, sub-tasks, backlog items). `multiple` swaps its rows for
    checkboxes plus a "Link (N)" confirm; matches are shown with their descendants
    nested beneath, and ticking a parent cascades down the subtree (partial
    selection shows the indeterminate dash). `onPick` hands back
    `{ id, parentId }[]` — the `parentId` is what lets a host tell a picked root
    from a picked descendant.
  - Setting an issue's **own** parent is the **Properties row** `ParentPropField`
    (set / change / clear), backed by `useParentPicker` — dialog state, the
    exclude set, the write and the error toast in one hook, so a second surface
    offering the action can't drift from it. Properties is the only place that
    works on surfaces with no page header (peek drawer, Inbox), which is why the
    row owns its own picker rather than taking one down. Hierarchy used to be
    creatable only *downwards* — from the parent's Sub-tasks panel or via MCP —
    so an issue could be shown a breadcrumb it had no way to acquire from its own
    page. The picker excludes itself plus `useIssueDescendants`/`subtreeIds` (a
    parent from below is exactly a cycle; the API refuses one anyway, this just
    stops it being offered) and searches **both kinds**.
  - `BacklogItemPropField` is the neighbouring row and a **different relation**: a
    backlog item lives in `roadmaps.items`, not the `issues` collection, so it can
    never be a `parentId` — an issue has a parent issue *and* a backlog item,
    independently. Both kinds get it (the mapper serves the roadmap fields for
    every issue); options and the four-field write come from
    `features/roadmaps/useBacklogLink.ts`. Searching `RM-…` in an issue picker is
    the obvious wrong guess, so `PickIssueDialog`'s empty state names this field.
  - **The trail is `board › backlog item › parent issue › this issue`**, widest
    first, both middle crumbs optional (`useIssueCrumbParent`). The backlog crumb
    is a *link to a roadmap item*, not hierarchy — it's there because the trail is
    where people look for "what does this sit under", and the answer is often the
    backlog item rather than a parent task. It resolves through
    `useBacklogLink(enabled).itemFor` — which fetches `GET /roadmaps` **only** for
    an issue that has an item, falling back to the stored
    `"<phase> · <title>"` label until it lands.
  - **Crumbs show titles, refs are hover text** — including the page's own last
    crumb (`title={issue.title}`, `subtitle={issue.shortId}`). `RM-7VBD8CR ›
    TSK-MNWG4V2` is a trail only to someone who already memorised both, and the
    ref is already printed above the body heading and sitting in the URL. Each
    crumb's tooltip is `ref · title`, so nothing is lost and a truncated title is
    still readable; a missing title falls back to the ref rather than rendering an
    empty crumb. This also names the browser tab (`usePageTitle` takes the title).
  - **Every `PageCrumb` navigates** — `to` is required. An empty position is never
    held open with a placeholder: a trail entry that acts instead of navigating is
    a control, and controls live in Properties. (A dashed "No parent" crumb that
    opened the picker was tried and removed; the backlog item took that slot.)

## Data model & key fields
Collection `issues`, entity `IssueProps` — flat union of old Task/Bug shapes:
- Identity: `id`, `kind` (`task`|`bug`), `tenantId`, `shortId` (`TSK-7`/`BUG-12`,
  unique per tenant via partial index on `shortId > ''`)
- Linkage: `teamId`, `ownerId` (task-only — private personal task, '' = team
  issue/bug), `parentId` (sub-issue — **both kinds**: a bug nests under a bug or a
  task just as a task does), `projectId`, `cycleId`,
  `carryOverCount`, `roadmapId`/`roadmapItemId`/`roadmapItemLabel` (task-only
  backlog link), `caseId`/`caseLabel`/`reportId` (bug-only, links to a test case)
- People: `assignees: {id,name}[]` (ordered, denormalized name), plus deprecated
  mirrors `assigneeId`/`assigneeName` = `assignees[0]` (kept in sync by the entity,
  never set independently — queries `$or` both because pre-multi-assign rows only
  have the mirror); `createdBy`/`createdByName`; `reporterId`/`reporterName`
  (bug-only, mirrors creator)
- Dates/sizing: `startDate`, `endDate` (the deadline board sorts/flags on),
  `dueDate` (task-only deprecated mirror of `endDate`), `estimate` (task-only,
  Fibonacci-ish scale)
- Bug specifics: `severity`, `type`, `attachments: BugAttachment[]`
- Shared meta: `status` (free string — built-in enum key or a team's custom column
  slug), `labelKeys: string[]`, `customFields: Record<string, CustomFieldValue>`,
  `order`, `createdAt`/`updatedAt`, `resolvedAt: Date|null` (stamped/cleared only by
  `IssueEntity.setStatus` crossing the done boundary — never client-settable)
- `IssueKind`: `TASK`/`BUG`. Status/severity/estimate enums are re-exported from
  the legacy `@application/tasks` and `@application/bugs` enum homes (single
  source of truth during migration). `COMPLETED_STATUS_KEYS` per kind
  (bug: resolved/closed; task: done) drives `isCompletedStatus`.
- Indexes: `{tenantId, shortId}` unique partial, `{tenantId, 'assignees.id'}`
  (compound), plus single-field indexes on `kind`, `tenantId`, `teamId`,
  `ownerId`, `parentId`, `roadmapId`, `roadmapItemId`, `projectId`, `cycleId`,
  `assigneeId`, `caseId`, `reportId`, `resolvedAt` (no compound `{tenantId, kind}`
  index).

## API surface
All under `/v1/issues` (`IssuesController`, no path decorator — prefix supplied by
`RouterModule` in `presentation.module.ts`):
- `GET /v1/issues` — list, filters via `QueryIssueDto` (kind, status, severity,
  assigneeId, teamId, mine, personal, ids, parentId, roadmapItemId, roadmapId,
  projectId, cycleId incl. `current`/`upcoming`/`none` sentinels, caseId, reportId,
  createdFrom/To, resolvedFrom/To, `search` — free text over title/description/
  id/shortId, inherited from the shared `PaginationDto`). A team-scoped read
  (`teamId` set) also lazily advances that team's cycles (see Relationships).
- `POST /v1/issues` — create (roles: ADMIN, TESTER, PRODUCT, DEVELOPER)
- `GET /v1/issues/:id` — get one. **The only read that resolves the parent**:
  `GetIssueUseCase` returns `{ issue, parent }` (parent tenant-scoped and put
  through the same `isVisibleTo`, so a private parent reads as none), and
  `IssueMapper.toResponseDto(issue, parent)` flattens it to `parentShortId` /
  `parentTitle`. A list leaves both `''` — one lookup per row isn't worth it, and
  nothing on a board needs them. Fills the detail breadcrumb (`useIssueCrumbParent`)
  and MCP `get_issue`'s `parent:` line.
- `PATCH /v1/issues/:id` — update. **The one write that can create a hierarchy
  cycle, so it's the one place that guards it**: a non-empty `parentId` goes
  through `UpdateIssueUseCase.parentIsSafe`, which walks *up* from the proposed
  parent (depth of the tree, not size of the subtree) and rejects itself or any of
  its own descendants. A parent that's missing, another tenant's, or invisible to
  the caller fails with the same `Parent issue not found`, so the error is no
  existence oracle. `parentId: ''` detaches and skips the walk. MCP's
  `update_issue { issue, parent }` delegates here, so it inherits all of it.
- `PATCH /v1/issues/:id/status` — move to another status column
- `DELETE /v1/issues/:id` — delete (deleting a *bug* requires ADMIN/PRODUCT;
  enforced by `canDeleteBug` passed from the controller, task delete is broader)

## Relationships to other modules
- [[module-teams]] — `teamId` scopes an issue to a team's board/list; team
  `status` columns (built-in + custom) are what `status` points at. Team also
  supplies `labels` (source of `labelKeys`) and custom-field defs (source of
  `customFields` keys). `CreateIssueUseCase` also reads `ITeamRepository` for
  the tenant's per-kind `DEFAULT_TEAMS` fallback (`qc`/`engineering`).
- [[module-cycles]] — `cycleId` commits an issue to a team's auto-sprint;
  `carryOverCount` tracks scheduler rollovers between cycles. `CreateIssueUseCase`
  auto-joins a new issue to its landing team's ACTIVE cycle when the team runs
  cycles and no `cycleId` was given; `GetIssuesUseCase` calls
  `CycleSchedulerService.ensureCyclesCurrent`/`resolveCycleFilter` on every
  team-scoped list read (no cron — reads are what advance the cycle clock).
- [[module-roadmaps]] — `roadmapId`/`roadmapItemId`/`roadmapItemLabel` link a task
  to the backlog item it delivers.
- [[module-projects]] — optional `projectId` grouping.
- [[module-reports]] — a bug's `caseId`/`caseLabel`/`reportId` link back to the
  test case / report section it was filed from.
- [[module-issue-links]] — richer typed relations between issues (blocks/relates
  to/etc.), consumed by `IssueRelations.tsx`/`relations.api.ts` on top of this
  entity.
- [[module-users]] — `assignees`, `createdBy`, `reporterId` reference user ids
  with denormalized names.
- [[module-labels]] / [[module-custom-fields]] — `labelKeys` and `customFields`
  values are validated against the owning team's configured labels/fields.
- [[module-webhooks]] — `CreateIssueUseCase` fires `BUG_CREATED`/`BUG_ASSIGNED`
  notifications (best-effort) when a bug is created.
- [[module-my-team]] / [[module-planning]] — team boards, "assigned to me", and
  personal board views all read/filter this same collection.
- [[module-activity]] — `IssueActivityController` is the one comment thread for
  both kinds (`:issueId` = the issue's id); `IssueDetailMain.tsx` mounts
  `CommentThread`/`ActivityHeader` under the description.
- [[module-favourites]] — `FavouriteKind.Issue` covers both kinds; the detail
  header's `FavouriteButton` toggles it.
- [[module-reactions]] — `ReactionBar` mounts under the Description in
  `IssueDetailMain.tsx` for the fixed-emoji quick-reaction bar.
- [[module-docs]] — `LinkedDocsSection` (via `DocLinkRef`/`refId`) shows doc
  pages attached to the issue on its detail view.
- [[module-inbox]] — `GetInboxUseCase` injects `IIssueRepository` as a read-only
  consumer (only calls `findByTenant`, never writes) to compute "assigned bug"
  notifications.
- [[module-mcp]] — `IIssueRepository.bugStats(tenantId, filter, dimensions, trend?)` runs a
  multi-dimension bug distribution in a single `$facet`; only the dimensions asked for are
  built into the pipeline. Cap and empty-bucket rules live in
  `application/mcp/domain/mcp-bug-stats.ts`, not in the repository. Used by `get_bug_stats`.

## Gotchas & conventions
- **Three caches, one collection.** `makeIssueHooks` is bound three times —
  `issues`/`issue`, `bugs`/`bug`, `tasks`/`task` — and every one is a view of the
  same `issues` documents. A write therefore has to invalidate **all six keys**
  (`ISSUE_CACHE_KEYS` in `hook-factory.ts`), not just the namespace it was issued
  through: a Properties field on `BugDetail` mutates via `useUpdateIssue` (the
  `issues` namespace) while the page reads `useBug` (`['bug', id]`), so a
  namespace-local invalidate leaves the server updated and **the control snapping
  back to its old value** — indistinguishable from a save that failed. Only
  *mounted* queries actually refetch, so the broad invalidate is cheap. A fourth
  binding of the factory must add itself to that list.
- **teamId fallback gotcha** (CLAUDE.md): `CreateIssueUseCase` resolves
  `teamId = dto.personal ? '' : dto.teamId || team?.id.toString() || ''`, where
  `team` is the tenant's **default** team for the kind (QC for bugs, Engineering
  for tasks). **A caller that omits `teamId` doesn't fail — the issue silently
  lands in the wrong team's board**, looking like it saved but not showing up
  where the user was looking. Every board/create-flow must pass its own
  `teamId` explicitly (see `IssueBoardLayout`/`KanbanBoard` conventions in
  CLAUDE.md); routes with no team context (`/bugs`, `/tasks`) rely on this
  fallback intentionally.
- Deprecated mirror fields (`assigneeId`/`assigneeName`, `dueDate`) are
  entity-maintained, never set directly — always go through `assignees`/`endDate`
  and let the entity sync the mirror. Repository assignee filters `$or` across
  `assigneeId` and `assignees.id` to cover pre-multi-assign rows.
  Note: `IssueDoc`/schema define `assigneeId`/`assigneeName` similarly.
- `resolvedAt` is owned entirely by `IssueEntity.setStatus`: first move into a
  completed status stamps it, reopening clears it — never set it from a DTO/client.
- `status` has no enum/validation beyond `IsString` — it can be a built-in key or
  any of a team's custom column slugs, spanning both kinds.
- Per project rule: response DTO (`IssueResponseDto`) is a flat interface, no
  nested sub-objects — mirrored on the frontend `IssueDto`.
- A personal task (`ownerId` set) is always `kind=task` — bugs can never be
  personal; team/assigned list views filter `ownerId: ''` to exclude personal
  tasks from team boards.
- **A timeline row carries the same chips as the card and the list row** — ref,
  team, status, severity, labels, assignees. They go in `GanttRow.meta` (the
  shared `<GanttChart>`'s rail slot) and are built from `GanttChip`,
  `LabelChips`, `AssigneeBadge` and `TeamChip`, so all three views of a board
  stay one treatment; add a chip by filling that slot in the adapter
  (`IssueTimelineView`, `RoadmapGantt`), never by styling a pill in a page.
  `TeamChip` appears only when the rows actually **span** teams — on a single
  team's board the page title already says it, and the rail is narrow.
  Lookups (`statusesFor`/`labelsFor`/`teamFor`) are injectable so the public
  board supplies its one team and fires no authed `/teams` fetch.

## Related skills
[[module-teams]] [[module-cycles]] [[module-roadmaps]] [[module-projects]] [[module-reports]] [[module-issue-links]] [[module-labels]] [[module-custom-fields]] [[module-users]] [[module-webhooks]] [[module-activity]] [[module-favourites]] [[module-reactions]] [[module-docs]] [[module-inbox]] [[module-mcp]]
