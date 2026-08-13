/** Just enough of an Express request to rebuild the URL it arrived on. */
export interface UrlBearingRequest {
  headers: Record<string, string | string[] | undefined>;
  protocol?: string;
  originalUrl?: string;
}

/**
 * The absolute URL this request was made to, which `create_upload_url` hangs a
 * ticket off.
 *
 * Derived from the request rather than configured: `APP_BASE_URL` names the web
 * app, not the API, and a second env var would be one more thing to get wrong on
 * a box. The proxy headers are honoured first because the API terminates plain
 * HTTP behind one — trusting `protocol` there would hand out an `http://` URL
 * that a client is right to refuse.
 */
export function requestBaseUrl(req: UrlBearingRequest, fallbackPath: string): string {
  const header = (name: string): string => {
    const value = req.headers[name];
    return (Array.isArray(value) ? value[0] : value) ?? '';
  };
  const first = (value: string): string => value.split(',')[0].trim();

  const proto = first(header('x-forwarded-proto')) || req.protocol || 'https';
  const host = first(header('x-forwarded-host')) || first(header('host'));
  // The version prefix and mount path exactly as routed, e.g. `/v1/mcp`.
  const path = (req.originalUrl || fallbackPath).split('?')[0].replace(/\/+$/, '');
  return `${proto}://${host}${path}`;
}
