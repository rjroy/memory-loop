/**
 * Vault Transfer
 *
 * Provides pi-agent tool definitions for transferring files between vaults.
 * Claude can use these tools to move or copy files when content is ready
 * to be published from a private vault to a public one.
 */

import { copyFile, mkdir, unlink, lstat } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createLogger, type VaultInfo } from "@memory-loop/shared";
import { discoverVaults, getVaultById } from "./vault/vault-manager";
import { directoryExists } from "@memory-loop/shared/server";
import { isPathWithinVault } from "./files/file-browser";

const log = createLogger("VaultTransfer");

/**
 * Error thrown when vault transfer operations fail.
 */
export type VaultTransferErrorCode =
  | "SOURCE_VAULT_NOT_FOUND"
  | "TARGET_VAULT_NOT_FOUND"
  | "SOURCE_FILE_NOT_FOUND"
  | "TARGET_EXISTS"
  | "PATH_TRAVERSAL"
  | "INVALID_FILE_TYPE"
  | "TRANSFER_FAILED";

export class VaultTransferError extends Error {
  constructor(
    message: string,
    public readonly code: VaultTransferErrorCode
  ) {
    super(message);
    this.name = "VaultTransferError";
  }
}

/**
 * Validates that a path is a markdown file.
 */
function validateMarkdownPath(filePath: string): void {
  const ext = extname(filePath).toLowerCase();
  if (ext !== ".md") {
    throw new VaultTransferError(
      `Only markdown (.md) files can be transferred. Got: ${ext || "(no extension)"}`,
      "INVALID_FILE_TYPE"
    );
  }
}

/**
 * Validates that a path is safe (no path traversal).
 */
async function validateSafePath(
  vaultPath: string,
  relativePath: string
): Promise<string> {
  const fullPath = join(vaultPath, relativePath);

  if (!(await isPathWithinVault(vaultPath, fullPath))) {
    throw new VaultTransferError(
      `Path "${relativePath}" is outside the vault boundary`,
      "PATH_TRAVERSAL"
    );
  }

  return fullPath;
}

/**
 * Options for transferring a file between vaults.
 */
export interface TransferOptions {
  sourceVaultId: string;
  targetVaultId: string;
  sourcePath: string;
  targetPath?: string;
  mode: "copy" | "move";
  overwrite?: boolean;
}

/**
 * Result of a successful transfer operation.
 */
export interface TransferResult {
  sourceVaultId: string;
  targetVaultId: string;
  sourcePath: string;
  targetPath: string;
  mode: "copy" | "move";
  bytesTransferred: number;
}

/**
 * Resolves a vault by ID, throwing a typed VaultTransferError when missing.
 */
async function requireVault(
  vaultId: string,
  role: "source" | "target"
): Promise<VaultInfo> {
  const vault = await getVaultById(vaultId);
  if (!vault) {
    throw new VaultTransferError(
      `${role === "source" ? "Source" : "Target"} vault "${vaultId}" not found`,
      role === "source" ? "SOURCE_VAULT_NOT_FOUND" : "TARGET_VAULT_NOT_FOUND"
    );
  }
  return vault;
}

/**
 * Transfers a file from one vault to another.
 */
export async function transferFile(
  options: TransferOptions
): Promise<TransferResult> {
  const {
    sourceVaultId,
    targetVaultId,
    sourcePath,
    targetPath = sourcePath,
    mode,
    overwrite = false,
  } = options;

  log.info(
    `Transferring file: ${sourceVaultId}:${sourcePath} -> ${targetVaultId}:${targetPath} (${mode})`
  );

  // Validate file types
  validateMarkdownPath(sourcePath);
  validateMarkdownPath(targetPath);

  const sourceVault = await requireVault(sourceVaultId, "source");
  const targetVault = await requireVault(targetVaultId, "target");

  // Validate paths are within vault boundaries
  const sourceFullPath = await validateSafePath(sourceVault.contentRoot, sourcePath);
  const targetFullPath = await validateSafePath(targetVault.contentRoot, targetPath);

  // Check source file exists and is not a symlink
  const sourceLstat = await lstat(sourceFullPath).catch(() => null);
  if (!sourceLstat) {
    throw new VaultTransferError(
      `Source file "${sourcePath}" does not exist in vault "${sourceVaultId}"`,
      "SOURCE_FILE_NOT_FOUND"
    );
  }
  if (sourceLstat.isSymbolicLink()) {
    log.warn(`Symlink rejected: ${sourcePath}`);
    throw new VaultTransferError(
      `Source path "${sourcePath}" is a symbolic link and cannot be transferred`,
      "PATH_TRAVERSAL"
    );
  }
  if (!sourceLstat.isFile()) {
    throw new VaultTransferError(
      `Source path "${sourcePath}" is not a file`,
      "SOURCE_FILE_NOT_FOUND"
    );
  }

  // Check if anything exists at target path (including broken symlinks).
  // ENOENT is expected; any other error is a real filesystem problem.
  let targetStats;
  try {
    targetStats = await lstat(targetFullPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    targetStats = null;
  }

  if (targetStats) {
    if (targetStats.isSymbolicLink()) {
      log.warn(`Target symlink rejected: ${targetPath}`);
      throw new VaultTransferError(
        `Target path "${targetPath}" is a symbolic link and cannot be overwritten`,
        "PATH_TRAVERSAL"
      );
    }

    if (!overwrite) {
      throw new VaultTransferError(
        `Target file "${targetPath}" already exists in vault "${targetVaultId}". Set overwrite=true to replace.`,
        "TARGET_EXISTS"
      );
    }
  }

  // Ensure target directory exists
  const targetDir = dirname(targetFullPath);
  if (!(await directoryExists(targetDir))) {
    await mkdir(targetDir, { recursive: true });
    log.debug(`Created target directory: ${targetDir}`);
  }

  // Size from the lstat above — we've already verified it's a regular file.
  const bytesTransferred = sourceLstat.size;

  // Perform the transfer
  if (mode === "copy") {
    await copyFile(sourceFullPath, targetFullPath);
    log.info(`Copied ${bytesTransferred} bytes to ${targetFullPath}`);
  } else {
    await copyFile(sourceFullPath, targetFullPath);
    try {
      await unlink(sourceFullPath);
    } catch (unlinkError) {
      log.error(`Move copy succeeded but source deletion failed: ${sourceFullPath}`);
      throw new VaultTransferError(
        `File copied to target but source deletion failed: ${unlinkError instanceof Error ? unlinkError.message : String(unlinkError)}. File exists in both locations.`,
        "TRANSFER_FAILED"
      );
    }
    log.info(`Moved ${bytesTransferred} bytes to ${targetFullPath}`);
  }

  return {
    sourceVaultId,
    targetVaultId,
    sourcePath,
    targetPath,
    mode,
    bytesTransferred,
  };
}

/**
 * Lists all available vaults for transfer operations.
 */
export async function listTransferableVaults(): Promise<
  Array<{ id: string; name: string; path: string }>
> {
  const vaults = await discoverVaults();
  return vaults.map((v) => ({
    id: v.id,
    name: v.name,
    path: v.path,
  }));
}

/**
 * Builds a tool error result shaped like a successful tool result so the agent
 * can surface failure as text. Logs the message for operator visibility.
 * `prefix` is used both for the log line and the user-facing message
 * (e.g. "Transfer failed", "Failed to list vaults").
 */
function toolErrorResult(prefix: string, error: unknown): {
  content: Array<{ type: "text"; text: string }>;
  details: null;
} {
  const message = error instanceof Error ? error.message : String(error);
  log.error(`${prefix}:`, message);
  return {
    content: [{ type: "text", text: `${prefix}: ${message}` }],
    details: null,
  };
}

/**
 * Creates pi-agent tool definitions for vault transfer operations.
 */
export function createVaultTransferTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "transfer_file",
      label: "Transfer File",
      description:
        "Transfer a markdown file from one vault to another. Use this when content is ready to be published from a private vault to a public one, or to reorganize content between vaults.",
      parameters: Type.Object({
        sourceVaultId: Type.String({
          description: "ID of the source vault (directory name in VAULTS_DIR)",
        }),
        targetVaultId: Type.String({
          description: "ID of the target vault (directory name in VAULTS_DIR)",
        }),
        sourcePath: Type.String({
          description:
            "Path to the file within the source vault (relative to vault root, must be .md)",
        }),
        targetPath: Type.Optional(
          Type.String({
            description:
              "Path for the file in target vault (defaults to same as source). Must be .md",
          })
        ),
        mode: Type.Union([Type.Literal("copy"), Type.Literal("move")], {
          description: "Whether to copy (keep original) or move (delete original)",
        }),
        overwrite: Type.Optional(
          Type.Boolean({
            description: "Whether to overwrite if target file already exists",
          })
        ),
      }),
      async execute(_toolCallId, args) {
        try {
          const result = await transferFile({
            sourceVaultId: args.sourceVaultId,
            targetVaultId: args.targetVaultId,
            sourcePath: args.sourcePath,
            targetPath: args.targetPath,
            mode: args.mode,
            overwrite: args.overwrite ?? false,
          });

          const action = result.mode === "copy" ? "Copied" : "Moved";
          const text =
            `${action} file successfully.\n\n` +
            `From: ${result.sourceVaultId}/${result.sourcePath}\n` +
            `To: ${result.targetVaultId}/${result.targetPath}\n` +
            `Size: ${result.bytesTransferred} bytes`;
          return {
            content: [{ type: "text", text }],
            details: result,
          };
        } catch (error) {
          return toolErrorResult("Transfer failed", error);
        }
      },
    }),
    defineTool({
      name: "list_vaults",
      label: "List Vaults",
      description:
        "List all available vaults that can be used as source or target for file transfers.",
      parameters: Type.Object({}),
      async execute() {
        try {
          const vaults = await listTransferableVaults();

          if (vaults.length === 0) {
            return {
              content: [{
                type: "text",
                text: "No vaults found. Ensure VAULTS_DIR is configured and contains vaults with CLAUDE.md files.",
              }],
              details: [],
            };
          }

          const vaultList = vaults.map((v) => `- ${v.id}: ${v.name}`).join("\n");
          return {
            content: [{ type: "text", text: `Available vaults:\n\n${vaultList}` }],
            details: vaults,
          };
        } catch (error) {
          return toolErrorResult("Failed to list vaults", error);
        }
      },
    }),
  ];
}
