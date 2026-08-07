import { CollabSyncService } from './collab-sync.service';

/**
 * Reaching the collab server after an API-side body write.
 *
 * Three shapes matter and they are answered differently on purpose:
 *
 *  - **Not configured** — a deployment that doesn't run collab is supported, so
 *    there is nothing to refresh and nothing to warn about. Clean no-op.
 *  - **Refreshed** — the room re-read the stored body; every open editor has it.
 *  - **Failed** — reported, never thrown. The write has already committed by the
 *    time anyone calls this, so a rejection here could only turn a partial
 *    success into a total failure the caller cannot act on.
 */

const REQUEST = { tenantId: 't1', pageId: 'page-1', userId: 'u1', userName: 'Ada' };

const build = (collabUrl: string | undefined) => {
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
  const config = {
    get: jest.fn((key: string) => (key === 'COLLAB_HTTP_URL' ? collabUrl : 'the-shared-secret')),
  };
  return { service: new CollabSyncService(jwt as never, config as never), jwt };
};

describe('CollabSyncService', () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  describe('when no collab server is configured', () => {
    it.each([undefined, '', '   '])('is a clean no-op for %p', async (url) => {
      const { service } = build(url);
      await expect(service.resetPage(REQUEST)).resolves.toEqual({ status: 'not-configured' });
      // Not an error, and not a call — there is no room to refresh.
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('when the refresh succeeds', () => {
    beforeEach(() => fetchMock.mockResolvedValue({ ok: true, status: 200 }));

    it('reports refreshed', async () => {
      const { service } = build('http://collab:3002');
      await expect(service.resetPage(REQUEST)).resolves.toEqual({ status: 'refreshed' });
    });

    it('POSTs /reset for the page, bearing a token it minted itself', async () => {
      const { service, jwt } = build('http://collab:3002');
      await service.resetPage(REQUEST);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://collab:3002/reset?page=page-1');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer signed.jwt.token');
      // The collab server's verifyToken wants userId, tenantId and role, and
      // gates /reset behind canWrite(role) — so those three, signed with the
      // API's own JWT_SECRET, which env.ts documents as the same value.
      const [claims, options] = jwt.signAsync.mock.calls[0];
      expect(claims).toEqual(expect.objectContaining({ userId: 'u1', tenantId: 't1' }));
      expect(claims.role).toBeTruthy();
      expect(options.secret).toBe('the-shared-secret');
      // A machine credential for one call: it must not outlive the request.
      expect(options.expiresIn).toBeTruthy();
    });

    it('tolerates a trailing slash on the configured URL', async () => {
      const { service } = build('http://collab:3002/');
      await service.resetPage(REQUEST);
      expect(fetchMock.mock.calls[0][0]).toBe('http://collab:3002/reset?page=page-1');
    });

    it('bounds the call, so a wedged collab server cannot hang the tool reply', async () => {
      const { service } = build('http://collab:3002');
      await service.resetPage(REQUEST);
      expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
    });
  });

  describe('when the refresh fails', () => {
    it('reports a non-2xx with the status, and does not throw', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 502 });
      const { service } = build('http://collab:3002');

      const result = await service.resetPage(REQUEST);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('502');
    });

    it('reports an unreachable server rather than rejecting', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      const { service } = build('http://collab:3002');

      const result = await service.resetPage(REQUEST);

      // The body write already committed; a rejection here would surface as the
      // whole call failing when in fact it half-succeeded.
      expect(result.status).toBe('failed');
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('reports a signing failure the same way', async () => {
      const jwt = { signAsync: jest.fn().mockRejectedValue(new Error('no secret')) };
      const config = { get: jest.fn(() => 'http://collab:3002') };
      const service = new CollabSyncService(jwt as never, config as never);

      await expect(service.resetPage(REQUEST)).resolves.toEqual(
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });
});
