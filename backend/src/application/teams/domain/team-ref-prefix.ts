import { ISSUE_REF_PREFIX } from '@application/issues/domain/enums/issue.enums';
import { DOC_REF_PREFIX } from '@application/docs/domain/entities/doc.props';
import { ROADMAP_ITEM_REF_PREFIX } from '@application/roadmaps/domain/types/roadmap-item.type';

/**
 * Prefixes a team may never take. `CounterService` keys its sequences by
 * `<tenantId>:<prefix>`, so a team prefixed `DOC` would draw from the very same
 * sequence as the workspace's docs and mint a ref that already exists. Built from
 * the minting constants rather than restated, so a prefix cannot be changed at its
 * source and forgotten here.
 */
export const RESERVED_REF_PREFIXES: readonly string[] = [
  DOC_REF_PREFIX,
  ROADMAP_ITEM_REF_PREFIX,
  ...Object.values(ISSUE_REF_PREFIX),
];

export const REF_PREFIX_INVALID =
  'Prefix must be 2–6 characters, letters and digits only, starting with a letter';
export const REF_PREFIX_RESERVED = 'That prefix is reserved by the workspace';

const SHAPE = /^[A-Z][A-Z0-9]{1,5}$/;

/** The error message for `value`, or null when it is a usable prefix. */
export function validateRefPrefix(value: string): string | null {
  if (!SHAPE.test(value)) return REF_PREFIX_INVALID;
  if (RESERVED_REF_PREFIXES.includes(value)) return REF_PREFIX_RESERVED;
  return null;
}

/**
 * A prefix for `name` that is free given `taken` — the same derive-then-dedupe
 * shape `uniqueSlug` uses for `Team.key`, but over a 2–6 char uppercase alphabet.
 *
 * A reserved prefix is treated exactly like a taken one, so "Bug Triage" becomes
 * BUG2 rather than colliding with the personal-bug sequence.
 */
export function deriveRefPrefix(name: string, taken: Set<string>): string {
  const letters = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  // 'TM' (team) is the fallback when a name carries no Latin letters at all —
  // never TSK/BUG, which are reserved.
  const base = letters.length >= 2 ? letters.slice(0, 3) : letters ? `${letters}T` : 'TM';

  const unavailable = (candidate: string) =>
    taken.has(candidate) || RESERVED_REF_PREFIXES.includes(candidate);

  if (!unavailable(base)) return base;
  for (let n = 2; n < 100; n++) {
    // Trim the base so base+digit still fits in 6 characters.
    const candidate = `${base.slice(0, 6 - String(n).length)}${n}`;
    if (!unavailable(candidate)) return candidate;
  }
  return `${base.slice(0, 2)}${Date.now() % 1000}`;
}
