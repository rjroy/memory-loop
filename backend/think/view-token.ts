import { createHash, randomBytes } from 'node:crypto';
import { ThinkStateError } from './state';

export const validViewToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43,256}$/.test(value);
export const mintViewToken = () => randomBytes(32).toString('base64url');
export function viewHash(token: string): string {
  if (!validViewToken(token)) throw new ThinkStateError('lease_unavailable');
  return createHash('sha256').update(token).digest('hex');
}
