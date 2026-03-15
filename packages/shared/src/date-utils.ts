/**
 * Date Formatting Utilities
 *
 * Pure formatting functions used by both daemon and nextjs.
 * No I/O, no side effects.
 */

/**
 * Formats a Date object as YYYY-MM-DD.
 */
export function formatDateForFilename(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a Date object as HH:MM for timestamp prefixes.
 */
export function formatTimeForTimestamp(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Gets the filename for a daily note.
 */
export function getDailyNoteFilename(date: Date = new Date()): string {
  return `${formatDateForFilename(date)}.md`;
}
