import { normalizeSearchText, SEARCH_BODY_MAX } from './search-text.util';
import { plainText } from './plain-text.util';

/**
 * `searchBody` — a doc page's indexed, size-capped plain-text body — computed
 * the one and only way it's allowed to be computed: strip HTML, normalize,
 * cap at `SEARCH_BODY_MAX`. Three places need this identical formula
 * (`DocPageRepository.toDocument`, `backfill-search-text.ts`, and the collab
 * server's `mirror.ts`), and until this function existed they each spelled it
 * out by hand — verified character-by-character to agree, with nothing to
 * catch drift if one was edited alone.
 *
 * This can't live in `search-text.util.ts` itself: that file is copied
 * VERBATIM into `collab/src/searchText.ts` by `collab/scripts/sync-shared.ts`
 * and its own docblock forbids importing anything (the copy sits in a
 * different directory tree, so any relative import would break there).
 * `plainText` lives in a sibling file, so pulling it in here would violate
 * that rule.
 *
 * It also can't itself be a third synced file that imports the other two:
 * `collab`'s `tsconfig.json` sets `module`/`moduleResolution: NodeNext`, which
 * *requires* an explicit `.js` extension on every relative import
 * (`./search-text.util.js`) — while this backend package is `commonjs` with
 * classic Node resolution, which does the opposite (a `.js` specifier
 * pointing at a `.ts` file does not resolve here). One byte-identical file
 * cannot satisfy both, so a verbatim copy of *this* file would fail
 * typecheck on whichever side it landed on.
 *
 * So: this is a normal, non-synced backend file, used directly by the two
 * backend call sites (`DocPageRepository`, `backfill-search-text.ts`). The
 * collab server keeps its own copy of this exact one-line composition in
 * `mirror.ts`, built from the two primitives it already has synced
 * (`plainText.ts`, `searchText.ts`) — see the comment there for the
 * cross-reference back to this function.
 */
export function computeSearchBody(html: string): string {
  return normalizeSearchText(plainText(html).slice(0, SEARCH_BODY_MAX));
}
