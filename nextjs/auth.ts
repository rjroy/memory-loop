import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

/**
 * Parse AUTH_ALLOWED_USERS env var into a lowercase Set.
 * Returns empty set if unset or blank (fail closed).
 */
export function parseAllowedUsers(raw?: string): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Check if a GitHub login is in the allowed set.
 * Fails closed: empty allowlist means nobody gets in.
 */
export function isUserAllowed(
  login: string | null | undefined,
  allowed: Set<string>,
): boolean {
  if (allowed.size === 0) return false;
  if (!login) return false;
  return allowed.has(login.toLowerCase());
}

const allowed = parseAllowedUsers(process.env.AUTH_ALLOWED_USERS);

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  callbacks: {
    signIn({ profile }) {
      return isUserAllowed(profile?.login as string | undefined, allowed);
    },
    jwt({ token, profile }) {
      if (profile?.login) {
        token.username = (profile.login as string).toLowerCase();
      }
      return token;
    },
    session({ session, token }) {
      if (token.username) {
        session.user.name = token.username as string;
      }
      return session;
    },
  },
});
