/**
 * DEV ONLY — checks the extension's backend path with a saved page payload (from extractPage):
 * CORS preflight → POST /api/courses/from-page (as the extension would) → cache hit → session →
 * first explanation (SSE). Usage: pnpm --filter web page-check <payload.json>
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.SEED_BASE_URL ?? "http://localhost:3000";
const ORIGIN = "chrome-extension://kalimatestextensionid";

async function toDataUrl(src: string): Promise<string | null> {
  const res = await fetch(src, { headers: { "User-Agent": "Kalima/1.0 (accessibility learning assistant)" } });
  if (!res.ok) return null;
  const type = res.headers.get("content-type")?.split(";")[0] ?? "image/png";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: page-check <payload.json>");
  const raw = JSON.parse(readFileSync(path.resolve(file), "utf8"));
  const session = JSON.parse(execFileSync("npx", ["tsx", "scripts/dev-session.ts"], { encoding: "utf8", shell: true }));
  const token = JSON.parse(session.value).access_token as string;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: ORIGIN };

  const pre = await fetch(`${BASE}/api/courses/from-page`, {
    method: "OPTIONS",
    headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
  });
  console.log(`CORS preflight: HTTP ${pre.status}, allow-origin=${pre.headers.get("access-control-allow-origin")}`);

  const images = (
    await Promise.all(
      raw.images.map(async (i: { src: string; alt: string; nearbyText: string; sectionIdx: number }) => {
        const dataUrl = await toDataUrl(i.src);
        return dataUrl ? { dataUrl, alt: i.alt, nearbyText: i.nearbyText, sectionIdx: i.sectionIdx } : null;
      }),
    )
  ).filter(Boolean);
  const payload = { ...raw, images };
  console.log(`payload: ${raw.sections.length} sections, ${images.length}/${raw.images.length} images, ${JSON.stringify(payload).length} bytes`);

  let t = Date.now();
  let res = await fetch(`${BASE}/api/courses/from-page`, { method: "POST", headers, body: JSON.stringify(payload) });
  const first = await res.json();
  console.log(`from-page: HTTP ${res.status} in ${Date.now() - t}ms, allow-origin=${res.headers.get("access-control-allow-origin")}`, first);
  if (!res.ok) process.exit(1);

  t = Date.now();
  res = await fetch(`${BASE}/api/courses/from-page`, { method: "POST", headers, body: JSON.stringify(payload) });
  console.log(`same page again: ${Date.now() - t}ms`, await res.json());

  const s = await (await fetch(`${BASE}/api/sessions`, { method: "POST", headers, body: JSON.stringify({ courseId: first.courseId }) })).json();
  console.log(`outline: ${s.chunks.map((c: { idx: number; title: string }) => `${c.idx + 1}. ${c.title}`).join(" | ")}`);

  t = Date.now();
  const ex = await fetch(`${BASE}/api/sessions/${s.session.id}/explain`, { method: "POST", headers, body: JSON.stringify({ chunkIdx: 0 }) });
  const text = await ex.text();
  const firstDelta = text.indexOf("event: delta") >= 0;
  const spoken = [...text.matchAll(/^data: (.+)$/gm)].map((m) => JSON.parse(m[1]!)).filter((d) => typeof d.text === "string").map((d) => d.text).join("");
  console.log(`explain part 1: HTTP ${ex.status}, ${Date.now() - t}ms, streamed=${firstDelta}\n${spoken.trim().slice(0, 700)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
