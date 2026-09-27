/**
 * Live check of the provider chain. Reads ../../.env.local; never prints keys.
 *   pnpm --filter @kalima/llm smoke          # full chain, as the app uses it
 *   pnpm --filter @kalima/llm smoke --each   # each configured provider on its own
 */
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createLlm, providersFromEnv, type CallLog, type Message, type ProviderConfig } from '../src/index';

config({ path: resolve(import.meta.dirname, '../../../.env.local'), quiet: true });

// A bar chart with known values, so we can check the description is accurate.
const CHART_URL =
  'https://quickchart.io/chart?format=png&width=400&height=250&c=' +
  encodeURIComponent(
    JSON.stringify({
      type: 'bar',
      data: { labels: ['Mon', 'Tue', 'Wed'], datasets: [{ label: 'Hours studied', data: [2, 5, 3] }] },
    }),
  );

async function chartDataUrl(): Promise<string> {
  const res = await fetch(CHART_URL);
  if (!res.ok) throw new Error(`chart download failed: HTTP ${res.status}`);
  return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

const preview = (s: string) => s.replace(/\s+/g, ' ').slice(0, 200);

async function run(label: string, providers: ProviderConfig[], image: string) {
  const logs: CallLog[] = [];
  const llm = createLlm({ providers, logger: (l) => void logs.push(l) });
  const trail = () => logs.map((l) => `${l.provider}#${l.attempt}:${l.ok ? 'ok' : l.status}`).join(' → ');
  console.log(`\n━━ ${label} ━━`);

  const text: Message[] = [
    { role: 'system', content: 'You are a patient teacher. Answer in two short spoken-style sentences.' },
    { role: 'user', content: 'What is photosynthesis?' },
  ];
  let t = Date.now();
  try {
    const r = await llm.chat({ messages: text, reasoning: 'off' });
    console.log(`TEXT   ✓ ${r.provider} (${r.model}) ${Date.now() - t}ms\n       ${preview(r.text)}`);
  } catch (e) {
    console.log(`TEXT   ✗ ${(e as Error).message}`);
  }
  console.log(`       trail: ${trail()}`);
  logs.length = 0;

  const vision: Message[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this chart for a blind student in two sentences, including the values.' },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ];
  t = Date.now();
  try {
    const r = await llm.chat({ messages: vision, reasoning: 'off', timeoutMs: 45_000 });
    console.log(`IMAGE  ✓ ${r.provider} (${r.model}) ${Date.now() - t}ms\n       ${preview(r.text)}`);
  } catch (e) {
    console.log(`IMAGE  ✗ ${(e as Error).message}`);
  }
  console.log(`       trail: ${trail()}`);
  logs.length = 0;

  t = Date.now();
  try {
    let firstMs = 0;
    let out = '';
    const gen = llm.chatStream({ messages: text, reasoning: 'off' });
    let step = await gen.next();
    while (!step.done) {
      if (!firstMs) firstMs = Date.now() - t;
      out += step.value;
      step = await gen.next();
    }
    console.log(`STREAM ✓ ${step.value.provider} first token ${firstMs}ms, total ${Date.now() - t}ms\n       ${preview(out)}`);
  } catch (e) {
    console.log(`STREAM ✗ ${(e as Error).message}`);
  }
  console.log(`       trail: ${trail()}`);
}

const providers = providersFromEnv();
if (!providers.length) {
  console.error('No provider keys found in .env.local');
  process.exit(1);
}
console.log(`Configured providers (in order): ${providers.map((p) => p.name).join(' → ')}`);
const image = await chartDataUrl();

if (process.argv.includes('--each')) {
  for (const p of providers) await run(`${p.name} only`, [p], image);
} else {
  await run('full chain', providers, image);
}
