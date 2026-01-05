/**
 * Vault Transfer
 *
 * Provides an SDK MCP tool for transferring files between vaults.
 * Claude can use this tool to move or copy files when content is ready
 * to be published from a private vault to a public one.
 */

import { copyFile, stat, mkdir, unlink, lstat } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { createLogger } from "./logger";
import {
  discoverVaults,
  getVaultById,
  directoryExists,
  fileExists,
} from "./vault-manager";
import { isPathWithinVault } from "./file-browser";

const log = createLogger("VaultTransfer");

/**
 * Error thrown when vault transfer operations fail.
 */
export class VaultTransferError extends Error {
  readonly code:
    | "SOURCE_VAULT_NOT_FOUND"
    | "TARGET_VAULT_NOT_FOUND"
    | "SOURCE_FILE_NOT_FOUND"
    | "TARGET_EXISTS"
    | "PATH_TRAVERSAL"
    | "INVALID_FILE_TYPE"
    | "TRANSFER_FAILED";

  constructor(
    message: string,
    code: VaultTransferError["code"]
  ) {
    super(message);
    this.name = "VaultTransferError";
    this.code = code;
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
 * Transfers a file from one vault to another.
 *
 * @param options - Transfer options
 * @returns Transfer result with details about the operation
 * @throws VaultTransferError on failure
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

  // Get source vault
  const sourceVault = await getVaultById(sourceVaultId);
  if (!sourceVault) {
    throw new VaultTransferError(
      `Source vault "${sourceVaultId}" not found`,
      "SOURCE_VAULT_NOT_FOUND"
    );
  }

  // Get target vault
  const targetVault = await getVaultById(targetVaultId);
  if (!targetVault) {
    throw new VaultTransferError(
      `Target vault "${targetVaultId}" not found`,
      "TARGET_VAULT_NOT_FOUND"
    );
  }

  // Validate paths are within vault boundaries
  const sourceFullPath = await validateSafePath(sourceVault.contentRoot, sourcePath);
  const targetFullPath = await validateSafePath(targetVault.contentRoot, targetPath);

  // Check source file exists and is not a symlink (prevent symlink-based path traversal)
  try {
    const sourceStats = await lstat(sourceFullPath);
    if (sourceStats.isSymbolicLink()) {
      log.warn(`Symlink rejected: ${sourcePath}`);
      throw new VaultTransferError(
        `Source path "${sourcePath}" is a symbolic link and cannot be transferred`,
        "PATH_TRAVERSAL"
      );
    }
    if (!sourceStats.isFile()) {
      throw new VaultTransferError(
        `Source path "${sourcePath}" is not a file`,
        "SOURCE_FILE_NOT_FOUND"
      );
    }
  } catch (error) {
    if (error instanceof VaultTransferError) {
      throw error;
    }
    throw new VaultTransferError(
      `Source file "${sourcePath}" does not exist in vault "${sourceVaultId}"`,
      "SOURCE_FILE_NOT_FOUND"
    );
  }

  // Check target doesn't exist (unless overwrite is enabled)
  if (!overwrite && (await fileExists(targetFullPath))) {
    throw new VaultTransferError(
      `Target file "${targetPath}" already exists in vault "${targetVaultId}". Set overwrite=true to replace.`,
      "TARGET_EXISTS"
    );
  }

  // Ensure target directory exists
  const targetDir = dirname(targetFullPath);
  if (!(await directoryExists(targetDir))) {
    await mkdir(targetDir, { recursive: true });
    log.debug(`Created target directory: ${targetDir}`);
  }

  // Get file size before transfer
  const sourceStats = await stat(sourceFullPath);
  const bytesTransferred = sourceStats.size;

  // Perform the transfer
  if (mode === "copy") {
    await copyFile(sourceFullPath, targetFullPath);
    log.info(`Copied ${bytesTransferred} bytes to ${targetFullPath}`);
  } else {
    // For move: copy then delete (safer than rename across filesystems)
    await copyFile(sourceFullPath, targetFullPath);
    try {
      await unlink(sourceFullPath);
    } catch (unlinkError) {
      // Copy succeeded but delete failed - user has duplicates
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
 *
 * @returns Array of vault info objects
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
 * Creates an SDK MCP server with vault transfer tools.
 *
 * The server provides:
 * - transfer_file: Copy or move a file between vaults
 * - list_vaults: List available vaults for transfer
 */
export function createVaultTransferServer() {
  return createSdkMcpServer({
    name: "vault-transfer",
    version: "1.0.0",
    tools: [
      tool(
        "transfer_file",
        "Transfer a markdown file from one vault to another. Use this when content is ready to be published from a private vault to a public one, or to reorganize content between vaults.",
        {
          sourceVaultId: z
            .string()
            .describe("ID of the source vault (directory name in VAULTS_DIR)"),
          targetVaultId: z
            .string()
            .describe("ID of the target vault (directory name in VAULTS_DIR)"),
          sourcePath: z
            .string()
            .describe(
              "Path to the file within the source vault (relative to vault root, must be .md)"
            ),
          targetPath: z
            .string()
            .optional()
            .describe(
              "Path for the file in target vault (defaults to same as source). Must be .md"
            ),
          mode: z
            .enum(["copy", "move"])
            .describe("Whether to copy (keep original) or move (delete original)"),
          overwrite: z
            .boolean()
            .optional()
            .default(false)
            .describe("Whether to overwrite if target file already exists"),
        },
        async (args) => {
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
            return {
              content: [
                {
                  type: "text",
                  text:
                    `${action} file successfully.\n\n` +
                    `From: ${result.sourceVaultId}/${result.sourcePath}\n` +
                    `To: ${result.targetVaultId}/${result.targetPath}\n` +
                    `Size: ${result.bytesTransferred} bytes`,
                },
              ],
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            log.error("Transfer failed:", message);
            return {
              content: [
                {
                  type: "text",
                  text: `Transfer failed: ${message}`,
                },
              ],
            };
          }
        }
      ),
      tool(
        "list_vaults",
        "List all available vaults that can be used as source or target for file transfers.",
        {},
        async () => {
          try {
            const vaults = await listTransferableVaults();

            if (vaults.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: "No vaults found. Ensure VAULTS_DIR is configured and contains vaults with CLAUDE.md files.",
                  },
                ],
              };
            }

            const vaultList = vaults
              .map((v) => `- ${v.id}: ${v.name}`)
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: `Available vaults:\n\n${vaultList}`,
                },
              ],
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            log.error("Failed to list vaults:", message);
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to list vaults: ${message}`,
                },
              ],
            };
          }
        }
      ),
    ],
  });
}
