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

export type VaultErrorCode =
  | 'config_missing'
  | 'config_invalid'
  | 'vault_unavailable'
  | 'note_unavailable'
  | 'invalid_request';

/** Public messages must not contain filesystem paths or note content. */
export interface VaultErrorResponse {
  error: { code: VaultErrorCode; message: string };
}
