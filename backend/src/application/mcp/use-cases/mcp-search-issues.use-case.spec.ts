import { UniqueEntityID } from '@core/domain';
import { IssueKind } from '@application/issues/domain/enums/issue.enums';
import { ApiKeyScope } from '@application/api-keys/domain/api-key.enums';
import { TeamEntity } from '@application/teams/domain/entities/team.entity';
import { TeamIssueType } from '@application/teams/domain/enums/team.enums';
import { UserEntity } from '@application/users/domain/entities/user.entity';
import { Result } from '@shared/logic/result';
import { McpSearchIssuesUseCase, type McpActor } from './mcp.use-cases';

describe('McpSearchIssuesUseCase', () => {
  const actor: McpActor = {
    tenantId: 'tenant-1',
    keyId: 'key-1',
    keyName: 'test',
    userId: 'caller-1',
    scope: ApiKeyScope.READ_WRITE,
    clientName: 'test-client',
  };

  const person = UserEntity.create(
    {
      tenantId: actor.tenantId,
      email: 'jane@example.com',
      name: 'Jane Doe',
      passwordHash: 'not-used',
    },
    new UniqueEntityID('owner-1'),
  ).getValue();

  const team = TeamEntity.create(
    {
      tenantId: actor.tenantId,
      key: 'engineering',
      name: 'Engineering',
      issueType: TeamIssueType.TASK,
    },
    new UniqueEntityID('team-1'),
  ).getValue();

  function setup(users = [person]) {
    const getTeams = {
      execute: jest.fn().mockResolvedValue(Result.ok([team])),
    };
    const getIssues = {
      execute: jest.fn().mockResolvedValue(
        Result.ok({
          data: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
          rollups: {},
        }),
      ),
    };
    const getRoadmaps = { execute: jest.fn().mockResolvedValue(Result.ok([])) };
    const issues = { findByRef: jest.fn() };
    const userRepository = {
      findByTenant: jest.fn().mockResolvedValue({ data: users }),
    };
    const useCase = new McpSearchIssuesUseCase(
      getTeams as never,
      getIssues as never,
      getRoadmaps as never,
      issues as never,
      userRepository as never,
    );
    return { useCase, getIssues, getRoadmaps, issues, userRepository };
  }

  it.each(['Jane Doe', 'jane@example.com', 'owner-1'])(
    'filters by assignee when the owner is identified by %s',
    async (assignee) => {
      const { useCase, getIssues, userRepository } = setup();

      const result = await useCase.execute({ actor, dto: { assignee } });

      expect(result.isSuccess).toBe(true);
      expect(userRepository.findByTenant).toHaveBeenCalledWith(actor.tenantId, {
        page: 1,
        limit: 100,
      });
      expect(getIssues.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            assigneeId: ['owner-1'],
            kind: undefined,
            page: 1,
            limit: 20,
          }),
        }),
      );
    },
  );

  it('returns valid owner choices instead of silently dropping an unknown owner', async () => {
    const { useCase, getIssues } = setup();

    const result = await useCase.execute({ actor, dto: { assignee: 'Janet' } });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Unknown assignee "Janet"');
    expect(result.error).toContain('Jane Doe');
    expect(getIssues.execute).not.toHaveBeenCalled();
  });

  it('leaves owner filtering unset when no assignee is requested', async () => {
    const { useCase, getIssues, userRepository } = setup();

    await useCase.execute({ actor, dto: { kind: IssueKind.TASK } });

    expect(userRepository.findByTenant).not.toHaveBeenCalled();
    expect(getIssues.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ assigneeId: undefined }),
      }),
    );
  });
});
