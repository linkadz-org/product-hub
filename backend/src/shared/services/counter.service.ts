import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Schema } from 'mongoose';

export interface CounterDoc {
  /** `<tenantId>:<prefix>`, e.g. `t_123:BUG`. */
  _id: string;
  seq: number;
}

export const CounterSchema = new Schema<CounterDoc>({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

/**
 * Per-tenant sequence for human-friendly short ids (`ENG-14`, `QC-8`, `RM-6`).
 *
 * This is the **primary** mechanism every ref is minted from — issues, roadmap
 * items and docs all draw here — not a leftover from an older scheme.
 *
 * A single atomic `findOneAndUpdate($inc)` hands out each number, so two
 * simultaneous creates can never receive the same one. Sequences are per tenant
 * *and* per prefix — and a prefix is a **team's**, not a kind's, so a team's tasks
 * and bugs share one run of numbers while two teams number independently.
 *
 * That also makes the counter the source of truth for "has this team issued a
 * ticket yet?": `current()` reading above 0 is what freezes a team's prefix, so
 * numbers already printed in commits and comments can never be re-minted. Gaps are
 * expected and fine — a number is burned if the create that claimed it later
 * fails, and `ensureAtLeast` burns a range on purpose to step past taken refs.
 */
@Injectable()
export class CounterService {
  constructor(@InjectModel('Counter') private readonly model: Model<CounterDoc>) {}

  /** Next number in the tenant's sequence for `prefix`. */
  async next(tenantId: string, prefix: string): Promise<number> {
    const doc = await this.model
      .findByIdAndUpdate(
        `${tenantId}:${prefix}`,
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<CounterDoc>()
      .exec();
    return doc?.seq ?? 1;
  }

  /**
   * Current value of the sequence **without consuming one** — 0 when it has never
   * been drawn from. This is what "has this prefix minted anything yet?" must ask:
   * counting a team's issues would answer wrong after a delete, and re-issuing a
   * number already printed in a commit message is exactly what freezing prevents.
   */
  async current(tenantId: string, prefix: string): Promise<number> {
    const doc = await this.model
      .findById(`${tenantId}:${prefix}`)
      .lean<CounterDoc>()
      .exec();
    return doc?.seq ?? 0;
  }

  /**
   * `current()` for many prefixes in **one** query, keyed by prefix.
   *
   * `GET /v1/teams` asks "is this team's prefix frozen?" for every team, and the
   * frontend fetches that list on essentially every page load — one `findById`
   * per team turned a hot endpoint into N round-trips. The public share endpoint
   * pays it too, unauthenticated.
   *
   * Falsy prefixes are dropped (a team with no prefix has minted nothing, and the
   * key `"<tenantId>:"` is meaningless) and duplicates are collapsed, so the same
   * prefix twice is one key and still resolves for both callers. A prefix with no
   * counter document reads back 0, exactly as `current()` returns.
   */
  async currentMany(tenantId: string, prefixes: string[]): Promise<Map<string, number>> {
    const wanted = [...new Set(prefixes.filter((p) => !!p))];
    // Every asked-for prefix is present in the result, so a caller can read the
    // map directly instead of remembering to default a miss.
    const seqs = new Map<string, number>(wanted.map((p) => [p, 0]));
    if (wanted.length === 0) return seqs;

    const docs = await this.model
      .find({ _id: { $in: wanted.map((p) => `${tenantId}:${p}`) } })
      .lean<CounterDoc[]>()
      .exec();
    for (const doc of docs) {
      // Ids are `<tenantId>:<prefix>` and a tenant id never contains ':', so the
      // remainder after the first tenant-length slice is the prefix verbatim.
      const prefix = doc._id.slice(tenantId.length + 1);
      if (seqs.has(prefix)) seqs.set(prefix, doc.seq ?? 0);
    }
    return seqs;
  }

  /**
   * Seeds the sequence so it never re-issues a number already in use — used by
   * the backfill, which assigns ids to rows created before short ids existed.
   */
  async ensureAtLeast(tenantId: string, prefix: string, value: number): Promise<void> {
    await this.model
      .findByIdAndUpdate(
        `${tenantId}:${prefix}`,
        { $max: { seq: value } },
        { upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }
}
