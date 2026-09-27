import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { fail } from "@/lib/http";

export type Db = SupabaseClient<Database>;

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/**
 * Authenticates `Authorization: Bearer <supabase access token>` (web app and extension both send it)
 * and returns a client that acts as that user, so every query goes through RLS.
 */
export async function authenticate(req: Request): Promise<{ db: Db; userId: string } | Response> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return fail(401, "missing_token");

  const db = createClient<Database>(url(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: noSession,
  });
  const { data, error } = await db.auth.getClaims(token);
  const userId = data?.claims.sub;
  if (error || !userId) return fail(401, "invalid_token");
  return { db, userId };
}

let service: Db | undefined;

/**
 * Bypasses RLS. Only for what ARCHITECTURE.md allows: writing the shared image-description cache
 * and anonymous usage events. Never use it to read or write user data.
 */
export function serviceDb(): Db {
  service ??= createClient<Database>(url(), process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: noSession });
  return service;
}
