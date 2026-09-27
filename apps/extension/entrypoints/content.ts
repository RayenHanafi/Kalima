// Page extraction lands in phase 4 (adapters/). Placeholder so the entrypoint exists.
export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {},
});
