import { sequentialRef } from './sequential-ref.util';

function counters(start = 0) {
  let seq = start;
  return { next: async () => ++seq };
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
    expect(minted).toEqual({ ref: 'TSK-3', prefix: 'TSK', seq: 3 });
  });

  it('gives up after a bounded number of draws rather than looping forever', async () => {
    await expect(
      sequentialRef(counters() as never, 't1', 'TSK', async () => true),
    ).rejects.toThrow(/could not mint/i);
  });
});
