/** One vault, configured by .memory-loop/config.json at daemon startup. */
export interface VaultConfig {
  vaultDirectory: string;
  /** Validated independently so invalid Think settings do not disable Recall. */
  think?: unknown;
}

/** Identifiers are vault-relative sequences of individual filename components. */
export type VaultId = readonly string[];

export type VaultEntry =
  | { kind: 'directory'; name: string; id: VaultId; children: VaultEntry[] }
  | { kind: 'note'; name: string; id: VaultId };

export interface VaultTreeResponse {
  entries: VaultEntry[];
}

export interface VaultNoteResponse {
  name: string;
  markdown: string;
}

export const vaultErrors = {
  config_missing: { status: 503, message: 'Vault configuration is missing' },
  config_invalid: { status: 503, message: 'Vault configuration is invalid' },
  vault_unavailable: { status: 503, message: 'Vault directory is unavailable' },
  note_unavailable: { status: 404, message: 'Note is unavailable' },
  invalid_request: { status: 400, message: 'Invalid note identifier' },
} as const;

export type VaultErrorCode = keyof typeof vaultErrors;

export function isVaultErrorCode(value: unknown): value is VaultErrorCode {
  return typeof value === 'string' && Object.hasOwn(vaultErrors, value);
}

export function isVaultComponent(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('.') &&
    !value.includes('/') && !value.includes('\\') && !value.includes('\0');
}

export function isVaultId(value: unknown): value is VaultId {
  return Array.isArray(value) && value.length > 0 && value.every(isVaultComponent);
}

/** Public messages must not contain filesystem paths or note content. */
export interface VaultErrorResponse {
  error: { code: VaultErrorCode; message: string };
}
