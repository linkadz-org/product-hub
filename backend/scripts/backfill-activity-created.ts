/**
 * One-time BACKFILL: write one `created` activity row per existing issue.
 *
 * History starts on deploy day — tasks 6–8 made every *future* write to an
 * issue append a row, but nothing has touched the issues that already exist.
 * They store only a last-writer snapshot (`createdBy`/`updatedBy`), not a
 * sequence of changes, so almost nothing about their past is recoverable.
 * One thing is: `createdBy` + `createdByName` + `createdAt` survive on every
 * issue, so a single `created` row can be reconstructed from them. That is
 * the difference between an old issue opening to a timeline with one honest
 * entry and opening to nothing at all, which reads as "the feature is
 * broken".
 *
 *   npm run backfill:activity-created              # DRY RUN — plan only
 *   npm run backfill:activity-created -- --apply    # write
 *
 * Idempotent: an issue is skipped when it already has a `created` row in
 * `auditlogs`, so re-running (intentionally or by accident) never writes a
 * second row for the same issue. That check is done with a single upfront
 * query — `distinct('entityId', { entity: 'issue', field: 'created' })` — so
 * it costs one round trip regardless of collection size, not one query per
 * issue. Batched: `issues` is streamed with a cursor and inserted in batches
 * of 500 via `insertMany`, so nothing loads a whole collection into memory.
 * A prod run needs an explicit MONGODB_URI (it won't silently hit localhost).
 */
import { MongoClient, type Document as MongoDocument } from 'mongodb';

const APPLY = process.argv.includes('--apply');
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

/**
 * Pure: the row an issue's own `created` history entry must look like.
 * No `new Date()` — `createdAt` is the issue's own creation time, never now,
 * or a backfilled row would lie about when the issue was actually created.
 */
export function buildCreatedRow(issue: Row): Row {
  return {
    tenantId: issue.tenantId,
    projectId: '',
    reportId: '',
    entity: 'issue',
    entityId: issue._id,
    entityRef: (issue.shortId as string) || String(issue._id),
    field: 'created',
    oldValue: '',
    newValue: '',
    actorType: 'user',
    actorId: (issue.createdBy as string) ?? '',
    actorName: (issue.createdByName as string) ?? '',
    automated: false,
    createdAt: issue.createdAt,
  };
}

interface RunResult {
  changed: number;
  scanned: number;
  ok: boolean;
  error?: unknown;
}

async function run(db: import('mongodb').Db): Promise<RunResult> {
  const issues = db.collection<MongoDocument>('issues');
  const auditLogs = db.collection<MongoDocument>('auditlogs');

  // One round trip, not one query per issue — this is what keeps the script
  // usable on a large collection.
  const alreadyBackfilled = new Set(
    (
      await auditLogs.distinct('entityId', { entity: 'issue', field: 'created' })
    ).map(String),
  );

  const cursor = issues.find({}, { batchSize: BATCH });
  let changed = 0;
  let scanned = 0;
  let shown = 0;
  let ops: Row[] = [];

  try {
    for await (const doc of cursor) {
      scanned++;
      const row = doc as Row;
      if (alreadyBackfilled.has(String(row._id))) continue;

      changed++;
      const created = buildCreatedRow(row);
      if (shown < 3) {
        console.log(`    ${String(row._id)}  ${String(row.shortId || '(no shortId)')}`);
        shown++;
      }
      ops.push(created);
      if (APPLY && ops.length >= BATCH) {
        await auditLogs.insertMany(ops as never, { ordered: false });
        ops = [];
      }
      if (scanned % PROGRESS_EVERY === 0) {
        console.log(`    …scanned ${scanned}, ${changed} need a created row so far`);
      }
    }
    if (APPLY && ops.length) await auditLogs.insertMany(ops as never, { ordered: false });
    console.log(`\n• issues: ${changed} of ${scanned} document(s) need a created row`);
    return { changed, scanned, ok: true };
  } catch (error) {
    // Report the failure honestly rather than mixing it into a "success" summary.
    console.error(`\n✋ issues FAILED after ${scanned} scanned, ${changed} written:`, error);
    return { changed, scanned, ok: false, error };
  } finally {
    await cursor.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  console.log('──── backfill:activity-created ────');
  console.log(APPLY ? '🚚 APPLY — writing created rows' : '🔎 DRY RUN — plan only, no changes');
  console.log(`Env:   ${NODE_ENV}`);
  console.log(`Mongo: ${MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();

  const result = await run(db);

  await client.close();

  console.log('\n────────────────────────────────');
  if (!result.ok) {
    console.log('❌ issues FAILED — see error above.');
    console.log('   Fix the cause and re-run — already-written rows are unaffected (idempotent).');
    process.exitCode = 1;
    return;
  }
  if (result.changed === 0) {
    console.log('Every issue already has a created row — nothing to do.');
  } else if (APPLY) {
    console.log(`✅ Wrote ${result.changed} created row(s).`);
  } else {
    console.log(`Would write ${result.changed} created row(s).`);
    console.log('\nDry run — nothing changed. To write for real:');
    console.log('  npm run backfill:activity-created -- --apply');
  }
}

// Guarded so the pure `buildCreatedRow` helper above can be imported by the
// unit test without this script trying to open a database connection.
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
