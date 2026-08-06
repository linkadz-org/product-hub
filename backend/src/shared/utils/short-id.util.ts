import { randomBytes } from 'crypto';
import { customAlphabet } from 'nanoid';

/**
 * Human-friendly short id for test cases (e.g. `TC-4F9K2`). Not globally unique —
 * unique enough within a report; the internal UUID remains the real identity.
 */
export function shortId(prefix = 'TC'): string {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${rand}`;
}

// Unambiguous uppercase alphabet — no 0/O/1/I/L, so a ref is safe to read aloud,
// type, and drop into a URL. 31 symbols ^ 7 ≈ 27.5 billion ids per prefix.
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const REF_LEN = 7;
const nano = customAlphabet(REF_ALPHABET, REF_LEN);

/**
 * A random, unguessable URL ref for a task/bug, e.g. `TSK-6HCUHKX` / `BUG-WHHY3ZV`.
 *
 * LEGACY: nothing in the running application mints refs this way any more — every
 * ref now comes from `CounterService` and is sequential (`ENG-14`). This survives
 * only because the two superseded one-time scripts (`backfill-doc-refs`,
 * `backfill-roadmap-item-refs`) still call it, and both carry a header saying not
 * to run them. Do not reach for it in new code.
 */
export function randomRef(prefix: string): string {
  return `${prefix}-${nano()}`;
}

// A share link is pasted into chat, read off a screen and typed by hand, so it
// uses the same unambiguous alphabet rather than a 36-character UUID. Longer
// than a ref because the token *is* the access control: 31^14 ≈ 7.6 × 10^20
// keeps it unguessable while still fitting in a glance.
const SHARE_LEN = 14;
const nanoShare = customAlphabet(REF_ALPHABET, SHARE_LEN);

/** A fresh public-share token, e.g. `K7M4PQ2XR9TVBD`. */
export function shareToken(): string {
  return nanoShare();
}

/**
 * A secret for a machine, not a person: an integration webhook's URL token and
 * its signing key. Neither is ever read aloud or typed by hand — they're copied
 * between two admin screens — so unlike {@link shareToken} there's no reason to
 * trade entropy for legibility, and these use full-strength random bytes.
 *
 * `base64url` for the URL half (path-safe, no escaping), hex for the signing key
 * (what every provider's "Secret" field expects to be given).
 */
export function webhookUrlToken(): string {
  return randomBytes(24).toString('base64url');
}

export function webhookSigningSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * The token to (re)enable a share link with: whatever it already had, so links
 * handed out earlier keep working — unless that's a legacy UUID, which is
 * upgraded to a short one. The hyphen is the tell; the short alphabet has none.
 */
export function keepOrUpgradeShareToken(current: string | null | undefined): string {
  return current && !current.includes('-') ? current : shareToken();
}
