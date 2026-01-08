/**
 * Holiday detection hook for seasonal theming.
 *
 * Returns the current holiday (if any) based on date ranges:
 * - Valentine's: 1 week starting Sunday of week containing Feb 14
 * - St. Patrick's: 1 week starting Sunday of week containing March 17
 * - Easter: 2 weeks centered on Easter Sunday
 * - Summer: 2 weeks centered on July 4th
 * - Halloween: 1 week starting Sunday of week containing Oct 31
 * - Thanksgiving: 1 week starting Sunday of week containing 4th Thursday of Nov
 * - Christmas: All of December
 */

export type Holiday =
  | "valentine"
  | "stpatricks"
  | "easter"
  | "summer"
  | "halloween"
  | "thanksgiving"
  | "christmas"
  | null;

/**
 * Calculate Easter Sunday for a given year using the Anonymous Gregorian algorithm.
 */
function calculateEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

/**
 * Get the Sunday at the start of the week containing the given date.
 */
function getSundayOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - result.getDay());
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get the 4th Thursday of November (Thanksgiving) for a given year.
 */
function getThanksgiving(year: number): Date {
  const nov1 = new Date(year, 10, 1); // November 1
  const dayOfWeek = nov1.getDay();
  // Days until first Thursday
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
  const firstThursday = 1 + daysUntilThursday;
  // 4th Thursday
  const fourthThursday = firstThursday + 21;
  return new Date(year, 10, fourthThursday);
}

/**
 * Check if a date falls within a range (inclusive).
 */
function isInRange(date: Date, start: Date, end: Date): boolean {
  const time = date.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

/**
 * Determine the current holiday based on today's date.
 */
export function getHoliday(date: Date = new Date()): Holiday {
  const year = date.getFullYear();
  const testDate = new Date(date);
  testDate.setHours(12, 0, 0, 0); // Normalize to noon to avoid timezone issues

  // Christmas: All of December
  if (date.getMonth() === 11) {
    return "christmas";
  }

  // Valentine's Day: 1 week starting Sunday of week containing Feb 14
  const valentines = new Date(year, 1, 14);
  const valentinesStart = getSundayOfWeek(valentines);
  const valentinesEnd = new Date(valentinesStart);
  valentinesEnd.setDate(valentinesEnd.getDate() + 6);
  valentinesEnd.setHours(23, 59, 59, 999);
  if (isInRange(testDate, valentinesStart, valentinesEnd)) {
    return "valentine";
  }

  // St. Patrick's Day: 1 week starting Sunday of week containing March 17
  const stpatricks = new Date(year, 2, 17);
  const stpatricksStart = getSundayOfWeek(stpatricks);
  const stpatricksEnd = new Date(stpatricksStart);
  stpatricksEnd.setDate(stpatricksEnd.getDate() + 6);
  stpatricksEnd.setHours(23, 59, 59, 999);
  if (isInRange(testDate, stpatricksStart, stpatricksEnd)) {
    return "stpatricks";
  }

  // Easter: 2 weeks centered on Easter Sunday
  const easter = calculateEaster(year);
  const easterStart = new Date(easter);
  easterStart.setDate(easterStart.getDate() - 7);
  easterStart.setHours(0, 0, 0, 0);
  const easterEnd = new Date(easter);
  easterEnd.setDate(easterEnd.getDate() + 6);
  easterEnd.setHours(23, 59, 59, 999);
  if (isInRange(testDate, easterStart, easterEnd)) {
    return "easter";
  }

  // Summer: 2 weeks with July 4th in the middle (June 27 - July 11)
  const summerStart = new Date(year, 5, 27); // June 27
  summerStart.setHours(0, 0, 0, 0);
  const summerEnd = new Date(year, 6, 11); // July 11
  summerEnd.setHours(23, 59, 59, 999);
  if (isInRange(testDate, summerStart, summerEnd)) {
    return "summer";
  }

  // Halloween: 1 week starting Sunday of week containing Oct 31
  const halloween = new Date(year, 9, 31);
  const halloweenStart = getSundayOfWeek(halloween);
  const halloweenEnd = new Date(halloweenStart);
  halloweenEnd.setDate(halloweenEnd.getDate() + 6);
  halloweenEnd.setHours(23, 59, 59, 999);
  if (isInRange(testDate, halloweenStart, halloweenEnd)) {
    return "halloween";
  }

  // Thanksgiving: 1 week starting Sunday of week containing 4th Thursday
  const thanksgiving = getThanksgiving(year);
  const thanksgivingStart = getSundayOfWeek(thanksgiving);
  const thanksgivingEnd = new Date(thanksgivingStart);
  thanksgivingEnd.setDate(thanksgivingEnd.getDate() + 6);
  thanksgivingEnd.setHours(23, 59, 59, 999);
  if (isInRange(testDate, thanksgivingStart, thanksgivingEnd)) {
    return "thanksgiving";
  }

  return null;
}

const VALID_HOLIDAYS = ['valentine', 'stpatricks', 'easter', 'summer', 'halloween', 'thanksgiving', 'christmas'] as const;

/**
 * React hook that returns the current holiday.
 * Supports ?holiday=<name> query parameter for testing or mood-based override.
 * Use ?holiday=none to disable holiday theming.
 */
export function useHoliday(): Holiday {
  // Check for query parameter override
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const override = params.get('holiday');
    if (override === 'none') return null;
    if (VALID_HOLIDAYS.includes(override as typeof VALID_HOLIDAYS[number])) {
      return override as Holiday;
    }
  }
  return getHoliday();
}
