import { CounterService } from '@module-shared/services/counter.service';

/** A ref and the two parts a sortable record stores alongside it. */
export interface MintedRef {
  /** The full ref as displayed and stored — `ENG-14`. */
  ref: string;
  /** The prefix half — `ENG`. */
  prefix: string;
  /** The number half — `14`. */
  seq: number;
}

/**
 * 40 doublings reach 2^40 (~1.1e12) — far past any number a real workspace could
 * hold. It is a guard against an `exists` oracle that answers "taken" for
 * *everything* (a broken lookup), not a limit real data can hit.
 */
const MAX_DRAWS = 40;

/**
 * The next ref in `prefix`'s per-tenant sequence, proven free.
 *
 * The `exists` check matters for two reasons:
 *
 *  1. The TSK / RM / DOC sequences all start at 0 in a workspace that already
 *     holds legacy *random* refs under those same prefixes, and the legacy
 *     alphabet (`23456789ABC…`) contains digits — so an all-numeric legacy
 *     suffix such as `RM-2345678` is possible.
 *  2. Much more importantly: a workspace can already hold refs from the
 *     ORIGINAL sequential scheme (`BUG-12`, `TSK-7`) while its `counters`
 *     document sits behind them — a restored dump, a partial migration, a
 *     tenant cloned without the `counters` collection. Then `BUG-1…BUG-12` are
 *     all taken and every draw collides.
 *
 * **On a collision the sequence gallops rather than nibbles.** Drawing one more
 * number per collision would need as many failed draws as the workspace has
 * legacy refs, and — because each rejected create advances the counter only by
 * the handful of draws it made — a whole workspace would be locked out of
 * creating anything until enough failures had accumulated. Instead each
 * collision `ensureAtLeast`s the sequence to `seq * 2`, so the *next* draw lands
 * beyond twice the colliding number: a block of N taken refs is cleared in
 * O(log N) draws (a 10,000-ref legacy block: 14), inside a single call, and the
 * jump is persisted with `$max` so it is not re-walked by the next create and
 * cannot be undone by a concurrent draw.
 *
 * Gaps in the sequence are expected: a number is burned whenever the create that
 * claimed it later fails, and a gallop burns a range. Jira behaves the same way,
 * and the ref only has to be unique and increasing — not dense.
 */
export async function sequentialRef(
  counters: CounterService,
  tenantId: string,
  prefix: string,
  exists: (ref: string) => Promise<boolean>,
): Promise<MintedRef> {
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    const seq = await counters.next(tenantId, prefix);
    const ref = `${prefix}-${seq}`;
    if (!(await exists(ref))) return { ref, prefix, seq };
    // Taken → jump the shared sequence past the conflicting block instead of
    // stepping one number at a time.
    await counters.ensureAtLeast(tenantId, prefix, seq * 2);
  }
  throw new Error(`Could not mint a free ${prefix} ref after ${MAX_DRAWS} draws`);
}
