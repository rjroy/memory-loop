/**
 * Task Manager
 *
 * Discovers and parses markdown tasks from vault directories.
 * Supports scanning inbox, projects, and areas directories recursively.
 * Task format: /^\s*- \[(.)\] (.+)$/
 */

import { readdir, readFile, writeFile, lstat, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import type { TaskEntry, TaskCategory } from "@/lib/schemas";
import { createLogger } from "./logger";
import {
  validatePath,
  FileBrowserError,
} from "./file-browser";
import {
  resolveProjectPath,
  resolveAreaPath,
  type VaultConfig,
} from "./vault-config";
import { DEFAULT_INBOX_PATH, directoryExists } from "./vault-manager";

const log = createLogger("TaskManager");

/**
 * Regex pattern for parsing markdown tasks.
 * Captures: state character (group 1), task text (group 2)
 * Examples:
 *   "- [ ] Buy groceries" -> state=" ", text="Buy groceries"
 *   "  - [x] Done item"   -> state="x", text="Done item"
 *   "- [/] Partial task"  -> state="/", text="Partial task"
 */
export const TASK_REGEX = /^(\s*- \[)(.)(] .+)$/;

/**
 * Valid task state characters.
 * ' ' = incomplete, 'x' = complete, '/' = partial,
 * '?' = needs info, 'b' = bookmarked, 'f' = urgent
 */
export const VALID_STATES = [" ", "x", "/", "?", "b", "f"] as const;
export type TaskState = (typeof VALID_STATES)[number];

/**
 * State cycle order for toggling tasks.
 */
export const STATE_CYCLE: TaskState[] = [" ", "x", "/", "?", "b", "f"];

/**
 * Result of getting all tasks from a vault.
 */
export interface TasksResult {
  tasks: TaskEntry[];
  incomplete: number;
  total: number;
}

// =============================================================================
// Directory Scanning
// =============================================================================

/**
 * Recursively scans a directory for markdown files.
 * Returns relative file paths from the vault root.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param relativePath - Path relative to vault root to scan
 * @returns Array of relative file paths (from vault root)
 */
export async function scanTasksFromDirectory(
  vaultPath: string,
  relativePath: string
): Promise<string[]> {
  log.debug(`Scanning directory: ${relativePath || "(root)"}`);

  // Validate path is within vault
  let targetPath: string;
  try {
    targetPath = await validatePath(vaultPath, relativePath);
  } catch (error) {
    if (error instanceof FileBrowserError) {
      log.warn(`Path validation failed for ${relativePath}: ${error.message}`);
      return [];
    }
    throw error;
  }

  // Check if directory exists
  if (!(await directoryExists(targetPath))) {
    log.debug(`Directory does not exist: ${relativePath}`);
    return [];
  }

  const filePaths: string[] = [];

  try {
    const entries = await readdir(targetPath, { withFileTypes: true });

    // Collect files and subdirectories to scan
    const subdirPromises: Promise<string[]>[] = [];

    for (const entry of entries) {
      // Skip hidden files and directories
      if (entry.name.startsWith(".")) {
        continue;
      }

      const entryRelativePath =
        relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
      const entryAbsolutePath = join(targetPath, entry.name);

      // Check for symlinks and skip them
      try {
        const stats = await lstat(entryAbsolutePath);
        if (stats.isSymbolicLink()) {
          log.debug(`Skipping symlink: ${entryRelativePath}`);
          continue;
        }

        if (stats.isDirectory()) {
          // Recursively scan subdirectory
          subdirPromises.push(scanTasksFromDirectory(vaultPath, entryRelativePath));
        } else if (stats.isFile()) {
          // Only process .md files
          if (extname(entry.name).toLowerCase() === ".md") {
            filePaths.push(entryRelativePath);
          }
        }
      } catch (error) {
        log.warn(
          `Error checking entry ${entryRelativePath}: ${error instanceof Error ? error.message : String(error)}`
        );
        // Skip entries we can't stat
        continue;
      }
    }

    // Wait for all subdirectory scans in parallel
    const subdirResults = await Promise.all(subdirPromises);
    for (const subFiles of subdirResults) {
      filePaths.push(...subFiles);
    }
  } catch (error) {
    log.warn(
      `Error reading directory ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }

  log.debug(`Found ${filePaths.length} files in ${relativePath || "(root)"}`);
  return filePaths;
}

// =============================================================================
// Task Parsing
// =============================================================================

/**
 * Parses tasks from a markdown file.
 *
 * @param vaultPath - Absolute path to the vault root
 * @param relativePath - Relative file path from vault root
 * @param category - Category indicating source directory (inbox, projects, or areas)
 * @returns Array of TaskEntry objects found in the file
 */
export async function parseTasksFromFile(
  vaultPath: string,
  relativePath: string,
  category: TaskCategory
): Promise<TaskEntry[]> {
  log.debug(`Parsing tasks from: ${relativePath}`);

  // Validate path is within vault
  let targetPath: string;
  try {
    targetPath = await validatePath(vaultPath, relativePath);
  } catch (error) {
    if (error instanceof FileBrowserError) {
      log.warn(`Path validation failed for ${relativePath}: ${error.message}`);
      return [];
    }
    throw error;
  }

  // Get file modification time for sorting
  let fileMtime: number;
  try {
    const stats = await stat(targetPath);
    fileMtime = stats.mtimeMs;
  } catch (error) {
    log.warn(
      `Error getting file stats ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
    );
    fileMtime = 0;
  }

  // Read file content
  let content: string;
  try {
    content = await readFile(targetPath, "utf-8");
  } catch (error) {
    log.warn(
      `Error reading file ${relativePath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }

  const tasks: TaskEntry[] = [];
  // Normalize line endings: split by \n, then remove trailing \r from each line
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    // Remove trailing \r for Windows-style line endings (CRLF)
    const line = lines[i].replace(/\r$/, "");
    const match = line.match(TASK_REGEX);

    if (match) {
      const state = match[2];
      // Extract task text: the regex captures "- [" + state + "] text"
      // match[3] contains "] text", so we slice off the "] " prefix
      const text = match[3].slice(2);

      tasks.push({
        text,
        state,
        filePath: relativePath,
        lineNumber: i + 1, // 1-indexed
        fileMtime,
        category,
      });
    }
  }

  log.debug(`Found ${tasks.length} tasks in ${relativePath}`);
  return tasks;
}

// =============================================================================
// Combined Operations
// =============================================================================

/**
 * Gets all tasks from configured vault directories.
 * Scans inbox, projects, and areas directories in parallel.
 * Each task is tagged with its source category for grouping.
 *
 * @param vaultPath - Absolute path to the vault root (content root)
 * @param config - Vault configuration
 * @returns TasksResult with tasks array and counts
 */
export async function getAllTasks(
  vaultPath: string,
  config: VaultConfig
): Promise<TasksResult> {
  log.info(`Getting all tasks from vault: ${vaultPath}`);

  // Resolve directory paths from config
  const inboxPath = config.inboxPath ?? DEFAULT_INBOX_PATH;
  const projectPath = resolveProjectPath(config);
  const areaPath = resolveAreaPath(config);

  log.debug(`Scanning directories: inbox=${inboxPath}, projects=${projectPath}, areas=${areaPath}`);

  // Scan all three directories in parallel
  const [inboxFiles, projectFiles, areaFiles] = await Promise.all([
    scanTasksFromDirectory(vaultPath, inboxPath),
    scanTasksFromDirectory(vaultPath, projectPath),
    scanTasksFromDirectory(vaultPath, areaPath),
  ]);

  log.debug(`Files found: inbox=${inboxFiles.length}, projects=${projectFiles.length}, areas=${areaFiles.length}`);

  // Parse tasks from each directory with its category in parallel
  const [inboxTasks, projectTasks, areaTasks] = await Promise.all([
    Promise.all(inboxFiles.map((filePath) => parseTasksFromFile(vaultPath, filePath, "inbox"))),
    Promise.all(projectFiles.map((filePath) => parseTasksFromFile(vaultPath, filePath, "projects"))),
    Promise.all(areaFiles.map((filePath) => parseTasksFromFile(vaultPath, filePath, "areas"))),
  ]);

  // Flatten results from each category
  const tasks: TaskEntry[] = [
    ...inboxTasks.flat(),
    ...projectTasks.flat(),
    ...areaTasks.flat(),
  ];

  // Sort by file path, then by line number (frontend handles category grouping)
  tasks.sort((a, b) => {
    const pathCompare = a.filePath.localeCompare(b.filePath);
    if (pathCompare !== 0) return pathCompare;
    return a.lineNumber - b.lineNumber;
  });

  // Calculate counts
  const incomplete = tasks.filter((t) => t.state === " ").length;
  const total = tasks.length;

  log.info(`Found ${total} tasks (${incomplete} incomplete)`);

  return { tasks, incomplete, total };
}

/**
 * Gets the next state in the toggle cycle.
 *
 * @param currentState - Current checkbox state character
 * @returns Next state in the cycle
 */
export function getNextState(currentState: string): TaskState {
  const currentIndex = STATE_CYCLE.indexOf(currentState as TaskState);
  if (currentIndex === -1) {
    // Unknown state, start from beginning
    return STATE_CYCLE[0];
  }
  const nextIndex = (currentIndex + 1) % STATE_CYCLE.length;
  return STATE_CYCLE[nextIndex];
}

// =============================================================================
// Task Toggle Operations
// =============================================================================

/**
 * Result of a toggle operation.
 */
export interface ToggleResult {
  success: boolean;
  newState?: string;
  error?: string;
}

/**
 * Toggles or sets the state of a task checkbox in a file.
 *
 * If newState is provided, sets the task to that state directly.
 * Otherwise cycles: ' ' -> 'x' -> '/' -> '?' -> 'b' -> 'f' -> ' '
 *
 * @param vaultPath - Absolute path to the vault root
 * @param filePath - Relative file path from vault root
 * @param lineNumber - 1-indexed line number of the task
 * @param newState - Optional: set to this state instead of cycling
 * @returns ToggleResult with success status and new state
 */
export async function toggleTask(
  vaultPath: string,
  filePath: string,
  lineNumber: number,
  newState?: string
): Promise<ToggleResult> {
  log.debug(`Toggling task: ${filePath}:${lineNumber} in ${vaultPath}`);

  // 1. Validate path is within vault
  let targetPath: string;
  try {
    targetPath = await validatePath(vaultPath, filePath);
  } catch (error) {
    if (error instanceof FileBrowserError) {
      log.warn(`Path validation failed for toggle: ${error.message}`);
      return { success: false, error: error.message };
    }
    throw error;
  }

  // 2. Read entire file content
  let content: string;
  try {
    content = await readFile(targetPath, "utf-8");
  } catch {
    const message = `File not found: ${filePath}`;
    log.warn(message);
    return { success: false, error: message };
  }

  // 3. Split by \n (preserve original line structure)
  const lines = content.split("\n");

  // 4. Validate lineNumber is within bounds (1 to lines.length)
  if (lineNumber < 1 || lineNumber > lines.length) {
    const message = `Line number ${lineNumber} out of bounds (file has ${lines.length} lines)`;
    log.warn(message);
    return { success: false, error: message };
  }

  // 5. Get the target line (lines[lineNumber - 1])
  const targetLine = lines[lineNumber - 1];

  // 6. Validate target line is a task (matches TASK_REGEX)
  const match = targetLine.match(TASK_REGEX);
  if (!match) {
    const message = `Line ${lineNumber} is not a task`;
    log.warn(message);
    return { success: false, error: message };
  }

  // 7. Extract current state from regex match
  // TASK_REGEX captures: group 1 = prefix including "- [", group 2 = state char, group 3 = "] text..."
  const prefix = match[1]; // e.g., "  - ["
  const currentState = match[2]; // e.g., " " or "x"
  const suffix = match[3]; // e.g., "] Buy groceries"

  // 8. Calculate next state: use provided state or cycle
  const targetState = newState ?? getNextState(currentState);

  // 9. Reconstruct the line with only the state character changed
  const newLine = prefix + targetState + suffix;

  // 10. Update the array
  lines[lineNumber - 1] = newLine;

  // 11. Join with \n and write back to file
  const newContent = lines.join("\n");

  try {
    await writeFile(targetPath, newContent, "utf-8");
  } catch (error) {
    const message = `Failed to write file: ${error instanceof Error ? error.message : String(error)}`;
    log.error(message);
    return { success: false, error: message };
  }

  log.info(`Toggled task ${filePath}:${lineNumber} from '${currentState}' to '${targetState}'`);

  // 12. Return success with new state
  return { success: true, newState: targetState };
}
