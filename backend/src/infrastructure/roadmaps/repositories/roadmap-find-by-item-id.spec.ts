import { RoadmapSchema } from '../entities/roadmap.schema';
import { RoadmapRepository } from './roadmap.repository';

/**
 * `findByItemId` is the guard for every roadmap-item activity read, and it also
 * runs for every issue read that links a roadmap item — so it sits on the hot
 * path of a UI panel. It has to be cheap on both counts:
 *
 *  - an index on `items.id`, or the query scans every roadmap in the tenant;
 *  - a projection, or each candidate document arrives whole (a roadmap can hold
 *    hundreds of items with long descriptions) and gets hydrated into a full
 *    entity — to read two scalars.
 *
 * Both were missing. Neither is observable from the use-case's behaviour, which
 * is exactly why they need pinning here.
 */
function repoWith(doc: unknown) {
  const calls: { filter: unknown; projection?: string }[] = [];
  const model = {
    findOne(filter: Record<string, unknown>) {
      const call: { filter: unknown; projection?: string } = { filter };
      calls.push(call);
      const chain = {
        select(projection: string) {
          call.projection = projection;
          return chain;
        },
        lean: () => ({ exec: async () => doc }),
      };
      return chain;
    },
  };
  return { repo: new RoadmapRepository(model as never), calls };
}

describe('RoadmapRepository.findByItemId', () => {
  it('queries by tenant + embedded item id, projecting only what the guard reads', async () => {
    const updatedAt = new Date('2026-01-01');
    const { repo, calls } = repoWith({ _id: 'r1', tenantId: 't1', updatedAt });

    const owner = await repo.findByItemId('t1', 'item-1');

    expect(owner).toEqual({ tenantId: 't1', updatedAt });
    expect(calls[0].filter).toEqual({ tenantId: 't1', 'items.id': 'item-1' });
    // A projection, not the whole document — and not a hydrated RoadmapEntity.
    expect(calls[0].projection).toBe('tenantId updatedAt');
  });

  it('short-circuits an empty item id without querying', async () => {
    const { repo, calls } = repoWith(null);
    await expect(repo.findByItemId('t1', '')).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null when no roadmap in the tenant holds the item', async () => {
    const { repo } = repoWith(null);
    await expect(repo.findByItemId('t1', 'item-1')).resolves.toBeNull();
  });
});

describe('RoadmapSchema indexes', () => {
  it('indexes the embedded item id, so findByItemId is not a tenant-wide scan', () => {
    const keys = RoadmapSchema.indexes().map(([spec]) => spec);
    expect(keys).toContainEqual({ tenantId: 1, 'items.id': 1 });
  });
});
