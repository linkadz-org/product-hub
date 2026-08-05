import { ISSUE_REF_PREFIX } from '@application/issues/domain/enums/issue.enums';
import { ROADMAP_ITEM_REF_PREFIX } from '@application/roadmaps/domain/types/roadmap-item.type';
import { CodeLinkSubject } from './github.types';

/**
 * Which kind of thing each ref prefix names. Built from the two minting sites
 * rather than restated, so a prefix can't be changed there and forgotten here.
 */
const PREFIX_SUBJECT: Record<string, CodeLinkSubject> = {
  // Both issue kinds (TSK, BUG) resolve the same way — one collection, one lookup.
  ...Object.fromEntries(
    Object.values(ISSUE_REF_PREFIX).map((prefix) => [prefix, CodeLinkSubject.ISSUE]),
  ),
  [ROADMAP_ITEM_REF_PREFIX]: CodeLinkSubject.ROADMAP_ITEM,
};

const PREFIXES = Object.keys(PREFIX_SUBJECT).join('|');

/**
 * Matches a ref inside free text — a commit message, a branch name, a PR title.
 *
 *   `TSK-6HCUHKX`  `BUG-WHHY3ZV`  `RM-4KQP2XZ`   current, random-suffix refs
 *   `TSK-3` / `TSK3`                             legacy sequential issue refs
 *
 * The suffix pattern is loose (any run of letters and digits) rather than the
 * exact minting alphabet, because refs have been minted three different ways
 * over the life of the schema — 7 chars of a restricted alphabet, a plain
 * counter, and a 12-char hex fallback on collision. Matching all of them wrongly
 * costs one lookup that finds nothing; matching one of them not at all silently
 * drops the link the developer was trying to make.
 *
 * The hyphen is required except before a pure digit run: without it `BUGFIXES`
 * would parse as a ref on every commit that mentions fixing bugs.
 *
 * Boundaries are lookarounds rather than `\b`, so `feature/TSK-6HCUHKX_v2` still
 * matches — `_` is a word character, and branch names are full of them.
 */
const REF_PATTERN = new RegExp(
  `(?<![0-9A-Za-z])(${PREFIXES})(?:-([0-9A-Z]{1,14})|(\\d+))(?![0-9A-Za-z])`,
  'gi',
);

/** A ref found in text, and what it points at. */
export interface ParsedRef {
  /** Canonical upper-case form, as stored — `TSK-6HCUHKX`. */
  ref: string;
  subjectType: CodeLinkSubject;
}

/**
 * Every distinct ref mentioned across the given texts, in the order found.
 *
 * Duplicates are dropped: a branch named for an issue makes every commit on it
 * mention that issue twice — once in the branch, once in the message — and each
 * commit must still produce one link, not two.
 */
export function parseRefs(...texts: (string | undefined | null)[]): ParsedRef[] {
  const found: ParsedRef[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(REF_PATTERN)) {
      const [, prefix, hyphenated, bare] = m;
      const ref = `${prefix}-${hyphenated ?? bare}`.toUpperCase();
      if (found.some((f) => f.ref === ref)) continue;
      found.push({ ref, subjectType: PREFIX_SUBJECT[prefix.toUpperCase()] });
    }
  }
  return found;
}
