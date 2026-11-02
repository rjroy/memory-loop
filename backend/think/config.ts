import { isAbsolute } from 'node:path';
import type { SessionCreateInput } from '@opencode/client';
import { defaultNativeMinimum, validNativeVersion } from './native-version';

export interface ThinkConfig {
  registrationFile: string;
  requiredVersion: string;
  agent?: string;
  model?: NonNullable<SessionCreateInput['model']>;
  /** Writer validates independently: bad logging configuration must not disable native chat. */
  transcriptDirectory?: unknown;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function only(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !value.includes('\0');
}

export function parseThinkConfig(value: unknown): ThinkConfig | undefined {
  if (!record(value) || !only(value, ['service', 'location', 'permissionMode', 'agent', 'model', 'transcriptDirectory']) ||
      !record(value.service) || !only(value.service, ['registrationFile', 'requiredVersion']) ||
      typeof value.service.registrationFile !== 'string' || !isAbsolute(value.service.registrationFile) || value.service.registrationFile.includes('\0') ||
      (value.service.requiredVersion !== undefined && !validNativeVersion(value.service.requiredVersion)) ||
      !record(value.location) || !only(value.location, ['kind']) || value.location.kind !== 'vault' ||
      (value.permissionMode !== undefined && value.permissionMode !== 'full') ||
      (value.agent !== undefined && !identifier(value.agent))) return undefined;
  const model = value.model;
  if (model !== undefined && (!record(model) || !only(model, ['providerID', 'id', 'variant']) ||
      !identifier(model.providerID) || !identifier(model.id) || (model.variant !== undefined && !identifier(model.variant)))) return undefined;
  return {
    registrationFile: value.service.registrationFile,
    requiredVersion: typeof value.service.requiredVersion === 'string' ? value.service.requiredVersion : defaultNativeMinimum,
    ...('transcriptDirectory' in value ? { transcriptDirectory: value.transcriptDirectory } : {}),
    ...(typeof value.agent === 'string' ? { agent: value.agent } : {}),
    ...(record(model) && typeof model.providerID === 'string' && typeof model.id === 'string'
      ? { model: { providerID: model.providerID, id: model.id, ...(typeof model.variant === 'string' ? { variant: model.variant } : {}) } } : {}),
  };
}
