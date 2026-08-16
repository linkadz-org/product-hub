import { UpdateIssueUseCase } from './update-issue.use-case';
import { IssueEntity } from '../domain/entities/issue.entity';
import { IssueKind } from '../domain/enums/issue.enums';

const makeIssue = (over: Partial<Parameters<typeof IssueEntity.create>[0]> = {}) =>
  IssueEntity.create({
    kind: IssueKind.TASK,
    tenantId: 't1',
    title: 'Dựng màn hình đăng nhập',
    createdBy: 'u1',
    ...over,
  }).getValue();

/**
 * A repo backed by an id → issue table. `findById` is what the parent walk uses,
 * so the table *is* the hierarchy under test.
 */
const build = (byId: Record<string, IssueEntity>) => {
  const issues = {
    findById: jest.fn((id: string) => Promise.resolve(byId[id] ?? null)),
    update: jest.fn(() => Promise.resolve()),
  };
  const users = { findByIds: jest.fn(() => Promise.resolve([])) };
  const cycles = { findById: jest.fn(() => Promise.resolve(null)) };
  const activity = { execute: jest.fn(() => Promise.resolve()) };
  return {
    useCase: new UpdateIssueUseCase(
      issues as never,
      users as never,
      cycles as never,
      activity as never,
    ),
    issues,
  };
};

describe('UpdateIssueUseCase parent guard', () => {
  const scope = { tenantId: 't1', requesterId: 'u1', requesterName: 'Alice', isAdmin: false };

  /** Give an entity a stable id, since `create` mints its own. */
  const withId = (issue: IssueEntity, id: string) => {
    Object.defineProperty(issue.id, 'toString', { value: () => id });
    return issue;
  };

  it('re-parents an issue when the move is sound', async () => {
    const child = withId(makeIssue(), 'child');
    const target = withId(makeIssue(), 'target');
    const { useCase, issues } = build({ child, target });

    const result = await useCase.execute({ id: 'child', ...scope, dto: { parentId: 'target' } });

    expect(result.isSuccess).toBe(true);
    expect(child.parentId).toBe('target');
    expect(issues.update).toHaveBeenCalled();
  });

  it('refuses an issue as its own parent', async () => {
    const child = withId(makeIssue(), 'child');
    const { useCase, issues } = build({ child });

    const result = await useCase.execute({ id: 'child', ...scope, dto: { parentId: 'child' } });

    expect(result.isFailure).toBe(true);
    expect(issues.update).not.toHaveBeenCalled();
  });

  it('refuses a parent that sits below the issue (the loop case)', async () => {
    // A → B → C. Making A a child of C closes the ring, and `parentId` is the
    // only record of hierarchy, so nothing could walk out of it afterwards.
    const a = withId(makeIssue(), 'a');
    const b = withId(makeIssue({ parentId: 'a' }), 'b');
    const c = withId(makeIssue({ parentId: 'b' }), 'c');
    const { useCase, issues } = build({ a, b, c });

    const result = await useCase.execute({ id: 'a', ...scope, dto: { parentId: 'c' } });

    expect(result.isFailure).toBe(true);
    expect(a.parentId).toBe('');
    expect(issues.update).not.toHaveBeenCalled();
  });

  it('refuses a parent that does not exist', async () => {
    const child = withId(makeIssue(), 'child');
    const { useCase } = build({ child });

    const result = await useCase.execute({ id: 'child', ...scope, dto: { parentId: 'gone' } });

    expect(result.isFailure).toBe(true);
  });

  it("refuses a parent the caller can't read, without confirming it exists", async () => {
    const secret = withId(makeIssue({ ownerId: 'someone-else' }), 'secret');
    const child = withId(makeIssue(), 'child');
    const { useCase } = build({ child, secret });

    const result = await useCase.execute({ id: 'child', ...scope, dto: { parentId: 'secret' } });

    // Same wording as a missing issue — the error must not be a existence oracle.
    expect(result.error).toBe('Parent issue not found');
  });

  it('detaches without walking anything', async () => {
    const child = withId(makeIssue({ parentId: 'old' }), 'child');
    const { useCase, issues } = build({ child });

    const result = await useCase.execute({ id: 'child', ...scope, dto: { parentId: '' } });

    expect(result.isSuccess).toBe(true);
    expect(child.parentId).toBe('');
    // Only the issue itself was read — '' can't create a loop.
    expect(issues.findById).toHaveBeenCalledTimes(1);
  });

  it('survives a loop that already exists above the target', async () => {
    // Corrupt rows predate the guard; the walk must terminate, not hang.
    const x = withId(makeIssue({ parentId: 'y' }), 'x');
    const y = withId(makeIssue({ parentId: 'x' }), 'y');
    const child = withId(makeIssue(), 'child');
    const { useCase } = build({ child, x, y });

    const result = await useCase.execute({ id: 'child', ...scope, dto: { parentId: 'x' } });

    expect(result.isSuccess).toBe(true);
  });
});
