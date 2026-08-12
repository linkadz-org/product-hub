import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/**
 * Root database connection. Global so any feature's `MongooseModule.forFeature`
 * resolves the same connection.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>(
          'MONGODB_URI',
          'mongodb://producthub:producthub@localhost:27017/producthub?authSource=admin',
        ),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class MongooseInfrastructureModule {}

const indexLogger = new Logger('MongoIndexes');

/**
 * Wait for every model's index build and say — loudly — if one failed.
 *
 * Mongoose builds indexes in the background on first use and swallows the
 * outcome (`Model.init().catch(() => {})` inside the Nest integration), so a
 * `createIndex` that fails on disk pressure, times out on a large collection, or
 * is killed by a concurrent build leaves the app booting green with nothing in
 * the log. That is not academic here: without the unique partial
 * `{tenantId, refPrefix}` on `teams`, two teams can take the same ticket prefix
 * and mint the same refs — damage no later fix untangles — and without
 * `{tenantId, refPrefix, refSeq, …}` on `issues` the ID sort is a collection scan.
 *
 * **Deliberately not fatal.** An index build failing is a serious operational
 * problem, but refusing to boot over it turns a degraded API into a total outage
 * — including for the read traffic that does not need the index at all, and for
 * the operator who now cannot use the app to look at the damage. The rule the
 * runbook enforces instead is "boot, then verify the indexes exist before opening
 * traffic"; this log is what makes that verifiable rather than assumed. Anything
 * that must not run without the index checks for it directly (as
 * `backfill-team-ref-prefix` does, refusing to `--apply` without it).
 */
export async function reportIndexBuildFailures(connection: Connection): Promise<void> {
  const names = Object.keys(connection.models);
  const results = await Promise.allSettled(
    names.map(async (name) => {
      await connection.models[name].init();
      return name;
    }),
  );

  const failures = results.flatMap((r, i) =>
    r.status === 'rejected' ? [{ name: names[i], reason: r.reason as unknown }] : [],
  );

  if (failures.length === 0) {
    indexLogger.log(`Indexes ready for ${names.length} model(s)`);
    return;
  }
  for (const { name, reason } of failures) {
    indexLogger.error(
      `INDEX BUILD FAILED for model "${name}" — queries relying on it will be slow, and any ` +
        'uniqueness it enforces is NOT being enforced. Fix and restart before opening traffic.',
      reason instanceof Error ? reason.stack : String(reason),
    );
  }
  indexLogger.error(`${failures.length} of ${names.length} model(s) failed to build their indexes`);
}

const searchLogger = new Logger('SearchBackfill');

/**
 * Deploy-order hazard, made loud instead of just commented: the issue board's
 * search and MCP's `search_issues` both read `searchText`, which only exists
 * on an issue once `backend/scripts/backfill-search-text.ts` has run against
 * it (every *new* issue gets it for free from `IssueRepository.toDocument()`,
 * but nothing backfills old rows automatically). Deploy this feature before
 * running that script and every pre-existing issue silently loses
 * title/shortId matching — the `description`/`_id` fallback branches still
 * match *something*, so it reads as flaky search rather than the systematic
 * regression it actually is.
 *
 * One indexed `countDocuments` (`{tenantId:1, searchText:1}` on `issues`, see
 * below) at boot, next to `reportIndexBuildFailures` — the app's other
 * "boot, then verify before opening traffic" check, same non-fatal shape: a
 * missing backfill degrades search, not the whole API, so this reports loudly
 * rather than refusing to start.
 */
export async function reportSearchTextBackfillHazard(connection: Connection): Promise<void> {
  const Issue = connection.models['Issue'];
  if (!Issue) return; // Not every process registers the Issue model (e.g. collab).

  const missing = await Issue.countDocuments({ searchText: '', title: { $ne: '' } }).exec();
  if (missing === 0) {
    searchLogger.log('searchText backfill: no gap found on issues');
    return;
  }
  searchLogger.error(
    `${missing} issue(s) have a title but no searchText — they will not match by ` +
      'title/shortId in ⌘K or MCP search_issues until ' +
      '`npm run backfill:search-text -- --apply` (backend/scripts/backfill-search-text.ts) is run.',
  );
}
