import { SaveDocPageVersionUseCase } from './doc-page-version.use-cases';

/**
 * Version retention.
 *
 * Versions used to be sparse — a person clicking "Save version" at a moment
 * worth marking. MCP's `update_doc` snapshots on every body write, and each
 * snapshot is a full copy of the page, so an assistant iterating on a 300 KB
 * page leaves tens of megabytes behind and a history nobody can scan.
 *
 * So a caller that snapshots per write may ask for a cap. The rule that makes
 * that safe is that pruning is scoped to the *label*: a machine cap can only
 * ever remove the machine's own snapshots, and a human's save is neither counted
 * against the cap nor eligible to be deleted by it.
 */
const PAGE = {
  id: { toString: () => 'page-1' },
  tenantId: 't1',
  docId: 'doc-1',
  title: 'Week 31',
  content: '<p>body</p>',
};

const AUTHOR = { userId: 'u1', name: 'Ada' };
const SCOPE = { docId: 'doc-1', pageId: 'page-1', tenantId: 't1' };

const build = (over: { prune?: jest.Mock } = {}) => {
  const pages = { findById: jest.fn().mockResolvedValue(PAGE) };
  const versions = {
    save: jest.fn().mockResolvedValue(undefined),
    pruneByPageAndLabel: over.prune ?? jest.fn().mockResolvedValue(undefined),
  };
  const useCase = new SaveDocPageVersionUseCase(pages as never, versions as never);
  return { useCase, versions };
};

describe('SaveDocPageVersionUseCase — retention', () => {
  it('prunes to the cap, scoped to the label it just wrote', async () => {
    const { useCase, versions } = build();

    const result = await useCase.execute({
      ...SCOPE,
      author: AUTHOR,
      retain: 10,
      dto: { label: 'Before update_doc (MCP)' } as never,
    });

    expect(result.isSuccess).toBe(true);
    expect(versions.pruneByPageAndLabel).toHaveBeenCalledWith(
      'page-1',
      'Before update_doc (MCP)',
      10,
    );
    // After the save, so a cap of 10 leaves 10 — this one included.
    expect(versions.pruneByPageAndLabel.mock.invocationCallOrder[0]).toBeGreaterThan(
      versions.save.mock.invocationCallOrder[0],
    );
  });

  it('never prunes when no cap was asked for — a human save stays append-only', async () => {
    const { useCase, versions } = build();

    const result = await useCase.execute({
      ...SCOPE,
      author: AUTHOR,
      dto: { label: 'Before the rewrite' } as never,
    });

    expect(result.isSuccess).toBe(true);
    expect(versions.pruneByPageAndLabel).not.toHaveBeenCalled();
  });

  it('does not prune an unlabelled snapshot, cap or no cap', async () => {
    // An empty label would match every unlabelled version on the page — which is
    // precisely the set a person's manual saves land in.
    const { useCase, versions } = build();

    await useCase.execute({ ...SCOPE, author: AUTHOR, retain: 10, dto: {} as never });

    expect(versions.pruneByPageAndLabel).not.toHaveBeenCalled();
  });

  it('still returns the version when pruning throws', async () => {
    const { useCase } = build({ prune: jest.fn().mockRejectedValue(new Error('mongo down')) });

    const result = await useCase.execute({
      ...SCOPE,
      author: AUTHOR,
      retain: 10,
      dto: { label: 'Before update_doc (MCP)' } as never,
    });

    // The snapshot is already stored and the caller is about to overwrite the
    // page on the strength of it. Housekeeping failing costs disk, not data.
    expect(result.isSuccess).toBe(true);
  });
});
