import { providersFromEnv } from "@kalima/llm";

export const runtime = "nodejs";

// Confirms server-side env loading: lists configured AI providers by name only (never keys).
export function GET() {
  return Response.json({
    ok: true,
    providers: providersFromEnv().map((p) => p.name),
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  });
}
