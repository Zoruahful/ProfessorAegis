'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, 'assets', 'pokemon-icons', 'manifest.json');
const DEFAULT_LOCAL_MANIFEST_PATH = path.join(REPO_ROOT, 'assets', 'pokemon-icons', 'manifest.local.json');

const KNOWN_SHOWDOWN_IDS = new Map(Object.entries({
  farigiraf: 'farigiraf',
  zoroarkhisui: 'zoroarkhisui',
  hisuianzoroark: 'zoroarkhisui',
  ogerponwellspring: 'ogerponwellspring',
  calyrexshadow: 'calyrexshadow',
  urshifurapidstrike: 'urshifurapidstrike',
  indeedeef: 'indeedeef',
  nidoranf: 'nidoranf',
  nidoranm: 'nidoranm',
}));

const DISPLAY_NAME_ALIASES = new Map(Object.entries({
  'hisuian zoroark': 'zoroarkhisui',
  'zoroark hisui': 'zoroarkhisui',
  'zoroark-hisui': 'zoroarkhisui',
  'ogerpon wellspring': 'ogerponwellspring',
  'ogerpon-wellspring': 'ogerponwellspring',
  'calyrex shadow': 'calyrexshadow',
  'calyrex-shadow': 'calyrexshadow',
  'urshifu rapid strike': 'urshifurapidstrike',
  'urshifu-rapid-strike': 'urshifurapidstrike',
  'indeedee f': 'indeedeef',
  'indeedee-f': 'indeedeef',
  'nidoran f': 'nidoranf',
  'nidoran-f': 'nidoranf',
  'nidoran female': 'nidoranf',
  'nidoran m': 'nidoranm',
  'nidoran-m': 'nidoranm',
  'nidoran male': 'nidoranm',
}));

let cachedManifestPath = null;
let cachedManifest = null;

function toShowdownId(value = '') {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizePokemonIconLookupName(name = '') {
  return String(name ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s*@\s*.+$/u, '')
    .replace(/\s+\([^)]*\)$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAliasKey(name = '') {
  return normalizePokemonIconLookupName(name)
    .toLowerCase()
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveShowdownSpeciesId(nameOrHeader = '') {
  const normalized = normalizePokemonIconLookupName(nameOrHeader);
  if (!normalized) return null;

  const aliasKey = normalizeAliasKey(normalized);
  if (DISPLAY_NAME_ALIASES.has(aliasKey)) return DISPLAY_NAME_ALIASES.get(aliasKey);

  const showdownId = toShowdownId(normalized);
  if (!showdownId) return null;
  if (KNOWN_SHOWDOWN_IDS.has(showdownId)) return KNOWN_SHOWDOWN_IDS.get(showdownId);

  return showdownId;
}

function normalizeManifestEntry(entry = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const showdownId = resolveShowdownSpeciesId(entry.showdownId || entry.displayName || entry.spriteId);
  if (!showdownId) return null;

  const iconPath = typeof entry.iconPath === 'string' && entry.iconPath.trim()
    ? entry.iconPath.replace(/\\/g, '/').trim()
    : null;

  return {
    displayName: typeof entry.displayName === 'string' ? entry.displayName.trim() : '',
    showdownId,
    spriteId: typeof entry.spriteId === 'string' ? entry.spriteId.trim() : showdownId,
    baseSpecies: typeof entry.baseSpecies === 'string' ? entry.baseSpecies.trim() : '',
    forme: typeof entry.forme === 'string' ? entry.forme.trim() : '',
    nationalDex: Number.isFinite(Number(entry.nationalDex)) ? Number(entry.nationalDex) : null,
    iconPath,
    source: typeof entry.source === 'string' ? entry.source.trim() : '',
    sourceUrl: typeof entry.sourceUrl === 'string' ? entry.sourceUrl.trim() : '',
    lastSyncedAt: typeof entry.lastSyncedAt === 'string' ? entry.lastSyncedAt.trim() : '',
  };
}

function buildManifestIndexes(entries = []) {
  const byShowdownId = new Map();
  const byDisplayName = new Map();

  entries.forEach((entry) => {
    const normalized = normalizeManifestEntry(entry);
    if (!normalized) return;
    byShowdownId.set(normalized.showdownId, normalized);
    if (normalized.displayName) {
      byDisplayName.set(toShowdownId(normalized.displayName), normalized);
      byDisplayName.set(normalizeAliasKey(normalized.displayName), normalized);
    }
  });

  return { byShowdownId, byDisplayName };
}

function emptyManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  return {
    schemaVersion: 1,
    sourcePolicy: 'No icon assets are bundled until owner approval chooses a source and sync policy.',
    manifestPath,
    entries: [],
    byShowdownId: new Map(),
    byDisplayName: new Map(),
    missing: true,
  };
}

function loadPokemonIconManifest(options = {}) {
  const defaultPath = fs.existsSync(DEFAULT_LOCAL_MANIFEST_PATH)
    ? DEFAULT_LOCAL_MANIFEST_PATH
    : DEFAULT_MANIFEST_PATH;
  const manifestPath = path.resolve(options.manifestPath || defaultPath);
  if (!options.forceReload && cachedManifest && cachedManifestPath === manifestPath) return cachedManifest;

  if (!fs.existsSync(manifestPath)) {
    cachedManifestPath = manifestPath;
    cachedManifest = emptyManifest(manifestPath);
    return cachedManifest;
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const indexes = buildManifestIndexes(entries);
    cachedManifestPath = manifestPath;
    cachedManifest = {
      schemaVersion: Number.isFinite(Number(parsed.schemaVersion)) ? Number(parsed.schemaVersion) : 1,
      sourcePolicy: typeof parsed.sourcePolicy === 'string' ? parsed.sourcePolicy : '',
      manifestPath,
      entries: Array.from(indexes.byShowdownId.values()),
      byShowdownId: indexes.byShowdownId,
      byDisplayName: indexes.byDisplayName,
      missing: false,
    };
    return cachedManifest;
  } catch (error) {
    return emptyManifest(manifestPath);
  }
}

function manifestIconEntryToResult(entry, manifestPath = DEFAULT_MANIFEST_PATH) {
  if (!entry || !entry.iconPath) return null;
  const absolutePath = path.resolve(REPO_ROOT, entry.iconPath);
  if (!fs.existsSync(absolutePath)) return null;

  return {
    displayName: entry.displayName || entry.showdownId,
    showdownId: entry.showdownId,
    spriteId: entry.spriteId || entry.showdownId,
    baseSpecies: entry.baseSpecies || '',
    forme: entry.forme || '',
    nationalDex: entry.nationalDex ?? null,
    iconPath: entry.iconPath,
    absolutePath,
    source: entry.source || '',
    sourceUrl: entry.sourceUrl || '',
    lastSyncedAt: entry.lastSyncedAt || '',
    manifestPath,
  };
}

function resolvePokemonIconByShowdownId(showdownId, options = {}) {
  const resolvedId = resolveShowdownSpeciesId(showdownId);
  if (!resolvedId) return null;

  const manifest = loadPokemonIconManifest(options);
  const entry = manifest.byShowdownId.get(resolvedId);
  return manifestIconEntryToResult(entry, manifest.manifestPath);
}

function resolvePokemonIconForDisplayName(displayName, options = {}) {
  const normalized = normalizePokemonIconLookupName(displayName);
  if (!normalized) return null;

  const manifest = loadPokemonIconManifest(options);
  const aliasKey = normalizeAliasKey(normalized);
  const showdownId = resolveShowdownSpeciesId(normalized);
  const entry = manifest.byDisplayName.get(aliasKey)
    || manifest.byDisplayName.get(toShowdownId(normalized))
    || manifest.byShowdownId.get(showdownId);

  return manifestIconEntryToResult(entry, manifest.manifestPath);
}

function resolvePokemonIconsForNames(names = [], options = {}) {
  const values = Array.isArray(names) ? names : [];
  return values.map((name) => ({
    name,
    showdownId: resolveShowdownSpeciesId(name),
    icon: resolvePokemonIconForDisplayName(name, options),
  }));
}

module.exports = {
  DEFAULT_MANIFEST_PATH,
  DEFAULT_LOCAL_MANIFEST_PATH,
  normalizePokemonIconLookupName,
  resolveShowdownSpeciesId,
  loadPokemonIconManifest,
  resolvePokemonIconByShowdownId,
  resolvePokemonIconForDisplayName,
  resolvePokemonIconsForNames,
};
