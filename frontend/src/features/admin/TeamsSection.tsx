import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SymbolPicker,
  Input,
  Select,
} from '@/components/ui';
import { RowsSkeleton } from '@/components/Skeletons';
import { t, type I18nKey } from '@/i18n';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { TeamDto } from '@/types/dto';
import {
  TEAM_COLORS,
  TEAM_ISSUE_TYPES,
  TEAM_ISSUE_TYPE_LABEL,
  TeamIssueType,
  defaultTeamIcon,
} from '@/types/enums';
import { TEAM_SYMBOL_NAMES } from '@/components/TeamSymbol';
import { TeamIconPicker } from '@/features/teams/TeamIconPicker';
import { useCreateTeam, useTeams, useUpdateTeam } from '@/features/teams/api';

/**
 * Manage the workspace's teams. QC + Engineering are seeded and can be renamed
 * but not archived (the backend enforces it); custom teams can be archived,
 * which keeps their issues but drops them from the sidebar.
 */
export function TeamsSection() {
  const { data: teams, isLoading } = useTeams();
  const create = useCreateTeam();

  const [name, setName] = useState('');
  const [issueType, setIssueType] = useState<TeamIssueType>(TeamIssueType.TASK);
  // Untouched, the new team's symbol tracks the issue type it owns.
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  // The create form is revealed from the header's top-right "+ Add team", so the
  // section reads as the team list first; adding is a deliberate second step.
  const [adding, setAdding] = useState(false);
  const newIcon = icon ?? defaultTeamIcon(issueType);

  function addTeam() {
    const value = name.trim();
    if (!value || create.isPending) return;
    create.mutate(
      { name: value, issueType, icon: newIcon, color },
      {
        onSuccess: () => {
          setName('');
          setIcon(null);
          setColor(null);
          setAdding(false);
        },
      },
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>{t('teams.title')}</CardTitle>
          <CardDescription>{t('teams.hint')}</CardDescription>
        </div>
        <Button
          className="shrink-0"
          size="sm"
          variant={adding ? 'ghost' : 'secondary'}
          onClick={() => {
            // Closing discards a half-filled form so it reopens clean.
            if (adding) {
              setName('');
              setIcon(null);
              setColor(null);
            }
            setAdding((v) => !v);
          }}
        >
          {adding ? (
            t('common.cancel')
          ) : (
            <>
              <Plus className="mr-1.5 size-3.5" />
              {t('teams.add')}
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {adding && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-3 sm:p-4">
            <SymbolPicker
              value={newIcon}
              color={color}
              options={TEAM_SYMBOL_NAMES}
              colors={TEAM_COLORS}
              ariaLabel={t('teams.icon')}
              reset={{
                icon: defaultTeamIcon(issueType),
                label: t('teams.useTypeIcon').replace('{type}', TEAM_ISSUE_TYPE_LABEL[issueType]),
              }}
              onChange={(patch) => {
                if (patch.icon !== undefined) setIcon(patch.icon);
                if (patch.color !== undefined) setColor(patch.color);
              }}
            />
            <Input
              className="min-w-0 flex-1 basis-48"
              value={name}
              placeholder={t('teams.name')}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTeam()}
            />
            <div className="w-40">
              <Select
                value={issueType}
                onValueChange={(v) => setIssueType(v as TeamIssueType)}
                aria-label={t('teams.issueType')}
                options={TEAM_ISSUE_TYPES.map((v) => ({
                  value: v,
                  label: TEAM_ISSUE_TYPE_LABEL[v],
                }))}
              />
            </div>
            <Button onClick={addTeam} disabled={!name.trim()} loading={create.isPending}>
              <Plus className="mr-1.5 size-3.5" />
              {t('teams.add')}
            </Button>
          </div>
        )}
        {isLoading ? (
          <RowsSkeleton />
        ) : (
          <div className="divide-y rounded-xl border">
            {(teams ?? []).map((team) => (
              <TeamRow key={team.id} team={team} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** What the server accepts (and what `deriveRefPrefix` mints): 2–6 characters,
 *  A–Z / 0–9, first character a letter. Checked here so the common typo answers
 *  in the user's own language instead of round-tripping to an English 400. */
const REF_PREFIX_RE = /^[A-Z][A-Z0-9]{1,5}$/;

/**
 * The server's rejection codes → what to say about them here.
 *
 * The API sends a `code` beside its `message` precisely so this side owns the
 * wording: the message is English, and a Korean admin editing a prefix should be
 * told "이미 사용 중인 접두사입니다", not handed the server's log line. Any code
 * not listed — an older frontend against a newer API, or a rule added later —
 * falls through to the message, which is always true even when it isn't
 * translated.
 */
const PREFIX_ERROR_KEYS: Record<string, I18nKey> = {
  TEAM_PREFIX_FROZEN: 'teams.prefixFrozen',
  TEAM_PREFIX_TAKEN: 'teams.prefixTaken',
  REF_PREFIX_INVALID: 'teams.prefixInvalid',
  REF_PREFIX_RESERVED: 'teams.prefixReserved',
};

/** What to show for a failed prefix save: our own wording when we recognise the
 *  code, the server's message otherwise, and a generic line if there is neither. */
function prefixErrorText(e: unknown): string {
  const key = e instanceof ApiError && e.code ? PREFIX_ERROR_KEYS[e.code] : undefined;
  if (key) return t(key);
  return e instanceof Error && e.message ? e.message : t('teams.prefixInvalid');
}

/**
 * One team's row: symbol, name, ticket prefix, then its archive control.
 *
 * Its own `useUpdateTeam()` — not one shared by the list — so a rejected prefix
 * reports under the team that was edited rather than every row at once.
 */
function TeamRow({ team }: { team: TeamDto }) {
  const update = useUpdateTeam();
  const [prefix, setPrefix] = useState(team.refPrefix);
  // The row outlives a refetch (keyed by team.id), so the field is re-seeded when
  // the server's value actually moves — after a save, or another admin's edit.
  const [seen, setSeen] = useState(team.refPrefix);
  const [error, setError] = useState<string | null>(null);
  if (seen !== team.refPrefix) {
    setSeen(team.refPrefix);
    setPrefix(team.refPrefix);
    setError(null);
  }

  function savePrefix() {
    if (team.refPrefixLocked) return;
    const next = prefix.trim();
    // Blurring an untouched field must not PATCH — and an emptied one reverts
    // rather than clearing, since a team with no prefix can't number a ticket.
    if (next === team.refPrefix) return setError(null);
    if (!next) {
      setPrefix(team.refPrefix);
      return setError(null);
    }
    if (!REF_PREFIX_RE.test(next)) return setError(t('teams.prefixInvalid'));
    setError(null);
    update.mutate(
      { id: team.id, input: { refPrefix: next } },
      // Taken / reserved / frozen all arrive as a 400 carrying a `code`, so each
      // one is said in the reader's language rather than the server's.
      { onError: (e) => setError(prefixErrorText(e)) },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 sm:gap-4 sm:px-4">
      <TeamIconPicker
        team={team}
        className={cn('size-9 border border-input', team.archived && 'opacity-60')}
      />
      <Input
        className={cn('min-w-0 flex-1 basis-40 sm:max-w-xs', team.archived && 'opacity-60')}
        defaultValue={team.name}
        aria-label={t('teams.name')}
        onBlur={(e) => {
          const next = e.target.value.trim();
          if (next && next !== team.name) update.mutate({ id: team.id, input: { name: next } });
        }}
      />
      <Input
        className={cn(
          'w-24 shrink-0 font-mono uppercase tracking-wider',
          team.archived && 'opacity-60',
          error && 'border-destructive focus-visible:ring-destructive',
        )}
        value={prefix}
        maxLength={6}
        aria-label={t('teams.prefix')}
        // Frozen prefixes are refused by the API too; disabling up front means the
        // row never offers an edit that can't land. `disabled:opacity-50` is the
        // Input's own locked look — same as every other inert control in settings.
        disabled={team.refPrefixLocked}
        title={team.refPrefixLocked ? t('teams.prefixLocked') : undefined}
        onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        onBlur={savePrefix}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setPrefix(team.refPrefix);
            setError(null);
          }
        }}
      />
      <Badge variant="muted" className="shrink-0">
        {TEAM_ISSUE_TYPE_LABEL[team.issueType]}
      </Badge>
      <span className="font-mono text-xs text-muted-foreground">{team.key}</span>
      {team.archived && (
        <Badge variant="secondary" className="shrink-0">
          {t('teams.archived')}
        </Badge>
      )}
      <div className="ml-auto">
        {team.isDefault ? (
          // The seeded teams own the bug/task lists — archiving one
          // would strand them, so the backend refuses it too.
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t('settings.builtIn')}
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (team.archived) {
                update.mutate({ id: team.id, input: { archived: false } });
              } else if (confirm(t('teams.confirmArchive'))) {
                update.mutate({ id: team.id, input: { archived: true } });
              }
            }}
          >
            {team.archived ? t('teams.unarchive') : t('teams.archive')}
          </Button>
        )}
      </div>
      {/* Full-width so it reads under the fields on a phone and never disturbs
          the row's alignment — the prefix is the only field here that explains
          itself, and at 390px every control has already wrapped above it. */}
      <p
        className={cn(
          '-mt-1 w-full text-xs',
          error ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {error ??
          (team.refPrefixLocked
            ? t('teams.prefixLocked')
            : prefix
              ? // Previews what is in the field, so the example updates as it is
                // typed rather than after the blur that saves it.
                t('teams.prefixHint').split('{prefix}').join(prefix)
              : t('teams.prefixEmptyHint'))}
      </p>
    </div>
  );
}
