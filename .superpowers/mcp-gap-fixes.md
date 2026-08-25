# MCP doc reads — gap fixes

Branch `feat/mcp-doc-reads`. Seven audit findings, all fixed.

## The leftover working tree

The previous interrupted attempt left ~7 modified files and two new paths
(`application/docs/collab-sync.port.ts`, `infrastructure/collab/`). It was **kept, not
discarded**: the three failing suites were failing for three mechanical reasons — a use-case
constructor that had gained an argument the spec didn't pass, a controller returning the old
`McpDocBriefDto[]` shape, and a test asserting `toHaveLength` on the new
`{ docs, total }` object. None of that is design rework. What the attempt had *not* reached was
FIX 6 at all, the module wiring, `.env.example`, and every test. Those were done here.

## FIX 1 — an MCP write can be silently reverted by the collab server

`update_doc` wrote Mongo only. A page anyone has open is served from the collab room's Y.Doc,
which the mirror writes back over `docpages.content` on store — so the tool reported success and
the edit was gone on the next keystroke.

- `ICollabSync` (`application/docs/collab-sync.port.ts`) — one method, `resetPage`. Documented as
  never throwing: the body write has already committed by the time it is called.
- `CollabSyncService` (`infrastructure/collab/`) — POSTs `/reset?page=<id>`, authenticating with a
  token it mints itself. `collab/src/env.ts` documents `JWT_SECRET` as byte-identical to the
  API's, and `verifyToken` wants only `userId`/`tenantId`/`role`, so no second shared secret. The
  role is `PRODUCT` — the least privileged of the three `canWrite` admits. TTL 60s (a machine
  credential for one call), timeout 3s via `AbortSignal.timeout`.
- Config: `COLLAB_HTTP_URL`, read through `ConfigService` like the rest of the backend, documented
  in `.env.example`. **Unset is a clean `not-configured` no-op** — a deployment without collab is
  a supported shape.
- Called only after `updatePage` actually succeeded, so title/tags-only edits never touch it.
- A failure does **not** fail the write. It sets `McpUpdatedDocResponseDto.warning`, which the
  factory prints last in the tool reply as `⚠ …` — naming the cause and the consequence ("their
  editor still holds the previous text and may write it back over this change").

Tested at both levels: the service's three paths (`collab-sync.service.spec.ts`) and the
use-case's (no-op / success + ordering / failure-with-warning).

## FIX 2 — `stripEchoedTitle` on write-back

Per the product owner's choice: **compose strips, replace does not.** `create_doc` and
`appendPage` still call `stripEchoedTitle`; `update_doc`'s body branch now passes
`docBodyToHtml(dto.content)` straight through.

The broken test is fixed at the fixture: `STORED` now opens `<h2>Discovery notes</h2>`, which is
the target page's actual title, so the strip branch is genuinely on the path. Added: a
write-back that preserves the matching heading, a three-pass loop proving it isn't shaved a
little at a time, and two tests that `appendPage`/`create_doc` still strip.

## FIX 3 — page-tree walk

`describeDocDetail` gained a `seen` set (a pre-existing cycle is explicitly tolerated by
`ReorderDocPagesUseCase`, and without the guard it recursed to "Maximum call stack size
exceeded"), and anything the walk didn't reach is now listed under "Not attached to the tree" —
so the page count in the header always matches what is printed.

## FIX 4 — `describeDoc` addressability

Leads with `d.ref || d.id` (`ref: ''` is a documented pre-backfill state) and ends with
`this.url('/docs/<id>')`, matching `describeIssue`/`describeBacklogItem`.

## FIX 5 — `list_docs` bound

`McpListDocsDto { limit }`, default 20, max 50 — `search_issues`'s shape, since docs are browsed
to pick one rather than read in bulk. The use-case now returns `{ docs, total }` so a truncated
reply can say *"20 of 140 docs (most recent first — raise `limit` for more)"* instead of reading
as the whole workspace. The REST mirror (`GET /mcp/docs`) takes the same query DTO.

## FIX 6 — hand-pasted mermaid

Two bugs in `promoteMermaid`, both fixed in `mcp-doc-body.ts`:

- `<br/>` was removed by the blanket tag strip, welding a line-oriented mermaid source onto one
  unparseable line. `stripTagsKeepingLines` converts break tags to newlines first.
- `unescapeHtml` decoded only `&lt; &gt; &amp;`, so `&quot;` survived and was then re-escaped to
  `&amp;quot;` — a literal `&quot;` in the rendered label. It now handles named
  (`lt gt quot apos nbsp`) and numeric/hex references, with `&amp;` decoded in a **second** pass
  so `&amp;quot;` (an author who meant the text) survives as `&quot;` rather than collapsing
  twice.

`ALREADY_A_DIAGRAM` still skips the app's own `mermaid-source` form — pinned by a test that a
second pass over stored HTML is byte-identical.

## FIX 7 — unbounded version history

Two measures, and the second is the one worth explaining.

1. **No snapshot for a no-op write.** `update_doc` compares the incoming body against
   `target.content`; if equal it writes nothing, snapshots nothing, refreshes no collab room, and
   reports `"page already matched — nothing written"` rather than claiming an edit.

2. **A retention cap of 10, scoped by label.** `SaveDocPageVersionUseCase` takes an optional
   `retain`, and `IDocPageVersionRepository.pruneByPageAndLabel(pageId, label, keep)` drops
   everything past the newest `keep` **that carries that label**.

   This is what makes the cap safe to add without changing what a human's manual save does. MCP's
   snapshots all carry `MCP_VERSION_LABEL`; a person's save carries their own label or none.
   Pruning matches on the label, so a machine cap can only ever delete the machine's own
   snapshots — a human's version is neither counted against the cap nor eligible for deletion.
   `retain` is passed by `update_doc` and by nothing else, so the manual-save path is untouched
   and still strictly append-only. Guarded further: an empty label never prunes (it would match
   exactly the unlabelled set humans land in), and a prune that throws is swallowed — the version
   is already stored and the caller is about to overwrite the page on the strength of it.

   The repo query selects `_id` only. Loading full bodies to decide what to delete would cost
   exactly the memory being reclaimed.

   `findByPage` still loads content for every version; capping the machine's writes fixes the
   growth, but a project that wants the *list* to be cheap should project content out of it. Left
   alone — it changes a read shape the frontend depends on, which is out of scope here.

## Gates

- `npx jest` — 44 suites, 433 tests, all passing.
- `npx tsc --noEmit -p tsconfig.json` — clean.
- `collab/` untouched, so not typechecked.
