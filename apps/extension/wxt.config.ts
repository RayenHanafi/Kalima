import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// Same root .env.local as the web app; only public values are compiled into the extension.
const rootEnv = resolve(__dirname, '../../.env.local');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __KALIMA_API__: JSON.stringify(process.env.KALIMA_API_BASE_URL ?? 'http://localhost:3000'),
      __SUPABASE_URL__: JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''),
      __SUPABASE_KEY__: JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''),
    },
  }),
  manifest: {
    name: 'Kalima',
    description: 'Spoken, interactive lessons for blind and low-vision learners.',
    action: { default_title: 'Open Kalima' },
    permissions: ['sidePanel', 'activeTab', 'scripting', 'storage'],
    // Needed to read the lesson page and download its images for description.
    host_permissions: ['<all_urls>'],
    commands: {
      'start-kalima': {
        suggested_key: { default: 'Alt+Shift+K' },
        description: 'Read this page with Kalima',
      },
    },
  },
});
