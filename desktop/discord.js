// Discord Rich Presence — fail-soft: if Discord isn't running or no client ID
// is configured, everything silently no-ops.
let RPC = null;
try {
  RPC = require('discord-rpc');
} catch {
  /* dependency not installed */
}

const CLIENT_ID =
  process.env.DISCORD_CLIENT_ID || require('./package.json').iscsteam?.discordClientId || '';

let client = null;
let ready = false;
let pending = null; // activity to apply once connected

function connect() {
  if (!RPC || !CLIENT_ID || client) return;
  client = new RPC.Client({ transport: 'ipc' });
  client.on('ready', () => {
    ready = true;
    if (pending) void client.setActivity(pending).catch(() => {});
  });
  client.login({ clientId: CLIENT_ID }).catch(() => {
    client = null; // Discord not running — try again on next game launch
  });
}

function setPlaying(title, bannerUrl) {
  const activity = {
    details: title,
    state: 'via ISCSteam',
    startTimestamp: Date.now(),
    // Discord accepts direct https URLs for images; falls back to the
    // "iscsteam" art asset from the Discord dev portal.
    largeImageKey: bannerUrl || 'iscsteam',
    largeImageText: title,
    smallImageKey: bannerUrl ? 'iscsteam' : undefined,
    smallImageText: bannerUrl ? 'ISC Steam' : undefined,
    instance: false,
  };
  pending = activity;
  if (!client) connect();
  else if (ready) void client.setActivity(activity).catch(() => {});
}

function clear() {
  pending = null;
  if (client && ready) void client.clearActivity().catch(() => {});
}

module.exports = { setPlaying, clear };
