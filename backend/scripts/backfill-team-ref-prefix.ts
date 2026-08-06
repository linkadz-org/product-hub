/**
 * One-time BACKFILL: give every existing team a ticket prefix (`refPrefix`), so
 * its new issues are numbered `ENG-1`, `QC-14` instead of falling back to the
 * workspace-wide TSK/BUG sequences.
 *
 *   npm run backfill:team-ref-prefix              # DRY RUN — plan only
 *   npm run backfill:team-ref-prefix -- --apply   # assign the prefixes
 *
 * NOT REQUIRED before deploying: a team without a prefix still mints sequential,
 * sortable refs under its kind's sequence — it just isn't team-scoped. This is a
 * pure improvement, safe to run whenever.
 *
 * NEVER touches an issue, roadmap item or doc. Idempotent: a team that already
 * has a prefix is skipped, so re-running is a no-op. Prefixes are derived per
 * tenant and deduplicated against the ones already held in that tenant —
 * including archived teams, because a prefix is never released. A prod run needs
 * an explicit MONGODB_URI (it won't silently hit localhost).
 *
 * OPERATIONAL NOTE: the unique partial index on `{tenantId, refPrefix}` (teams
 * collection) is only created when the app boots. Make sure the app has started
 * at least once against this database — so the index exists — before running
 * this script with --apply, or duplicate prefixes could slip past.
 */
import mongoose from 'mongoose';
import { deriveRefPrefix } from '../src/application/teams/domain/team-ref-prefix';

const APPLY = process.argv.includes('--apply');

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

interface TeamRow {
  _id: string;
  tenantId: string;
  name: string;
  refPrefix?: string;
}

async function main(): Promise<void> {
  console.log(
    APPLY ? '🚚 APPLY — assigning team ref prefixes' : '🔎 DRY RUN — plan only, no changes',
  );

  await mongoose.connect(MONGODB_URI);
  const teams = mongoose.connection.collection<TeamRow>('teams');

  const all = await teams.find({}).sort({ tenantId: 1, order: 1 }).toArray();

  // Seed each tenant's taken set from the prefixes already assigned, so a
  // partially-backfilled workspace (or a re-run) never mints a duplicate.
  const takenByTenant = new Map<string, Set<string>>();
  for (const team of all) {
    if (!takenByTenant.has(team.tenantId)) takenByTenant.set(team.tenantId, new Set());
    if (team.refPrefix) takenByTenant.get(team.tenantId)!.add(team.refPrefix);
  }

  let assigned = 0;
  let skipped = 0;

  for (const team of all) {
    if (team.refPrefix) {
      skipped++;
      continue;
    }
    const taken = takenByTenant.get(team.tenantId)!;
    const prefix = deriveRefPrefix(team.name, taken);
    taken.add(prefix);
    assigned++;

    console.log(`  ${team.tenantId}  ${team.name.padEnd(24)} → ${prefix}`);
    if (APPLY) {
      await teams.updateOne({ _id: team._id }, { $set: { refPrefix: prefix } });
    }
  }

  console.log(
    `\n${APPLY ? '✅ assigned' : 'would assign'} ${assigned} prefix(es); ${skipped} team(s) already had one`,
  );
  if (!APPLY && assigned > 0) console.log('   Re-run with --apply to write.');

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
