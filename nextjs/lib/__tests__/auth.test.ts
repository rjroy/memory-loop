import { describe, test, expect } from "bun:test";
import { parseAllowedUsers, isUserAllowed } from "../../auth";
import { getAuthAction } from "../../middleware";

describe("parseAllowedUsers", () => {
  test("parses comma-separated usernames", () => {
    const result = parseAllowedUsers("alice,bob,charlie");
    expect(result).toEqual(new Set(["alice", "bob", "charlie"]));
  });

  test("trims whitespace", () => {
    const result = parseAllowedUsers(" alice , bob ");
    expect(result).toEqual(new Set(["alice", "bob"]));
  });

  test("lowercases all entries", () => {
    const result = parseAllowedUsers("Alice,BOB,Charlie");
    expect(result).toEqual(new Set(["alice", "bob", "charlie"]));
  });

  test("returns empty set for empty string", () => {
    expect(parseAllowedUsers("")).toEqual(new Set());
  });

  test("returns empty set for undefined", () => {
    expect(parseAllowedUsers(undefined)).toEqual(new Set());
  });

  test("filters out empty entries from trailing commas", () => {
    const result = parseAllowedUsers("alice,,bob,");
    expect(result).toEqual(new Set(["alice", "bob"]));
  });
});

describe("isUserAllowed", () => {
  const allowed = new Set(["alice", "bob"]);

  test("allows listed user", () => {
    expect(isUserAllowed("alice", allowed)).toBe(true);
  });

  test("denies unlisted user", () => {
    expect(isUserAllowed("eve", allowed)).toBe(false);
  });

  test("is case insensitive", () => {
    expect(isUserAllowed("Alice", allowed)).toBe(true);
    expect(isUserAllowed("ALICE", allowed)).toBe(true);
  });

  test("fails closed on empty allowlist", () => {
    expect(isUserAllowed("alice", new Set())).toBe(false);
  });

  test("returns false for null login", () => {
    expect(isUserAllowed(null, allowed)).toBe(false);
  });

  test("returns false for undefined login", () => {
    expect(isUserAllowed(undefined, allowed)).toBe(false);
  });
});

describe("getAuthAction", () => {
  test("health endpoint is always public", () => {
    expect(getAuthAction("/api/health", false)).toBe("public");
    expect(getAuthAction("/api/health", true)).toBe("public");
  });

  test("auth endpoints are always public", () => {
    expect(getAuthAction("/api/auth/signin", false)).toBe("public");
    expect(getAuthAction("/api/auth/callback/github", false)).toBe("public");
    expect(getAuthAction("/api/auth/signout", true)).toBe("public");
  });

  test("unauthenticated API request returns api-unauthorized", () => {
    expect(getAuthAction("/api/vaults", false)).toBe("api-unauthorized");
    expect(getAuthAction("/api/chat", false)).toBe("api-unauthorized");
  });

  test("unauthenticated page request returns page-redirect", () => {
    expect(getAuthAction("/", false)).toBe("page-redirect");
    expect(getAuthAction("/some/page", false)).toBe("page-redirect");
  });

  test("authenticated requests are allowed", () => {
    expect(getAuthAction("/api/vaults", true)).toBe("allow");
    expect(getAuthAction("/", true)).toBe("allow");
  });
});
