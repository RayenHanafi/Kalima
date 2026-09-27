/**
 * DEV ONLY — checks that another signed-in user cannot reach the seed user's data (RLS).
 * Run after `pnpm seed` with the dev server up: pnpm --filter web rls-check
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env.local"));
const seed = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../.seed-session.json"), "utf8"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const noSession = { persistSession: false, autoRefreshToken: false };
const EMAIL = "intruder@kalima.test";

async function main() {
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: noSession });
  const password = randomBytes(18).toString("base64url");
  const created = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true });
  const userId = created.data.user?.id;
  if (!userId) throw created.error;

  try {
    const { data } = await createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: noSession }).auth.signInWithPassword({
      email: EMAIL,
      password,
    });
    const token = data.session!.access_token;
    const call = (method: string, route: string, body: unknown = {}) =>
      fetch(`${seed.base}${route}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(body),
      }).then((r) => r.status);

    const checks: [string, number][] = [
      ["GET course", await call("GET", `/api/courses/${seed.courseId}`)],
      ["POST plan", await call("POST", `/api/courses/${seed.courseId}/plan`)],
      ["POST session on course", await call("POST", "/api/sessions", { courseId: seed.courseId })],
      ["PATCH session", await call("PATCH", `/api/sessions/${seed.sessionId}`, { currentChunkIdx: 0 })],
      ["POST explain", await call("POST", `/api/sessions/${seed.sessionId}/explain`)],
      ["POST ask", await call("POST", `/api/sessions/${seed.sessionId}/ask`, { question: "hi" })],
      ["POST quiz", await call("POST", `/api/sessions/${seed.sessionId}/quiz`)],
    ];
    let ok = true;
    for (const [name, status] of checks) {
      const pass = status === 404;
      ok &&= pass;
      console.log(`${pass ? "✓" : "✗"} ${name}: HTTP ${status} (expected 404)`);
    }
    console.log(ok ? "\n✔ Another user cannot see or change the seed user's data." : "\n✗ RLS LEAK");
    process.exitCode = ok ? 0 : 1;
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
