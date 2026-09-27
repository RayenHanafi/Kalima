import { NextResponse, type NextRequest } from "next/server";

// CORS for the browser extension's side panel (chrome-extension:// origin). Every API route still
// requires a Bearer token, so allowing extension origins exposes nothing without a user session.
// Set EXTENSION_ORIGIN (e.g. chrome-extension://abc…) in production to allow only our extension.
function allowed(origin: string | null): origin is string {
  if (!origin) return false;
  const pinned = process.env.EXTENSION_ORIGIN;
  if (pinned && !pinned.includes("<")) return origin === pinned;
  return origin.startsWith("chrome-extension://");
}

export function proxy(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!allowed(origin)) return NextResponse.next();

  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: "/api/:path*" };
