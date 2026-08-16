import {
  CreateDocPageUseCase,
  DeleteDocPageUseCase,
  ReorderDocPagesUseCase,
  UpdateDocPageUseCase,
} from './doc-page.use-cases';
import { RestoreDocPageVersionUseCase } from './doc-page-version.use-cases';
import { DocPageEntity } from '../domain/entities/doc-page.entity';
import { DocEntity } from '../domain/entities/doc.entity';
import { DocPageVersionEntity } from '../domain/entities/doc-page-version.entity';
import { AuditActor } from '@application/audit-log/domain/enums/audit.enums';

function makeDoc(): DocEntity {
  return DocEntity.create({
    tenantId: 't1',
    ref: 'DOC-1',
    title: 'Discovery',
    createdBy: 'u1',
    createdByName: 'Lucas',
  } as never).getValue();
}

function makePage(over: Record<string, unknown> = {}): DocPageEntity {
  return DocPageEntity.create({
    tenantId: 't1',
    docId: 'doc1',
    title: 'Old',
    createdBy: 'u1',
    ...over,
  } as never).getValue();
}

/** An id → thing table, keyed by whatever `toString()` returns for that thing. */
function withId<T extends { id: { toString(): string } }>(entity: T, id: string): T {
  Object.defineProperty(entity.id, 'toString', { value: () => id });
  return entity;
}

function makeRecorder() {
  const recorded: Record<string, unknown>[] = [];
  const activity = {
    execute: async (req: Record<string, unknown>) => {
      recorded.push(req);
    },
  };
  return { activity, recorded };
}

const author = { userId: 'u1', name: 'Lucas' };

describe('CreateDocPageUseCase activity', () => {
  it('records a created event', async () => {
    const doc = withId(makeDoc(), 'doc1');
    const { activity, recorded } = makeRecorder();
    const docs = { findById: async () => doc, update: async () => undefined };
    const pages = { findByDoc: async () => [], save: async () => undefined };
    const uc = new CreateDocPageUseCase(docs as never, pages as never, activity as never);

    const result = await uc.execute({
      docId: 'doc1',
      tenantId: 't1',
      author,
      dto: { title: 'New page' } as never,
    });

    expect(result.isSuccess).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].changes).toEqual([{ field: 'created', oldValue: '', newValue: '' }]);
    expect(recorded[0].entityRef).toBe('New page');
  });
});

describe('UpdateDocPageUseCase activity', () => {
  function build(page: DocPageEntity) {
    const doc = withId(makeDoc(), 'doc1');
    const { activity, recorded } = makeRecorder();
    const docs = { findById: async () => doc, update: async () => undefined };
    const pages = { findById: async () => page, update: async () => undefined };
    const uc = new UpdateDocPageUseCase(docs as never, pages as never, activity as never);
    return { uc, recorded };
  }

  it('records the title change', async () => {
    const page = withId(makePage({ title: 'Old' }), 'p1');
    const { uc, recorded } = build(page);

    await uc.execute({
      docId: 'doc1',
      pageId: 'p1',
      tenantId: 't1',
      author,
      dto: { title: 'New' } as never,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].changes).toEqual([{ field: 'title', oldValue: 'Old', newValue: 'New' }]);
  });

  it('records nothing for a content-only edit — page bodies emit nothing', async () => {
    const page = withId(makePage({ title: 'Old' }), 'p1');
    const { uc, recorded } = build(page);

    await uc.execute({
      docId: 'doc1',
      pageId: 'p1',
      tenantId: 't1',
      author,
      dto: { content: '<p>new body</p>' } as never,
    });

    const changes = (recorded[0]?.changes ?? []) as unknown[];
    expect(changes).toHaveLength(0);
  });

  it('SNAPSHOT PLACEMENT: captures the title before the entity is mutated', async () => {
    const page = withId(makePage({ title: 'Old' }), 'p1');
    const { uc, recorded } = build(page);

    await uc.execute({
      docId: 'doc1',
      pageId: 'p1',
      tenantId: 't1',
      author,
      dto: { title: 'New', content: 'irrelevant' } as never,
    });

    const changes = recorded[0].changes as { field: string; oldValue: string }[];
    const title = changes.find((c) => c.field === 'title');
    expect(title?.oldValue).toBe('Old');
  });
});

describe('DeleteDocPageUseCase activity', () => {
  it('records a deleted event for the removed page', async () => {
    const doc = withId(makeDoc(), 'doc1');
    const page = withId(makePage({ title: 'Bye' }), 'p1');
    const { activity, recorded } = makeRecorder();
    const docs = { findById: async () => doc, update: async () => undefined };
    const pages = {
      findByDoc: async () => [page],
      deleteMany: async () => undefined,
    };
    const versions = { deleteByPages: async () => undefined };
    const comments = { deleteByDocPages: async () => undefined };
    const uc = new DeleteDocPageUseCase(
      docs as never,
      pages as never,
      versions as never,
      comments as never,
      activity as never,
    );

    const result = await uc.execute({ docId: 'doc1', pageId: 'p1', tenantId: 't1', author });

    expect(result.isSuccess).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].entityId).toBe('p1');
    expect(recorded[0].entityRef).toBe('Bye');
    expect(recorded[0].changes).toEqual([{ field: 'deleted', oldValue: '', newValue: '' }]);
  });
});

describe('ReorderDocPagesUseCase activity', () => {
  it('records a moved event for a re-parented page', async () => {
    const doc = withId(makeDoc(), 'doc1');
    const parent = withId(makePage({ title: 'Parent' }), 'parent1');
    const page = withId(makePage({ title: 'Child', parentId: '', order: 0 }), 'p1');
    const { activity, recorded } = makeRecorder();
    const docs = { findById: async () => doc, update: async () => undefined };
    const pages = {
      findByDoc: async () => [parent, page],
      updateMany: async () => undefined,
    };
    const uc = new ReorderDocPagesUseCase(docs as never, pages as never, activity as never);

    const result = await uc.execute({
      docId: 'doc1',
      tenantId: 't1',
      author,
      dto: { pages: [{ id: 'p1', parentId: 'parent1', order: 0 }] } as never,
    });

    expect(result.isSuccess).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].entityId).toBe('p1');
    expect(recorded[0].changes).toEqual([
      { field: 'parentId', oldValue: '', newValue: '' },
    ]);
  });

  it('records nothing when a page does not actually move', async () => {
    const doc = withId(makeDoc(), 'doc1');
    const page = withId(makePage({ title: 'Child', parentId: '', order: 0 }), 'p1');
    const { activity, recorded } = makeRecorder();
    const docs = { findById: async () => doc, update: async () => undefined };
    const pages = { findByDoc: async () => [page], updateMany: async () => undefined };
    const uc = new ReorderDocPagesUseCase(docs as never, pages as never, activity as never);

    await uc.execute({
      docId: 'doc1',
      tenantId: 't1',
      author,
      dto: { pages: [{ id: 'p1', parentId: '', order: 0 }] } as never,
    });

    expect(recorded).toHaveLength(0);
  });
});

describe('RestoreDocPageVersionUseCase activity', () => {
  it('records a version_restored event', async () => {
    const doc = withId(makeDoc(), 'doc1');
    const page = withId(makePage({ title: 'Current' }), 'p1');
    const version = DocPageVersionEntity.create({
      tenantId: 't1',
      docId: 'doc1',
      pageId: 'p1',
      title: 'Old title',
      content: 'old body',
      label: 'Before the rewrite',
      createdBy: 'u1',
      createdByName: 'Lucas',
    } as never).getValue();
    const { activity, recorded } = makeRecorder();
    const docs = { findById: async () => doc, update: async () => undefined };
    const pages = { findById: async () => page, update: async () => undefined };
    const versions = { findById: async () => version, save: async () => undefined };
    const uc = new RestoreDocPageVersionUseCase(
      docs as never,
      pages as never,
      versions as never,
      activity as never,
    );

    const result = await uc.execute({
      docId: 'doc1',
      pageId: 'p1',
      tenantId: 't1',
      versionId: 'v1',
      author,
    });

    expect(result.isSuccess).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].changes).toEqual([
      { field: 'version_restored', oldValue: '', newValue: 'Before the rewrite' },
    ]);
    expect(recorded[0].actor).toEqual({ type: AuditActor.USER, id: 'u1', name: 'Lucas' });
  });
});
