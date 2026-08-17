import { Result } from '@shared/logic/result';
import { Role } from '@core/interfaces';
import { ApiKeyScope } from '@application/api-keys/domain/api-key.enums';
import { IssueKind } from '@application/issues/domain/enums/issue.enums';
import { TeamIssueType } from '@application/teams/domain/enums/team.enums';
import { AuditActor } from '@application/audit-log/domain/enums/audit.enums';
import {
  McpCreateBacklogItemUseCase,
  McpCreateIssueUseCase,
  McpDeleteIssueUseCase,
  McpSetStatusUseCase,
  McpUpdateIssueUseCase,
  type McpActor,
} from './mcp.use-cases';

/**
 * One API key must read as ONE actor across a whole bot session.
 *
 * Every MCP write hands an `actorName` to the use-case that records the history
 * row. Three of them used to pass `actor.keyName` while the other two passed the
 * key owner's name, so a bot that created an issue and then closed it appeared
 * in the timeline as two different people — both `actorType: api`. This drives
 * all five wrappers with the SAME actor and asserts the recorded name is
 * identical, and that it is the owner's (the same person `actorId` points at).
 *
 * A regression to `actor.keyName` at any one site fails here: the fixture's key
 * name ('CI') and owner name ('Ada') are deliberately different.
 */

const OWNER = 'Ada';
const KEY = 'CI';

const actor: McpActor = {
  tenantId: 't1',
  keyId: 'k1',
  keyName: KEY,
  userId: 'u1',
  scope: ApiKeyScope.READ_WRITE_DELETE,
  clientName: 'claude-code/1.0',
};

const UUID = 'uuid-of-tsk-7';

const fakeIssue = {
  id: { toString: () => UUID },
  shortId: 'TSK-7',
  title: 'Parent task',
  kind: IssueKind.TASK,
  teamId: 'team-1',
  assignees: [],
  labelKeys: [],
};

const team = {
  id: { toString: () => 'team-1' },
  name: 'Engineering',
  key: 'eng',
  issueType: TeamIssueType.TASK,
  archived: false,
  isDefault: true,
  statuses: [
    { key: 'todo', label: 'Todo' },
    { key: 'done', label: 'Done' },
  ],
};

const users = () => ({
  findById: jest.fn().mockResolvedValue({ role: Role.ADMIN, name: OWNER }),
  findByTenant: jest.fn().mockResolvedValue({ data: [] }),
});
const events = () => ({ append: jest.fn().mockResolvedValue(undefined) });
const getTeams = () => ({ execute: jest.fn().mockResolvedValue(Result.ok([team])) });
const getRoadmaps = () => ({ execute: jest.fn().mockResolvedValue(Result.ok([])) });
const issuesRepo = () => ({
  findByRef: jest.fn().mockResolvedValue(fakeIssue),
  countChildren: jest.fn().mockResolvedValue(0),
});

/** The `actorName` (however the wrapper names the field) the write use-case saw. */
function recordedName(execute: jest.Mock): { name: unknown; actorType: unknown } {
  const arg = execute.mock.calls[0][0] as Record<string, unknown>;
  return {
    name: arg.requesterName ?? arg.createdByName,
    actorType: arg.actorType,
  };
}

describe('MCP writes record one actor name per key', () => {
  it('create_issue → the owner, not the key', async () => {
    const createIssue = {
      execute: jest.fn().mockResolvedValue(
        Result.ok({ ...fakeIssue, id: { toString: () => UUID } }),
      ),
    };
    const uc = new McpCreateIssueUseCase(
      getTeams() as never,
      getRoadmaps() as never,
      createIssue as never,
      issuesRepo() as never,
      users() as never,
      events() as never,
    );
    const result = await uc.execute({
      actor,
      dto: { kind: IssueKind.TASK, title: 'x' } as never,
    });
    expect(result.isSuccess).toBe(true);
    expect(recordedName(createIssue.execute)).toEqual({
      name: OWNER,
      actorType: AuditActor.API,
    });
  });

  it('update_issue → the owner, not the key', async () => {
    const updateIssue = { execute: jest.fn().mockResolvedValue(Result.ok(fakeIssue)) };
    const uc = new McpUpdateIssueUseCase(
      updateIssue as never,
      getTeams() as never,
      getRoadmaps() as never,
      issuesRepo() as never,
      users() as never,
      events() as never,
    );
    const result = await uc.execute({ actor, dto: { issue: 'TSK-7', title: 'y' } as never });
    expect(result.isSuccess).toBe(true);
    expect(recordedName(updateIssue.execute)).toEqual({
      name: OWNER,
      actorType: AuditActor.API,
    });
  });

  it('set_status → the owner, not the key', async () => {
    const setStatus = { execute: jest.fn().mockResolvedValue(Result.ok(fakeIssue)) };
    const uc = new McpSetStatusUseCase(
      setStatus as never,
      getTeams() as never,
      issuesRepo() as never,
      users() as never,
      events() as never,
    );
    const result = await uc.execute({ actor, dto: { issue: 'TSK-7', status: 'Done' } as never });
    expect(result.isSuccess).toBe(true);
    expect(recordedName(setStatus.execute)).toEqual({
      name: OWNER,
      actorType: AuditActor.API,
    });
  });

  it('delete_issue → the owner, not the key', async () => {
    const deleteIssue = { execute: jest.fn().mockResolvedValue(Result.ok<void>()) };
    const getIssues = { execute: jest.fn().mockResolvedValue(Result.ok({ data: [] })) };
    const uc = new McpDeleteIssueUseCase(
      deleteIssue as never,
      getIssues as never,
      issuesRepo() as never,
      users() as never,
      events() as never,
    );
    const result = await uc.execute({ actor, dto: { issue: 'TSK-7' } as never });
    expect(result.isSuccess).toBe(true);
    expect(recordedName(deleteIssue.execute)).toEqual({
      name: OWNER,
      actorType: AuditActor.API,
    });
  });

  it('create_backlog_item → the owner, not the key', async () => {
    const roadmap = {
      id: { toString: () => 'r1' },
      title: 'Product',
      columns: [{ key: 'now', label: 'Now', color: '' }],
      items: [],
    };
    const addItem = {
      execute: jest.fn().mockResolvedValue(
        Result.ok({ roadmap, item: { id: 'i1', shortId: 'RM-1', title: 'x' } }),
      ),
    };
    const uc = new McpCreateBacklogItemUseCase(
      { execute: jest.fn().mockResolvedValue(Result.ok([roadmap])) } as never,
      addItem as never,
      users() as never,
      events() as never,
    );
    const result = await uc.execute({ actor, dto: { title: 'x' } as never });
    expect(result.isSuccess).toBe(true);
    expect(recordedName(addItem.execute)).toEqual({
      name: OWNER,
      actorType: AuditActor.API,
    });
  });
});
