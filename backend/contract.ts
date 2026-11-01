/** One vault, configured by .memory-loop/config.json at daemon startup. */
export interface VaultConfig {
  vaultDirectory: string;
  /** Validated independently so invalid Think settings do not disable Recall. */
  think?: unknown;
  ground?: unknown;
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
  revision: string;
  editable: boolean;
}

export interface VaultSaveRequest { id: VaultId; markdown: string; expectedRevision: string }
export interface VaultSaveResponse { revision: string }
export const vaultSaveTextLimit = 2 * 1024 * 1024;
// JSON escaping may expand each UTF-8 byte to six ASCII bytes.
export const vaultSaveBodyLimit = vaultSaveTextLimit * 6 + 65536;

export function parseVaultSaveRequest(value: unknown): VaultSaveRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3 ||
      !('id' in value) || !isVaultId(value.id) || !('markdown' in value) || typeof value.markdown !== 'string' ||
      !('expectedRevision' in value) || typeof value.expectedRevision !== 'string' ||
      value.expectedRevision.length === 0 || value.expectedRevision.length > 128) return;
  const bytes = new TextEncoder().encode(value.markdown);
  if (bytes.byteLength > vaultSaveTextLimit || new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== value.markdown) return;
  return { id: value.id, markdown: value.markdown, expectedRevision: value.expectedRevision };
}

export const vaultErrors = {
  config_missing: { status: 503, message: 'Vault configuration is missing' },
  config_invalid: { status: 503, message: 'Vault configuration is invalid' },
  vault_unavailable: { status: 503, message: 'Vault directory is unavailable' },
  note_unavailable: { status: 404, message: 'Note is unavailable' },
  invalid_request: { status: 400, message: 'Invalid note identifier' },
  note_conflict: { status: 409, message: 'Note has changed' },
  note_not_editable: { status: 422, message: 'Note cannot be edited' },
  note_save_unavailable: { status: 503, message: 'Note could not be saved' },
  note_save_uncertain: { status: 503, message: 'Note save outcome is uncertain' },
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
