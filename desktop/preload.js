// Bridge between the web app and the desktop launcher.
// The web app detects the desktop build via window.iscSteam?.desktop.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('iscSteam', {
  desktop: true,
  version: process.env.npm_package_version ?? '',

  getInstallDir: () => ipcRenderer.invoke('isc:getInstallDir'),
  chooseInstallDir: () => ipcRenderer.invoke('isc:chooseInstallDir'),

  /** Returns { [slug]: { version, title } } for locally installed games. */
  installed: () => ipcRenderer.invoke('isc:installed'),

  /** game: { slug, title, version } — token authenticates the download. */
  install: (game, token) => ipcRenderer.invoke('isc:install', game, token),
  uninstall: (slug) => ipcRenderer.invoke('isc:uninstall', slug),
  play: (slug) => ipcRenderer.invoke('isc:play', slug),

  /** cb receives { type: 'started'|'exited', slug, title, seconds? }. Returns unsubscribe. */
  onGameEvent: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('isc:game-event', listener);
    return () => ipcRenderer.removeListener('isc:game-event', listener);
  },
});
