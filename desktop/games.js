// Main-process game manager: install folder, download+unzip, launch, sessions.
const { app, dialog, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const AdmZip = require('adm-zip');
const discord = require('./discord');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'iscsteam.json');
const META_FILE = '.iscsteam.json';
const SLUG_RE = /^[a-z0-9-]{1,100}$/;

const running = new Map(); // slug -> { child, startedAt, title }

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(next, null, 2));
  return next;
}

function broadcast(event) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('isc:game-event', event);
  }
}

function getInstallDir() {
  return readConfig().installDir ?? null;
}

async function chooseInstallDir(parentWindow) {
  const { canceled, filePaths } = await dialog.showOpenDialog(parentWindow, {
    title: 'Choose where ISCSteam installs games',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths[0]) return getInstallDir();
  writeConfig({ installDir: filePaths[0] });
  return filePaths[0];
}

function gameDir(slug) {
  const root = getInstallDir();
  if (!root) throw new Error('No install folder selected');
  if (!SLUG_RE.test(slug)) throw new Error('Invalid game id');
  return path.join(root, slug);
}

async function readMeta(slug) {
  try {
    return JSON.parse(await fsp.readFile(path.join(gameDir(slug), META_FILE), 'utf8'));
  } catch {
    return null;
  }
}

async function listInstalled() {
  const root = getInstallDir();
  if (!root) return {};
  const out = {};
  let entries = [];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return {};
  }
  for (const e of entries) {
    if (!e.isDirectory() || !SLUG_RE.test(e.name)) continue;
    const meta = await readMeta(e.name);
    if (meta) out[e.name] = { version: meta.version, title: meta.title };
  }
  return out;
}

/** Finds the launcher at the top of the game folder: AppName.exe or AppName.bat. */
async function findLauncher(dir) {
  const entries = await fsp.readdir(dir);
  return (
    entries.find((f) => f.toLowerCase().endsWith('.exe')) ??
    entries.find((f) => f.toLowerCase().endsWith('.bat')) ??
    null
  );
}

async function install(appUrl, game, token) {
  const root = getInstallDir();
  if (!root) throw new Error('No install folder selected');
  if (!SLUG_RE.test(game.slug)) throw new Error('Invalid game id');
  if (running.has(game.slug)) throw new Error('Close the game before updating it');

  const url = `${appUrl.replace(/\/$/, '')}/api/games/${game.slug}/download?token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `Download failed (HTTP ${res.status})`;
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch { /* not JSON */ }
    throw new Error(msg);
  }

  const tmp = path.join(os.tmpdir(), `iscsteam-${game.slug}-${Date.now()}.zip`);
  await fsp.writeFile(tmp, Buffer.from(await res.arrayBuffer()));

  const dest = gameDir(game.slug);
  await fsp.rm(dest, { recursive: true, force: true });

  try {
    // The package zips everything under a top-level "<slug>/" folder.
    new AdmZip(tmp).extractAllTo(root, true);
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
  }

  const launcher = await findLauncher(dest);
  if (!launcher) {
    await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
    throw new Error('Package did not contain a launcher (.exe or .bat)');
  }

  await fsp.writeFile(
    path.join(dest, META_FILE),
    JSON.stringify(
      { slug: game.slug, title: game.title, version: game.version, coverUrl: game.coverUrl ?? null, launcher },
      null,
      2,
    ),
  );

  return { ok: true };
}

async function uninstall(slug) {
  if (running.has(slug)) throw new Error('Close the game first');
  await fsp.rm(gameDir(slug), { recursive: true, force: true });
  return { ok: true };
}

async function play(appUrl, slug) {
  if (running.has(slug)) throw new Error('Already running');
  const meta = await readMeta(slug);
  if (!meta?.launcher) throw new Error('Game is not installed');

  // Banner for Discord: media URLs are relative (/api/games/...), Discord needs https
  const bannerUrl = meta.coverUrl ? `${appUrl.replace(/\/$/, '')}${meta.coverUrl}` : null;

  const dir = gameDir(slug);
  const launcherPath = path.join(dir, meta.launcher);
  const child = meta.launcher.toLowerCase().endsWith('.bat')
    ? spawn('cmd.exe', ['/c', launcherPath], { cwd: dir, windowsHide: false })
    : spawn(launcherPath, [], { cwd: dir, windowsHide: false });

  const session = { child, startedAt: Date.now(), title: meta.title ?? slug };
  running.set(slug, session);

  broadcast({ type: 'started', slug, title: session.title });
  discord.setPlaying(session.title, bannerUrl);

  const finish = () => {
    if (!running.has(slug)) return;
    running.delete(slug);
    const seconds = Math.round((Date.now() - session.startedAt) / 1000);
    broadcast({ type: 'exited', slug, title: session.title, seconds });
    discord.clear();
  };

  child.on('exit', finish);
  child.on('error', finish);

  return { ok: true };
}

module.exports = { getInstallDir, chooseInstallDir, listInstalled, install, uninstall, play };
