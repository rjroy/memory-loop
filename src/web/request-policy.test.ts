import { describe, expect, it } from 'vitest';
import type { TransportConfig } from '../../backend/transport';
import { parseTransport } from '../../backend/transport';
import { allowsWebRequest } from './request-policy';

const local: TransportConfig['web'] = { mode: 'loopback', origin: 'http://127.0.0.1:3000' };
const tail: TransportConfig['web'] = { mode: 'tailscale', origin: 'https://recall.example.test:9443', allowedLogin: 'person@example.test' };
function request(host: string | undefined, extra: Record<string, string> = {}) {
  const headers = new Headers(extra);
  if (host !== undefined && !headers.has('host')) headers.set('host', host);
  return new Request('http://127.0.0.1:3000/api/vault/tree', { headers });
}

describe('web request policy', () => {
  const proxyWeb = () => parseTransport({ daemonOrigin: 'http://127.0.0.1:3001', web: {
    mode: 'reverse-proxy', origin: 'https://proxy.example.test:10000', externalAuth: 'operator-managed',
  } }).web;
  it.each([undefined, 'none', 'same-origin'])('accepts the authenticated proxy authority with allowed fetch metadata %s', site => {
    const web = proxyWeb();
    expect(allowsWebRequest(request('proxy.example.test:10000', { origin: web.origin, ...(site ? { 'sec-fetch-site': site } : {}) }), web)).toBe(true);
  });
  it('accepts proxy requests without Origin or Fetch Metadata', () => {
    expect(allowsWebRequest(request('proxy.example.test:10000'), proxyWeb())).toBe(true);
  });
  it.each<Record<string, string>>([
    { host: 'evil.test', 'x-forwarded-host': 'proxy.example.test:10000' },
    { host: 'evil.test', forwarded: 'host=proxy.example.test:10000' },
    { host: 'proxy.example.test' }, { origin: 'null' }, { origin: 'https://evil.test' },
    { origin: 'https://proxy.example.test' }, { 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'unknown' },
  ])('denies hostile reverse-proxy request %o', headers => {
    expect(allowsWebRequest(request('proxy.example.test:10000', headers), proxyWeb())).toBe(false);
  });
  it('denies missing actual proxy Host even with forwarded authority', () => {
    expect(allowsWebRequest(request(undefined, { 'x-forwarded-host': 'proxy.example.test:10000' }), proxyWeb())).toBe(false);
  });
  it.each([undefined, 'none', 'same-origin'])('accepts local exact authority and allowed fetch metadata %s', site => {
    expect(allowsWebRequest(request('127.0.0.1:3000', { origin: local.origin, ...(site ? { 'sec-fetch-site': site } : {}) }), local)).toBe(true);
  });
  it('accepts requests with no Origin or Fetch Metadata', () => {
    expect(allowsWebRequest(request('127.0.0.1:3000'), local)).toBe(true);
  });
  it.each<Record<string, string>>([
    { host: 'localhost:3000' }, { host: 'evil.test', 'x-forwarded-host': '127.0.0.1:3000' },
    { host: 'evil.test', forwarded: 'host=127.0.0.1:3000' }, { host: '127.0.0.1:3000, evil.test' },
    { origin: 'null' }, { origin: '*' }, { origin: 'http://evil.test' },
    { origin: 'http://127.0.0.1:3000, http://evil.test' },
    { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'unknown' },
  ])('denies ambiguous or hostile local request %o', headers => {
    const actual = request('127.0.0.1:3000', headers);
    if (headers.host !== undefined) expect(actual.headers.get('host')).toBe(headers.host);
    expect(allowsWebRequest(actual, local)).toBe(false);
  });
  it('denies a missing actual Host even with forwarded authority', () => {
    expect(allowsWebRequest(request(undefined, { 'x-forwarded-host': '127.0.0.1:3000' }), local)).toBe(false);
  });
  it('accepts only the exact tailnet authority and personal principal', () => {
    expect(allowsWebRequest(request('recall.example.test:9443', { origin: tail.origin, 'tailscale-user-login': 'person@example.test' }), tail)).toBe(true);
  });
  it.each<Record<string, string>>([
    {}, { 'tailscale-user-login': 'other@example.test' }, { 'tailscale-user-login': 'tag:device' },
    { 'tailscale-user-login': 'person@example.test, person@example.test' },
    { 'tailscale-user-login': 'person@example.test', 'tailscale-funnel-request': 'true' },
  ])('denies absent or untrusted tailnet identity %o', headers => {
    expect(allowsWebRequest(request('recall.example.test:9443', headers), tail)).toBe(false);
  });
});
