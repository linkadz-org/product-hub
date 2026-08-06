import { sequentialRef } from './sequential-ref.util';

/**
 * The real `CounterService` in miniature: `next` is the atomic `$inc`,
 * `ensureAtLeast` the `$max` gallop. Both move the same number, which is the
 * property the gallop depends on.
 */
function counters(start = 0) {
  let seq = start;
  return {
    next: async () => ++seq,
    ensureAtLeast: async (_t: string, _p: string, value: number) => {
      seq = Math.max(seq, value);
    },
    get value() {
      return seq;
    },
  };
}

const free = async () => false;

describe('sequentialRef', () => {
  it('mints PREFIX-n from the tenant sequence', async () => {
    const minted = await sequentialRef(counters() as never, 't1', 'ENG', free);
    expect(minted).toEqual({ ref: 'ENG-1', prefix: 'ENG', seq: 1 });
  });

  it('advances on each call', async () => {
    const c = counters() as never;
    expect((await sequentialRef(c, 't1', 'ENG', free)).ref).toBe('ENG-1');
    expect((await sequentialRef(c, 't1', 'ENG', free)).ref).toBe('ENG-2');
  });

  it('draws again when the ref is already taken', async () => {
    // TSK/RM/DOC sequences start at 0 in a workspace that already holds legacy
    // random refs under the same prefix, and the legacy alphabet contains digits —
    // so an all-numeric legacy suffix can in principle be hit.
    const taken = new Set(['TSK-1', 'TSK-2']);
    const minted = await sequentialRef(counters() as never, 't1', 'TSK', async (ref) =>
      taken.has(ref),
    );
    expect(taken.has(minted.ref)).toBe(false);
    expect(minted.seq).toBeGreaterThan(2);
  });

  it('gives up after a bounded number of draws rather than looping forever', async () => {
    await expect(
      sequentialRef(counters() as never, 't1', 'TSK', async () => true),
    ).rejects.toThrow(/could not mint/i);
  });

  describe('a workspace whose counter sits behind its legacy sequential refs', () => {
    /** `BUG-1 … BUG-n` all exist — a restored dump, a partial migration, or a
     *  tenant cloned without its `counters` collection. */
    const firstNTaken = (n: number) => async (ref: string) => {
      const seq = Number(ref.split('-')[1]);
      return Number.isFinite(seq) && seq >= 1 && seq <= n;
    };

    it.each([12, 500, 10_000, 1_000_000])(
      'still mints a free ref with the first %i numbers taken',
      async (n) => {
        const c = counters();
        const minted = await sequentialRef(c as never, 't1', 'BUG', firstNTaken(n));

        expect(minted.prefix).toBe('BUG');
        expect(minted.seq).toBeGreaterThan(n);
        expect(minted.ref).toBe(`BUG-${minted.seq}`);
      },
    );

    it('leaves the sequence past the legacy block, so the next create does not re-walk it', async () => {
      const c = counters();
      await sequentialRef(c as never, 't1', 'BUG', firstNTaken(500));

      // The second create draws exactly one number and is free immediately.
      let draws = 0;
      const minted = await sequentialRef(
        {
          next: async () => {
            draws++;
            return c.next();
          },
          ensureAtLeast: c.ensureAtLeast,
        } as never,
        't1',
        'BUG',
        firstNTaken(500),
      );
      expect(draws).toBe(1);
      expect(minted.seq).toBeGreaterThan(500);
    });

    it('clears the block in a logarithmic number of draws, not one per taken ref', async () => {
      let draws = 0;
      const c = counters();
      await sequentialRef(
        {
          next: async () => {
            draws++;
            return c.next();
          },
          ensureAtLeast: c.ensureAtLeast,
        } as never,
        't1',
        'BUG',
        firstNTaken(10_000),
      );
      expect(draws).toBeLessThan(20);
    });
  });
});
