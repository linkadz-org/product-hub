import type { SavedViewDto } from '@/types/dto';

/**
 * Which board a saved view belongs to.
 *
 * A saved view used to be implicitly "the Issues board" — every sidebar row and
 * palette entry hardcoded `/issues?sv=<id>`. Once a team board can save one too,
 * the view has to carry where it came from, or opening "QC · Crashes this
 * sprint" would drop you on the workspace board with a team's statuses filtered
 * against the wrong columns.
 *
 * **It is deliberately a key, not a path.** A shared view is authored by one
 * user and opened by everyone in the workspace, so its stored value is
 * attacker-controlled input to a link. A path column would make
 * `scope = '//evil.example'` a protocol-relative href and turn a saved view into
 * an open redirect. Storing a key and resolving it to a path *here* means the
 * set of URLs a saved view can ever produce is fixed by this file. The backend
 * additionally constrains the column's shape (see `CreateSavedViewDto.scope`),
 * so neither side relies on the other to be the only guard.
 */

/** The workspace board (`/issues`). The backend's column default, so every row
 *  written before scopes existed already reads as this — no migration. */
export const SCOPE_ISSUES = 'issues';
/** The same board narrowed to me (`/issues/me`). */
export const SCOPE_ISSUES_ME = 'issues-me';
/** A team's own board (`/teams/<teamId>`), whichever kind the team owns. */
export const SCOPE_TEAM_PREFIX = 'team:';

/** A team board's scope key. */
export function teamScope(teamId: string): string {
  return `${SCOPE_TEAM_PREFIX}${teamId}`;
}

/**
 * A scope key → the board's path.
 *
 * Anything unrecognised falls back to `/issues` rather than throwing or
 * producing the literal string: a row can outlive the code that wrote it (an
 * older client, a board that has since been removed), and the workspace board
 * is the one place every saved view's filters still mean *something*. The team
 * id is percent-encoded on the way out — it reaches here from the database, and
 * this function's whole job is that no stored value can shape a URL.
 */
export function savedViewPath(scope: string | undefined): string {
  if (scope === SCOPE_ISSUES_ME) return '/issues/me';
  if (scope?.startsWith(SCOPE_TEAM_PREFIX)) {
    const teamId = scope.slice(SCOPE_TEAM_PREFIX.length);
    // A `team:` with nothing after it names no team — treat it as unrecognised.
    if (teamId) return `/teams/${encodeURIComponent(teamId)}`;
  }
  return '/issues';
}

/** The full link to open a saved view — the one place a `?sv=` URL is built. */
export function savedViewHref(view: Pick<SavedViewDto, 'id' | 'scope'>): {
  pathname: string;
  search: string;
} {
  return { pathname: savedViewPath(view.scope), search: `?sv=${encodeURIComponent(view.id)}` };
}

/**
 * Whether the live URL is standing on this exact saved view.
 *
 * Both halves matter now that views span boards: two views on different boards
 * can't be told apart by `?sv=` alone if the pathname is ignored, and two views
 * on the *same* board can only be told apart by `?sv=` — a `NavLink`'s
 * pathname-only match would light every row on the current board at once.
 */
export function isSavedViewActive(
  pathname: string,
  search: string,
  view: Pick<SavedViewDto, 'id' | 'scope'>,
): boolean {
  return (
    pathname === savedViewPath(view.scope) &&
    new URLSearchParams(search).get('sv') === view.id
  );
}

/**
 * The two lists a board's view picker shows: the ones I own, and the ones
 * someone else shared with the workspace.
 *
 * `GET /saved-views` already returns own + shared in one list, sorted mine-first
 * (`sortSavedViews`), so this only has to cut it — no second request, and the
 * order within each group is the server's. Splitting matters because the two
 * are not the same object to a user: mine are mine to rename and delete,
 * *theirs* are someone else's and can change under me.
 *
 * A view I own **and** shared stays in "mine" only — it's still mine, and
 * listing it twice would read as two views.
 */
export function groupSavedViews(
  views: SavedViewDto[] | undefined,
  userId: string | undefined,
): { mine: SavedViewDto[]; shared: SavedViewDto[] } {
  const all = views ?? [];
  return {
    mine: all.filter((v) => v.ownerId === userId),
    shared: all.filter((v) => v.ownerId !== userId),
  };
}
