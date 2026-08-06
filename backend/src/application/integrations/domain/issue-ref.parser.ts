import { ROADMAP_ITEM_REF_PREFIX } from '@application/roadmaps/domain/types/roadmap-item.type';
import { CodeLinkSubject } from './github.types';

/**
 * Matches a ref inside free text — a commit message, a branch name, a PR title.
 *
 *   `ENG-14` `QC-103` `WEB2-7`     team-scoped sequential refs (prefixes are
 *                                  created at runtime, so no fixed list can
 *                                  stay correct)
 *   `TSK-6HCUHKX` `RM-4KQP2XZ`     legacy random-suffix refs
 *   `TSK-3` / `TSK3`               legacy sequential refs
 *
 * The prefix is any 2–6 character upper-case run starting with a letter — the
 * shape a team prefix is minted in — and the suffix is loose, because refs have
 * been minted four different ways over the life of the schema. Matching one
 * wrongly costs a single lookup that finds nothing; failing to match one
 * silently drops the link the developer was trying to make.
 *
 * The pattern is deliberately NOT case-insensitive. With a fixed prefix list the
 * `i` flag was free; with an open-ended prefix it would read `well-known` as the
 * ref `WELL-KNOWN`. Refs are stored and displayed upper-case, so requiring upper
 * case is the right trade.
 *
 * The hyphen is required except before a pure digit run: without it `BUGFIXES`
 * would parse as a ref on every commit that mentions fixing bugs.
 *
 * Boundaries are lookarounds rather than `\b`, so `feature/ENG-14_v2` still
 * matches — `_` is a word character, and branch names are full of them.
 */
const REF_PATTERN = /(?<![0-9A-Za-z])([A-Z][0-9A-Z]{1,5})(?:-([0-9A-Z]{1,14})|(\d+))(?![0-9A-Za-z])/g;

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
      const subjectType =
        prefix.toUpperCase() === ROADMAP_ITEM_REF_PREFIX
          ? CodeLinkSubject.ROADMAP_ITEM
          : CodeLinkSubject.ISSUE;
      found.push({ ref, subjectType });
    }
  }
  return found;
}
