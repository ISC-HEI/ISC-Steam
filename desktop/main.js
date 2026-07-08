// ISCSteam desktop client — thin Electron shell around the ISC Steam web app.
// The app URL comes from package.json ("iscsteam.url"), overridable with the
// ISCSTEAM_URL environment variable (handy for testing against localhost).
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const games = require('./games');

const APP_URL = process.env.ISCSTEAM_URL || require('./package.json').iscsteam.url;

// ---- launcher IPC (used by the web app via preload.js) ----
ipcMain.handle('isc:getInstallDir', () => games.getInstallDir());
ipcMain.handle('isc:chooseInstallDir', (e) => games.chooseInstallDir(BrowserWindow.fromWebContents(e.sender)));
ipcMain.handle('isc:installed', () => games.listInstalled());
ipcMain.handle('isc:install', (e, game, token) => games.install(APP_URL, game, token));
ipcMain.handle('isc:uninstall', (e, slug) => games.uninstall(slug));
ipcMain.handle('isc:play', (e, slug) => games.play(APP_URL, slug));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1b2838',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Links to other sites open in the default browser, not in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Game downloads: save straight to the OS Downloads folder, then reveal.
  win.webContents.session.on('will-download', (event, item) => {
    const target = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(target);
    item.once('done', (e, state) => {
      if (state === 'completed') shell.showItemInFolder(target);
    });
  });

  // If the server is unreachable, show a local retry page.
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame) win.loadFile(path.join(__dirname, 'offline.html'));
  });

  win.loadURL(APP_URL);
  return win;
}

app.whenReady().then(() => {
  const win = createWindow();

  // Auto-update from GitHub Releases (installed/NSIS builds only; the portable
  // exe can't replace itself). Downloads in the background, then shows the
  // release notes and offers to restart.
  try {
    const { autoUpdater } = require('electron-updater');

    autoUpdater.on('update-downloaded', (info) => {
      // GitHub release notes arrive as an HTML string (or per-file array)
      const raw = Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n) => n.note ?? '').join('\n')
        : String(info.releaseNotes ?? '');
      const notes = raw
        .replace(/<li>/gi, '• ')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      dialog
        .showMessageBox(win, {
          type: 'info',
          title: 'Update available',
          message: `ISCSteam ${info.version} is ready to install`,
          detail: notes ? `What's new:\n\n${notes.slice(0, 2000)}` : 'Restart to apply the update.',
          buttons: ['Restart & update', 'Later'],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall();
        });
    });

    autoUpdater.checkForUpdates().catch(() => {});
  } catch {
    /* updater unavailable in dev */
  }
  // offline.html calls location.reload via a retry link back to the app URL
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`window.__ISCSTEAM_URL = ${JSON.stringify(APP_URL)};`).catch(() => {});
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
