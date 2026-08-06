# Fix report — feat/sortable-issue-ids

Three fixes: a production tenant-creation bug, ticket-ref search ranking, and an N+1 on the
team-list endpoint. All gates run once at the end; output pasted below.

---

## FIX 1 — only one slug-less tenant could ever exist

### What was wrong

`TenantSchema.index({ slug: 1 }, { unique: true, sparse: true })`. `sparse` only excludes
documents where the field is **absent**. The schema declares `slug: { type: String, default: null }`,
so every tenant written through Mongoose stores an *explicit* `null`, every one of them is
indexed, and the second slug-less tenant is rejected:

```
E11000 duplicate key error collection: internal_product_os.tenants index: slug_1 dup key: { slug: null }
```

Both creation paths are affected — `RegisterUseCase` (never sends a slug) and the platform
console (`platform-tenant.use-cases.ts:163`, `dto.slug` optional).

### What changed

**`backend/src/infrastructure/tenants/entities/tenant.schema.ts`** — `sparse: true` replaced with
`partialFilterExpression: { slug: { $type: 'string' } }`, matching the `{tenantId, refPrefix}`
index in `team.schema.ts`. Only real string slugs enter the index, so any number of slug-less
tenants coexist and real slugs stay unique. A comment at the declaration records *why* it is
partial and not sparse (with the observed E11000 pasted in), so it does not get "simplified" back.

**`backend/scripts/drop-tenant-slug-index.ts`** (new) — Mongoose creates an index only when one
of that name is missing; it never *redefines* one. Production still carries the old broken
`slug_1`, so without dropping it the code fix silently does nothing. The script follows
`backfill-team-ref-prefix.ts`'s conventions:

- dry-run by default, `--apply` to act;
- prod guard: `NODE_ENV=prod` without an explicit `MONGODB_URI` refuses to run rather than
  falling back to localhost;
- logs the resolved `NODE_ENV` and the URI with credentials masked before acting;
- prints the **current** `{slug: 1}` index definition verbatim, plus how many tenants have a real
  slug vs none;
- touches **no document** — it only drops an index;
- idempotent: `correct` (already partial) and `absent` both exit 0 doing nothing, so re-running is
  safe;
- refuses (`unknown`, exit 1) on any `{slug: 1}` index it does not recognise, rather than silently
  discarding someone else's index;
- drops by the name Mongo actually reports, so a hand-created index under another name is still
  removed;
- `main()` runs under `require.main === module` so the pure helpers are importable by the test
  without opening a connection.

**`backend/package.json`** — `migrate:tenant-slug-index` and `migrate:tenant-slug-index:apply`,
beside the other `migrate:*`/`backfill:*` entries.

### Test

`backend/scripts/drop-tenant-slug-index.spec.ts` covers `classifySlugIndex` / `findSlugIndex` —
the only pure logic the script has, since the rest needs a database. Cases: the live
sparse+unique definition → `broken`; a plain unique with no `sparse` → `broken` (it fails for the
same reason and needs the same drop, so "broken" is defined as *not partial*, not as
`sparse === true`); the new partial → `correct` (re-run is a no-op); no index → `absent`; a
compound `{slug, status}` index → `absent` (never dropped just for leading with `slug`); a
non-unique or foreign-filtered `{slug: 1}` → `unknown`.

### Operational steps a human must run against production, in order

1. **Deploy the code first.** The schema change is inert on its own — the old index is still live,
   so behaviour is unchanged and nothing can regress. Deploying first means step 4 recreates the
   correct index immediately.
2. **Dry run, read the output.**
   ```
   cd backend
   NODE_ENV=prod MONGODB_URI='<prod uri>' npm run migrate:tenant-slug-index
   ```
   Confirm it prints the current index as `{"name":"slug_1","key":{"slug":1},"unique":true,"sparse":true}`
   and `Verdict: broken`. If it says `correct` or `absent`, stop — nothing to do. If it says
   `unknown`, stop and inspect by hand with `db.tenants.getIndexes()`.
3. **Apply — drops the index.**
   ```
   NODE_ENV=prod MONGODB_URI='<prod uri>' npm run migrate:tenant-slug-index:apply
   ```
4. **Restart the API promptly.** Mongoose recreates `slug_1` with the partial filter on boot
   (`autoIndex`). Between step 3 and this restart there is no uniqueness constraint on slugs at
   all — slugs are set by hand from the platform console so the window is theoretical, but do not
   leave it open.
5. **Verify.** `db.tenants.getIndexes()` must show `slug_1` with
   `partialFilterExpression: { slug: { $type: "string" } }` and no `sparse`.
6. **Smoke test.** Register two workspaces (or create two console tenants with no slug) — both
   must succeed. Then confirm two tenants cannot take the same real slug.

Rollback: if step 4 cannot happen, re-creating the old index by hand restores the previous
(broken) behaviour — `db.tenants.createIndex({slug:1},{unique:true,sparse:true})`.

---

## FIX 2 — searching a ticket ref buried the exact match

### What was wrong

The `if (query.search)` block builds one unanchored case-insensitive regex over `title`,
`description`, `_id`, `shortId`. With sequential refs, searching `ENG-1` also matches `ENG-10`…
`ENG-19`, `ENG-100`… — and all of those sort ahead of `ENG-1` under the board's default
`{order: 1, createdAt: -1}`. Typing a known ref is the most common reason anyone searches.

### What changed

**`backend/src/infrastructure/issues/repositories/issue.repository.ts`**

- `exactRefSearch(search)` — returns the search text upper-cased when it is *exactly* a
  `PREFIX-digits` ref (`^[A-Za-z][A-Za-z0-9]{0,9}-\d+$`, trimmed), else `null`. Upper-casing gives
  the required case-insensitivity on the ref (refs are stored upper case), matching what
  `findByRef` already does.
- `shouldRankExactRefFirst(exactRef, sort)` — true only when the text is ref-shaped **and no sort
  was requested**.
- When it is true, the list runs as an aggregation: `$match` the same filter, `$addFields` a
  `__exactRefRank` of `0` for `shortId === exactRef` / `1` otherwise, `$sort` by that rank then the
  normal sort stage, `$skip`/`$limit`, then `$project` the field away. Otherwise the original
  `find()` runs completely untouched.

The `$match` is the *same* filter object, so the matched set — and therefore `total`, which still
comes from the unchanged `countDocuments(filter)` — is identical. Only the ordering differs, and
only for a search whose text is a whole ref. The substring search over the other three fields is
unchanged, so `ENG-1` still returns `ENG-10` etc., just below the exact hit.

### The explicit-sort decision (and why)

**An explicit user sort wins; the rank is not applied.** When someone clicks "ID ascending" or
"recently updated" they have stated the order they want, and the column header now claims it.
Pinning one row above that makes the sort control look broken and the header lie — and the user
who sorted deliberately can see the exact row anyway, because they narrowed the list themselves.
With *no* sort chosen there is no user intent to override: the default `{order, createdAt}` is the
board's own arrangement, and "the ticket whose id you just typed" is a better first row than it.

The narrow ref-shape gate is a second layer of the same conservatism: a non-ref search cannot
reach the aggregation branch at all, so ordinary text searching is provably unaffected. And with
no search and no sort the query is still byte-for-byte `{order: 1, createdAt: -1}` on the original
`find()` path — asserted by `issue-sort.spec.ts` and again in the new spec.

### Test

`backend/src/infrastructure/issues/repositories/issue-search-exact-ref.spec.ts` — ref recognition
(`ENG-1`, `eng-1`, `Eng-14`, whitespace-padded), thirteen non-ref rejections including `ENG`,
`ENG-`, `ENG-1a`, `fix ENG-1 crash`; the explicit-sort yield for `id`/`created`/`updated`; the
composed sort leading with the rank and keeping the board default underneath; and the no-sort,
no-search shape.

---

## FIX 3 — `GET /v1/teams` issued one counter read per team

### What was wrong

`ResolveTeamPrefixLockUseCase.many` was `Promise.all(teams.map(t => this.one(...)))`, and each
`one()` is a `counters.findById`. `teams.controller.ts` calls it on the team-list endpoint, which
the frontend fetches on essentially every page load; `public-teams.controller.ts` pays it on the
unauthenticated share endpoint too.

### What changed

**`backend/src/shared/services/counter.service.ts`** — new
`currentMany(tenantId, prefixes): Promise<Map<string, number>>`. Filters falsy prefixes, collapses
duplicates through a `Set`, and issues one `find({_id: {$in: [...]}})`. Every asked-for prefix is
pre-seeded to `0` in the returned map, so a prefix with no counter document reads `0` — the same
answer `current()` gives, so the two paths can never disagree about whether a prefix is frozen.
Ids are `<tenantId>:<prefix>`, so the prefix is recovered by slicing at the tenant length (not by
searching for a separator, which a prefix containing `-` could otherwise confuse). Returns without
querying when nothing survives the filter.

**`backend/src/application/teams/use-cases/team.use-cases.ts`** — `many` collects the non-empty
prefixes, short-circuits to all-`false` if there are none, makes one `currentMany` call, then maps
back over the *original* `teams` array so results stay positionally paired by index. A team with
no prefix returns `false` without contributing a key, exactly as `one()` short-circuits today.
`one()` is unchanged and still used by `UpdateTeamUseCase` for single lookups.

### Tests

`backend/src/shared/services/counter.service.spec.ts` — one query for many prefixes with the exact
`$in` asserted; a missing counter document reading `0`; duplicates collapsing to one key; falsy
prefixes dropped so `"<tenantId>:"` is never queried; no query at all for an empty or wholly-empty
list; tenant scoping; and a dash-containing prefix round-tripping through the id split.

`backend/src/application/teams/use-cases/resolve-team-prefix-lock.spec.ts` — the existing `many`
ordering test still passes against the batched implementation, plus: exactly one batched call for
three teams; correct positional pairing with **duplicate** prefixes in the input; the
empty-prefix short-circuit issuing no query at all; and tenant scoping. All existing `one()` tests
untouched and passing.

---

## Gates

### `cd backend && npx tsc --noEmit -p tsconfig.json`

```
(no output — clean)
```

### `cd backend && npx jest`

```
Test Suites: 38 passed, 38 total
Tests:       330 passed, 330 total
Snapshots:   0 total
Time:        6.309 s, estimated 7 s
Ran all test suites.
```

Targeted run of the touched suites:

```
PASS scripts/drop-tenant-slug-index.spec.ts
PASS src/shared/services/counter.service.spec.ts
PASS src/application/teams/use-cases/resolve-team-prefix-lock.spec.ts
PASS src/infrastructure/issues/repositories/issue-find-by-ref.spec.ts
PASS src/infrastructure/issues/repositories/issue-ref-mapping.spec.ts
PASS src/infrastructure/issues/repositories/issue-search-exact-ref.spec.ts
PASS src/infrastructure/issues/repositories/issue-sort.spec.ts

Test Suites: 7 passed, 7 total
Tests:       56 passed, 56 total
```

### `cd frontend && npx tsc --noEmit`

```
(no output — clean)
```

### `cd frontend && npm run build`

```
dist/assets/cynefin-VYW2F7L2-Bqktt0BR.js                690.56 kB │ gzip: 154.58 kB
dist/assets/index-Bkck8Ymq.js                         1,956.81 kB │ gzip: 555.04 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 5.73s

PWA v0.21.2
mode      generateSW
precache  3 entries (2061.70 KiB)
files generated
  dist/sw.js
  dist/workbox-2fbc6a65.js
```

(The chunk-size notice is pre-existing and unrelated — no frontend source was touched.)
