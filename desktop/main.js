// ISCSteam desktop client — thin Electron shell around the ISC Steam web app.
// The app URL comes from package.json ("iscsteam.url"), overridable with the
// ISCSTEAM_URL environment variable (handy for testing against localhost).
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const APP_URL = process.env.ISCSTEAM_URL || require('./package.json').iscsteam.url;

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
