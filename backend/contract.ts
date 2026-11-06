import { isPortableName } from './portable-name';

/** One vault, configured by .memory-loop/config.json at daemon startup. */
export interface VaultConfig {
  vaultDirectory: string;
  recall?: { uploads?: { maxFileBytes?: number; [key: string]: unknown }; [key: string]: unknown };
  /** Validated independently so invalid Think settings do not disable Recall. */
  think?: unknown;
  ground?: unknown;
}
export const defaultUploadMaxBytes = 100 * 1024 * 1024;
export const hardUploadMaxBytes = 1024 * 1024 * 1024;
export interface VaultUploadLimit { maxFileBytes: number }
export interface VaultUploadResponse { id: VaultId; name: string; size: number }
export function isUploadName(value: unknown): value is string {
  return typeof value === 'string' && isVaultComponent(value) && isPortableName(value) && !/[\x00-\x1f\x7f]/.test(value) && new TextEncoder().encode(value).length <= 255 && new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(value)) === value;
}

/** Identifiers are vault-relative sequences of individual filename components. */
export type VaultId = readonly string[];

export type VaultEntry =
  | { kind: 'directory'; name: string; id: VaultId; identity: string; version: string; children: VaultEntry[] }
  | { kind: 'note' | 'file'; name: string; id: VaultId; identity: string; version: string };

export type VaultFileResponse =
  | { name: string; kind: 'text'; text: string }
  | { name: string; kind: 'image' | 'video'; contentType: string }
  | { name: string; kind: 'unsupported' };

export interface VaultTreeResponse {
  rootIdentity: string;
  entries: VaultEntry[];
}

/** A directory listing never implies that a child directory is empty. */
export type VaultDirectoryEntry =
  | { kind: 'directory'; name: string; id: VaultId; identity: string; version: string }
  | Exclude<VaultEntry, { kind: 'directory' }>;

export interface VaultDirectoryResponse {
  rootIdentity: string;
  directoryIdentity: string;
  id: VaultId;
  entries: VaultDirectoryEntry[];
}

export function isVaultDirectoryId(value: unknown): value is VaultId {
  return Array.isArray(value) && value.length <= 64 && value.every(isVaultComponent);
}

export type VaultAction =
  | { action: 'create-note'; parentId: VaultId; expectedParentIdentity: string; name: string }
  | { action: 'create-directory'; parentId: VaultId; expectedParentIdentity: string; name: string }
  | { action: 'move'; kind: 'note' | 'file' | 'directory'; id: VaultId; expectedVersion: string; destinationParentId: VaultId; expectedDestinationIdentity: string }
  | { action: 'delete'; kind: 'note' | 'file' | 'directory'; id: VaultId; expectedVersion: string };
export type VaultActionResponse = { id: VaultId; revision?: string };
export const vaultActionBodyLimit = 65536;
const opaque = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128;
const parentId = (v: unknown): v is VaultId => Array.isArray(v) && v.length <= 64 && v.every(isVaultComponent);
export function parseVaultAction(value: unknown): VaultAction | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  if ((v.action === 'create-note' || v.action === 'create-directory') && Object.keys(v).length === 4 && parentId(v.parentId) && opaque(v.expectedParentIdentity) && isVaultComponent(v.name) && isPortableName(v.name) && new TextEncoder().encode(v.name).length <= 255 && (v.action !== 'create-note' || v.name.endsWith('.md'))) return { action: v.action, parentId: v.parentId, expectedParentIdentity: v.expectedParentIdentity, name: v.name };
  if ((v.action === 'move' || v.action === 'delete') && (v.kind === 'note' || v.kind === 'file' || v.kind === 'directory') && isVaultId(v.id) && v.id.length <= 64 && opaque(v.expectedVersion)) {
    if (v.action === 'delete' && Object.keys(v).length === 4) return { action: v.action, kind: v.kind, id: v.id, expectedVersion: v.expectedVersion };
    if (v.action === 'move' && Object.keys(v).length === 6 && parentId(v.destinationParentId) && opaque(v.expectedDestinationIdentity) && isPortableName(v.id[v.id.length - 1])) return { action: v.action, kind: v.kind, id: v.id, expectedVersion: v.expectedVersion, destinationParentId: v.destinationParentId, expectedDestinationIdentity: v.expectedDestinationIdentity };
  }
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
  entry_unavailable: { status: 404, message: 'Entry is unavailable' },
  entry_conflict: { status: 409, message: 'Entry has changed' },
  entry_exists: { status: 409, message: 'Destination already exists' },
  folder_not_empty: { status: 409, message: 'Folder is not empty' },
  move_cross_device: { status: 409, message: 'Move crosses devices' },
  move_unsupported: { status: 503, message: 'Move is unsupported' },
  file_action_unavailable: { status: 503, message: 'File action is unavailable' },
  file_action_uncertain: { status: 503, message: 'File action outcome is uncertain' },
  upload_too_large: { status: 413, message: 'Upload exceeds the file size limit' },
  upload_unavailable: { status: 503, message: 'Upload is unavailable' },
  upload_uncertain: { status: 503, message: 'Upload outcome is uncertain' },
  search_unavailable: { status: 503, message: 'Search is unavailable' },
  search_context_changed: { status: 409, message: 'This file changed. Search again.' },
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

export type VaultSearchMode = 'filename' | 'content';
export interface VaultSearchRequest { mode: VaultSearchMode; query: string }
export interface VaultSearchContextRequest { id: VaultId; version: string; line: number; query: string }
export interface VaultSearchSnippet { text: string; start: number; end: number; positions: number[] }
export interface VaultFilenameHit { id: VaultId; name: string; path: string; field: 'name' | 'path'; positions: number[]; score: number }
export interface VaultContentHit { id: VaultId; name: string; path: string; line: number; version: string; score: number; snippets: VaultSearchSnippet[] }
export interface VaultSearchCoverage {
  complete: boolean;
  filesSearched: number;
  skippedFiles: { binary: number; invalidEncoding: number; unreadable: number; changed: number };
  skippedLines: number;
  timedOut: boolean;
}
interface VaultSearchSummary { counts: { matches: number; files: number }; limited: boolean; coverage: VaultSearchCoverage }
export type VaultSearchResponse = VaultSearchSummary & (
  { mode: 'filename'; hits: VaultFilenameHit[] } | { mode: 'content'; hits: VaultContentHit[] }
);
export interface VaultSearchContextLine { number: number; text: string; positions: number[] }
export interface VaultSearchContextResponse {
  id: VaultId; name: string; version: string; targetLine: number; startLine: number;
  lines: VaultSearchContextLine[]; truncated: boolean;
}
export const vaultSearchBodyLimit = 16 * 1024;
export const normalizeSearchQuery = (query: string): string => query.replace(/\s/gu, '');
function searchQuery(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && normalizeSearchQuery(value).length <= 128 &&
    new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value;
}
export function parseVaultSearchRequest(value: unknown): VaultSearchRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
      !('mode' in value) || (value.mode !== 'filename' && value.mode !== 'content') || !('query' in value) || !searchQuery(value.query)) return;
  return { mode: value.mode, query: value.query };
}
export function parseVaultSearchContextRequest(value: unknown): VaultSearchContextRequest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4 ||
      !('id' in value) || !isVaultId(value.id) || value.id.length > 64 || value.id.some(part => part.length > 255) ||
      !('version' in value) || !opaque(value.version) || !('line' in value) || typeof value.line !== 'number' ||
      !Number.isSafeInteger(value.line) || value.line < 1 || !('query' in value) || !searchQuery(value.query) || !normalizeSearchQuery(value.query)) return;
  return { id: value.id, version: value.version, line: value.line, query: value.query };
}
