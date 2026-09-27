/**
 * DEV ONLY — prints a Supabase session for the seed test user, for browser tests while anonymous
 * sign-ins are disabled. Put it in localStorage under `sb-<project ref>-auth-token`.
 *   pnpm --filter web dev-session > session.json
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const noSession = { persistSession: false, autoRefreshToken: false };
const EMAIL = "seed@kalima.test";

async function main() {
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: noSession });
  const password = randomBytes(18).toString("base64url");
  const created = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true });
  if (created.error) {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const user = data.users.find((u) => u.email === EMAIL);
    if (!user) throw created.error;
    await admin.auth.admin.updateUserById(user.id, { password });
  }
  const { data, error } = await createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: noSession }).auth.signInWithPassword({
    email: EMAIL,
    password,
  });
  if (error) throw error;
  const ref = new URL(url).hostname.split(".")[0];
  process.stdout.write(JSON.stringify({ key: `sb-${ref}-auth-token`, value: JSON.stringify(data.session) }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
