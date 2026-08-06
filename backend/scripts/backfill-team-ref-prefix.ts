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
 * collection) is only created when the app boots. `--apply` CHECKS for it and
 * refuses to write if it is missing, so "start the app once against this
 * database first" is enforced rather than remembered. A dry run needs no index.
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

/**
 * The unique partial index this backfill's de-duplication leans on. It is only
 * created when the app boots, so a database the app has never started against
 * silently accepts duplicate prefixes — and two teams sharing a prefix means two
 * teams minting the same ticket refs, which no later fix can untangle. Checked
 * by shape (key + uniqueness), not by name, since the name is Mongo-generated.
 */
async function hasUniquePrefixIndex(
  teams: ReturnType<typeof mongoose.connection.collection<TeamRow>>,
): Promise<boolean> {
  const indexes = (await teams.indexes()) as {
    key: Record<string, unknown>;
    unique?: boolean;
  }[];
  return indexes.some(
    (i) => i.unique === true && i.key['tenantId'] === 1 && i.key['refPrefix'] === 1,
  );
}

async function main(): Promise<void> {
  console.log(
    APPLY ? '🚚 APPLY — assigning team ref prefixes' : '🔎 DRY RUN — plan only, no changes',
  );
  console.log(`Env:   ${NODE_ENV}`);
  console.log(`Mongo: ${MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}`);

  await mongoose.connect(MONGODB_URI);
  const teams = mongoose.connection.collection<TeamRow>('teams');

  if (APPLY && !(await hasUniquePrefixIndex(teams))) {
    console.error(
      '\n✋ Refusing to write: the unique index on {tenantId, refPrefix} does not exist\n' +
        '   on the `teams` collection of this database.\n' +
        '   Without it, two teams could end up sharing a prefix and minting the same\n' +
        '   ticket refs. Start the app once against this database (it creates the\n' +
        '   index on boot), then re-run with --apply.',
    );
    await mongoose.disconnect();
    process.exit(1);
  }

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
