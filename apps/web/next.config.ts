import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Single .env.local at the repo root, shared with packages/llm scripts. Next only reads .env files
// from apps/web (and caches that load), so read the root file directly. Existing vars win.
// On Vercel the file doesn't exist and project env vars are used instead.
const rootEnv = path.resolve(__dirname, "../../.env.local");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {};

export default nextConfig;
