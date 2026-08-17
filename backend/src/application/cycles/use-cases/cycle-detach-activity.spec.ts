import { TeamEntity } from '@application/teams/domain/entities/team.entity';
import { CycleMode, TeamIssueType } from '@application/teams/domain/enums/team.enums';
import { MovedIssue } from '@application/issues/repositories/issue.repository';
import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import {
  RecordActivityRequest,
  RecordActivityUseCase,
} from '@application/audit-log/use-cases/record-activity.use-case';
import { CycleEntity } from '../domain/entities/cycle.entity';
import { DeleteCycleUseCase, UpdateTeamCycleConfigUseCase } from './cycle.use-cases';

/**
 * An issue that leaves a cycle must leave a trace, whichever way it left.
 *
 * Rollover was logged from the start; the three `clearCycleIds` paths — deleting
 * a cycle, rebuilding a team's cadence, turning cycles off — were not. So "why
 * did TSK-1 fall out of Cycle 3?" was answerable exactly when the answer was
 * "the calendar", and silent whenever the answer was "an admin did it".
 *
 * These drive the real use-cases and assert the rows. Before the fix each one
 * recorded nothing at all, so `recorded` was empty and every case failed.
 *
 * They also pin the actor rule the enum doc states: SYSTEM means NOBODY acted,
 * and is reserved for the date-driven rollover. A person who triggers a cascade
 * keeps their identity and the rows carry `automated: true`.
 */

const DETACHED: MovedIssue[] = [
  { id: 'i1', shortId: 'TSK-1', fromCycleId: 'c1', toCycleId: '' },
  { id: 'i2', shortId: '', fromCycleId: 'c1', toCycleId: '' },
];

const requester = { requesterId: 'u1', requesterName: 'Ada' };

function recorder() {
  const recorded: RecordActivityRequest[] = [];
  const activity = {
    execute: async (req: RecordActivityRequest) => {
      recorded.push(req);
    },
  } as unknown as RecordActivityUseCase;
  return { activity, recorded };
}

const makeTeam = (over: Record<string, unknown> = {}) =>
  TeamEntity.create({
    tenantId: 't1',
    key: 'engineering',
    name: 'Engineering',
    issueType: TeamIssueType.TASK,
    cyclesEnabled: true,
    cycleLengthWeeks: 2,
    cycleCooldownWeeks: 0,
    cycleStartDay: 1,
    cycleAutoRollover: true,
    cycleMode: CycleMode.MANUAL,
    ...over,
  } as never).getValue();

describe('detaching issues from a cycle is recorded', () => {
  it('DeleteCycleUseCase records one row per issue, attributed to the admin', async () => {
    const { activity, recorded } = recorder();
    const cycle = CycleEntity.create({
      tenantId: 't1',
      teamId: 'team-1',
      number: 1,
      startDate: '2026-07-20',
      endDate: '2026-08-02',
    }).getValue();
    const teams = { findById: async () => makeTeam() };
    const cycles = {
      findById: async () => cycle,
      deleteById: async () => true,
    };
    const issues = { clearCycleIds: async () => DETACHED };

    const uc = new DeleteCycleUseCase(
      teams as never,
      cycles as never,
      issues as never,
      activity,
    );
    const result = await uc.execute({
      tenantId: 't1',
      teamId: 'team-1',
      cycleId: cycle.id.toString(),
      ...requester,
    });

    expect(result.isSuccess).toBe(true);
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toEqual(
      expect.objectContaining({
        tenantId: 't1',
        entity: AuditEntity.ISSUE,
        entityId: 'i1',
        entityRef: 'TSK-1',
        automated: true,
        changes: [{ field: 'cycleId', oldValue: 'c1', newValue: '' }],
      }),
    );
    // The admin, NOT SYSTEM — a person acted here.
    expect(recorded[0].actor).toEqual({ type: AuditActor.USER, id: 'u1', name: 'Ada' });
    expect(recorded[0].actor.type).not.toBe(AuditActor.SYSTEM);
    // An issue with no shortId falls back to its uuid rather than an empty ref.
    expect(recorded[1].entityRef).toBe('i2');
    // One shared timestamp, so the UI can group the sweep into one entry.
    expect(recorded[1].at).toBe(recorded[0].at);
  });

  it('UpdateTeamCycleConfigUseCase records the issues a disable detaches', async () => {
    const { activity, recorded } = recorder();
    const team = makeTeam();
    const teams = { findById: async () => team, save: async () => undefined };
    const cycles = {
      findByTeam: async () => [],
      deleteUpcoming: async () => ['c1'],
      deleteAllForTeam: async () => [],
    };
    const issues = { clearCycleIds: async () => DETACHED };
    const scheduler = { ensureCyclesCurrent: async () => [] };

    const uc = new UpdateTeamCycleConfigUseCase(
      teams as never,
      cycles as never,
      issues as never,
      scheduler as never,
      activity,
    );
    const result = await uc.execute({
      tenantId: 't1',
      teamId: team.id.toString(),
      dto: { cyclesEnabled: false } as never,
      ...requester,
    });

    expect(result.isSuccess).toBe(true);
    expect(recorded.map((r) => r.entityId)).toEqual(['i1', 'i2']);
    expect(recorded[0].actor).toEqual({ type: AuditActor.USER, id: 'u1', name: 'Ada' });
    expect(recorded[0].automated).toBe(true);
  });

  it('records nothing when a delete detaches nothing', async () => {
    const { activity, recorded } = recorder();
    const cycle = CycleEntity.create({
      tenantId: 't1',
      teamId: 'team-1',
      number: 1,
      startDate: '2026-07-20',
      endDate: '2026-08-02',
    }).getValue();
    const uc = new DeleteCycleUseCase(
      { findById: async () => makeTeam() } as never,
      { findById: async () => cycle, deleteById: async () => true } as never,
      { clearCycleIds: async () => [] } as never,
      activity,
    );

    await uc.execute({
      tenantId: 't1',
      teamId: 'team-1',
      cycleId: cycle.id.toString(),
      ...requester,
    });

    expect(recorded).toHaveLength(0);
  });
});
