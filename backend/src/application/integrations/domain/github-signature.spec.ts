import { createHmac } from 'crypto';
import { verifyGitHubSignature } from './github-signature';

const SECRET = 'a-signing-secret';
const BODY = Buffer.from(JSON.stringify({ ref: 'refs/heads/main', commits: [] }));

/** What GitHub puts in `X-Hub-Signature-256` for a given body and secret. */
const sign = (body: Buffer, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

/**
 * The gate that decides whether a delivery is really from GitHub. Both halves
 * matter equally: rejecting a good signature makes the integration look broken,
 * and accepting a bad one lets anyone who learned the URL write into a workspace.
 */
describe('verifyGitHubSignature', () => {
  it('accepts a body signed with the workspace secret', () => {
    expect(verifyGitHubSignature(BODY, SECRET, sign(BODY))).toBe(true);
  });

  it('rejects a body signed with a different secret', () => {
    expect(verifyGitHubSignature(BODY, SECRET, sign(BODY, 'someone-elses-secret'))).toBe(false);
  });

  it('rejects a body altered after it was signed', () => {
    const signature = sign(BODY);
    const tampered = Buffer.from(JSON.stringify({ ref: 'refs/heads/main', commits: [1] }));
    expect(verifyGitHubSignature(tampered, SECRET, signature)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyGitHubSignature(BODY, SECRET, undefined)).toBe(false);
  });

  it('rejects a signature of the wrong length rather than throwing', () => {
    // timingSafeEqual throws on mismatched lengths — the length guard is what
    // turns a truncated header into a plain "no" instead of a 500.
    expect(verifyGitHubSignature(BODY, SECRET, 'sha256=abc')).toBe(false);
  });

  it('rejects everything when no secret is stored', () => {
    // A never-connected workspace must not be signable with the empty string.
    expect(verifyGitHubSignature(BODY, '', sign(BODY, ''))).toBe(false);
  });

  it('rejects when the raw body was never captured', () => {
    expect(verifyGitHubSignature(undefined, SECRET, sign(BODY))).toBe(false);
  });
});
