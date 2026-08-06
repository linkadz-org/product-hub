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

const MAX_DRAWS = 5;

/**
 * The next ref in `prefix`'s per-tenant sequence, proven free.
 *
 * The `exists` check matters because the TSK / RM / DOC sequences all start at 0
 * in a workspace that already holds legacy *random* refs under those same
 * prefixes, and the legacy alphabet (`23456789ABC…`) contains digits — so an
 * all-numeric legacy suffix such as `RM-2345678` is possible. A collision needs
 * the sequence to climb into the millions and is not a practical risk, but the
 * check costs one lookup and removes the failure mode outright. Team prefixes are
 * new and cannot collide with anything.
 *
 * Gaps in the sequence are expected: a number is burned whenever the create that
 * claimed it later fails. Jira behaves the same way.
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
  }
  throw new Error(`Could not mint a free ${prefix} ref after ${MAX_DRAWS} draws`);
}
