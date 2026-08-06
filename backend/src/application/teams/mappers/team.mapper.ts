import { TeamEntity } from '../domain/entities/team.entity';
import { TeamResponseDto } from '../dtos/team.dtos';

export class TeamMapper {
  /**
   * `refPrefixLocked` cannot be derived from the entity — it is a fact about the
   * tenant's counter, which only a use-case can read. Callers that care resolve it
   * (see `ResolveTeamPrefixLockUseCase`) and pass it in; the default `false` is the
   * right answer for a team that has just been created and for read-only surfaces
   * (the public board) that never render the prefix input.
   */
  static toResponseDto(team: TeamEntity, refPrefixLocked = false): TeamResponseDto {
    return {
      id: team.id.toString(),
      tenantId: team.tenantId,
      key: team.key,
      refPrefix: team.refPrefix,
      refPrefixLocked,
      name: team.name,
      issueType: team.issueType,
      icon: team.icon,
      color: team.color,
      statuses: team.statuses,
      labels: team.labels,
      customFields: team.customFields,
      cyclesEnabled: team.cyclesEnabled,
      cycleMode: team.cycleMode,
      cycleLengthWeeks: team.cycleLengthWeeks,
      cycleCooldownWeeks: team.cycleCooldownWeeks,
      cycleStartDay: team.cycleStartDay,
      cycleStartDate: team.cycleStartDate,
      cycleAutoRollover: team.cycleAutoRollover,
      archived: team.archived,
      isDefault: team.isDefault,
      order: team.order,
      publicEnabled: team.publicEnabled,
      publicToken: team.publicToken,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    };
  }

  /** `locked[i]` pairs with `teams[i]`; omit it when no caller renders the prefix input. */
  static toResponseDtoArray(teams: TeamEntity[], locked: boolean[] = []): TeamResponseDto[] {
    return teams.map((t, i) => this.toResponseDto(t, locked[i] ?? false));
  }
}
