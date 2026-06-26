'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const {
  DEFAULT_LOCAL_MANIFEST_PATH,
  resolveShowdownSpeciesId,
  normalizePokemonIconLookupName,
} = require('../services/pokemon_icon_catalog');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CACHE_DIR = path.join(REPO_ROOT, 'assets', 'pokemon-icons', 'icons');
const POKEAPI_SPRITE_SOURCE = 'pokeapi-sprites';
const POKEAPI_SPRITE_REPO = 'https://github.com/PokeAPI/sprites';
const POKEAPI_RAW_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const POKEAPI_API_BASE = 'https://pokeapi.co/api/v2/pokemon';
const POKEAPI_FULL_LIST_URL = `${POKEAPI_API_BASE}?limit=100000&offset=0`;

const SAMPLE_NAMES = [
  'farigiraf',
  'zoroarkhisui',
  'ogerponwellspring',
  'calyrexshadow',
  'urshifurapidstrike',
  'indeedeef',
  'nidoranf',
  'nidoranm',
];

const POKEAPI_NAME_OVERRIDES = new Map(Object.entries({
  farigiraf: 'farigiraf',
  zoroarkhisui: 'zoroark-hisui',
  ogerponwellspring: 'ogerpon-wellspring-mask',
  calyrexshadow: 'calyrex-shadow',
  urshifurapidstrike: 'urshifu-rapid-strike',
  indeedeef: 'indeedee-female',
  nidoranf: 'nidoran-f',
  nidoranm: 'nidoran-m',
}));

const POKEAPI_ID_OVERRIDES = new Map(Object.entries({
  farigiraf: 981,
  zoroarkhisui: 10239,
  ogerponwellspring: 10273,
  calyrexshadow: 10194,
  urshifurapidstrike: 10191,
  indeedeef: 10186,
  nidoranf: 29,
  nidoranm: 32,
}));

const DISPLAY_NAME_OVERRIDES = new Map(Object.entries({
  farigiraf: 'Farigiraf',
  zoroarkhisui: 'Zoroark-Hisui',
  ogerponwellspring: 'Ogerpon-Wellspring',
  calyrexshadow: 'Calyrex-Shadow',
  urshifurapidstrike: 'Urshifu-Rapid-Strike',
  indeedeef: 'Indeedee-F',
  nidoranf: 'Nidoran-F',
  nidoranm: 'Nidoran-M',
}));

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    all: false,
    dryRun: true,
    download: false,
    fetchMetadata: false,
    summaryOnly: false,
    limit: null,
    names: [],
    cacheDir: DEFAULT_CACHE_DIR,
    manifestPath: DEFAULT_LOCAL_MANIFEST_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--download') {
      options.download = true;
      options.dryRun = false;
    } else if (arg === '--all') {
      options.all = true;
      options.summaryOnly = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
      options.download = false;
    } else if (arg === '--fetch-metadata') {
      options.fetchMetadata = true;
    } else if (arg === '--summary-only') {
      options.summaryOnly = true;
    } else if (arg === '--include-rows') {
      options.summaryOnly = false;
    } else if (arg === '--limit') {
      const parsed = Number(argv[index + 1]);
      options.limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
      index += 1;
    } else if (arg === '--names') {
      options.names.push(...String(argv[index + 1] || '').split(',').map((item) => item.trim()).filter(Boolean));
      index += 1;
    } else if (arg === '--cache-dir') {
      options.cacheDir = path.resolve(argv[index + 1] || DEFAULT_CACHE_DIR);
      index += 1;
    } else if (arg === '--manifest') {
      options.manifestPath = path.resolve(argv[index + 1] || DEFAULT_LOCAL_MANIFEST_PATH);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg && !arg.startsWith('--')) {
      options.names.push(arg);
    }
  }

  if (!options.names.length && !options.all) options.names = [...SAMPLE_NAMES];
  return options;
}

function usage() {
  return [
    'Usage: node scripts/sync_pokemon_icons.js [--dry-run] [--download] [--all] [--limit n] [--fetch-metadata] [--names name1,name2]',
    '',
    'Default mode is dry-run. It prints planned PokeAPI sprite URLs and local ignored paths without downloading.',
    '--all fetches the full PokeAPI Pokemon/form list and prints summary counts by default.',
    'Use --download only after owner approval for a real local cache mutation.',
  ].join('\n');
}

function localIconPath(showdownId, cacheDir = DEFAULT_CACHE_DIR) {
  return path.join(cacheDir, `${showdownId}.png`);
}

function repoRelativePath(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

function pokeApiNameForShowdownId(showdownId) {
  return POKEAPI_NAME_OVERRIDES.get(showdownId) || showdownId.replace(/([a-z])([0-9])/g, '$1-$2');
}

function spriteUrlFromPokeApiId(pokeApiId) {
  return `${POKEAPI_RAW_BASE}/${pokeApiId}.png`;
}

function displayNameFromPokeApiName(name = '') {
  return String(name || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}

function showdownIdFromPokeApiName(name = '') {
  const normalized = String(name || '').toLowerCase().trim();
  const known = resolveShowdownSpeciesId(normalized);
  if (known && known !== normalized.replace(/[^a-z0-9]+/g, '')) return known;

  const parts = normalized.split('-').filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last === 'female') return `${parts.slice(0, -1).join('')}f`;
    if (last === 'male') return `${parts.slice(0, -1).join('')}m`;
  }

  return resolveShowdownSpeciesId(normalized);
}

function pokeApiIdFromUrl(url = '') {
  const match = String(url || '').match(/\/pokemon\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}

function planPokemonIconSync(names = [], options = {}) {
  const cacheDir = path.resolve(options.cacheDir || DEFAULT_CACHE_DIR);
  return names.map((name) => {
    const showdownId = resolveShowdownSpeciesId(name);
    const pokeApiName = showdownId ? pokeApiNameForShowdownId(showdownId) : null;
    const pokeApiId = showdownId ? POKEAPI_ID_OVERRIDES.get(showdownId) || null : null;
    const iconPath = showdownId ? localIconPath(showdownId, cacheDir) : null;
    return {
      input: normalizePokemonIconLookupName(name),
      displayName: DISPLAY_NAME_OVERRIDES.get(showdownId) || normalizePokemonIconLookupName(name),
      showdownId,
      pokeApiName,
      pokeApiId,
      spriteUrl: pokeApiId ? spriteUrlFromPokeApiId(pokeApiId) : null,
      iconPath: iconPath ? repoRelativePath(iconPath) : null,
      absoluteIconPath: iconPath,
      status: showdownId && pokeApiId ? 'planned' : 'missing-pokeapi-id',
    };
  });
}

function planPokemonIconSyncFromPokeApiRows(rows = [], options = {}) {
  const cacheDir = path.resolve(options.cacheDir || DEFAULT_CACHE_DIR);
  return rows.map((row) => {
    const pokeApiName = String(row?.name || '').trim();
    const pokeApiId = Number(row?.id || pokeApiIdFromUrl(row?.url));
    const showdownId = showdownIdFromPokeApiName(pokeApiName);
    const iconPath = showdownId ? localIconPath(showdownId, cacheDir) : null;
    return {
      input: pokeApiName,
      displayName: DISPLAY_NAME_OVERRIDES.get(showdownId) || displayNameFromPokeApiName(pokeApiName),
      showdownId,
      pokeApiName,
      pokeApiId: Number.isFinite(pokeApiId) ? pokeApiId : null,
      spriteUrl: Number.isFinite(pokeApiId) ? spriteUrlFromPokeApiId(pokeApiId) : null,
      iconPath: iconPath ? repoRelativePath(iconPath) : null,
      absoluteIconPath: iconPath,
      status: showdownId && Number.isFinite(pokeApiId) ? 'planned' : 'missing-pokeapi-id',
    };
  });
}

function requestBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'user-agent': 'Professor-Aegis-PokemonIconSync/1.0' } }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function fetchPokeApiMetadata(pokeApiName) {
  const url = `${POKEAPI_API_BASE}/${encodeURIComponent(pokeApiName)}`;
  const buffer = await requestBuffer(url);
  return JSON.parse(buffer.toString('utf8'));
}

async function fetchPokeApiFullList(options = {}) {
  const buffer = await requestBuffer(POKEAPI_FULL_LIST_URL);
  const parsed = JSON.parse(buffer.toString('utf8'));
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  const limited = options.limit ? results.slice(0, options.limit) : results;
  return limited.map((row) => ({
    name: row.name,
    url: row.url,
    id: pokeApiIdFromUrl(row.url),
  }));
}

async function completePlanWithMetadata(rows = []) {
  const completed = [];
  for (const row of rows) {
    if (row.pokeApiId && row.spriteUrl) {
      completed.push(row);
      continue;
    }
    if (!row.pokeApiName) {
      completed.push(row);
      continue;
    }
    try {
      const metadata = await fetchPokeApiMetadata(row.pokeApiName);
      const spriteUrl = metadata?.sprites?.front_default || null;
      completed.push({
        ...row,
        pokeApiId: metadata?.id || row.pokeApiId,
        spriteUrl,
        status: spriteUrl ? 'planned' : 'missing-sprite-url',
      });
    } catch (error) {
      completed.push({ ...row, status: 'metadata-error', error: error.message });
    }
  }
  return completed;
}

function manifestEntryFromPlan(row) {
  return {
    displayName: row.displayName,
    showdownId: row.showdownId,
    spriteId: row.pokeApiName || row.showdownId,
    baseSpecies: '',
    forme: '',
    nationalDex: row.pokeApiId,
    iconPath: row.iconPath,
    source: POKEAPI_SPRITE_SOURCE,
    sourceUrl: row.spriteUrl || POKEAPI_SPRITE_REPO,
    lastSyncedAt: new Date().toISOString(),
  };
}

function readExistingManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return {
      schemaVersion: 1,
      sourcePolicy: 'Local generated PokeAPI icon manifest. Do not commit downloaded icon files.',
      entries: [],
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return {
      schemaVersion: Number.isFinite(Number(parsed.schemaVersion)) ? Number(parsed.schemaVersion) : 1,
      sourcePolicy: typeof parsed.sourcePolicy === 'string'
        ? parsed.sourcePolicy
        : 'Local generated PokeAPI icon manifest. Do not commit downloaded icon files.',
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      sourcePolicy: 'Local generated PokeAPI icon manifest. Do not commit downloaded icon files.',
      entries: [],
    };
  }
}

function writeManifest(manifestPath, rows) {
  const existing = readExistingManifest(manifestPath);
  const byId = new Map(existing.entries
    .filter((entry) => entry && entry.showdownId)
    .map((entry) => [entry.showdownId, entry]));

  rows
    .filter((row) => row.status === 'downloaded' || row.status === 'cached')
    .forEach((row) => byId.set(row.showdownId, manifestEntryFromPlan(row)));

  const manifest = {
    schemaVersion: 1,
    sourcePolicy: 'Local generated PokeAPI sprite cache manifest. Do not commit downloaded icon files.',
    generatedAt: new Date().toISOString(),
    entries: Array.from(byId.values()).sort((a, b) => a.showdownId.localeCompare(b.showdownId)),
  };

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function summarizeRows(rows = []) {
  const summary = {
    planned: 0,
    downloaded: 0,
    cached: 0,
    skipped: 0,
    failed: 0,
    missing: 0,
  };

  rows.forEach((row) => {
    const status = String(row.status || 'skipped');
    if (status === 'planned') summary.planned += 1;
    else if (status === 'downloaded') summary.downloaded += 1;
    else if (status === 'cached') summary.cached += 1;
    else if (status === 'skipped') summary.skipped += 1;
    else if (/missing/.test(status)) summary.missing += 1;
    else if (/error|failed/.test(status)) summary.failed += 1;
    else summary.skipped += 1;
  });

  return summary;
}

function isPokeApiSpriteNotFoundError(row = {}, errorMessage = row.error) {
  const message = String(errorMessage || '');
  return message.startsWith('HTTP 404 for ')
    && String(row.spriteUrl || '').startsWith(POKEAPI_RAW_BASE);
}

function syncRowHasFatalFailure(row = {}) {
  const status = String(row.status || '');
  if (!/error|failed|missing/.test(status)) return false;
  if (/missing/.test(status)) return false;
  if (status === 'download-error' && isPokeApiSpriteNotFoundError(row)) return false;
  return true;
}

async function downloadIcons(rows = [], options = {}) {
  const cacheDir = path.resolve(options.cacheDir || DEFAULT_CACHE_DIR);
  fs.mkdirSync(cacheDir, { recursive: true });

  const results = [];
  for (const row of rows) {
    if (!row.spriteUrl || !row.absoluteIconPath) {
      results.push({ ...row, status: row.status || 'skipped' });
      continue;
    }
    try {
      if (fs.existsSync(row.absoluteIconPath) && !options.force) {
        results.push({ ...row, status: 'cached' });
        continue;
      }
      const buffer = await requestBuffer(row.spriteUrl);
      fs.writeFileSync(row.absoluteIconPath, buffer);
      results.push({ ...row, status: 'downloaded', bytes: buffer.length });
    } catch (error) {
      const status = isPokeApiSpriteNotFoundError(row, error.message)
        ? 'missing-sprite-file'
        : 'download-error';
      results.push({ ...row, status, error: error.message });
    }
  }
  return results;
}

function printRows(rows = [], options = {}) {
  const summary = summarizeRows(rows);
  const output = {
    all: Boolean(options.all),
    dryRun: Boolean(options.dryRun),
    download: Boolean(options.download),
    source: POKEAPI_SPRITE_REPO,
    cacheDir: repoRelativePath(path.resolve(options.cacheDir || DEFAULT_CACHE_DIR)),
    manifestPath: repoRelativePath(path.resolve(options.manifestPath || DEFAULT_LOCAL_MANIFEST_PATH)),
    count: rows.length,
    summary,
    rows: options.summaryOnly ? undefined : rows.map((row) => ({
      input: row.input,
      displayName: row.displayName,
      showdownId: row.showdownId,
      pokeApiName: row.pokeApiName,
      pokeApiId: row.pokeApiId,
      spriteUrl: row.spriteUrl,
      iconPath: row.iconPath,
      status: row.status,
      error: row.error,
    })),
    samples: options.summaryOnly ? rows.slice(0, 12).map((row) => ({
      input: row.input,
      displayName: row.displayName,
      showdownId: row.showdownId,
      pokeApiName: row.pokeApiName,
      pokeApiId: row.pokeApiId,
      iconPath: row.iconPath,
      status: row.status,
    })) : undefined,
    failures: rows
      .filter((row) => /error|missing/.test(String(row.status || '')))
      .slice(0, 25)
      .map((row) => ({
        input: row.input,
        showdownId: row.showdownId,
        pokeApiName: row.pokeApiName,
        status: row.status,
        error: row.error,
      })),
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  let rows = options.all
    ? planPokemonIconSyncFromPokeApiRows(await fetchPokeApiFullList(options), options)
    : planPokemonIconSync(options.names, options);
  if (options.fetchMetadata) rows = await completePlanWithMetadata(rows);

  if (options.download) {
    rows = await downloadIcons(rows, options);
    writeManifest(path.resolve(options.manifestPath), rows);
  }

  printRows(rows, options);
  const failed = rows.some(syncRowHasFatalFailure);
  return failed ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`Pokemon icon sync failed safely: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  SAMPLE_NAMES,
  POKEAPI_NAME_OVERRIDES,
  POKEAPI_ID_OVERRIDES,
  parseArgs,
  displayNameFromPokeApiName,
  showdownIdFromPokeApiName,
  pokeApiIdFromUrl,
  planPokemonIconSync,
  planPokemonIconSyncFromPokeApiRows,
  fetchPokeApiFullList,
  completePlanWithMetadata,
  downloadIcons,
  writeManifest,
  summarizeRows,
  isPokeApiSpriteNotFoundError,
  syncRowHasFatalFailure,
};
