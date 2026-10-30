import { UpdateIssueUseCase } from './update-issue.use-case';
import { IssueEntity } from '../domain/entities/issue.entity';
import { IssueKind, TaskStatus, isCompletedStatus } from '../domain/enums/issue.enums';

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
    // The roll-up reads each parent's children off the same table.
    childRollups: jest.fn((_t: string, [parentId]: string[]) => {
      const kids = Object.values(byId).filter((i) => i.parentId === parentId);
      const done = kids.filter((i) => isCompletedStatus(i.kind, i.status)).length;
      return Promise.resolve(kids.length ? { [parentId]: { total: kids.length, done } } : {});
    }),
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
    // '' can't create a loop, so the guard walks nothing — the only other read
    // is the old parent, for the roll-up.
    expect(issues.findById.mock.calls.map(([id]) => id)).toEqual(['child', 'old']);
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

  // RM-85: two open sub-tasks moved under a parent that was already Done. The
  // parent stayed Done, so the backlog panel folded them away under a "done"
  // row while the item's bar read 88%.
  it('reopens a finished parent when an open sub-task moves under it', async () => {
    const target = withId(makeIssue({ status: TaskStatus.DONE }), 'target');
    const finished = withId(makeIssue({ parentId: 'target', status: TaskStatus.DONE }), 'finished');
    const child = withId(makeIssue({ status: TaskStatus.TODO }), 'child');
    const { useCase } = build({ target, finished, child });

    const result = await useCase.execute({ id: 'child', ...scope, dto: { parentId: 'target' } });

    expect(result.isSuccess).toBe(true);
    expect(target.status).toBe(TaskStatus.IN_PROGRESS);
  });

  it('finishes the old parent when its last open sub-task moves away', async () => {
    const old = withId(makeIssue({ status: TaskStatus.IN_PROGRESS }), 'old');
    const finished = withId(makeIssue({ parentId: 'old', status: TaskStatus.DONE }), 'finished');
    const child = withId(makeIssue({ parentId: 'old', status: TaskStatus.TODO }), 'child');
    const { useCase } = build({ old, finished, child });

    const result = await useCase.execute({ id: 'child', ...scope, dto: { parentId: '' } });

    expect(result.isSuccess).toBe(true);
    expect(old.status).toBe(TaskStatus.DONE);
  });

  it('leaves both parents alone when nothing about the parent changed', async () => {
    const parent = withId(makeIssue({ status: TaskStatus.DONE }), 'parent');
    const child = withId(makeIssue({ parentId: 'parent', status: TaskStatus.TODO }), 'child');
    const { useCase, issues } = build({ parent, child });

    await useCase.execute({ id: 'child', ...scope, dto: { title: 'Đổi tên' } });

    expect(issues.childRollups).not.toHaveBeenCalled();
  });
});
