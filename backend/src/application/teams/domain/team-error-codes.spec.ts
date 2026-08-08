import { REF_PREFIX_INVALID, REF_PREFIX_RESERVED } from './team-ref-prefix';
import { TEAM_PREFIX_FROZEN, TEAM_PREFIX_TAKEN } from '../use-cases/team.use-cases';
import { TeamErrorCode, teamErrorBody } from './team-error-codes';

/**
 * These codes are a published contract: the frontend keys a translated string off
 * each one. A rejection that stops carrying its code doesn't fail loudly — it just
 * starts showing English in a Korean settings form again.
 */
describe('teamErrorBody', () => {
  it.each([
    [TEAM_PREFIX_FROZEN, TeamErrorCode.PREFIX_FROZEN],
    [TEAM_PREFIX_TAKEN, TeamErrorCode.PREFIX_TAKEN],
    [REF_PREFIX_INVALID, TeamErrorCode.PREFIX_INVALID],
    [REF_PREFIX_RESERVED, TeamErrorCode.PREFIX_RESERVED],
  ])('codes "%s"', (message, code) => {
    expect(teamErrorBody(message)).toEqual({ message, code });
  });

  it('keeps the message and adds no code for a rejection nothing maps', () => {
    expect(teamErrorBody('Team not found')).toEqual({ message: 'Team not found' });
  });
});
