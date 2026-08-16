import { UpdateIssueUseCase } from './update-issue.use-case';
import { IssueEntity } from '../domain/entities/issue.entity';
import { IssueKind } from '../domain/enums/issue.enums';
import { AuditActor } from '@application/audit-log/domain/enums/audit.enums';

function makeIssue(): IssueEntity {
  return IssueEntity.create({
    kind: IssueKind.BUG,
    tenantId: 't1',
    title: 'Login fails',
    createdBy: 'u1',
    status: 'Backlog',
    shortId: 'QC-10',
  } as never).getValue();
}

function build(issue: IssueEntity) {
  const recorded: Record<string, unknown>[] = [];
  const issues = {
    findById: async () => issue,
    update: async () => undefined,
  };
  const users = { findByTenant: async () => [] };
  const cycles = { findById: async () => null };
  const activity = {
    execute: async (req: Record<string, unknown>) => {
      recorded.push(req);
    },
  };
  const uc = new UpdateIssueUseCase(
    issues as never,
    users as never,
    cycles as never,
    activity as never,
  );
  return { uc, recorded };
}

describe('UpdateIssueUseCase activity', () => {
  it('records the field that changed', async () => {
    const issue = makeIssue();
    const { uc, recorded } = build(issue);

    await uc.execute({
      id: 'i1',
      tenantId: 't1',
      requesterId: 'u1',
      requesterName: 'Lucas',
      isAdmin: true,
      dto: { severity: 'critical' } as never,
    });

    expect(recorded).toHaveLength(1);
    // IssueEntity.create defaults a bug's severity to BugSeverity.MEDIUM
    // ('medium') when not supplied (issue.entity.ts:147) — '' is the task
    // sentinel, not an unset-bug state. See task-4-report.md for the same
    // finding against the diff engine spec.
    expect(recorded[0].changes).toEqual([
      { field: 'severity', oldValue: 'medium', newValue: 'critical' },
    ]);
    expect(recorded[0].entityRef).toBe('QC-10');
  });

  it('records nothing when the update changes nothing', async () => {
    const issue = makeIssue();
    const { uc, recorded } = build(issue);

    await uc.execute({
      id: 'i1',
      tenantId: 't1',
      requesterId: 'u1',
      requesterName: 'Lucas',
      isAdmin: true,
      dto: { title: 'Login fails' } as never,
    });

    const changes = (recorded[0]?.changes ?? []) as unknown[];
    expect(changes).toHaveLength(0);
  });

  it('SNAPSHOT PLACEMENT: captures the value before the entity is mutated', async () => {
    // If the snapshot is taken after applyUpdate, `oldValue` comes back as the NEW
    // status and this assertion fails. That is the whole point of this test — the
    // failure it guards is silent in production.
    const issue = makeIssue();
    const { uc, recorded } = build(issue);

    await uc.execute({
      id: 'i1',
      tenantId: 't1',
      requesterId: 'u1',
      requesterName: 'Lucas',
      isAdmin: true,
      dto: { description: 'new body', severity: 'critical' } as never,
    });

    const changes = recorded[0].changes as { field: string; oldValue: string }[];
    const severity = changes.find((c) => c.field === 'severity');
    // Real starting value for an unset bug is 'medium' (see note above) — the
    // point of this test is that oldValue must be the PRE-mutation value, not
    // that it be empty. If the snapshot were taken after applyUpdate, this
    // would come back as 'critical' instead.
    expect(severity?.oldValue).toBe('medium');
  });

  it('records long text as changed without its content', async () => {
    const issue = makeIssue();
    const { uc, recorded } = build(issue);

    await uc.execute({
      id: 'i1',
      tenantId: 't1',
      requesterId: 'u1',
      requesterName: 'Lucas',
      isAdmin: true,
      dto: { description: 'a completely new body' } as never,
    });

    const changes = recorded[0].changes as { field: string; oldValue: string; newValue: string }[];
    expect(changes).toEqual([{ field: 'description', oldValue: '', newValue: '' }]);
  });

  it('records a title change with its real values — unlike description, a title is short', async () => {
    const issue = makeIssue();
    const { uc, recorded } = build(issue);

    await uc.execute({
      id: 'i1',
      tenantId: 't1',
      requesterId: 'u1',
      requesterName: 'Lucas',
      isAdmin: true,
      dto: { title: 'Login fails on Safari' } as never,
    });

    expect(recorded[0].changes).toEqual([
      { field: 'title', oldValue: 'Login fails', newValue: 'Login fails on Safari' },
    ]);
  });

  it('records an MCP write as an API actor', async () => {
    const issue = makeIssue();
    const { uc, recorded } = build(issue);

    await uc.execute({
      id: 'i1',
      tenantId: 't1',
      requesterId: 'owner-1',
      requesterName: 'qa-runner',
      actorType: AuditActor.API,
      isAdmin: true,
      dto: { severity: 'critical' } as never,
    });

    expect(recorded[0].actor).toEqual({
      type: AuditActor.API,
      id: 'owner-1',
      name: 'qa-runner',
    });
  });
});
