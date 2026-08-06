import { TeamEntity } from './team.entity';
import { TeamIssueType } from '../enums/team.enums';
import { REF_PREFIX_RESERVED } from '../team-ref-prefix';

function team(refPrefix?: string): TeamEntity {
  const result = TeamEntity.create({
    tenantId: 't1',
    key: 'engineering',
    name: 'Engineering',
    issueType: TeamIssueType.TASK,
    refPrefix,
  });
  expect(result.isSuccess).toBe(true);
  return result.getValue();
}

describe('TeamEntity refPrefix', () => {
  it('reads back what it was created with', () => {
    expect(team('ENG').refPrefix).toBe('ENG');
  });

  it("is '' for a team stored before prefixes existed", () => {
    expect(team().refPrefix).toBe('');
  });

  it('uppercases and trims on set', () => {
    const t = team();
    expect(t.setRefPrefix('  web ').isSuccess).toBe(true);
    expect(t.refPrefix).toBe('WEB');
  });

  it('rejects a reserved prefix', () => {
    const t = team();
    const result = t.setRefPrefix('BUG');
    expect(result.isFailure).toBe(true);
    expect(result.error).toBe(REF_PREFIX_RESERVED);
    expect(t.refPrefix).toBe('');
  });

  it('rejects a malformed prefix', () => {
    expect(team().setRefPrefix('E').isFailure).toBe(true);
    expect(team().setRefPrefix('TOO-LONG').isFailure).toBe(true);
  });
});
