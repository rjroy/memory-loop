import { describe, expect, it } from 'vitest';
import { allowsWebRequest } from './request-policy';

function request(host: string | undefined, extra: Record<string, string> = {}) {
  const headers = new Headers(extra);
  if (host !== undefined && !headers.has('host')) headers.set('host', host);
  return new Request('http://127.0.0.1:3000/api/vault/tree', { headers });
}

describe('web request policy', () => {
  it('accepts request-local HTTP and HTTPS authorities regardless of legacy origin', () => {
    for (const [host, origin] of [
      ['example.test:7319', 'http://example.test:7319'],
      ['example.test:8447', 'https://example.test:8447'],
      ['192.0.2.17:9017', 'http://192.0.2.17:9017'],
      ['[2001:db8::1]:9017', 'https://[2001:db8::1]:9017'],
    ]) expect(allowsWebRequest(request(host, { origin, 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(allowsWebRequest(request('another.example:7319'))).toBe(true);
  });
  it('accepts TLS termination using actual Host and HTTPS Origin without forwarding headers or identity', () => {
    const post = new Request('http://127.0.0.1:3000/api/capture', { method: 'POST', headers: {
      host: 'fixture.example:9447', origin: 'https://fixture.example:9447', 'sec-fetch-site': 'same-origin',
    } });
    expect(allowsWebRequest(post)).toBe(true);
  });
  it('still rejects malformed authorities, mismatched POST origins and spoofed forwarding headers', () => {
    const hostile: Record<string, string>[] = [
      { host: 'fixture.example:7319, evil.example', origin: 'http://fixture.example:7319' },
      { host: 'fixture.example:7319', origin: 'http://fixture.example:7320' },
      { host: 'fixture.example:7319', origin: 'null' },
      { host: 'fixture.example:7319', origin: 'http://fixture.example:7319', 'sec-fetch-site': 'cross-site' },
      { host: 'evil.example:7319', origin: 'http://fixture.example:7319', 'x-forwarded-host': 'fixture.example:7319', 'x-forwarded-proto': 'http', 'tailscale-user-login': 'person@example.test' },
    ];
    for (const headers of hostile) {
      const post = new Request('http://127.0.0.1:3000/api/capture', { method: 'POST', headers });
      expect(allowsWebRequest(post)).toBe(false);
    }
  });
  it.each([undefined, 'none', 'same-origin'])('accepts matching authority with allowed fetch metadata %s', site => {
    expect(allowsWebRequest(request('proxy.example.test:10000', { origin: 'https://proxy.example.test:10000', ...(site ? { 'sec-fetch-site': site } : {}) }))).toBe(true);
  });
  it('accepts proxy requests without Origin or Fetch Metadata', () => {
    expect(allowsWebRequest(request('proxy.example.test:10000'))).toBe(true);
  });
  it.each<Record<string, string>>([
    { host: 'evil.test', origin: 'https://proxy.example.test:10000', 'x-forwarded-host': 'proxy.example.test:10000' },
    { host: 'evil.test', origin: 'https://proxy.example.test:10000', forwarded: 'host=proxy.example.test:10000' },
    { host: 'proxy.example.test', origin: 'https://proxy.example.test:10000' }, { origin: 'null' }, { origin: 'https://evil.test' },
    { origin: 'https://proxy.example.test' }, { 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'unknown' },
  ])('denies hostile reverse-proxy request %o', headers => {
    expect(allowsWebRequest(request('proxy.example.test:10000', headers))).toBe(false);
  });
  it('denies missing actual proxy Host even with forwarded authority', () => {
    expect(allowsWebRequest(request(undefined, { 'x-forwarded-host': 'proxy.example.test:10000' }))).toBe(false);
  });
  it.each([undefined, 'none', 'same-origin'])('accepts local exact authority and allowed fetch metadata %s', site => {
    expect(allowsWebRequest(request('127.0.0.1:3000', { origin: 'http://127.0.0.1:3000', ...(site ? { 'sec-fetch-site': site } : {}) }))).toBe(true);
  });
  it('accepts requests with no Origin or Fetch Metadata', () => {
    expect(allowsWebRequest(request('127.0.0.1:3000'))).toBe(true);
  });
  it.each<Record<string, string>>([
    { host: 'localhost:3000', origin: 'http://127.0.0.1:3000' }, { host: 'evil.test', origin: 'http://127.0.0.1:3000', 'x-forwarded-host': '127.0.0.1:3000' },
    { host: 'evil.test', origin: 'http://127.0.0.1:3000', forwarded: 'host=127.0.0.1:3000' }, { host: '127.0.0.1:3000, evil.test' },
    { origin: 'null' }, { origin: '*' }, { origin: 'http://evil.test' },
    { origin: 'http://127.0.0.1:3000, http://evil.test' },
    { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'unknown' },
  ])('denies ambiguous or hostile local request %o', headers => {
    const actual = request('127.0.0.1:3000', headers);
    if (headers.host !== undefined) expect(actual.headers.get('host')).toBe(headers.host);
    expect(allowsWebRequest(actual)).toBe(false);
  });
  it('denies a missing actual Host even with forwarded authority', () => {
    expect(allowsWebRequest(request(undefined, { 'x-forwarded-host': '127.0.0.1:3000' }))).toBe(false);
  });
  it.each<Record<string, string>>([
    {}, { 'tailscale-user-login': 'other@example.test' }, { 'tailscale-user-login': 'tag:device' },
    { 'tailscale-user-login': 'person@example.test, person@example.test' },
    { 'tailscale-user-login': 'person@example.test', 'tailscale-funnel-request': 'true' },
  ])('does not use proxy identity headers as application authentication %o', headers => {
    expect(allowsWebRequest(request('recall.example.test:9443', { ...headers, origin: 'https://recall.example.test:9443' }))).toBe(true);
  });
});
