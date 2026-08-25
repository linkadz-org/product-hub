# MCP doc reads + snapshot-before-overwrite — implementation report

Spec: `docs/superpowers/specs/2026-08-06-mcp-doc-reads-design.md`
Branch: `feat/mcp-doc-reads`

## What was built

### 1. Three read tools + routes

| MCP tool | REST route | Wrapper use-case | Delegates to |
|---|---|---|---|
| `list_docs` | `GET /v1/mcp/docs` | `McpListDocsUseCase` | `GetDocsUseCase` |
| `get_doc` | `GET /v1/mcp/docs/:doc` | `McpGetDocUseCase` | `GetDocUseCase` |
| `get_doc_page` | `GET /v1/mcp/docs/:doc/pages/:page` | `McpGetDocPageUseCase` | `GetDocUseCase` → `GetDocPageUseCase` |

No new business logic. `:doc` accepts a `DOC-…` ref or a uuid (`findByIdOrRef`, inside
`GetDocUseCase`). `get_doc_page` resolves the ref to a uuid and then hands the page lookup to
`GetDocPageUseCase`, which is the authority on "this page belongs to this doc, in this tenant" —
that check is not duplicated in the wrapper.

All three are `readOnlyHint: true`, are registered without the `gated(...)` wrapper in the
factory, and their controller routes do not call `guardWrite` — so a `read-only` key can use them.

Files:
- `backend/src/application/mcp/use-cases/mcp.use-cases.ts` — the three wrappers
- `backend/src/application/mcp/dtos/mcp.dtos.ts` — `McpGetDocDto`, `McpGetDocPageDto`
- `backend/src/application/mcp/mcp.module.ts` — providers/exports
- `backend/src/presentation/mcp/mcp.controller.ts` — the three routes
- `backend/src/presentation/mcp/mcp-server.factory.ts` — `registerListDocs` / `registerGetDoc` /
  `registerGetDocPage`, plus `describeDoc` / `describeDocDetail` / `describeDocPage`

### 2. Response shapes

Added to the `McpDocResponseDto` family in `mcp.response.dto.ts`, flat per project convention:

- `McpDocBriefDto` — `ref, id, title, tags, pageCount, updatedAt`
- `McpDocPageBriefDto` — `id, title, parentId, order` (**no** `content`)
- `McpDocDetailResponseDto` — `ref, id, title, tags, pages[], updatedAt`
- `McpDocPageResponseDto` — `id, title, content, updatedAt`

`publicToken` is mapped in none of them, and presentation settings
(`fontStyle`/`fontSize`/`pageWidth`/`show*`/`icon`/`color`/`coverUrl`) are omitted.

`describeDocDetail` renders the page list as an indented tree (walking `parentId`, sorted by
`order`) with each page id in brackets, so the assistant can lift the id straight into
`get_doc_page` or `update_doc`'s `page`.

### 3. Snapshot before overwrite

`McpUpdateDocUseCase` now injects `SaveDocPageVersionUseCase` (5th constructor arg, before
`users`) and calls it inside the `dto.content !== undefined` branch, **before**
`UpdateDocPageUseCase`, labelled `Before update_doc (MCP)`.

- Not called for a title/tags-only edit, nor for `appendPage`.
- A failed snapshot returns a failure through the existing `partial(...)` helper and **skips the
  page write entirely** — the message names the snapshot error and says the edit was not applied.
- Nothing about what `update_doc` writes changed: it still passes only `{ content }`.

### 4. Description corrections

`update_doc`'s tool description (factory) and `McpUpdateDocDto`'s class doc:
- "read them first (the doc in the app)" → "Call get_doc_page first … Read immediately before
  writing, since anything edited in between is overwritten."
- Blast radius stated: "Only the body is replaced — the page's title, its attachments, its links
  to issues and its Page Styles all survive the write."
- Adds that each body write saves a restorable version first.
- The `page` and `content` field descriptions now point at `get_doc` / `get_doc_page`.
- `list_docs`'s description states refs look like `DOC-3` and that `list_workspace` doesn't
  mention docs.

## Spec Testing section → covering test

| Spec requirement | Test |
|---|---|
| `get_doc` returns no page `content` for any page | `mcp-doc-reads.use-case.spec.ts` → "returns NO page content for any page"; also `mcp-doc-reads.spec.ts` → "get_doc prints the page ids and titles but never a page body" and the REST route case |
| `get_doc_page` refuses a page from a different doc | `mcp-doc-reads.use-case.spec.ts` → "refuses a page id that belongs to a different doc" |
| …and one from another tenant | `mcp-doc-reads.use-case.spec.ts` → "refuses a page from another tenant" (+ "refuses a doc from another tenant" for `get_doc`) |
| All three succeed with a `read-only` key | `mcp-doc-reads.use-case.spec.ts` → three "succeeds on a read-only key" cases; `mcp-doc-reads.spec.ts` → "%s answers a read-only key…" (parameterised over the three tools) and the three route cases |
| …and none call `assertCanWrite` | `mcp-doc-reads.spec.ts` — `./mcp-scope` is `jest.mock`ed to a **failing** gate, so any gating both fails `expect(assertCanWrite).not.toHaveBeenCalled()` and turns the reply into an error |
| `:doc` resolves both `DOC-3` and the uuid | `mcp-doc-reads.use-case.spec.ts` → "resolves the DOC-… ref and the uuid to the same doc" and "resolves the doc by ref or by uuid before finding the page" |
| Round trip: read → write back unchanged → stored content identical | `mcp-update-doc.use-case.spec.ts` → "stores exactly what get_doc_page returned" and "is stable across a second pass" (body carries a table, an `<img>`, a stored mermaid `<figure>`, a link, a literal `\|`, and headings) |
| A version exists after an MCP body write | `mcp-update-doc.use-case.spec.ts` → "saves a version of the target page before writing the body" (also asserts snapshot-before-write via `invocationCallOrder`) and "labels the version so it is distinguishable…" |
| …and does not after a title-only update | "does NOT snapshot a title/tags-only edit" (plus "does NOT snapshot appendPage") |
| When the snapshot fails, the body is not written | "aborts the write when the snapshot fails — the body is not overwritten" and "says why it refused…" |
| `publicToken` appears in none of the three responses | `mcp-doc-reads.use-case.spec.ts` → three "never carries publicToken" cases; the fake doc entity carries a token, and the serialized reply is asserted not to contain it or the field name |

Also covered (not in the spec's list but implied by section 4):
`mcp-doc-reads.spec.ts` → "points at get_doc_page instead of 'the doc in the app'" and "states the
blast radius".

## Gate output

```
$ npx jest
...
Test Suites: 42 passed, 42 total
Tests:       392 passed, 392 total
Snapshots:   0 total
Time:        4.388 s, estimated 11 s
Ran all test suites.

$ npx tsc --noEmit -p tsconfig.json
TYPECHECK OK
```

## What the spec got wrong or did not anticipate

1. **The round-trip is only safe because stored bodies don't open with the echoed title.**
   `stripEchoedTitle` removes a leading `<h1>`/`<h2>` that exactly equals the *page* title. Any
   body written through `create_doc`/`update_doc` has already had that stripped, and the app's
   editor stores the body without the title (the title renders above it), so in practice a stored
   body never starts with it and the round trip is a genuine no-op. But a body that *does* open
   with `<h1>Week 31</h1>` on a page titled "Week 31" — hand-pasted HTML, or an import — loses that
   heading on the first MCP write-back. It converges after one pass (the second read no longer has
   it), so it is not the compounding shave the spec feared, but it is a one-time loss. Fixing it
   would change what `update_doc` writes, which the brief rules out; flagged rather than changed.

2. **`appendPage` needed an explicit decision the spec didn't make.** The spec scopes the snapshot
   to "when a body is actually being written". `appendPage` writes a body — but to a page that did
   not exist a moment earlier, so there is nothing to lose and nothing to restore to. No snapshot
   is taken there, and a test pins that down.

3. **A failed snapshot after a successful rename is a partial, not a clean failure.** `update_doc`
   already applies title/tags before the page write and has a `partial(...)` helper for exactly
   this. The abort reuses it, so a call that renames and then fails to snapshot reports
   "Partially applied (renamed), then failed: …" rather than implying nothing happened. The spec
   said "abort the write" and was silent on the metadata step that had already committed.

4. **`get_doc`'s reply needed a tree renderer, not a flat list.** The spec specifies `parentId`
   and `order` on the wire, which is right, but the MCP tool reply is prose — a flat list of pages
   with a `parentId` field would make an assistant reconstruct the nesting itself. The reply
   indents children under parents; the DTO still carries both fields.

5. **The "no `assertCanWrite`" requirement is not directly assertable on a passing call.** A tool
   that never gates and a tool that gates-and-passes look the same from the outside when the key
   has write scope. The test mocks `./mcp-scope` to a *failing* gate and asserts it was never
   consulted, which is the only way to make the absence observable.
