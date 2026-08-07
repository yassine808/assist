'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const riot = require('./riot');

const STORE_DIR = path.join(app.getPath('appData'), 'AS');
const STORE_FILE = path.join(STORE_DIR, 'accounts.json');
const PROFILES_DIR = path.join(STORE_DIR, 'profiles');

const profileDir = (puuid) => path.join(PROFILES_DIR, puuid);

function loadAccounts() {
  if (!fs.existsSync(STORE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch (e) {
    // A corrupt store must not silently wipe saved accounts.
    throw new Error(`accounts.json is unreadable (${e.message}). Fix or delete ${STORE_FILE}.`);
  }
}

function saveAccounts(accounts) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(accounts, null, 2));
}

function upsert(account) {
  const accounts = loadAccounts();
  const i = accounts.findIndex((a) => a.puuid === account.puuid);
  if (i >= 0) accounts[i] = { ...accounts[i], ...account };
  else accounts.push(account);
  saveAccounts(accounts);
  return accounts;
}

// --- IPC ------------------------------------------------------------------

ipcMain.handle('accounts:list', () => loadAccounts());

ipcMain.handle('accounts:tier-meta', () => riot.tierMeta());

ipcMain.handle('accounts:active', () => riot.currentPuuid());

/** Captures whoever is currently signed into the Riot Client. */
ipcMain.handle('accounts:add-current', async () => {
  const session = riot.readClientSession();
  if (!session) {
    throw new Error(
      'No signed-in Riot Client session found. Open the Riot Client, log in, then try again.',
    );
  }

  const auth = await riot.authenticate(session.cookies, session.region);
  const rank = await riot.fetchRank(auth);

  riot.saveProfileFiles(profileDir(auth.puuid));

  return upsert({
    puuid: auth.puuid,
    name: auth.name,
    tag: auth.tag,
    shard: auth.shard,
    region: session.region,
    tier: rank.tier,
    rr: rank.rr,
    updatedAt: Date.now(),
  });
});

/** Re-authenticates a saved account from its stored cookies to refresh name and rank. */
ipcMain.handle('accounts:refresh', async (_e, puuid) => {
  const session = riot.readClientSession(profileDir(puuid));
  if (!session) throw new Error('Saved session files are missing. Re-add this account.');

  const auth = await riot.authenticate(session.cookies, session.region);
  const rank = await riot.fetchRank(auth);

  return upsert({
    puuid: auth.puuid,
    name: auth.name,
    tag: auth.tag,
    shard: auth.shard,
    tier: rank.tier,
    rr: rank.rr,
    updatedAt: Date.now(),
  });
});

ipcMain.handle('accounts:switch', async (_e, puuid) => {
  await riot.switchTo(profileDir(puuid));
  return true;
});

ipcMain.handle('accounts:remove', (_e, puuid) => {
  fs.rmSync(profileDir(puuid), { recursive: true, force: true });
  const accounts = loadAccounts().filter((a) => a.puuid !== puuid);
  saveAccounts(accounts);
  return accounts;
});

ipcMain.handle('accounts:tracker', (_e, { name, tag }) => {
  shell.openExternal(
    `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(`${name}#${tag}`)}/overview`,
  );
});

// --- Window ---------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 880,
    height: 660,
    minWidth: 640,
    // Matches --bg so the window does not flash cold-grey before the CSS lands.
    backgroundColor: '#16120f',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());
