const crypto = require('crypto');
const https = require('https');
const { URL, URLSearchParams } = require('url');

const DEFAULT_API_BASE = 'https://play.limitlesstcg.com/api';
const DEFAULT_GAME = 'VGC';
const DEFAULT_TARGET_FORMAT_ID = 'gen9championscustomgame';
const DEFAULT_POOL_KEY = 'default';
const DEFAULT_TOURNAMENT_LIMIT = 30;
const DEFAULT_PAGE_LIMIT = 50;
const CHAMPIONLAB_TARGET_COUNTS = Object.freeze({
  topTournament: 271,
  top4Tournament: 545,
  allTournament: 1050,
});
const SYNC_VERSION = 'aegis-limitless-opponent-pool-v1';

function cleanText(value) {
  return String(value || '').trim();
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function integerOrNull(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

function stableId(prefix, parts) {
  const hash = crypto
    .createHash('sha256')
    .update(parts.map((part) => cleanText(part)).join('|'))
    .digest('hex')
    .slice(0, 24);
  return `${prefix}_${hash}`;
}

function hashText(value) {
  const text = cleanText(value);
  return text ? crypto.createHash('sha256').update(text).digest('hex') : null;
}

function uniqueItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const value = cleanText(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function formatAllocationLine(label, values) {
  if (!values || typeof values !== 'object') return null;
  const aliases = [
    ['HP', ['hp', 'HP']],
    ['Atk', ['atk', 'attack', 'ATK']],
    ['Def', ['def', 'defense', 'DEF']],
    ['SpA', ['spa', 'spA', 'specialAttack', 'special_attack', 'satk', 'SPATK']],
    ['SpD', ['spd', 'spD', 'specialDefense', 'special_defense', 'sdef', 'SPDEF']],
    ['Spe', ['spe', 'speed', 'SPE']],
  ];
  const parts = [];
  for (const [stat, keys] of aliases) {
    const raw = keys.map((key) => values[key]).find((candidate) => candidate !== undefined && candidate !== null);
    const amount = integerOrNull(raw);
    if (amount && amount > 0) parts.push(`${amount} ${stat}`);
  }
  return parts.length ? `${label}: ${parts.join(' / ')}` : null;
}

function normalizeMoveList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|,/)
      .map((item) => cleanText(item).replace(/^-\s*/, ''))
      .filter(Boolean);
  }
  return [];
}

function pickFirstObjectValue(source, keys) {
  if (!source || typeof source !== 'object') return null;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && cleanText(source[key])) return source[key];
  }
  return null;
}

function renderPokemonExport(pokemon) {
  if (typeof pokemon === 'string') return cleanText(pokemon);
  if (!pokemon || typeof pokemon !== 'object') return '';

  const species = cleanText(pickFirstObjectValue(pokemon, ['species', 'name', 'pokemon', 'mon']));
  if (!species) return '';

  const nickname = cleanText(pickFirstObjectValue(pokemon, ['nickname', 'displayName']));
  const item = cleanText(pickFirstObjectValue(pokemon, ['item', 'heldItem', 'held_item']));
  const headerName = nickname && lowerText(nickname) !== lowerText(species)
    ? `${nickname} (${species})`
    : species;
  const lines = [item ? `${headerName} @ ${item}` : headerName];

  const ability = cleanText(pickFirstObjectValue(pokemon, ['ability']));
  if (ability) lines.push(`Ability: ${ability}`);

  const level = integerOrNull(pickFirstObjectValue(pokemon, ['level']));
  if (level && level !== 100) lines.push(`Level: ${level}`);

  const teraType = cleanText(pickFirstObjectValue(pokemon, ['teraType', 'tera_type', 'teratype']));
  if (teraType) lines.push(`Tera Type: ${teraType}`);

  const evLine = formatAllocationLine('EVs', pokemon.evs || pokemon.EVs);
  if (evLine) lines.push(evLine);

  const nature = cleanText(pickFirstObjectValue(pokemon, ['nature']));
  if (nature) lines.push(`${nature} Nature`);

  const ivLine = formatAllocationLine('IVs', pokemon.ivs || pokemon.IVs);
  if (ivLine) lines.push(ivLine);

  const moves = uniqueItems([
    ...normalizeMoveList(pokemon.moves),
    ...normalizeMoveList(pokemon.attacks),
  ]);
  for (const move of moves.slice(0, 4)) lines.push(`- ${move}`);

  return lines.join('\n');
}

function extractTeamCandidates(decklist) {
  if (!decklist) return [];
  if (typeof decklist === 'string') return [decklist];
  if (Array.isArray(decklist)) return decklist;
  if (typeof decklist !== 'object') return [];

  const textKeys = [
    'export',
    'teamExport',
    'team_export',
    'showdown',
    'showdownExport',
    'paste',
    'text',
    'raw',
  ];
  for (const key of textKeys) {
    if (typeof decklist[key] === 'string' && cleanText(decklist[key])) return [decklist[key]];
  }

  const listKeys = ['pokemon', 'team', 'teamlist', 'mons', 'decklist'];
  for (const key of listKeys) {
    if (Array.isArray(decklist[key]) && decklist[key].length) return decklist[key];
  }

  return [];
}

function normalizeTeamlistToShowdownExport(decklist) {
  const candidates = extractTeamCandidates(decklist);
  if (!candidates.length) return null;

  if (candidates.length === 1 && typeof candidates[0] === 'string') {
    const text = cleanText(candidates[0]).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return text || null;
  }

  const blocks = candidates
    .map(renderPokemonExport)
    .map((block) => cleanText(block).replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
    .filter(Boolean);
  return blocks.length ? blocks.join('\n\n') : null;
}

function normalizeRecordText(record) {
  if (typeof record === 'string') return cleanText(record) || null;
  if (!record || typeof record !== 'object') return null;
  const wins = integerOrNull(record.wins);
  const losses = integerOrNull(record.losses);
  const ties = integerOrNull(record.ties);
  const parts = [];
  if (wins !== null) parts.push(`${wins}W`);
  if (losses !== null) parts.push(`${losses}L`);
  if (ties !== null && ties > 0) parts.push(`${ties}T`);
  return parts.length ? parts.join('-') : null;
}

function determineSourceTier(placing) {
  const place = integerOrNull(placing);
  if (place === null || place <= 0) return 'limitless';
  if (place <= 4) return 'top-4';
  if (place <= 8) return 'top-8';
  if (place <= 32) return 'tournament';
  return 'meta';
}

function normalizeTournamentRecord(raw, options = {}) {
  const game = cleanText(raw?.game || options.game || DEFAULT_GAME).toLowerCase();
  const formatId = cleanText(options.targetFormatId || DEFAULT_TARGET_FORMAT_ID);
  const tournamentId = cleanText(raw?.id || raw?.tournamentId);
  const sourceUrl = tournamentId ? `https://play.limitlesstcg.com/tournament/${tournamentId}/standings` : null;
  return {
    tournamentId,
    game,
    formatId,
    name: cleanText(raw?.name) || tournamentId,
    tournamentStartDate: cleanText(raw?.date || raw?.startDate) || null,
    players: integerOrNull(raw?.players),
    organizer: cleanText(raw?.organizer?.name || raw?.organizer) || null,
    decklistsPublic: raw?.decklists === true || raw?.decklistsPublic === true,
    online: raw?.isOnline === true || raw?.online === true,
    sourceUrl,
    raw,
  };
}

function normalizeStandingToTeamlist(raw, tournament, options = {}) {
  const decklist = raw?.decklist || raw?.teamlist || raw?.team;
  const normalizedTeamExport = normalizeTeamlistToShowdownExport(decklist);
  if (!normalizedTeamExport) return null;

  const formatId = cleanText(options.targetFormatId || DEFAULT_TARGET_FORMAT_ID);
  const playerId = cleanText(raw?.player || raw?.playerId || raw?.id);
  const playerName = cleanText(raw?.name || raw?.playerName || playerId);
  const placing = integerOrNull(raw?.placing || raw?.place || raw?.rank);
  const teamHash = hashText(normalizedTeamExport);
  const sourceOpponentId = stableId('limitless_opp', [
    tournament?.tournamentId || tournament?.id,
    playerId,
    playerName,
    teamHash,
  ]);

  return {
    sourceOpponentId,
    tournamentId: tournament?.tournamentId || tournament?.id || null,
    game: cleanText(tournament?.game || options.game || DEFAULT_GAME).toLowerCase(),
    formatId,
    playerId: playerId || null,
    playerName: playerName || null,
    playerCountry: cleanText(raw?.country) || null,
    placing,
    recordText: normalizeRecordText(raw?.record),
    dropped: raw?.drop !== null && raw?.drop !== undefined && raw?.drop !== false,
    rawTeamlist: decklist,
    normalizedTeamExport,
    teamHash,
    opponentFingerprint: teamHash,
    archetypeKey: cleanText(raw?.deck?.id || raw?.archetypeKey || raw?.archetype) || null,
    templateKey: cleanText(raw?.deck?.id || raw?.templateKey) || null,
    featured: placing !== null && placing > 0 && placing <= Number(options.featuredCutoff || 8),
    topCut: placing !== null && placing > 0 && placing <= Number(options.topCutoff || 8),
    sourceTier: determineSourceTier(placing),
    sourceUrl: tournament?.sourceUrl || null,
    raw,
  };
}

function applyChampionLabPoolTiers(teamlists, options = {}) {
  const poolTeamLimit = Math.max(1, Number(options.poolTeamLimit || CHAMPIONLAB_TARGET_COUNTS.allTournament));
  const topTournamentLimit = Math.max(0, Number(options.topTournamentLimit || CHAMPIONLAB_TARGET_COUNTS.topTournament));
  const top4TournamentLimit = Math.max(0, Number(options.top4TournamentLimit || CHAMPIONLAB_TARGET_COUNTS.top4Tournament));
  return teamlists.slice(0, poolTeamLimit).map((item, index) => {
    const rank = index + 1;
    const topCut = rank <= topTournamentLimit;
    const featured = rank <= top4TournamentLimit;
    return {
      ...item,
      featured,
      topCut,
      sourceTier: topCut ? 's-tier-top-tournament' : (featured ? 'sa-tier-top4-tournament' : item.sourceTier),
    };
  });
}

function buildPoolSnapshotRecord(teamlists, syncRun, options = {}) {
  const opponentIds = uniqueItems(teamlists.map((item) => item.sourceOpponentId));
  return {
    syncRunId: syncRun.syncRunId,
    formatId: cleanText(options.targetFormatId || DEFAULT_TARGET_FORMAT_ID),
    poolKey: cleanText(options.poolKey || DEFAULT_POOL_KEY),
    label: cleanText(options.label || 'Aegis Limitless Active Opponent Pool'),
    criteria: {
      source: 'limitless',
      game: cleanText(options.game || DEFAULT_GAME),
      sourceFormat: cleanText(options.sourceFormat || options.limitlessFormat || 'all') || 'all',
      tournamentLimit: Number(options.tournamentLimit || DEFAULT_TOURNAMENT_LIMIT),
      poolTeamLimit: Number(options.poolTeamLimit || CHAMPIONLAB_TARGET_COUNTS.allTournament),
      topTournamentLimit: Number(options.topTournamentLimit || CHAMPIONLAB_TARGET_COUNTS.topTournament),
      top4TournamentLimit: Number(options.top4TournamentLimit || CHAMPIONLAB_TARGET_COUNTS.top4Tournament),
      syncVersion: SYNC_VERSION,
    },
    opponentCount: opponentIds.length,
    opponentIds,
    isActive: true,
  };
}

function buildSyncPlan(input = {}, options = {}) {
  const startedAt = cleanText(options.startedAt) || new Date().toISOString();
  const targetFormatId = cleanText(options.targetFormatId || DEFAULT_TARGET_FORMAT_ID);
  const rawTournaments = Array.isArray(input.tournaments) ? input.tournaments : [];
  const standingsByTournamentId = input.standingsByTournamentId || {};
  const tournaments = rawTournaments
    .map((item) => normalizeTournamentRecord(item, { ...options, targetFormatId }))
    .filter((item) => item.tournamentId);

  const teamlists = [];
  for (const tournament of tournaments) {
    const standings = standingsByTournamentId[tournament.tournamentId] || [];
    for (const standing of standings) {
      const record = normalizeStandingToTeamlist(standing, tournament, { ...options, targetFormatId });
      if (record) teamlists.push(record);
    }
  }

  const uniqueByFingerprint = new Map();
  for (const item of teamlists) {
    const key = item.opponentFingerprint || item.sourceOpponentId;
    if (!uniqueByFingerprint.has(key)) uniqueByFingerprint.set(key, item);
  }
  const uniqueTeamlists = applyChampionLabPoolTiers(Array.from(uniqueByFingerprint.values()), options);

  const syncRun = {
    source: 'limitless',
    game: cleanText(options.game || DEFAULT_GAME).toLowerCase(),
    formatId: targetFormatId,
    status: 'completed',
    startedAt,
    completedAt: cleanText(options.completedAt) || new Date().toISOString(),
    tournamentCount: tournaments.length,
    teamCount: uniqueTeamlists.length,
    requestSummary: {
      source: 'limitless-api',
      tournamentCount: tournaments.length,
      teamCount: uniqueTeamlists.length,
      dryRun: options.apply !== true,
    },
    syncVersion: SYNC_VERSION,
  };
  syncRun.syncRunId = stableId('limitless_sync', [
    syncRun.source,
    syncRun.game,
    syncRun.formatId,
    syncRun.startedAt,
    syncRun.syncVersion,
  ]);

  return {
    syncRun,
    tournaments,
    teamlists: uniqueTeamlists.map((item) => ({ ...item, lastSyncRunId: syncRun.syncRunId })),
    snapshot: buildPoolSnapshotRecord(uniqueTeamlists, syncRun, { ...options, targetFormatId }),
  };
}

function requestJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 20000);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Limitless API ${res.statusCode}: ${body.slice(0, 160)}`));
          return;
        }
        try {
          resolve(JSON.parse(body || 'null'));
        } catch (error) {
          reject(new Error(`Limitless API JSON parse failed: ${error.message}`));
        }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Limitless API timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

function buildApiUrl(apiBase, pathname, query = {}) {
  const base = new URL(apiBase || DEFAULT_API_BASE);
  const url = new URL(pathname.replace(/^\//, ''), `${base.toString().replace(/\/$/, '')}/`);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  url.search = params.toString();
  return url.toString();
}

async function fetchLimitlessTournamentData(options = {}) {
  const apiBase = cleanText(options.apiBase || DEFAULT_API_BASE);
  const game = cleanText(options.game || DEFAULT_GAME);
  const sourceFormat = cleanText(options.sourceFormat || options.limitlessFormat);
  const tournamentLimit = Math.max(1, Number(options.tournamentLimit || DEFAULT_TOURNAMENT_LIMIT));
  const pageLimit = Math.max(1, Math.min(Number(options.pageLimit || DEFAULT_PAGE_LIMIT), 200));
  const tournaments = [];
  let page = 1;

  while (tournaments.length < tournamentLimit) {
    const url = buildApiUrl(apiBase, '/tournaments', {
      game,
      format: sourceFormat || undefined,
      limit: pageLimit,
      page,
    });
    const batch = await requestJson(url, options);
    if (!Array.isArray(batch) || !batch.length) break;
    tournaments.push(...batch);
    if (batch.length < pageLimit) break;
    page += 1;
  }

  const selectedTournaments = tournaments.slice(0, tournamentLimit);
  const standingsByTournamentId = {};
  for (const tournament of selectedTournaments) {
    const id = cleanText(tournament?.id);
    if (!id) continue;
    const standingsUrl = buildApiUrl(apiBase, `/tournaments/${id}/standings`);
    const standings = await requestJson(standingsUrl, options);
    standingsByTournamentId[id] = Array.isArray(standings) ? standings : [];
  }

  return { tournaments: selectedTournaments, standingsByTournamentId };
}

async function applySyncPlan(plan, database) {
  if (!database) throw new Error('database helper module is required to apply Limitless sync');
  if (database.initializePostgresIntegration) {
    const status = await database.initializePostgresIntegration();
    if (!status || !status.connected) throw new Error('Postgres is unavailable for Limitless sync apply');
  }
  if (database.ensureBenchmarkLimitlessStorage) await database.ensureBenchmarkLimitlessStorage();

  const syncRun = await database.saveBenchmarkLimitlessSyncRun(plan.syncRun);
  const tournaments = [];
  for (const tournament of plan.tournaments) {
    tournaments.push(await database.saveBenchmarkLimitlessTournament({
      ...tournament,
      lastSyncRunId: syncRun.syncRunId,
    }));
  }
  const teamlists = [];
  for (const teamlist of plan.teamlists) {
    teamlists.push(await database.saveBenchmarkLimitlessTeamlist({
      ...teamlist,
      lastSyncRunId: syncRun.syncRunId,
    }));
  }
  const snapshot = await database.saveBenchmarkOpponentPoolSnapshot({
    ...plan.snapshot,
    syncRunId: syncRun.syncRunId,
    opponentIds: teamlists.map((item) => item.sourceOpponentId),
    opponentCount: teamlists.length,
    isActive: true,
  });
  return { syncRun, tournaments, teamlists, snapshot };
}

async function syncBenchmarkLimitlessOpponentPool(options = {}) {
  const sourceData = options.sourceData || await fetchLimitlessTournamentData(options);
  const plan = buildSyncPlan(sourceData, options);
  const result = {
    ok: true,
    dryRun: options.apply !== true,
    syncRun: plan.syncRun,
    tournaments: plan.tournaments.length,
    teamlists: plan.teamlists.length,
    snapshot: plan.snapshot,
    sampleTeamExport: plan.teamlists[0]?.normalizedTeamExport || null,
    dbWrites: {
      benchmark_limitless_sync_runs: 1,
      benchmark_limitless_tournaments: plan.tournaments.length,
      benchmark_limitless_teamlists: plan.teamlists.length,
      benchmark_opponent_pool_snapshots: plan.snapshot ? 1 : 0,
    },
  };

  if (options.apply === true) {
    const database = options.database || require('./database');
    result.applied = await applySyncPlan(plan, database);
    result.dryRun = false;
  }
  return result;
}

function parseCliArgs(argv) {
  const out = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--dry-run') out.apply = false;
    else if (arg === '--fixture') out.fixture = argv[++index];
    else if (arg === '--target-format') out.targetFormatId = argv[++index];
    else if (arg === '--source-format') out.sourceFormat = argv[++index];
    else if (arg === '--pool-key') out.poolKey = argv[++index];
    else if (arg === '--tournament-limit') out.tournamentLimit = Number(argv[++index]);
    else if (arg === '--pool-team-limit') out.poolTeamLimit = Number(argv[++index]);
    else if (arg === '--top-tournament-limit') out.topTournamentLimit = Number(argv[++index]);
    else if (arg === '--top4-tournament-limit') out.top4TournamentLimit = Number(argv[++index]);
  }
  return out;
}

async function runCli(argv = process.argv.slice(2)) {
  const fs = require('fs');
  const path = require('path');
  const options = parseCliArgs(argv);
  if (options.fixture) {
    const fixturePath = path.resolve(options.fixture);
    options.sourceData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  }
  const result = await syncBenchmarkLimitlessOpponentPool(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_API_BASE,
  DEFAULT_GAME,
  DEFAULT_TARGET_FORMAT_ID,
  DEFAULT_POOL_KEY,
  CHAMPIONLAB_TARGET_COUNTS,
  SYNC_VERSION,
  normalizeTeamlistToShowdownExport,
  normalizeTournamentRecord,
  normalizeStandingToTeamlist,
  buildSyncPlan,
  fetchLimitlessTournamentData,
  syncBenchmarkLimitlessOpponentPool,
};
