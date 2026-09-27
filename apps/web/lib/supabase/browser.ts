"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

let client: SupabaseClient<Database> | undefined;

export function browserDb() {
  client ??= createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  return client;
}

/** Access token of the current session; signs in anonymously on first visit (no account needed). */
export async function accessToken(): Promise<string> {
  const db = browserDb();
  const { data } = await db.auth.getSession();
  if (data.session) return data.session.access_token;
  const { data: anon, error } = await db.auth.signInAnonymously();
  if (error || !anon.session) throw new Error(`sign-in failed: ${error?.message ?? "no session"}`);
  return anon.session.access_token;
}
