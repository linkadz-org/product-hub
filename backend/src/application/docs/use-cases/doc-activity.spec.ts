import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import { CreateDocUseCase, DeleteDocUseCase, DuplicateDocUseCase } from './doc.use-cases';
import { DocEntity } from '../domain/entities/doc.entity';
import { DocPageEntity } from '../domain/entities/doc-page.entity';

/**
 * The doc-level write paths, all three of which recorded nothing.
 *
 * Only page-level use-cases had hooks, so: every doc — from the UI or from
 * `mcp_create_doc` — opened on a first page with an empty timeline while pages
 * 2..n had one; a duplicate produced N such pages; and deleting a doc ended
 * every page's timeline mid-sentence. Each test below drives the real use-case
 * and asserts the rows, so each one failed before the hooks existed.
 */

function makeDoc(title = 'Discovery'): DocEntity {
  return DocEntity.create({
    tenantId: 't1',
    ref: 'DOC-1',
    title,
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

function makeRecorder() {
  const recorded: Record<string, unknown>[] = [];
  return {
    activity: {
      execute: async (req: Record<string, unknown>) => {
        recorded.push(req);
      },
    },
    recorded,
  };
}

const counters = { next: async () => 1 };
const author = { userId: 'u1', name: 'Lucas' };

describe('CreateDocUseCase activity', () => {
  it('records a created event for the first page every doc is born with', async () => {
    const { activity, recorded } = makeRecorder();
    let saved: DocPageEntity | undefined;
    const docs = { refExists: async () => false, save: async () => undefined };
    const pages = {
      save: async (p: DocPageEntity) => {
        saved = p;
      },
    };
    const uc = new CreateDocUseCase(
      docs as never,
      pages as never,
      counters as never,
      activity as never,
    );

    const result = await uc.execute({
      tenantId: 't1',
      author,
      dto: { title: 'Discovery' } as never,
    });

    expect(result.isSuccess).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual(
      expect.objectContaining({
        entity: AuditEntity.DOC_PAGE,
        entityId: saved!.id.toString(),
        entityRef: 'Discovery',
        changes: [{ field: 'created', oldValue: '', newValue: '' }],
      }),
    );
    expect(recorded[0].actor).toEqual({ type: AuditActor.USER, id: 'u1', name: 'Lucas' });
  });

  it('marks the row API when MCP is the caller', async () => {
    const { activity, recorded } = makeRecorder();
    const uc = new CreateDocUseCase(
      { refExists: async () => false, save: async () => undefined } as never,
      { save: async () => undefined } as never,
      counters as never,
      activity as never,
    );

    await uc.execute({
      tenantId: 't1',
      author,
      actorType: AuditActor.API,
      dto: { title: 'Discovery' } as never,
    });

    expect((recorded[0].actor as { type: AuditActor }).type).toBe(AuditActor.API);
  });
});

describe('DuplicateDocUseCase activity', () => {
  it('records a created event for every copied page, sharing one timestamp', async () => {
    const { activity, recorded } = makeRecorder();
    const source = makeDoc();
    const sourcePages = [makePage({ title: 'One' }), makePage({ title: 'Two' })];
    const docs = {
      findByIdOrRef: async () => source,
      refExists: async () => false,
      save: async () => undefined,
    };
    const pages = { findByDoc: async () => sourcePages, saveMany: async () => undefined };
    const uc = new DuplicateDocUseCase(
      docs as never,
      pages as never,
      counters as never,
      activity as never,
    );

    const result = await uc.execute({
      id: source.id.toString(),
      tenantId: 't1',
      author,
      dto: {} as never,
    });

    expect(result.isSuccess).toBe(true);
    const copies = result.getValue().pages;
    expect(recorded).toHaveLength(2);
    expect(recorded.map((r) => r.entityId)).toEqual(copies.map((p) => p.id.toString()));
    expect(recorded.map((r) => r.entityRef)).toEqual(['One', 'Two']);
    expect(recorded.every((r) => r.automated === true)).toBe(true);
    expect(recorded[1].at).toBe(recorded[0].at);
  });
});

describe('DeleteDocUseCase activity', () => {
  it('records a deleted event for every page, captured before the delete', async () => {
    const { activity, recorded } = makeRecorder();
    const doc = makeDoc();
    const doomed = [makePage({ title: 'One' }), makePage({ title: 'Two' })];
    let deleted = false;
    const docs = {
      findByIdOrRef: async () => doc,
      delete: async () => undefined,
    };
    const pages = {
      // Returns nothing once the delete has run — a snapshot taken afterwards
      // would silently record zero rows, which is exactly the bug.
      findByDoc: async () => (deleted ? [] : doomed),
      deleteByDoc: async () => {
        deleted = true;
      },
    };
    const uc = new DeleteDocUseCase(
      docs as never,
      pages as never,
      { deleteByDoc: async () => undefined } as never,
      { deleteByDoc: async () => undefined } as never,
      activity as never,
    );

    const result = await uc.execute({ id: doc.id.toString(), tenantId: 't1', author });

    expect(result.isSuccess).toBe(true);
    expect(recorded).toHaveLength(2);
    expect(recorded.map((r) => r.entityRef)).toEqual(['One', 'Two']);
    expect(recorded[0]).toEqual(
      expect.objectContaining({
        entity: AuditEntity.DOC_PAGE,
        entityId: doomed[0].id.toString(),
        automated: true,
        changes: [{ field: 'deleted', oldValue: '', newValue: '' }],
      }),
    );
    expect(recorded[0].actor).toEqual({ type: AuditActor.USER, id: 'u1', name: 'Lucas' });
  });
});
