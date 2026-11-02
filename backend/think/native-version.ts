import { gte, parse } from 'semver';

export const defaultNativeMinimum = '2.2.2';

export function validNativeVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = parse(value);
  return parsed !== null && value === `${parsed.version}${parsed.build.length ? `+${parsed.build.join('.')}` : ''}`;
}

export function nativeVersionStatus(version: unknown, minimum: string): 'compatible' | 'invalid' | 'below_minimum' {
  if (!validNativeVersion(version) || !validNativeVersion(minimum)) return 'invalid';
  return gte(version, minimum) ? 'compatible' : 'below_minimum';
}
