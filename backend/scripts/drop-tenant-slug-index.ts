/**
 * One-time MIGRATION: drop the broken `slug_1` index on the `tenants` collection
 * so the app can recreate it with the correct partial filter on next boot.
 *
 *   npm run migrate:tenant-slug-index            # DRY RUN — report only
 *   npm run migrate:tenant-slug-index -- --apply # drop the old index
 *
 * WHY: the index was declared `{ unique: true, sparse: true }`. `sparse` only
 * excludes documents where `slug` is *absent* — and the schema declares
 * `slug: { default: null }`, so every tenant stores an explicit null, all of them
 * are indexed, and the *second* slug-less tenant is rejected:
 *
 *   E11000 duplicate key error collection: <db>.tenants index: slug_1
 *   dup key: { slug: null }
 *
 * That is a production 500 on both tenant-creation paths (registration, which
 * never sends a slug, and the platform console, where it is optional).
 * `tenant.schema.ts` now declares
 * `partialFilterExpression: { slug: { $type: 'string' } }` instead.
 *
 * WHY A SCRIPT IS REQUIRED: Mongoose creates an index only when one of that name
 * does not exist — it never *redefines* one. A database still carrying the old
 * `slug_1` keeps the broken definition forever and the code fix silently does
 * nothing. The old index must be dropped first; the app recreates it correctly
 * the next time it boots (`autoIndex`).
 *
 * TOUCHES NO DOCUMENT. It only drops an index. Idempotent and safe to re-run: if
 * the index is already the partial one, or already absent, `--apply` reports that
 * and exits 0 without doing anything.
 *
 * BRIEF UNIQUENESS GAP: between the drop and the app's next boot, two tenants
 * could take the same real slug. Slugs are set by hand from the platform console,
 * so the window is theoretical — but restart the API promptly after applying, and
 * verify with `db.tenants.getIndexes()` that `slug_1` is back and partial.
 *
 * A prod run needs an explicit MONGODB_URI (it won't silently hit localhost).
 */
import mongoose from 'mongoose';

const APPLY = process.argv.includes('--apply');

const NODE_ENV = process.env['NODE_ENV'] || 'local';
const IS_PROD = NODE_ENV === 'prod' || NODE_ENV === 'production';
const DEFAULT_MONGODB_URI =
  'mongodb://producthub:producthub@localhost:27017/producthub?authSource=admin';
const MONGODB_URI = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;

/** The index this migration is about. Mongo names it from its key by default. */
export const SLUG_INDEX_NAME = 'slug_1';

/** Shape of an entry from `collection.indexes()`, narrowed to what we inspect. */
export interface IndexInfo {
  name?: string;
  key?: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: Record<string, unknown>;
}

/** What the collection's slug index currently is. */
export type SlugIndexVerdict =
  /** No index on `{slug: 1}` at all — nothing to drop; the app will create it. */
  | 'absent'
  /** The broken one: unique over `{slug: 1}` with no partial filter. */
  | 'broken'
  /** Already `partialFilterExpression: {slug: {$type: 'string'}}` — nothing to do. */
  | 'correct'
  /** An index on `{slug: 1}` we do not recognise — a human must look. */
  | 'unknown';

/**
 * Classify the live `{slug: 1}` index.
 *
 * Matched by **key shape**, not by name, so a hand-created index under another
 * name is still seen. "Broken" is deliberately defined as *not partial* rather
 * than as `sparse === true`: a plain `{unique: true}` index (no sparse at all)
 * rejects slug-less tenants for exactly the same reason and needs the same drop.
 * A partial filter on anything other than `slug` is reported as `unknown` rather
 * than dropped — this script must never silently discard someone else's index.
 */
export function classifySlugIndex(indexes: IndexInfo[]): SlugIndexVerdict {
  const idx = indexes.find(
    (i) => i.key && i.key['slug'] === 1 && Object.keys(i.key).length === 1,
  );
  if (!idx) return 'absent';
  const partial = idx.partialFilterExpression;
  if (partial) {
    const keys = Object.keys(partial);
    const onSlug =
      keys.length === 1 && keys[0] === 'slug' && idx.unique === true;
    return onSlug ? 'correct' : 'unknown';
  }
  return idx.unique === true ? 'broken' : 'unknown';
}

/** The index entry this script would act on, for logging and for the drop call. */
export function findSlugIndex(indexes: IndexInfo[]): IndexInfo | undefined {
  return indexes.find((i) => i.key && i.key['slug'] === 1 && Object.keys(i.key).length === 1);
}

async function main(): Promise<void> {
  // Inside main, not at module scope, so importing the pure helpers above from a
  // test can never kill the process.
  if (IS_PROD && !process.env.MONGODB_URI) {
    console.error(
      '✋ NODE_ENV=prod but MONGODB_URI is not set (would fall back to localhost).\n' +
        '   Set the production MONGODB_URI before touching any index.',
    );
    process.exit(1);
  }

  console.log(
    APPLY
      ? '🚚 APPLY — dropping the broken tenants.slug_1 index'
      : '🔎 DRY RUN — report only, no changes',
  );
  console.log(`Env:   ${NODE_ENV}`);
  console.log(`Mongo: ${MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}`);

  await mongoose.connect(MONGODB_URI);
  const tenants = mongoose.connection.collection('tenants');

  const indexes = (await tenants.indexes()) as IndexInfo[];
  const current = findSlugIndex(indexes);
  const verdict = classifySlugIndex(indexes);

  console.log('\nCurrent {slug: 1} index:');
  console.log(current ? `  ${JSON.stringify(current)}` : '  (none)');
  console.log(`Verdict: ${verdict}`);

  const slugless = await tenants.countDocuments({ slug: { $not: { $type: 'string' } } });
  const withSlug = await tenants.countDocuments({ slug: { $type: 'string' } });
  console.log(`Tenants: ${withSlug} with a real slug, ${slugless} without.`);

  if (verdict === 'correct') {
    console.log('\n✅ Already the partial index — nothing to do.');
    await mongoose.disconnect();
    return;
  }
  if (verdict === 'absent') {
    console.log(
      '\n✅ No {slug: 1} index on this database — nothing to drop.\n' +
        '   The app creates the correct partial index on next boot.',
    );
    await mongoose.disconnect();
    return;
  }
  if (verdict === 'unknown') {
    console.error(
      '\n✋ Refusing to touch it: the {slug: 1} index on this database is not the\n' +
        '   definition this migration knows how to replace. Inspect it by hand\n' +
        '   (db.tenants.getIndexes()) before doing anything.',
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  // verdict === 'broken'
  if (!APPLY) {
    console.log(
      '\nWould DROP this index (no document is touched).\n' +
        '   Re-run with --apply, then restart the API — it recreates {slug: 1} with\n' +
        "   partialFilterExpression {slug: {$type: 'string'}} on boot.",
    );
    await mongoose.disconnect();
    return;
  }

  // Drop by the name Mongo reports rather than the assumed `slug_1`, so a
  // hand-created index under a different name is still removed.
  const name = current?.name ?? SLUG_INDEX_NAME;
  await tenants.dropIndex(name);
  console.log(`\n✅ Dropped index \`${name}\`.`);
  console.log(
    '   NEXT: restart the API so it recreates the partial index, then confirm with\n' +
      '   db.tenants.getIndexes() that slug_1 carries partialFilterExpression.',
  );

  await mongoose.disconnect();
}

// Guarded so the pure helpers above can be imported by the unit test without
// this script trying to open a database connection.
if (require.main === module) {
  main().catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
  });
}
