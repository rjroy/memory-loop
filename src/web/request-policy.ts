import type { TransportConfig } from '../../backend/transport';

export function allowsWebRequest(request: Request, web: TransportConfig['web']): boolean {
  let origin: URL;
  try { origin = new URL(web.origin); } catch { return false; }
  const headers = request.headers;
  if (headers.get('host') !== origin.host) return false;
  const suppliedOrigin = headers.get('origin');
  if (suppliedOrigin !== null && suppliedOrigin !== web.origin) return false;
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'none' && site !== 'same-origin') return false;
  if (web.mode === 'tailscale') {
    if (headers.has('tailscale-funnel-request') || headers.get('tailscale-user-login') !== web.allowedLogin) return false;
  }
  return true;
}
