import { describe, test, expect } from "bun:test";
import { getHoliday } from "./useHoliday";

describe("getHoliday", () => {
  describe("Christmas", () => {
    test("returns christmas for any day in December", () => {
      expect(getHoliday(new Date(2024, 11, 1))).toBe("christmas");
      expect(getHoliday(new Date(2024, 11, 15))).toBe("christmas");
      expect(getHoliday(new Date(2024, 11, 25))).toBe("christmas");
      expect(getHoliday(new Date(2024, 11, 31))).toBe("christmas");
    });

    test("does not return christmas in November or January", () => {
      expect(getHoliday(new Date(2024, 10, 30))).not.toBe("christmas");
      expect(getHoliday(new Date(2025, 0, 1))).not.toBe("christmas");
    });
  });

  describe("Valentine's Day", () => {
    // 2024: Feb 14 is Wednesday, week is Feb 11 (Sun) - Feb 17 (Sat)
    test("returns valentine for week containing Feb 14", () => {
      expect(getHoliday(new Date(2024, 1, 11))).toBe("valentine"); // Sunday
      expect(getHoliday(new Date(2024, 1, 14))).toBe("valentine"); // Wednesday
      expect(getHoliday(new Date(2024, 1, 17))).toBe("valentine"); // Saturday
    });

    test("does not return valentine outside the week", () => {
      expect(getHoliday(new Date(2024, 1, 10))).not.toBe("valentine");
      expect(getHoliday(new Date(2024, 1, 18))).not.toBe("valentine");
    });

    // 2025: Feb 14 is Friday, week is Feb 9 (Sun) - Feb 15 (Sat)
    test("handles different years correctly", () => {
      expect(getHoliday(new Date(2025, 1, 9))).toBe("valentine");
      expect(getHoliday(new Date(2025, 1, 14))).toBe("valentine");
      expect(getHoliday(new Date(2025, 1, 15))).toBe("valentine");
      expect(getHoliday(new Date(2025, 1, 16))).not.toBe("valentine");
    });
  });

  describe("Easter", () => {
    // 2024: Easter is March 31, range is March 24 - April 6
    test("returns easter for 2 weeks centered on Easter Sunday", () => {
      expect(getHoliday(new Date(2024, 2, 24))).toBe("easter"); // Week before
      expect(getHoliday(new Date(2024, 2, 31))).toBe("easter"); // Easter Sunday
      expect(getHoliday(new Date(2024, 3, 6))).toBe("easter"); // Week after
    });

    test("does not return easter outside the range", () => {
      expect(getHoliday(new Date(2024, 2, 23))).not.toBe("easter");
      expect(getHoliday(new Date(2024, 3, 7))).not.toBe("easter");
    });

    // 2025: Easter is April 20, range is April 13 - April 26
    test("handles different years correctly", () => {
      expect(getHoliday(new Date(2025, 3, 13))).toBe("easter");
      expect(getHoliday(new Date(2025, 3, 20))).toBe("easter");
      expect(getHoliday(new Date(2025, 3, 26))).toBe("easter");
      expect(getHoliday(new Date(2025, 3, 27))).not.toBe("easter");
    });
  });

  describe("Summer", () => {
    // Fixed range: June 27 - July 11
    test("returns summer for June 27 - July 11", () => {
      expect(getHoliday(new Date(2024, 5, 27))).toBe("summer"); // June 27
      expect(getHoliday(new Date(2024, 6, 4))).toBe("summer"); // July 4
      expect(getHoliday(new Date(2024, 6, 11))).toBe("summer"); // July 11
    });

    test("does not return summer outside the range", () => {
      expect(getHoliday(new Date(2024, 5, 26))).not.toBe("summer");
      expect(getHoliday(new Date(2024, 6, 12))).not.toBe("summer");
    });
  });

  describe("Halloween", () => {
    // 2024: Oct 31 is Thursday, week is Oct 27 (Sun) - Nov 2 (Sat)
    test("returns halloween for week containing Oct 31", () => {
      expect(getHoliday(new Date(2024, 9, 27))).toBe("halloween"); // Sunday
      expect(getHoliday(new Date(2024, 9, 31))).toBe("halloween"); // Thursday
      expect(getHoliday(new Date(2024, 10, 2))).toBe("halloween"); // Saturday
    });

    test("does not return halloween outside the week", () => {
      expect(getHoliday(new Date(2024, 9, 26))).not.toBe("halloween");
      expect(getHoliday(new Date(2024, 10, 3))).not.toBe("halloween");
    });

    // 2025: Oct 31 is Friday, week is Oct 26 (Sun) - Nov 1 (Sat)
    test("handles different years correctly", () => {
      expect(getHoliday(new Date(2025, 9, 26))).toBe("halloween");
      expect(getHoliday(new Date(2025, 9, 31))).toBe("halloween");
      expect(getHoliday(new Date(2025, 10, 1))).toBe("halloween");
      expect(getHoliday(new Date(2025, 10, 2))).not.toBe("halloween");
    });
  });

  describe("Thanksgiving", () => {
    // 2024: 4th Thursday is Nov 28, week is Nov 24 (Sun) - Nov 30 (Sat)
    // But Nov 30 is in the December range... actually December starts Dec 1
    test("returns thanksgiving for week containing 4th Thursday", () => {
      expect(getHoliday(new Date(2024, 10, 24))).toBe("thanksgiving"); // Sunday
      expect(getHoliday(new Date(2024, 10, 28))).toBe("thanksgiving"); // Thursday
      expect(getHoliday(new Date(2024, 10, 30))).toBe("thanksgiving"); // Saturday
    });

    test("does not return thanksgiving outside the week", () => {
      expect(getHoliday(new Date(2024, 10, 23))).not.toBe("thanksgiving");
      // Dec 1 is christmas
      expect(getHoliday(new Date(2024, 11, 1))).toBe("christmas");
    });

    // 2025: 4th Thursday is Nov 27, week is Nov 23 (Sun) - Nov 29 (Sat)
    test("handles different years correctly", () => {
      expect(getHoliday(new Date(2025, 10, 23))).toBe("thanksgiving");
      expect(getHoliday(new Date(2025, 10, 27))).toBe("thanksgiving");
      expect(getHoliday(new Date(2025, 10, 29))).toBe("thanksgiving");
      expect(getHoliday(new Date(2025, 10, 30))).not.toBe("thanksgiving");
    });
  });

  describe("No holiday", () => {
    test("returns null for dates without holidays", () => {
      expect(getHoliday(new Date(2024, 0, 15))).toBe(null); // Mid January
      expect(getHoliday(new Date(2024, 4, 15))).toBe(null); // Mid May
      expect(getHoliday(new Date(2024, 7, 15))).toBe(null); // Mid August
      expect(getHoliday(new Date(2024, 8, 15))).toBe(null); // Mid September
    });
  });

  describe("Priority", () => {
    test("christmas takes priority over thanksgiving at month boundary", () => {
      // Dec 1 could theoretically be in thanksgiving week, but christmas wins
      expect(getHoliday(new Date(2024, 11, 1))).toBe("christmas");
    });
  });
});
