import { TeamEntity } from '../domain/entities/team.entity';
import { TeamResponseDto } from '../dtos/team.dtos';

export class TeamMapper {
  /**
   * `refPrefixLocked` cannot be derived from the entity — it is a fact about the
   * tenant's counter, which only an async use-case can read. Resolve it with
   * `ResolveTeamPrefixLockUseCase` and pass it in.
   *
   * It is **required, with no default**, on purpose. Settings renders the prefix
   * input's disabled state from this exact flag, so a defaulted `false` on a
   * locked team offers an edit the API will then reject — a flag that lies is
   * worse than one that is absent. Making it required turns "I forgot to resolve
   * it" from a silent wrong answer into a compile error.
   */
  static toResponseDto(team: TeamEntity, refPrefixLocked: boolean): TeamResponseDto {
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

  /** `locked[i]` pairs with `teams[i]` — resolve the batch with `ResolveTeamPrefixLockUseCase.many`. */
  static toResponseDtoArray(teams: TeamEntity[], locked: boolean[]): TeamResponseDto[] {
    return teams.map((t, i) => this.toResponseDto(t, locked[i] ?? false));
  }
}
