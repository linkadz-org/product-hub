/**
 * One-time BACKFILL: compute `searchText` (and per-collection companions —
 * `searchBody` on doc pages, `casesSearchText` on reports, `itemsSearchText` on
 * roadmaps) for documents written before global search existed.
 *
 * Every *future* write already computes these fields at the repository layer
 * (`toDocument()` in issues/docs/docpages/projects/reports/roadmaps). This
 * script exists only to catch up documents that predate that change — it must
 * produce exactly the same value the live write path would, or the two drift
 * and search results become inconsistent depending on when a document was last
 * saved. See `TARGETS` below: each formula is copied verbatim from its
 * repository, not re-derived.
 *
 *   npm run backfill:search-text                             # DRY RUN — plan only
 *   npm run backfill:search-text -- --apply                  # write, every collection
 *   npm run backfill:search-text -- --apply --only=docpages  # write, one collection
 *
 * Idempotent: a document is only written when the computed value differs from
 * what is already stored, so running this against an already-backfilled
 * database (or re-running after a partial failure) is a no-op for anything
 * already correct. Batched: each collection is streamed with a cursor and
 * written in batches of 500 via `bulkWrite`, so nothing loads a whole
 * collection into memory. One collection failing does not abort the others —
 * it is reported by name and the run exits non-zero, never silently mixed into
 * a "success" summary. A prod run needs an explicit MONGODB_URI (it won't
 * silently hit localhost).
 */
import { MongoClient, type Document as MongoDocument } from 'mongodb';
import {
  buildSearchText,
  normalizeSearchText,
  SEARCH_BODY_MAX,
} from '../src/shared/utils/search-text.util';
import { plainText } from '../src/shared/utils/plain-text.util';

const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const BATCH = 500;
/** How often to print a progress line while streaming a large collection. */
const PROGRESS_EVERY = 5000;

const NODE_ENV = process.env['NODE_ENV'] || 'local';
const IS_PROD = NODE_ENV === 'prod' || NODE_ENV === 'production';
const DEFAULT_MONGODB_URI =
  'mongodb://producthub:producthub@localhost:27017/producthub?authSource=admin';
const MONGODB_URI = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;

if (IS_PROD && !process.env.MONGODB_URI) {
  console.error(
    '✋ NODE_ENV=prod but MONGODB_URI is not set (would fall back to localhost).\n' +
      '   Set the production MONGODB_URI before backfilling anything.',
  );
  process.exit(1);
}

type Row = Record<string, unknown>;

export interface Target {
  /** Mongo collection name — matches the pluralized model name (e.g. `Issue` → `issues`). */
  name: string;
  /** The exact formula the live repository's `toDocument()` computes, reused verbatim. */
  fields: (doc: Row) => Row;
}

/**
 * One entry per collection carrying a search field (Task 3/4). Every formula
 * here must match its repository's `toDocument()`:
 *  - issues            → src/infrastructure/issues/repositories/issue.repository.ts
 *  - docs               → src/infrastructure/docs/repositories/doc.repository.ts
 *  - docpages           → src/infrastructure/docs/repositories/doc-page.repository.ts
 *  - projects           → src/infrastructure/projects/repositories/project.repository.ts
 *  - reports            → src/infrastructure/reports/repositories/report.repository.ts
 *  - roadmaps           → src/infrastructure/roadmaps/repositories/roadmap.repository.ts
 */
export const TARGETS: Target[] = [
  {
    name: 'issues',
    fields: (d) => ({ searchText: buildSearchText(d.title as string, d.shortId as string) }),
  },
  {
    name: 'docs',
    fields: (d) => ({
      searchText: buildSearchText(d.title as string, ((d.tags as string[]) ?? []).join(' ')),
    }),
  },
  {
    name: 'docpages',
    fields: (d) => ({
      searchText: buildSearchText(d.title as string),
      // The collab server also writes `searchBody` directly via the raw Mongo
      // driver (see doc-page.repository.ts) — this must stay identical to that
      // formula or a duplicated/legacy tree's pages silently fall out of search.
      searchBody: normalizeSearchText(plainText((d.content as string) ?? '').slice(0, SEARCH_BODY_MAX)),
    }),
  },
  {
    name: 'projects',
    fields: (d) => ({ searchText: buildSearchText(d.title as string, d.subtitle as string) }),
  },
  {
    name: 'reports',
    fields: (d) => ({
      searchText: buildSearchText(d.title as string, d.subtitle as string, d.module as string),
      casesSearchText: ((d.sections as Row[]) ?? [])
        .filter((s) => s.type === 'testing')
        .flatMap((s) => (s.cases as Row[]) ?? [])
        .map((c) => buildSearchText(c.shortId as string, c.area as string)),
    }),
  },
  {
    name: 'roadmaps',
    fields: (d) => ({
      searchText: buildSearchText(d.title as string, d.description as string),
      itemsSearchText: ((d.items as Row[]) ?? []).map((i) =>
        buildSearchText(i.title as string, i.shortId as string),
      ),
    }),
  },
];

/** Deep-ish equality good enough for the flat/array-of-string shapes above. */
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

interface CollectionResult {
  name: string;
  changed: number;
  scanned: number;
  ok: boolean;
  error?: unknown;
}

async function runTarget(
  db: import('mongodb').Db,
  target: Target,
): Promise<CollectionResult> {
  const col = db.collection<MongoDocument>(target.name);
  const cursor = col.find({}, { batchSize: BATCH });
  let changed = 0;
  let scanned = 0;
  let shown = 0;
  let ops: { updateOne: { filter: Row; update: Row } }[] = [];

  try {
    for await (const doc of cursor) {
      scanned++;
      const row = doc as Row;
      const next = target.fields(row);
      const stale = Object.entries(next).some(([k, v]) => !same(row[k], v));
      if (stale) {
        changed++;
        if (shown < 3) {
          console.log(`    ${String(row._id)}  ${String(row.title ?? '(no title)')}`);
          shown++;
        }
        ops.push({ updateOne: { filter: { _id: row._id as never }, update: { $set: next } } });
        if (APPLY && ops.length >= BATCH) {
          await col.bulkWrite(ops as never);
          ops = [];
        }
      }
      if (scanned % PROGRESS_EVERY === 0) {
        console.log(`    …scanned ${scanned}, ${changed} need updating so far`);
      }
    }
    if (APPLY && ops.length) await col.bulkWrite(ops as never);
    console.log(`\n• ${target.name}: ${changed} of ${scanned} document(s) need updating`);
    return { name: target.name, changed, scanned, ok: true };
  } catch (error) {
    // One collection's failure must not abort the others, and must not be
    // reported as if it succeeded — the caller decides the exit code from `ok`.
    console.error(`\n✋ ${target.name} FAILED after ${scanned} scanned, ${changed} written:`, error);
    return { name: target.name, changed, scanned, ok: false, error };
  } finally {
    await cursor.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  console.log('──── backfill:search-text ────');
  console.log(APPLY ? '🚚 APPLY — writing search fields' : '🔎 DRY RUN — plan only, no changes');
  console.log(`Env:   ${NODE_ENV}`);
  console.log(`Mongo: ${MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}`);
  if (ONLY) console.log(`Only:  ${ONLY}`);

  const targets = ONLY ? TARGETS.filter((t) => t.name === ONLY) : TARGETS;
  if (ONLY && targets.length === 0) {
    console.error(
      `✋ --only=${ONLY} does not match any target (${TARGETS.map((t) => t.name).join(', ')}).`,
    );
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();

  const results: CollectionResult[] = [];
  for (const target of targets) {
    results.push(await runTarget(db, target));
  }

  await client.close();

  const totalChanged = results.reduce((sum, r) => sum + r.changed, 0);
  const failed = results.filter((r) => !r.ok);

  console.log('\n────────────────────────────────');
  if (failed.length > 0) {
    console.log(`❌ ${failed.length} collection(s) FAILED: ${failed.map((r) => r.name).join(', ')}`);
    console.log('   Fix the cause and re-run — already-written documents are unaffected (idempotent).');
    process.exitCode = 1;
    return;
  }
  if (totalChanged === 0) {
    console.log('Mọi document đã có field search — không có gì để làm.');
  } else if (APPLY) {
    console.log(`✅ Đã cập nhật ${totalChanged} document.`);
  } else {
    console.log(`Sẽ cập nhật ${totalChanged} document.`);
    console.log('\nDry run — chưa thay đổi gì. Để ghi thật:');
    console.log('  npm run backfill:search-text -- --apply');
  }
}

// Guarded so the pure `TARGETS`/`same` helpers above can be imported by the
// unit test without this script trying to open a database connection.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
