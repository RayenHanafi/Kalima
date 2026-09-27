import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Kalima',
    description: 'Spoken, interactive lessons for blind and low-vision learners.',
    action: { default_title: 'Open Kalima' },
    permissions: ['sidePanel'],
  },
});
