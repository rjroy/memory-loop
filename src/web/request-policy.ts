import { isIP } from 'node:net';

// Validate the actual HTTP authority before URL normalization can conceal ambiguity.
function authority(value: string, scheme: 'http' | 'https'): URL | undefined {
  const match = /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?$/.exec(value);
  if (!match) return;
  const host = match[1];
  if (host.startsWith('[')) {
    if (isIP(host.slice(1, -1)) !== 6) return;
  } else {
    if (host.length > 253 || host.split('.').some(label => !label || label.length > 63 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label))) return;
    if (/^[0-9.]+$/.test(host) && isIP(host) !== 4) return;
  }
  if (match[2] !== undefined && (Number(match[2]) > 65535 || match[2].length > 5)) return;
  try { return new URL(`${scheme}://${value}`); } catch { return; }
}

export function allowsWebRequest(request: Request): boolean {
  const host = request.headers.get('host');
  if (!host) return false;
  const suppliedOrigin = request.headers.get('origin');
  if (suppliedOrigin !== null) {
    const match = /^(https?):\/\/([^/?#]+)$/.exec(suppliedOrigin);
    if (!match) return false;
    const scheme = match[1] === 'https' ? 'https' : 'http';
    const actual = authority(host, scheme);
    const origin = authority(match[2], scheme);
    if (!actual || !origin || actual.host !== origin.host) return false;
  } else if (!authority(host, 'http')) return false;
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'none' || site === 'same-origin';
}
