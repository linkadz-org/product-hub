import { requestBaseUrl } from './mcp-request-url';

/**
 * The upload URL is handed to a client that will connect to it, so getting the
 * scheme or host wrong is not cosmetic — it is a link that cannot be used. These
 * cover the shape the API actually runs in: plain HTTP behind a TLS proxy.
 */
describe('requestBaseUrl', () => {
  it('trusts the proxy scheme over the socket, so TLS is not downgraded to http', () => {
    const url = requestBaseUrl(
      {
        headers: { 'x-forwarded-proto': 'https', host: 'team-api.linkadz.store' },
        protocol: 'http',
        originalUrl: '/v1/mcp',
      },
      '/v1/mcp',
    );
    expect(url).toBe('https://team-api.linkadz.store/v1/mcp');
  });

  it('takes the first hop when a chain of proxies appended their own', () => {
    const url = requestBaseUrl(
      {
        headers: {
          'x-forwarded-proto': 'https,http',
          'x-forwarded-host': 'team-api.linkadz.store, internal-lb',
          host: 'internal-lb',
        },
        originalUrl: '/v1/mcp',
      },
      '/v1/mcp',
    );
    expect(url).toBe('https://team-api.linkadz.store/v1/mcp');
  });

  it('drops the query string, which would otherwise land mid-path before the ticket', () => {
    const url = requestBaseUrl(
      { headers: { host: 'api.test' }, protocol: 'https', originalUrl: '/v1/mcp?session=abc' },
      '/v1/mcp',
    );
    expect(url).toBe('https://api.test/v1/mcp');
  });

  it('falls back to the given path when the request carries none', () => {
    const url = requestBaseUrl({ headers: { host: 'api.test' }, protocol: 'https' }, '/v1/mcp');
    expect(url).toBe('https://api.test/v1/mcp');
  });
});
