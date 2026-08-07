'use strict';
// Everything that talks to Riot: the on-disk client data folder, the cookie -> token
// exchange, and the two game API calls we need (name + rank).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const YAML = require('yaml');
const { net } = require('electron');

const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const PROGRAMDATA = process.env.ProgramData || 'C:\\ProgramData';

// The Riot Client keeps its whole logged-in session in this one folder. Swapping accounts
// is just swapping its contents - there is no credential store or registry key involved.
const DATA_DIRS = [
  path.join(LOCAL, 'Riot Games', 'Riot Client', 'Data'),
  path.join(LOCAL, 'Riot Games', 'Beta', 'Data'),
];

const RIOT_PROCESSES = [
  'VALORANT-Win64-Shipping.exe',
  'VALORANT.exe',
  'RiotClientServices.exe',
  'RiotClientUx.exe',
  'RiotClientUxRender.exe',
  'RiotClientCrashHandler.exe',
];

const AUTHORIZE_URL =
  'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in' +
  '&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid';

// Base64 of the standard Riot client platform blob; the game API 400s without it.
const CLIENT_PLATFORM =
  'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2' +
  'lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9';

const TIERS = [
  'Unranked', '', '',
  'Iron 1', 'Iron 2', 'Iron 3',
  'Bronze 1', 'Bronze 2', 'Bronze 3',
  'Silver 1', 'Silver 2', 'Silver 3',
  'Gold 1', 'Gold 2', 'Gold 3',
  'Platinum 1', 'Platinum 2', 'Platinum 3',
  'Diamond 1', 'Diamond 2', 'Diamond 3',
  'Ascendant 1', 'Ascendant 2', 'Ascendant 3',
  'Immortal 1', 'Immortal 2', 'Immortal 3',
  'Radiant',
];

const tierName = (t) => TIERS[t] || 'Unranked';

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

// Electron's net stack is Chromium's, so Riot's Cloudflare edge sees a browser TLS
// fingerprint. Plain node https gets challenged, which is why the C# app shells out to curl.
function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const r = net.request({ method: opts.method || 'GET', url, redirect: 'manual' });
    for (const [k, v] of Object.entries(opts.headers || {})) r.setHeader(k, v);

    let redirectUrl = '';
    r.on('redirect', (status, method, location) => { redirectUrl = location; r.abort(); });
    r.on('response', (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, redirectUrl }));
    });
    r.on('abort', () => resolve({ status: 303, body: '', redirectUrl }));
    r.on('error', reject);

    if (opts.body) r.write(opts.body);
    r.end();
  });
}

async function getJson(url, headers) {
  const res = await request(url, { headers });
  if (res.status !== 200) throw new Error(`${url} -> HTTP ${res.status}`);
  return JSON.parse(res.body);
}

// ---------------------------------------------------------------------------
// Client data folder
// ---------------------------------------------------------------------------

function activeDataDir() {
  return DATA_DIRS.find((d) => fs.existsSync(d)) || DATA_DIRS[0];
}

/** Reads the logged-in session out of the live Riot Client, or null if nobody is logged in. */
function readClientSession(dir = activeDataDir()) {
  const file = path.join(dir, 'RiotGamesPrivateSettings.yaml');
  if (!fs.existsSync(file)) return null;

  const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
  const persist = doc?.['riot-login']?.persist;
  const cookies = persist?.session?.cookies;
  if (!Array.isArray(cookies) || cookies.length === 0) return null;

  return { cookies, region: persist.region || '' };
}

const cookieHeader = (cookies) => cookies.map((c) => `${c.name}=${c.value}`).join('; ');

function killRiot() {
  return Promise.all(
    RIOT_PROCESSES.map(
      (name) =>
        new Promise((resolve) => execFile('taskkill', ['/F', '/T', '/IM', name], () => resolve())),
    ),
  );
}

function findRiotClient() {
  const installs = path.join(PROGRAMDATA, 'Riot Games', 'RiotClientInstalls.json');
  if (!fs.existsSync(installs)) return null;

  const cfg = JSON.parse(fs.readFileSync(installs, 'utf8'));
  for (const key of ['rc_live', 'rc_beta', 'rc_esports', 'rc_default']) {
    if (cfg[key] && fs.existsSync(cfg[key])) return cfg[key];
  }
  return null;
}

/** Snapshots the current session folder so it can be restored later. */
function saveProfileFiles(destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.cpSync(activeDataDir(), destDir, { recursive: true });
}

/** Kills Riot, swaps the session folder for a saved one, and launches VALORANT. */
async function switchTo(profileDir) {
  if (!fs.existsSync(path.join(profileDir, 'RiotGamesPrivateSettings.yaml'))) {
    throw new Error('Saved session files are missing. Re-add this account.');
  }

  const client = findRiotClient();
  if (!client) throw new Error('No Riot Client install found.');

  await killRiot();
  // The client holds file handles for a moment after the kill.
  await new Promise((r) => setTimeout(r, 1500));

  const dir = activeDataDir();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(profileDir, dir, { recursive: true });

  spawn(client, ['--launch-product=valorant', '--launch-patchline=live'], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

// ---------------------------------------------------------------------------
// Auth + game API
// ---------------------------------------------------------------------------

function fragmentValue(url, key) {
  const hash = url.indexOf('#');
  if (hash < 0) return '';
  return new URLSearchParams(url.slice(hash + 1)).get(key) || '';
}

const REGION_SHARDS = [
  [/^(EU|TR|RU)/, 'eu'],
  [/^(NA|OC|LA|BR)/, 'na'],
  [/^(KR|JP)/, 'kr'],
  [/^(AP|SG|TW|VN|PH|TH)/, 'ap'],
];

function shardFromRegion(region) {
  const r = (region || '').toUpperCase();
  for (const [re, shard] of REGION_SHARDS) if (re.test(r)) return shard;
  return 'na';
}

/** The PAS token names the account's live shard, which beats guessing from the login region. */
function shardFromPasToken(pas) {
  try {
    const payload = JSON.parse(Buffer.from(pas.split('.')[1], 'base64').toString('utf8'));
    return payload.affinity || '';
  } catch {
    return '';
  }
}

/**
 * Exchanges a Riot Client cookie jar for game API credentials.
 * Riot answers /authorize with a 303 whose Location fragment carries the tokens.
 */
async function authenticate(cookies, region) {
  const res = await request(AUTHORIZE_URL, { headers: { Cookie: cookieHeader(cookies) } });
  const accessToken = fragmentValue(res.redirectUrl || '', 'access_token');
  if (!accessToken) throw new Error('Session expired. Sign in through the Riot Client again.');

  const bearer = { Authorization: `Bearer ${accessToken}` };

  const ent = await request('https://entitlements.auth.riotgames.com/api/token/v1', {
    method: 'POST',
    headers: { ...bearer, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const entitlement = JSON.parse(ent.body).entitlements_token;
  if (!entitlement) throw new Error('Could not get an entitlements token.');

  const info = await getJson('https://auth.riotgames.com/userinfo', bearer);

  let shard = '';
  try {
    const pas = await request('https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat', {
      headers: bearer,
    });
    shard = shardFromPasToken(pas.body.replace(/"/g, ''));
  } catch {
    // Presence service is optional - fall back to the login region below.
  }

  return {
    puuid: info.sub,
    name: info.acct?.game_name || '',
    tag: info.acct?.tag_line || '',
    shard: shard || shardFromRegion(region),
    headers: {
      ...bearer,
      'X-Riot-Entitlements-JWT': entitlement,
      'X-Riot-ClientPlatform': CLIENT_PLATFORM,
      'X-Riot-ClientVersion': await clientVersion(),
    },
  };
}

let cachedVersion = null;
async function clientVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const v = await getJson('https://valorant-api.com/v1/version');
    cachedVersion = v.data.riotClientVersion;
  } catch {
    cachedVersion = 'release-13.02-shipping-10-5229475';
  }
  return cachedVersion;
}

/** Current competitive tier and RR. */
async function fetchRank(session) {
  const mmr = await getJson(
    `https://pd.${session.shard}.a.pvp.net/mmr/v1/players/${session.puuid}`,
    session.headers,
  );

  const latest = mmr.LatestCompetitiveUpdate;
  if (latest && latest.TierAfterUpdate > 0) {
    return { tier: latest.TierAfterUpdate, rr: latest.RankedRatingAfterUpdate || 0 };
  }

  // No recent competitive game: fall back to the best tier on record so the card is not blank.
  // ponytail: highest-ever rather than current act, since resolving the live act ID costs
  // another API call. Swap to the act-scoped lookup if the distinction ever matters.
  let best = 0;
  for (const season of Object.values(mmr.QueueSkills?.competitive?.SeasonalInfoBySeasonID || {})) {
    if (season.CompetitiveTier > best) best = season.CompetitiveTier;
  }
  return { tier: best, rr: 0 };
}

let cachedTiers = null;
/**
 * Maps competitive tier number -> { icon, color } from the newest tier table.
 * Riot ships a colour per tier, so the UI can take its only chroma straight from the
 * data instead of inventing an accent.
 */
async function tierMeta() {
  if (cachedTiers) return cachedTiers;
  try {
    const res = await getJson('https://valorant-api.com/v1/competitivetiers');
    const newest = res.data[res.data.length - 1];
    cachedTiers = Object.fromEntries(
      newest.tiers.map((t) => [
        t.tier,
        { icon: t.largeIcon, color: `#${(t.color || '').slice(0, 6)}` },
      ]),
    );
  } catch {
    cachedTiers = {};
  }
  return cachedTiers;
}

/** The puuid signed into the Riot Client right now, or '' if nobody is. */
function currentPuuid() {
  const session = readClientSession();
  return session?.cookies.find((c) => c.name === 'sub')?.value || '';
}

module.exports = {
  activeDataDir,
  tierMeta,
  currentPuuid,
  readClientSession,
  saveProfileFiles,
  switchTo,
  killRiot,
  authenticate,
  fetchRank,
  tierName,
};
