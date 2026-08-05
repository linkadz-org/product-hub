import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Whether a delivery really came from GitHub.
 *
 * GitHub signs the **raw** request body with the webhook's shared secret and
 * sends `X-Hub-Signature-256: sha256=<hex>`. The bytes matter: re-serialising
 * the parsed JSON produces a different string and therefore a different digest,
 * which is why the controller keeps the original buffer around.
 *
 * Compared in constant time — a plain `===` leaks how much of a forged
 * signature was right, which is enough to reconstruct one byte at a time.
 */
export function verifyGitHubSignature(
  rawBody: Buffer | undefined,
  secret: string,
  header: string | undefined,
): boolean {
  if (!rawBody || !secret || !header) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(header, 'utf8');
  // timingSafeEqual throws on a length mismatch, and length is not a secret here
  // (the digest is fixed-width, so a wrong length just means a malformed header).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
