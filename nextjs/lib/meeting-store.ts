/**
 * Meeting Store
 *
 * Global in-memory storage for active meetings, keyed by vault ID.
 * This allows meeting state to persist across requests.
 * Meeting state is maintained per-vault so it survives connection interruptions.
 */

import type { ActiveMeeting } from "./meeting-capture";
import { wsLog as log } from "./logger";

/**
 * Global map of vault ID to active meeting.
 * Only one meeting can be active per vault at a time.
 */
const activeMeetings = new Map<string, ActiveMeeting>();

/**
 * Gets the active meeting for a vault.
 *
 * @param vaultId - The vault ID
 * @returns The active meeting or null if none
 */
export function getActiveMeeting(vaultId: string): ActiveMeeting | null {
  return activeMeetings.get(vaultId) ?? null;
}

/**
 * Sets the active meeting for a vault.
 *
 * @param vaultId - The vault ID
 * @param meeting - The meeting to store
 */
export function setActiveMeeting(vaultId: string, meeting: ActiveMeeting): void {
  log.info(`[MeetingStore] Setting active meeting for vault ${vaultId}: "${meeting.title}"`);
  activeMeetings.set(vaultId, meeting);
}

/**
 * Clears the active meeting for a vault.
 *
 * @param vaultId - The vault ID
 */
export function clearActiveMeeting(vaultId: string): void {
  const existing = activeMeetings.get(vaultId);
  if (existing) {
    log.info(`[MeetingStore] Clearing active meeting for vault ${vaultId}: "${existing.title}"`);
    activeMeetings.delete(vaultId);
  }
}

/**
 * Updates the entry count for an active meeting.
 * Used after capturing a note to keep the global state in sync.
 *
 * @param vaultId - The vault ID
 */
export function incrementMeetingEntryCount(vaultId: string): void {
  const meeting = activeMeetings.get(vaultId);
  if (meeting) {
    meeting.entryCount++;
  }
}

/**
 * Checks if a vault has an active meeting.
 *
 * @param vaultId - The vault ID
 * @returns true if the vault has an active meeting
 */
export function hasActiveMeeting(vaultId: string): boolean {
  return activeMeetings.has(vaultId);
}

/**
 * Gets all active meetings across all vaults.
 * Useful for diagnostics and testing.
 *
 * @returns Array of [vaultId, meeting] tuples
 */
export function getAllActiveMeetings(): Array<[string, ActiveMeeting]> {
  return Array.from(activeMeetings.entries());
}

/**
 * Clears all active meetings.
 * Intended for testing cleanup only.
 */
export function clearAllMeetings(): void {
  log.info(`[MeetingStore] Clearing all ${activeMeetings.size} active meetings`);
  activeMeetings.clear();
}
