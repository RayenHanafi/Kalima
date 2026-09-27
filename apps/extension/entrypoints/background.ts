export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel.
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // Alt+Shift+K: open the panel and start reading the current page (screen readers capture
  // single keys in browse mode, so the extension needs a global shortcut).
  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'start-kalima') return;
    await browser.storage.session.set({ autostart: Date.now() });
    if (tab?.windowId !== undefined) await browser.sidePanel.open({ windowId: tab.windowId });
    // If the panel was already open, tell it directly.
    browser.runtime.sendMessage({ type: 'kalima:start' }).catch(() => {});
  });
});
