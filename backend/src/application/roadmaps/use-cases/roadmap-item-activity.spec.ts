import {
  AddRoadmapItemUseCase,
  DeleteRoadmapUseCase,
  ReplaceRoadmapItemsUseCase,
} from './roadmap.use-cases';
import { RoadmapEntity } from '../domain/entities/roadmap.entity';
import { RoadmapDifficulty, RoadmapItemStatus, RoadmapPhase } from '../domain/enums/roadmap.enums';
import { RoadmapItemData } from '../domain/types/roadmap-item.type';
import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';

function item(over: Partial<RoadmapItemData> & { id: string }): RoadmapItemData {
  return {
    title: `Item ${over.id}`,
    description: '',
    phase: RoadmapPhase.NOW,
    status: RoadmapItemStatus.PLANNED,
    difficulty: RoadmapDifficulty.MEDIUM,
    reach: 0,
    impact: 0,
    confidence: 0,
    effort: 0,
    progress: 0,
    imageUrl: '',
    startDate: '',
    endDate: '',
    assignees: [],
    milestoneId: '',
    objectiveId: '',
    keyResultId: '',
    okrLabel: '',
    ...over,
  } as RoadmapItemData;
}

function roadmapWith(items: RoadmapItemData[]): RoadmapEntity {
  const roadmap = RoadmapEntity.create({ tenantId: 't1', title: 'Board' }).getValue();
  roadmap.replaceItems(items);
  return roadmap;
}

function build(existing: RoadmapItemData[]) {
  const roadmap = roadmapWith(existing);
  const recorded: Record<string, unknown>[] = [];
  const roadmaps = {
    findById: async () => roadmap,
    update: async () => undefined,
  };
  const counters = {
    next: async () => 1,
    ensureAtLeast: async () => undefined,
  };
  const activity = {
    execute: async (req: Record<string, unknown>) => {
      recorded.push(req);
    },
  };
  const replaceUseCase = new ReplaceRoadmapItemsUseCase(
    roadmaps as never,
    counters as never,
    activity as never,
  );
  const addUseCase = new AddRoadmapItemUseCase(
    roadmaps as never,
    counters as never,
    activity as never,
  );
  return { replaceUseCase, addUseCase, roadmap, recorded };
}

describe('roadmap item activity', () => {
  it('records a phase move keyed by the ITEM id, not the roadmap id', async () => {
    const stored = item({ id: 'a', shortId: 'RM-1', phase: RoadmapPhase.NOW });
    const { replaceUseCase, recorded } = build([stored]);

    const result = await replaceUseCase.execute({
      id: 'r1',
      tenantId: 't1',
      requesterId: 'u1',
      requesterName: 'Lucas',
      dto: { items: [item({ id: 'a', shortId: 'RM-1', phase: RoadmapPhase.DONE })] } as never,
    });

    expect(result.isSuccess).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].entity).toBe(AuditEntity.ROADMAP_ITEM);
    // entityId is the item's own id ('a'), never the roadmap's id ('r1').
    expect(recorded[0].entityId).toBe('a');
    expect(recorded[0].entityRef).toBe('RM-1');
    expect(recorded[0].changes).toEqual([
      { field: 'phase', oldValue: RoadmapPhase.NOW, newValue: RoadmapPhase.DONE },
    ]);
  });

  it('IGNORES pure reordering at the wiring level — a drag emits no rows', async () => {
    const a = item({ id: 'a', shortId: 'RM-1' });
    const b = item({ id: 'b', shortId: 'RM-2' });
    const { replaceUseCase, recorded } = build([a, b]);

    // A drag rewrites the whole array with positions swapped; nothing about
    // either item's own fields changed.
    await replaceUseCase.execute({
      id: 'r1',
      tenantId: 't1',
      requesterId: 'u1',
      requesterName: 'Lucas',
      dto: { items: [item({ id: 'b', shortId: 'RM-2' }), item({ id: 'a', shortId: 'RM-1' })] } as never,
    });

    expect(recorded).toHaveLength(0);
  });

  it('shares one timestamp across every row from a single bulk edit', async () => {
    const a = item({ id: 'a', shortId: 'RM-1', phase: RoadmapPhase.NOW });
    const b = item({ id: 'b', shortId: 'RM-2', phase: RoadmapPhase.NOW });
    const { replaceUseCase, recorded } = build([a, b]);

    await replaceUseCase.execute({
      id: 'r1',
      tenantId: 't1',
      requesterId: 'u1',
      requesterName: 'Lucas',
      dto: {
        items: [
          item({ id: 'a', shortId: 'RM-1', phase: RoadmapPhase.DONE }),
          item({ id: 'b', shortId: 'RM-2', phase: RoadmapPhase.DONE }),
        ],
      } as never,
    });

    expect(recorded).toHaveLength(2);
    expect(recorded[0].at).toBeInstanceOf(Date);
    expect(recorded[0].at).toBe(recorded[1].at);
  });

  it('records an added item as created, attributed to the requester', async () => {
    const { addUseCase, recorded } = build([]);

    const result = await addUseCase.execute({
      id: 'r1',
      tenantId: 't1',
      requesterId: 'owner-1',
      requesterName: 'qa-runner',
      actorType: AuditActor.API,
      item: { title: 'New idea' },
    });

    expect(result.isSuccess).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].changes).toEqual([{ field: 'created', oldValue: '', newValue: '' }]);
    expect(recorded[0].actor).toEqual({ type: AuditActor.API, id: 'owner-1', name: 'qa-runner' });
  });
});

/**
 * Dropping the whole roadmap has to say the same thing `diffRoadmapItems` says
 * when one item disappears through `replaceItems` — otherwise an item's
 * timeline just stops. Before the hook existed, DeleteRoadmapUseCase recorded
 * nothing at all, so both assertions below failed.
 */
describe('DeleteRoadmapUseCase activity', () => {
  function buildDelete(items: RoadmapItemData[]) {
    const roadmap = roadmapWith(items);
    const recorded: Record<string, unknown>[] = [];
    let deleted = false;
    const roadmaps = {
      findById: async () => roadmap,
      // After the delete there is nothing left to name the items with: a
      // snapshot taken afterwards would record zero rows, silently.
      delete: async () => {
        deleted = true;
        roadmap.replaceItems([]);
      },
    };
    const activity = {
      execute: async (req: Record<string, unknown>) => {
        recorded.push(req);
      },
    };
    const useCase = new DeleteRoadmapUseCase(roadmaps as never, activity as never);
    return { useCase, roadmap, recorded, wasDeleted: () => deleted };
  }

  it('records a deleted event for every item it drops', async () => {
    const { useCase, roadmap, recorded, wasDeleted } = buildDelete([
      item({ id: 'a', shortId: 'RM-1' }),
      item({ id: 'b' }), // no ref yet — falls back to the uuid
    ]);

    const result = await useCase.execute({
      id: roadmap.id.toString(),
      tenantId: 't1',
      requesterId: 'u1',
      requesterName: 'Lucas',
    });

    expect(result.isSuccess).toBe(true);
    expect(wasDeleted()).toBe(true);
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toEqual(
      expect.objectContaining({
        entity: AuditEntity.ROADMAP_ITEM,
        entityId: 'a',
        entityRef: 'RM-1',
        automated: true,
        changes: [{ field: 'deleted', oldValue: '', newValue: '' }],
      }),
    );
    expect(recorded[0].actor).toEqual({ type: AuditActor.USER, id: 'u1', name: 'Lucas' });
    expect(recorded[1].entityRef).toBe('b');
    // One shared timestamp — the user deleted a roadmap, not N items.
    expect(recorded[1].at).toBe(recorded[0].at);
  });

  it('records nothing for another tenant, and does not delete', async () => {
    const { useCase, roadmap, recorded, wasDeleted } = buildDelete([item({ id: 'a' })]);
    const result = await useCase.execute({
      id: roadmap.id.toString(),
      tenantId: 'other',
      requesterId: 'u1',
      requesterName: 'Lucas',
    });
    expect(result.isFailure).toBe(true);
    expect(wasDeleted()).toBe(false);
    expect(recorded).toHaveLength(0);
  });
});
