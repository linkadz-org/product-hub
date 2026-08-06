import { REF_PREFIX_INVALID, REF_PREFIX_RESERVED } from './team-ref-prefix';
import { TEAM_PREFIX_FROZEN, TEAM_PREFIX_TAKEN } from '../use-cases/team.use-cases';

/**
 * Stable, machine-readable names for the rejections a client has to *say*
 * something about.
 *
 * The messages themselves are written for a human and written in English, which
 * is fine for a log line and wrong for a Korean settings form: the frontend
 * renders the API's `message` verbatim, so a rejected prefix used to arrive as
 * English in an otherwise translated UI. A code lets the frontend look up its own
 * translation instead — and, unlike the message, it can be reworded without
 * silently breaking that lookup.
 *
 * The message stays in the response and stays the fallback: a code the frontend
 * has never heard of (an older build, a new rule) still shows something true.
 */
export const TeamErrorCode = {
  PREFIX_FROZEN: 'TEAM_PREFIX_FROZEN',
  PREFIX_TAKEN: 'TEAM_PREFIX_TAKEN',
  PREFIX_INVALID: 'REF_PREFIX_INVALID',
  PREFIX_RESERVED: 'REF_PREFIX_RESERVED',
} as const;

export type TeamErrorCodeValue = (typeof TeamErrorCode)[keyof typeof TeamErrorCode];

/** Keyed by the message each rule fails with, so the two can never disagree. */
const CODE_BY_MESSAGE: Record<string, TeamErrorCodeValue> = {
  [TEAM_PREFIX_FROZEN]: TeamErrorCode.PREFIX_FROZEN,
  [TEAM_PREFIX_TAKEN]: TeamErrorCode.PREFIX_TAKEN,
  [REF_PREFIX_INVALID]: TeamErrorCode.PREFIX_INVALID,
  [REF_PREFIX_RESERVED]: TeamErrorCode.PREFIX_RESERVED,
};

/**
 * The error body for a rejected team write: always the message, plus a `code`
 * when the rejection is one a client can translate. Fed straight to
 * `BadRequestException`, whose object form is passed through by
 * `AllExceptionsFilter` (which copies `code` onto the envelope).
 */
export function teamErrorBody(message: string): { message: string; code?: string } {
  const code = CODE_BY_MESSAGE[message];
  return code ? { message, code } : { message };
}
