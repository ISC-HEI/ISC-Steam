// Bridge between the web app and the desktop launcher.
// The web app detects the desktop build via window.iscSteam?.desktop.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('iscSteam', {
  desktop: true,
  // sandboxed preloads can't require local files; the main process answers synchronously
  version: ipcRenderer.sendSync('isc:version'),

  getInstallDir: () => ipcRenderer.invoke('isc:getInstallDir'),
  chooseInstallDir: () => ipcRenderer.invoke('isc:chooseInstallDir'),

  /** Returns { [slug]: { version, title } } for locally installed games. */
  installed: () => ipcRenderer.invoke('isc:installed'),

  /** game: { slug, title, version } - token authenticates the download. */
  install: (game, token) => ipcRenderer.invoke('isc:install', game, token),
  uninstall: (slug) => ipcRenderer.invoke('isc:uninstall', slug),
  play: (slug) => ipcRenderer.invoke('isc:play', slug),
  openFolder: (slug) => ipcRenderer.invoke('isc:openFolder', slug),

  /** Unread count shown on the taskbar icon (0 clears it). */
  setBadge: (count) => ipcRenderer.send('isc:badge', count),

  /** cb receives { type: 'started'|'exited', slug, title, seconds? }. Returns unsubscribe. */
  onGameEvent: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('isc:game-event', listener);
    return () => ipcRenderer.removeListener('isc:game-event', listener);
  },
});
