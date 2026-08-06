import { sequentialRef } from '@module-shared/utils/sequential-ref.util';
import { ROADMAP_ITEM_REF_PREFIX } from '../domain/types/roadmap-item.type';

describe('roadmap item refs', () => {
  it('mints RM-n from the tenant sequence, skipping refs already on the roadmap', async () => {
    let seq = 0;
    const counters = { next: async () => ++seq } as never;
    // A roadmap already holding RM-1 (embedded items are checked in memory,
    // since they are not their own collection).
    const taken = new Set(['RM-1']);

    const first = await sequentialRef(counters, 't1', ROADMAP_ITEM_REF_PREFIX, async (r) =>
      taken.has(r),
    );
    expect(first.ref).toBe('RM-2');

    taken.add(first.ref);
    const second = await sequentialRef(counters, 't1', ROADMAP_ITEM_REF_PREFIX, async (r) =>
      taken.has(r),
    );
    expect(second.ref).toBe('RM-3');
  });
});
