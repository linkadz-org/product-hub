/**
 * One-time BACKFILL: give every existing team a ticket prefix (`refPrefix`), so
 * its new issues are numbered `ENG-1`, `QC-14` instead of falling back to the
 * workspace-wide TSK/BUG sequences.
 *
 *   npm run backfill:team-ref-prefix                          # DRY RUN — every tenant
 *   npm run backfill:team-ref-prefix -- --tenant <id>         # DRY RUN — one tenant
 *   npm run backfill:team-ref-prefix -- --tenant <id> --apply # assign, one tenant
 *   npm run backfill:team-ref-prefix -- --apply               # assign, EVERY tenant
 *
 * `--tenant` is how a shared database gets staged one customer at a time. Without
 * it this reads and writes every tenant in the database in a single pass, which
 * is fine for a single-tenant install and reckless for a shared one — a prefix
 * freezes the moment its team mints a first ticket, so the window to correct a
 * bad auto-derivation is minutes, not days. Do one tenant, look at it, continue.
 *
 * The dry run prints, per team, the prefix it would assign, how many issues that
 * team already has, and the current value of the counter that prefix would draw
 * from. A non-zero counter is the one line that matters: it means something has
 * already minted under that prefix, so the team's first ticket will not be `-1`.
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

/** `--tenant <id>` — restrict the whole run to one tenant. */
function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  const value = i === -1 ? undefined : process.argv[i + 1];
  // A flag with nothing after it (or the next flag after it) is a typo, not
  // "every tenant" — refusing beats quietly widening the blast radius.
  if (i !== -1 && (!value || value.startsWith('--'))) {
    console.error(`✋ ${flag} needs a value, e.g. ${flag} 65f0a1b2c3d4e5f60718293a`);
    process.exit(1);
  }
  return value;
}

const TENANT = argValue('--tenant');

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

  console.log(`Scope: ${TENANT ? `tenant ${TENANT}` : 'EVERY tenant in this database'}`);

  await mongoose.connect(MONGODB_URI);
  const teams = mongoose.connection.collection<TeamRow>('teams');
  const issues = mongoose.connection.collection('issues');
  const counters = mongoose.connection.collection<{ _id: string; seq: number }>('counters');

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

  // Scoped by tenant when asked. The taken-set below is seeded from the same
  // query, which is correct either way: prefixes are unique *within* a tenant, so
  // one tenant's rows are the whole universe its de-duplication cares about.
  const scope = TENANT ? { tenantId: TENANT } : {};
  const all = await teams.find(scope).sort({ tenantId: 1, order: 1 }).toArray();

  if (all.length === 0) {
    console.log(
      TENANT
        ? `\nNo teams found for tenant ${TENANT} — check the id.`
        : '\nNo teams found in this database.',
    );
    await mongoose.disconnect();
    return;
  }

  // Seed each tenant's taken set from the prefixes already assigned, so a
  // partially-backfilled workspace (or a re-run) never mints a duplicate.
  const takenByTenant = new Map<string, Set<string>>();
  for (const team of all) {
    if (!takenByTenant.has(team.tenantId)) takenByTenant.set(team.tenantId, new Set());
    if (team.refPrefix) takenByTenant.get(team.tenantId)!.add(team.refPrefix);
  }

  let planned = 0;
  let wrote = 0;
  let failed = 0;
  let skipped = 0;

  for (const team of all) {
    if (team.refPrefix) {
      skipped++;
      continue;
    }
    const taken = takenByTenant.get(team.tenantId)!;
    const prefix = deriveRefPrefix(team.name, taken);
    taken.add(prefix);
    planned++;

    // The two numbers that decide whether this prefix is the right one, printed
    // for the dry run as much as the apply. `issues` is how much history the
    // prefix is about to describe; `counter` is what its first ticket will be
    // numbered *after* — non-zero means the prefix is already in use somewhere
    // in this tenant, so `ENG-1` is not what the team will get.
    const issueCount = await issues.countDocuments({
      tenantId: team.tenantId,
      teamId: team._id.toString(),
    });
    const counter = await counters.findOne({ _id: `${team.tenantId}:${prefix}` });
    const seq = counter?.seq ?? 0;
    const note = seq > 0 ? `⚠ counter=${seq} → first ticket ${prefix}-${seq + 1}` : 'counter=0';
    const line = `  ${team.tenantId}  ${team.name.padEnd(24)} → ${prefix.padEnd(6)} issues=${String(issueCount).padStart(5)}  ${note}`;

    if (!APPLY) {
      console.log(line);
      continue;
    }
    // One team's failure must not abort a multi-tenant run: the teams already
    // written stay written, and the summary says how many did not. Logged only
    // after the write lands — logging first meant a failed run's last line named
    // a prefix that was never stored.
    try {
      await teams.updateOne({ _id: team._id }, { $set: { refPrefix: prefix } });
      wrote++;
      console.log(line);
    } catch (error) {
      failed++;
      console.error(`  ✋ FAILED ${team.tenantId} ${team.name} → ${prefix}:`, error);
    }
  }

  console.log(
    APPLY
      ? `\n✅ wrote ${wrote} of ${planned} prefix(es)${failed ? `; ${failed} FAILED` : ''}; ${skipped} team(s) already had one`
      : `\nwould assign ${planned} prefix(es); ${skipped} team(s) already had one`,
  );
  if (!APPLY && planned > 0) {
    console.log(
      TENANT
        ? '   Re-run with --apply to write.'
        : '   Re-run with --apply to write — or add --tenant <id> to stage one customer first.',
    );
  }
  // A non-zero exit is what a deploy step checks; a partial write must not read
  // as success.
  if (failed > 0) process.exitCode = 1;

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
