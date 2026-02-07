import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Node.js runtime avoids edge compilation of instrumentation.ts,
// which imports scheduler code using node:crypto, node:fs, etc.
export const runtime = "nodejs";

type AuthAction = "public" | "api-unauthorized" | "page-redirect" | "allow";

/**
 * Determine what to do based on the path and auth state.
 * Pure function for testability.
 */
export function getAuthAction(
  pathname: string,
  isAuthenticated: boolean,
): AuthAction {
  // Health check is always public
  if (pathname === "/api/health") return "public";

  // Auth endpoints must be public (login flow)
  if (pathname.startsWith("/api/auth/")) return "public";

  if (isAuthenticated) return "allow";

  // Unauthenticated: API gets 401, pages get redirect
  if (pathname.startsWith("/api/")) return "api-unauthorized";
  return "page-redirect";
}

export default auth((req) => {
  const action = getAuthAction(req.nextUrl.pathname, !!req.auth);

  switch (action) {
    case "public":
    case "allow":
      return NextResponse.next();
    case "api-unauthorized":
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 },
      );
    case "page-redirect":
      return NextResponse.redirect(new URL("/api/auth/signin", req.nextUrl));
  }
});

export const config = {
  matcher: [
    // Match all paths except static assets
    "/((?!_next/static|_next/image|images/|favicon\\.ico).*)",
  ],
};
