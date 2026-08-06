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
 * The two forms are separate branches rather than one prefix with an optional
 * hyphen, because a shared prefix class cannot tell `TSK12` (prefix `TSK`, issue
 * 12) from `WEB2-…` (prefix `WEB2`). Greedy matching would take `TSK1` and read
 * the rest as issue 2. The no-hyphen form only ever existed for the all-letter
 * legacy prefixes, so it gets the narrower `[A-Z]{2,6}`; a digit-bearing prefix
 * always writes its hyphen.
 *
 * The pattern IS case-insensitive, on the same cost model as everything else here.
 * Requiring upper case was tried and reversed: it does buy back `well-known`, but
 * at the price of `eng-14`, `tsk-6hcuhkx` and `feature/bug-3` — lower-case refs
 * developers really do type into commit messages and branch names — never linking
 * at all. A spurious match costs one lookup that finds nothing, which nobody ever
 * sees; a missed real ref silently drops the link the developer was trying to
 * make, which is exactly the failure this feature exists to prevent. The captured
 * ref is upper-cased below, so what gets stored and looked up is canonical either
 * way.
 *
 * The hyphen is required except before a pure digit run: without it `BUGFIXES`
 * would parse as a ref on every commit that mentions fixing bugs.
 *
 * An open prefix does also match ordinary hyphenated tokens — `UTF-8`, `RFC-822`,
 * `ISO-8601`, `well-known`. That is the accepted price, not a bug: each costs one
 * lookup that finds nothing, whereas narrowing the prefix to avoid them would
 * start dropping real team refs.
 *
 * Boundaries are lookarounds rather than `\b`, so `feature/ENG-14_v2` still
 * matches — `_` is a word character, and branch names are full of them.
 *
 * The `i` flag is what opens the `[A-Z]` classes below to lower case; they are
 * written upper-case because that is the canonical form a ref is stored in.
 */
const REF_PATTERN =
  /(?<![0-9A-Za-z])(?:([A-Z][0-9A-Z]{1,5})-([0-9A-Z]{1,14})|([A-Z]{2,6})(\d+))(?![0-9A-Za-z])/gi;

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
      // Groups 1–2 are the hyphenated form, 3–4 the legacy no-hyphen one.
      const [, hyphenPrefix, hyphenSuffix, barePrefix, bareNumber] = m;
      const prefix = hyphenPrefix ?? barePrefix;
      const ref = `${prefix}-${hyphenSuffix ?? bareNumber}`.toUpperCase();
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
