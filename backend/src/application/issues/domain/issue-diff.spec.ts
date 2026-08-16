import { diffIssue, snapshotIssue, LONG_TEXT_FIELDS } from './issue-diff';
import { IssueEntity } from './entities/issue.entity';
import { IssueKind } from './enums/issue.enums';

function makeIssue(over: Record<string, unknown> = {}): IssueEntity {
  return IssueEntity.create({
    kind: IssueKind.BUG,
    tenantId: 't1',
    title: 'Login fails',
    createdBy: 'u1',
    status: 'Backlog',
    ...over,
  } as never).getValue();
}

describe('diffIssue', () => {
  it('reports nothing when nothing changed', () => {
    const issue = makeIssue();
    const before = snapshotIssue(issue);
    expect(diffIssue(before, issue)).toEqual([]);
  });

  it('reports one change per changed field', () => {
    const issue = makeIssue();
    const before = snapshotIssue(issue);
    issue.applyUpdate({ severity: 'critical' } as never);
    const changes = diffIssue(before, issue);
    expect(changes).toEqual([
      { field: 'severity', oldValue: 'medium', newValue: 'critical' },
    ]);
  });

  it('records status transitions with both values', () => {
    const issue = makeIssue({ status: 'Backlog' });
    const before = snapshotIssue(issue);
    issue.setStatus('Done');
    expect(diffIssue(before, issue)).toEqual([
      { field: 'status', oldValue: 'Backlog', newValue: 'Done' },
    ]);
  });

  it('records that long text changed but never its content', () => {
    const issue = makeIssue({ description: 'old body' });
    const before = snapshotIssue(issue);
    issue.applyUpdate({ description: 'a completely new body' } as never);
    expect(diffIssue(before, issue)).toEqual([
      { field: 'description', oldValue: '', newValue: '' },
    ]);
  });

  it('treats title as long text too', () => {
    expect(LONG_TEXT_FIELDS).toContain('title');
    expect(LONG_TEXT_FIELDS).toContain('description');
  });

  it('renders assignees as names, not ids', () => {
    const issue = makeIssue();
    const before = snapshotIssue(issue);
    issue.setAssignees([{ id: 'u2', name: 'Felix' }] as never);
    expect(diffIssue(before, issue)).toEqual([
      { field: 'assignees', oldValue: '', newValue: 'Felix' },
    ]);
  });

  it('does not track customFields in v1', () => {
    const issue = makeIssue();
    const before = snapshotIssue(issue);
    issue.applyUpdate({ customFields: { anything: 'x' } } as never);
    expect(diffIssue(before, issue)).toEqual([]);
  });

  it('snapshot is a copy — mutating the issue afterwards must not change it', () => {
    // This is the guard for the whole feature's worst failure mode: a snapshot
    // that aliases the live entity makes every diff come out empty, silently.
    const issue = makeIssue({ status: 'Backlog' });
    const before = snapshotIssue(issue);
    issue.setStatus('Done');
    expect(before.status).toBe('Backlog');
  });
});
