import { TeamSymbol } from '@/components/TeamSymbol';
import { cn } from '@/lib/utils';
import { defaultTeamIcon } from '@/types/enums';
import type { TeamDto } from '@/types/dto';

/** All a chip needs — so a row can name its team from a lookup or from a public
 *  payload without either side handling a whole `TeamDto`. */
export type TeamChipTeam = Pick<TeamDto, 'name' | 'icon' | 'color' | 'issueType'>;

/**
 * Which team a row belongs to — its symbol and name, tinted with the team's own
 * accent (the `color-mix` idiom `LabelChips` uses, so it sits in the same family
 * as the status and label chips beside it).
 *
 * The one place that treatment lives: a cross-team surface (the "All issues"
 * timeline, a roadmap's linked tasks) has to say *Design* vs *Engineering* vs
 * *Frontend* — otherwise a bar is just a title and you have to open it to find
 * out whose work it is. Renders nothing without a team, so a personal task or a
 * row whose team hasn't loaded yet simply drops the chip.
 */
export function TeamChip({ team, className }: { team: TeamChipTeam | undefined; className?: string }) {
  if (!team) return null;
  // A team with no accent inherits the muted token rather than inventing a colour.
  const color = team.color ?? 'hsl(var(--muted-foreground))';
  return (
    <span
      title={team.name}
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-none',
        className,
      )}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      <TeamSymbol name={team.icon || defaultTeamIcon(team.issueType)} size={11} />
      <span className="truncate">{team.name}</span>
    </span>
  );
}
