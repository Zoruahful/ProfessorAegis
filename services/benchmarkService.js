const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { URL } = require('url');
const analyzer = require('./benchmarkAnalyzer');

const buildWeaknessReportFromTeam = analyzer.buildWeaknessReportFromTeam;
const buildMatchupEvalFromTeam = analyzer.buildMatchupEvalFromTeam || (() => ({}));
const buildSimMatchupScaffold = analyzer.buildSimMatchupScaffold || (() => ({}));
const AEGIS_OPPONENT_SOURCE = 'aegis-limitless-active-opponent-pool';
const CHAMPIONLAB_OPPONENT_SOURCE = 'championslab-public-source';
const DEFAULT_BENCHMARK_FORMAT_ID = 'gen9championscustomgame';
const CHAMPIONS_BENCHMARK_FORMAT_ID = 'gen9championscustomgame';
const PYTHON_COMMAND = process.platform === 'win32' ? 'python' : 'python3';
const MODE_S_TIER_TOP = 's-tier-top-tournament';
const MODE_SA_TIER_TOP4 = 'sa-tier-top4-tournament';
const MODE_ALL_META_TOURNAMENT = 'all-meta-all-tournament';
const MODE_FULL_META_RANDOM_100 = 'full-meta-random-100';
const MODE_GAUNTLET_FULL_META_200 = 'gauntlet-full-meta-200';
const CHAMPIONLAB_TARGET_COUNTS = Object.freeze({
  [MODE_S_TIER_TOP]: 271,
  [MODE_SA_TIER_TOP4]: 545,
  [MODE_ALL_META_TOURNAMENT]: 1050,
  [MODE_FULL_META_RANDOM_100]: 1150,
  [MODE_GAUNTLET_FULL_META_200]: 1250,
});
const CHAMPIONLAB_BENCHMARK_MODES = Object.freeze(Object.keys(CHAMPIONLAB_TARGET_COUNTS));
const BENCHMARK_BATTLE_BUDGET_OPTIONS = Object.freeze([100, 200, 300, 850, 1250]);
const DEFAULT_BENCHMARK_BATTLE_BUDGET = 200;

const DEFAULT_WORKER_MODE = String(process.env.BENCHMARK_WORKER_MODE || 'mock').toLowerCase();
const DEFAULT_WORKER_URL = String(process.env.BENCHMARK_WORKER_URL || 'http://127.0.0.1:8787').trim();
const DEFAULT_TIMEOUT_MS = Number(process.env.BENCHMARK_WORKER_TIMEOUT_MS || 15000);
const SUITE_SUBMIT_TIMEOUT_MS = Number(process.env.BENCHMARK_SUITE_SUBMIT_TIMEOUT_MS || Math.max(DEFAULT_TIMEOUT_MS, 45000));
const JOB_STATUS_TIMEOUT_MS = Number(process.env.BENCHMARK_JOB_STATUS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
const REPORT_FETCH_TIMEOUT_MS = Number(process.env.BENCHMARK_REPORT_FETCH_TIMEOUT_MS || Math.max(DEFAULT_TIMEOUT_MS, 120000));
const LOG_WORKER_REQUESTS = String(process.env.BENCHMARK_LOG_WORKER_REQUESTS || '1').trim() !== '0';

function cleanText(value) {
  return String(value || '').trim();
}

const INSTANT_MODE_PARITY_STATUSES = Object.freeze(['unvalidated', 'calibrating', 'approved']);
const INSTANT_MODE_RESULT_CONTRACT = Object.freeze({
  engineMode: 'instant',
  canonical: false,
  allowedOutputs: Object.freeze(['ephemeral-report-view', 'paper-report-pdf']),
  forbiddenPromotions: Object.freeze(['latest-report-history', 'simulation-archive', 'training-mode', 'confidence-accumulation']),
  eligibility: Object.freeze({
    historyEligible: false,
    archiveEligible: false,
    trainingEligible: false,
    confidenceEligible: false,
    paperReportEligible: true,
  }),
  tempFilePolicy: 'delete-after-discord-attachment-send',
  labelingRule: 'Unapproved Instant Mode output must be labeled projection/estimator output, not canonical Pokemon Showdown simulation.',
});

function buildInstantModePaperReportPayloadFixture(overrides = {}) {
  const generatedAt = overrides.generatedAt || new Date(0).toISOString();
  const wins = Number(overrides.wins ?? 6);
  const losses = Number(overrides.losses ?? 4);
  const gamesPlayed = wins + losses;
  const winRate = Number.isFinite(Number(overrides.winRate))
    ? Number(overrides.winRate)
    : gamesPlayed > 0
      ? Number(((wins / gamesPlayed) * 100).toFixed(2))
      : 0;
  return {
    reportType: 'Instant Projection Report',
    engineMode: 'instant',
    engineVersion: overrides.engineVersion || 'instant-contract-v1',
    canonical: false,
    projectionLabel: 'Instant projection - not canonical Pokemon Showdown',
    generatedAt,
    expiresAt: overrides.expiresAt || new Date(Date.parse(generatedAt) + 15 * 60 * 1000).toISOString(),
    formatId: overrides.formatId || DEFAULT_BENCHMARK_FORMAT_ID,
    benchmarkMode: 'instant-projection',
    winRate,
    wins,
    losses,
    ties: 0,
    totalGamesCompleted: gamesPlayed,
    averageTurns: Number(overrides.averageTurns ?? 8.5),
    confidence: {
      label: overrides.confidence || 'Low',
      parityStatus: overrides.parityStatus || 'unvalidated',
      parityScore: Number(overrides.parityScore ?? 0),
    },
    warnings: Array.isArray(overrides.warnings)
      ? overrides.warnings
      : ['Instant projection is not canonical Pokemon Showdown output.'],
    knownLimitations: Array.isArray(overrides.knownLimitations)
      ? overrides.knownLimitations
      : ['Mechanics coverage must be calibrated before this can be treated as approved guidance.'],
    showdownDelta: overrides.showdownDelta || {
      status: 'unvalidated',
      note: 'No parity harness comparison has been run for this fixture.',
    },
    compactSummary: {
      reportType: 'Instant Projection Report',
      benchmarkMode: 'instant-projection',
      benchmarkModeLabel: 'Instant Projection',
      formatId: overrides.formatId || DEFAULT_BENCHMARK_FORMAT_ID,
      winRate,
      wins,
      losses,
      ties: 0,
      totalGamesCompleted: gamesPlayed,
      averageTurns: Number(overrides.averageTurns ?? 8.5),
      confidenceLabel: overrides.confidence || 'Low',
      takeaway: 'Instant Mode estimates a one-time scouting snapshot without saving history, archives, training data, or confidence memory.',
      sourceFields: {
        summary: 'instant-mode-contract-fixture',
        archetypeRows: 'instant.archetypeBreakdown',
        opponentRows: 'instant.archetypeBreakdown',
        threatRows: 'instant.threats',
        leadRows: 'instant.leads',
        coreRows: null,
      },
      goodMatchups: [
        { name: 'Rain Balance', archetypeLabel: 'Rain Balance', wins: 4, losses: 1, ties: 0, gamesPlayed: 5, winRate: 80, confidence: 'Low' },
      ],
      neutralMatchups: [
        { name: 'Bulky Balance', archetypeLabel: 'Bulky Balance', wins: 2, losses: 2, ties: 0, gamesPlayed: 4, winRate: 50, confidence: 'Low' },
      ],
      dangerMatchups: [
        { name: 'Hard Trick Room', archetypeLabel: 'Hard Trick Room', wins: 0, losses: 1, ties: 0, gamesPlayed: 1, winRate: 0, confidence: 'Low' },
      ],
      bestLeadPairs: [
        {
          rank: 1,
          pair: [{ species: 'Farigiraf' }, { species: 'Pelipper' }],
          label: 'Farigiraf + Pelipper',
          wins: 3,
          losses: 1,
          ties: 0,
          gamesPlayed: 4,
          winRate: 75,
          confidence: 'Low',
          matchupGuide: [
            { archetypeLabel: 'Rain Balance', wins: 2, losses: 0, gamesPlayed: 2, winRate: 100, recommendation: 'use', confidence: 'Low' },
          ],
        },
      ],
    },
    resultsByTemplate: [
      { name: 'Rain Balance', archetypeLabel: 'Rain Balance', wins: 4, losses: 1, ties: 0, gamesPlayed: 5, winRate: 80, confidence: 'Low' },
      { name: 'Bulky Balance', archetypeLabel: 'Bulky Balance', wins: 2, losses: 2, ties: 0, gamesPlayed: 4, winRate: 50, confidence: 'Low' },
      { name: 'Hard Trick Room', archetypeLabel: 'Hard Trick Room', wins: 0, losses: 1, ties: 0, gamesPlayed: 1, winRate: 0, confidence: 'Low' },
    ],
    pokemonThreats: [
      { species: 'Calyrex-Shadow', lossRate: 100, gamesPlayed: 1, losses: 1, wins: 0, confidence: 'Low' },
    ],
    teamPreview: overrides.teamPreview || ['Instant Test Team', 'Farigiraf @ Colbur Berry', 'Pelipper @ Focus Sash'],
  };
}

function buildInstantModeResultFixture(overrides = {}) {
  const generatedAt = overrides.generatedAt || new Date(0).toISOString();
  const paperReportPayload = overrides.paperReportPayload || buildInstantModePaperReportPayloadFixture({
    ...overrides,
    generatedAt,
  });
  const warnings = Array.isArray(overrides.warnings)
    ? overrides.warnings
    : ['Instant Mode is projection/estimator output until parity is approved.'];
  const knownLimitations = Array.isArray(overrides.knownLimitations)
    ? overrides.knownLimitations
    : ['No Pokemon Showdown replay artifacts are produced by Instant Mode.'];
  const parityStatus = INSTANT_MODE_PARITY_STATUSES.includes(String(overrides.parityStatus || '').toLowerCase())
    ? String(overrides.parityStatus).toLowerCase()
    : 'unvalidated';
  return {
    engineMode: 'instant',
    engineVersion: overrides.engineVersion || 'instant-contract-v1',
    canonical: false,
    confidence: overrides.confidence || { label: 'Low', reason: 'Contract fixture only; parity harness not run.' },
    parityStatus,
    parityScore: Number(overrides.parityScore ?? 0),
    mechanicsCoverage: overrides.mechanicsCoverage || { status: 'unvalidated', covered: [], missing: ['full-showdown-parity'] },
    knownLimitations,
    showdownDelta: overrides.showdownDelta || { status: 'unvalidated', note: 'No canonical Showdown comparison has been run.' },
    warnings,
    winRate: Number(paperReportPayload.winRate ?? 0),
    archetypeBreakdown: paperReportPayload.resultsByTemplate,
    threats: paperReportPayload.pokemonThreats,
    leads: paperReportPayload.compactSummary?.bestLeadPairs || [],
    paperReportPayload,
    generatedAt,
    expiresAt: overrides.expiresAt || paperReportPayload.expiresAt,
    historyEligible: false,
    archiveEligible: false,
    trainingEligible: false,
    confidenceEligible: false,
    paperReportEligible: true,
  };
}

function logWorkerRequest(event, payload = {}) {
  if (!LOG_WORKER_REQUESTS) return;
  try {
    console.log('[benchmark-service] ' + JSON.stringify({ event, ts: new Date().toISOString(), ...payload }));
  } catch {
    console.log('[benchmark-service] ' + event);
  }
}

const BENCHMARK_MODE_CATALOG = [
  {
    mode: MODE_S_TIER_TOP,
    label: 'S-Tier + Top Tournament',
    description: 'Use ChampionsLab S-tier curated teams plus top 2 tournament finishes.',
    source: CHAMPIONLAB_OPPONENT_SOURCE,
  },
  {
    mode: MODE_SA_TIER_TOP4,
    label: 'S/A Tier + Top 4 Tournament',
    description: 'Use ChampionsLab S/A curated teams plus top 4 tournament finishes.',
    source: CHAMPIONLAB_OPPONENT_SOURCE,
  },
  {
    mode: MODE_ALL_META_TOURNAMENT,
    label: 'All Meta + All Tournament',
    description: 'Use ChampionsLab curated meta teams plus all tournament teams.',
    source: CHAMPIONLAB_OPPONENT_SOURCE,
  },
  {
    mode: MODE_FULL_META_RANDOM_100,
    label: 'Full Meta + 100 Random',
    description: 'Use ChampionsLab full meta pool plus 100 generated random teams.',
    source: CHAMPIONLAB_OPPONENT_SOURCE,
  },
  {
    mode: MODE_GAUNTLET_FULL_META_200,
    label: 'GAUNTLET - Full Meta + 200 Random',
    description: 'Use ChampionsLab full meta pool plus 200 generated random teams.',
    source: CHAMPIONLAB_OPPONENT_SOURCE,
  },
  {
    mode: 'custom-only',
    label: 'Custom only',
    description: 'Use only the hand-picked Professor Aegis custom opponents.',
    source: 'professor-aegis-custom',
  },
];

function normalizeBenchmarkMode(value = null) {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = {
    'featured-only': MODE_S_TIER_TOP,
    'random-sample': MODE_FULL_META_RANDOM_100,
    'full-reg': MODE_ALL_META_TOURNAMENT,
    's-tier + top tournament': MODE_S_TIER_TOP,
    's/a tier + top 4 tournament': MODE_SA_TIER_TOP4,
    'all meta + all tournament': MODE_ALL_META_TOURNAMENT,
    'full meta + 100 random': MODE_FULL_META_RANDOM_100,
    'gauntlet - full meta + 200 random': MODE_GAUNTLET_FULL_META_200,
  };
  const normalized = aliases[raw] || raw;
  if (CHAMPIONLAB_BENCHMARK_MODES.includes(normalized)) return normalized;
  if (normalized === 'custom-only' && isBenchmarkCustomOnlyModeEnabled()) return normalized;
  return MODE_ALL_META_TOURNAMENT;
}

function isBenchmarkCustomOnlyModeEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.BENCHMARK_ENABLE_CUSTOM_ONLY_MODE || '0').trim().toLowerCase());
}

function isBenchmarkFullPoolMode(value = null) {
  const mode = normalizeBenchmarkMode(value);
  return mode === MODE_ALL_META_TOURNAMENT
    || mode === MODE_FULL_META_RANDOM_100
    || mode === MODE_GAUNTLET_FULL_META_200;
}

function isChampionLabFixedPoolMode(value = null) {
  return Boolean(CHAMPIONLAB_TARGET_COUNTS[normalizeBenchmarkMode(value)]);
}

function getBenchmarkRegFromFormatId(formatId = null) {
  const explicit = String(process.env.BENCHMARK_REPO_DEFAULT_REG || 'i').trim().toLowerCase() || 'i';
  const mapping = {
    gen9benchmarkdoublesag: 'i',
    gen9championscustomgame: 'i',
    gen9vgc2026regi: 'i',
    gen9vgc2025regh: 'h',
    gen9vgc2024regg: 'g',
    gen9vgc2024regf: 'f',
    gen9vgc2024rege: 'e',
  };
  return mapping[String(formatId || '').trim().toLowerCase()] || explicit;
}

function getBenchmarkRepoRoot() {
  const override = String(process.env.BENCHMARK_REPO_VGC_BENCH_DIR || '').trim();
  return override || null;
}

function normalizeBenchmarkFormatId(formatId = null) {
  return cleanText(formatId) || DEFAULT_BENCHMARK_FORMAT_ID;
}

function isChampionBenchmarkFormat(formatId = null) {
  return String(formatId || DEFAULT_BENCHMARK_FORMAT_ID).trim().toLowerCase() === CHAMPIONS_BENCHMARK_FORMAT_ID;
}

function normalizeBenchmarkSuiteGamesPerOpponent(value = 1, formatId = null) {
  if (isChampionBenchmarkFormat(formatId)) return 1;
  const parsed = Number(value);
  return parsed === 3 ? 3 : 1;
}

function normalizeBenchmarkBattleBudget(value = null) {
  const parsed = Number(value);
  return BENCHMARK_BATTLE_BUDGET_OPTIONS.includes(parsed)
    ? parsed
    : DEFAULT_BENCHMARK_BATTLE_BUDGET;
}

function getAllocatedGamesPerOpponent(selectedCount = 0, battleBudget = DEFAULT_BENCHMARK_BATTLE_BUDGET) {
  const opponents = Math.max(Number(selectedCount) || 0, 0);
  const budget = normalizeBenchmarkBattleBudget(battleBudget);
  if (opponents <= 0) return 1;
  return Math.max(1, Math.floor(budget / opponents));
}

function getExpectedTotalGames(selectedCount = 0, battleBudget = DEFAULT_BENCHMARK_BATTLE_BUDGET) {
  const opponents = Math.max(Number(selectedCount) || 0, 0);
  if (opponents <= 0) return 0;
  return opponents * getAllocatedGamesPerOpponent(opponents, battleBudget);
}

function countBenchmarkRepoTeams(formatId = null) {
  return countBenchmarkAegisOpponentPoolTeamsSync(normalizeBenchmarkFormatId(formatId));
}

function countBenchmarkAegisExecutableOpponentPoolTeamsSync(formatId = null) {
  const safeFormatId = String(formatId || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const pythonCode = `
import json
import sys
sys.path.insert(0, 'services')
from benchmark_repo_teams import get_repo_summary
summary = get_repo_summary(format_id='${safeFormatId}')
print(json.dumps({
    'source': summary.get('source'),
    'teamCount': summary.get('teamCount') or 0,
    'featuredCount': summary.get('featuredCount') or 0,
    'snapshot': None,
}))
`;
  try {
    const result = spawnSync(PYTHON_COMMAND, ['-c', pythonCode], {
      cwd: path.join(__dirname, '..'),
      env: process.env,
      encoding: 'utf8',
      timeout: 12000,
      windowsHide: true,
    });
    if (result.status !== 0) return null;
    const parsed = JSON.parse(String(result.stdout || '').trim() || '{}');
    return {
      source: cleanText(parsed.source) || AEGIS_OPPONENT_SOURCE,
      teamCount: Number.isFinite(Number(parsed.teamCount)) ? Number(parsed.teamCount) : 0,
      featuredCount: Number.isFinite(Number(parsed.featuredCount)) ? Number(parsed.featuredCount) : 0,
      snapshot: parsed.snapshot || null,
    };
  } catch {
    return null;
  }
}

async function countBenchmarkAegisOpponentPoolTeams(formatId = null, poolKey = 'default') {
  try {
    const originalConsoleLog = console.log;
    let database;
    try {
      console.log = () => {};
      database = require('./database');
    } finally {
      console.log = originalConsoleLog;
    }
    const pool = await database.getActiveBenchmarkLimitlessOpponentPool({
      formatId,
      poolKey: poolKey || 'default',
    });
    const opponents = Array.isArray(pool?.opponents) ? pool.opponents : [];
    const featuredCount = opponents.filter((item) => item?.featured === true || item?.topCut === true).length;
    const topCutCount = opponents.filter((item) => item?.topCut === true).length;
    return {
      source: AEGIS_OPPONENT_SOURCE,
      teamCount: opponents.length,
      featuredCount,
      topCutCount,
      snapshot: pool?.snapshot || null,
    };
  } catch (error) {
    return {
      source: AEGIS_OPPONENT_SOURCE,
      teamCount: 0,
      featuredCount: 0,
      topCutCount: 0,
      snapshot: null,
      error: error?.message || String(error),
    };
  }
}

function countBenchmarkAegisOpponentPoolTeamsSync(formatId = null, poolKey = 'default') {
  const executableSummary = countBenchmarkAegisExecutableOpponentPoolTeamsSync(formatId);
  if (executableSummary) return executableSummary;

  const nodeCode = `
const originalConsoleLog = console.log;
console.log = () => {};
const database = require('./services/database');
console.log = originalConsoleLog;
(async () => {
  const status = await database.initializePostgresIntegration();
  if (!status || !status.connected) {
    process.stdout.write(JSON.stringify({ source: '${AEGIS_OPPONENT_SOURCE}', teamCount: 0, featuredCount: 0, snapshot: null }));
    return;
  }
  const pool = await database.getActiveBenchmarkLimitlessOpponentPool({
    formatId: process.env.AEGIS_LIMITLESS_FORMAT_ID || '',
    poolKey: process.env.AEGIS_LIMITLESS_POOL_KEY || 'default',
  });
  const opponents = Array.isArray(pool && pool.opponents) ? pool.opponents : [];
  const featuredCount = opponents.filter((item) => item && (item.featured === true || item.topCut === true)).length;
  const topCutCount = opponents.filter((item) => item && item.topCut === true).length;
  process.stdout.write(JSON.stringify({
    source: '${AEGIS_OPPONENT_SOURCE}',
    teamCount: opponents.length,
    featuredCount,
    topCutCount,
    snapshot: pool && pool.snapshot ? pool.snapshot : null,
  }));
})()
  .catch(() => {
    process.stdout.write(JSON.stringify({ source: '${AEGIS_OPPONENT_SOURCE}', teamCount: 0, featuredCount: 0, topCutCount: 0, snapshot: null }));
  })
  .finally(async () => {
    const pool = database.getPostgresPool && database.getPostgresPool();
    if (pool && pool.end) await pool.end().catch(() => {});
  });
`;
  try {
    const result = spawnSync(process.execPath, ['-e', nodeCode], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        AEGIS_LIMITLESS_FORMAT_ID: String(formatId || ''),
        AEGIS_LIMITLESS_POOL_KEY: String(poolKey || 'default'),
      },
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    });
    const parsed = JSON.parse(String(result.stdout || '').trim() || '{}');
    return {
      source: AEGIS_OPPONENT_SOURCE,
      teamCount: Number.isFinite(Number(parsed.teamCount)) ? Number(parsed.teamCount) : 0,
      featuredCount: Number.isFinite(Number(parsed.featuredCount)) ? Number(parsed.featuredCount) : 0,
      snapshot: parsed.snapshot || null,
    };
  } catch {
    return {
      source: AEGIS_OPPONENT_SOURCE,
      teamCount: 0,
      featuredCount: 0,
      snapshot: null,
    };
  }
}

function countCustomBenchmarkOpponents(formatId = null) {
  if (!isBenchmarkCustomOnlyModeEnabled()) return 0;
  const targetFormat = String(formatId || '').trim().toLowerCase();
  const opponentPath = path.join(__dirname, 'benchmark_opponents.py');
  let text = '';
  try {
    text = fs.readFileSync(opponentPath, 'utf8');
  } catch {
    return null;
  }
  const blocks = text.match(/\{\s*"id":/g) || [];
  if (!targetFormat) return blocks.length;
  const formatMatches = text.match(/"formatId":\s*"([^"]*)"/g) || [];
  return formatMatches.filter((entry) => {
    const match = entry.match(/"formatId":\s*"([^"]*)"/);
    const value = String(match?.[1] || '').trim().toLowerCase();
    return !value || value === targetFormat;
  }).length;
}

function getChampionLabTargetCount(mode = null) {
  return CHAMPIONLAB_TARGET_COUNTS[normalizeBenchmarkMode(mode)] || null;
}

function getExecutableChampionLabModeCount(mode = null, teamCount = 0) {
  const target = getChampionLabTargetCount(mode);
  const executableCount = Number.isFinite(Number(teamCount)) ? Math.max(Number(teamCount), 0) : 0;
  return target ? Math.min(target, executableCount) : executableCount;
}

function getChampionLabRecommendedSizes(mode = null, teamCount = 0) {
  const count = getExecutableChampionLabModeCount(mode, teamCount);
  return count ? [count] : [];
}

function buildDynamicBenchmarkModeCatalog(formatId = null) {
  const { teamCount } = countBenchmarkRepoTeams(formatId);
  const customOnlyEnabled = isBenchmarkCustomOnlyModeEnabled();
  const customCount = customOnlyEnabled ? countCustomBenchmarkOpponents(formatId) : 0;
  const customSizes = [1, 2, 4].filter((size) => Number.isFinite(customCount) && size <= customCount);

  return BENCHMARK_MODE_CATALOG
    .filter((entry) => entry.mode !== 'custom-only' || customOnlyEnabled)
    .map((entry) => {
      if (CHAMPIONLAB_TARGET_COUNTS[entry.mode]) {
        return {
          ...entry,
          targetOpponentCount: getChampionLabTargetCount(entry.mode),
          availableOpponents: getExecutableChampionLabModeCount(entry.mode, teamCount),
          recommendedSizes: getChampionLabRecommendedSizes(entry.mode, teamCount),
        };
      }
      if (entry.mode === 'custom-only' && Number.isFinite(customCount)) {
        return {
          ...entry,
          availableOpponents: customCount,
          recommendedSizes: customSizes.length ? customSizes : (customCount ? [customCount] : []),
        };
      }
      return { ...entry };
    });
}

const mockJobs = new Map();
let mockJobCounter = 1;

function getBenchMarkWorkerConfig() {
  return {
    mode: DEFAULT_WORKER_MODE === 'http' ? 'http' : 'mock',
    url: DEFAULT_WORKER_URL,
    timeoutMs: Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0 ? DEFAULT_TIMEOUT_MS : 15000,
  };
}

function buildMockJobId() {
  return `mock-job-${Date.now()}-${mockJobCounter++}`;
}

function createMockJob(jobType, userId) {
  const jobId = buildMockJobId();
  const now = new Date().toISOString();
  const job = {
    jobId,
    userId,
    jobType,
    status: 'queued',
    submittedAt: now,
    startedAt: null,
    completedAt: null,
    error: null,
    report: null,
  };
  mockJobs.set(jobId, job);
  return job;
}

function finalizeMockJob(jobId, buildReport) {
  setTimeout(() => {
    const current = mockJobs.get(jobId);
    if (!current || current.status !== 'queued') return;
    current.status = 'running';
    current.startedAt = new Date().toISOString();
  }, 250);

  setTimeout(() => {
    const current = mockJobs.get(jobId);
    if (!current || (current.status !== 'queued' && current.status !== 'running')) return;
    try {
      current.status = 'completed';
      current.completedAt = new Date().toISOString();
      current.report = buildReport();
    } catch (error) {
      current.status = 'failed';
      current.completedAt = new Date().toISOString();
      current.error = error?.message || 'Mock BenchMark worker failed.';
    }
  }, 2000);
}

function getMockJobStatus(jobId) {
  const job = mockJobs.get(String(jobId || ''));
  if (!job) {
    return {
      ok: false,
      mode: 'mock',
      status: 'missing',
      error: 'BenchMark job was not found.',
    };
  }
  return {
    ok: true,
    mode: 'mock',
    jobId: job.jobId,
    jobType: job.jobType,
    status: job.status,
    submittedAt: job.submittedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    report: job.report,
  };
}

function requestJson(method, targetUrl, body = null, options = {}) {
  return new Promise((resolve, reject) => {
    const requestStartedAt = Date.now();
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const config = getBenchMarkWorkerConfig();

    const timeoutMs = Number.isFinite(Number(options?.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : config.timeoutMs;

    logWorkerRequest('request_started', {
      method,
      path: `${parsed.pathname}${parsed.search}`,
      timeoutMs,
      mode: config.mode,
    });

    const req = client.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;

          try {
            json = raw ? JSON.parse(raw) : {};
          } catch {
            reject(new Error(`BenchMark worker returned invalid JSON with status ${res.statusCode}.`));
            return;
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            logWorkerRequest('request_failed_status', {
              method,
              path: `${parsed.pathname}${parsed.search}`,
              statusCode: res.statusCode,
              durationMs: Date.now() - requestStartedAt,
              workerJobId: json?.jobId || null,
              workerStatus: json?.status || null,
            });
            const message = json?.error || `BenchMark worker request failed with status ${res.statusCode}.`;
            const error = new Error(message);
            error.statusCode = res.statusCode;
            error.payload = json;
            reject(error);
            return;
          }

          logWorkerRequest('request_completed', {
            method,
            path: `${parsed.pathname}${parsed.search}`,
            statusCode: res.statusCode,
            durationMs: Date.now() - requestStartedAt,
            workerJobId: json?.jobId || null,
            workerStatus: json?.status || null,
          });
          resolve(json);
        });
      },
    );

    req.on('timeout', () => {
      logWorkerRequest('request_timeout', {
        method,
        path: `${parsed.pathname}${parsed.search}`,
        durationMs: Date.now() - requestStartedAt,
        timeoutMs,
      });
      req.destroy(new Error(`BenchMark worker request timed out after ${timeoutMs} ms.`));
    });
    req.on('error', (error) => {
      logWorkerRequest('request_error', {
        method,
        path: `${parsed.pathname}${parsed.search}`,
        durationMs: Date.now() - requestStartedAt,
        error: error?.message || String(error),
      });
      reject(error);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function buildMockBenchmarkSuiteReport({
  mode = MODE_ALL_META_TOURNAMENT,
  sampleSize = null,
  battleBudget = DEFAULT_BENCHMARK_BATTLE_BUDGET,
  gamesPerOpponent = 3,
  formatId = null,
}) {
  const normalizedBattleBudget = normalizeBenchmarkBattleBudget(battleBudget);
  const selectedCount = Number(sampleSize || 0);
  const allocatedGamesPerOpponent = getAllocatedGamesPerOpponent(selectedCount, normalizedBattleBudget);
  const expectedTotalGames = getExpectedTotalGames(selectedCount, normalizedBattleBudget);
  return {
    reportType: 'Mock Benchmark Suite Report',
    benchmarkMode: mode,
    selectionSummary: {
      mode,
      requestedSampleSize: sampleSize,
      sampleSizeIgnored: isChampionLabFixedPoolMode(mode),
      selectionSeed: null,
      selectedCount,
      availableOpponents: selectedCount,
      battleBudget: normalizedBattleBudget,
      battlesPerMatchup: normalizedBattleBudget,
      battleBudgetAllocationRule: 'championslab-min-one-per-opponent-floor-budget',
      allocatedGamesPerOpponent,
      expectedTotalGames,
    },
    formatId,
    battleBudget: normalizedBattleBudget,
    battlesPerMatchup: normalizedBattleBudget,
    battleBudgetAllocationRule: 'championslab-min-one-per-opponent-floor-budget',
    gamesPerOpponent: allocatedGamesPerOpponent,
    opponentsRequested: selectedCount,
    opponentsCompleted: selectedCount,
    totalGamesRequested: expectedTotalGames,
    totalGamesCompleted: expectedTotalGames,
    wins: 0,
    losses: 0,
    ties: 0,
    winRate: 0,
    averageTurns: 0,
    completedOk: true,
    noteText: 'Mock fallback does not run real battles.',
    generatedAt: new Date().toISOString(),
  };
}

function listBenchmarkModes(workerModes = null, options = {}) {
  const formatId = normalizeBenchmarkFormatId(typeof workerModes === 'string' ? workerModes : options?.formatId);
  const dynamicCatalog = buildDynamicBenchmarkModeCatalog(formatId);
  const staticByMode = new Map(dynamicCatalog.map((entry) => [entry.mode, entry]));
  const sourceModes = Array.isArray(workerModes) && workerModes.length
    ? workerModes
    : dynamicCatalog;

  return sourceModes
    .filter((entry) => entry && entry.mode)
    .map((entry) => ({
      ...(staticByMode.get(entry.mode) || {}),
      ...entry,
    }));
}

function toTitleWords(value) {
  return String(value || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function humanizeTemplateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown template';
  return toTitleWords(raw);
}

function humanizeBenchmarkMode(value) {
  const raw = normalizeBenchmarkMode(value);
  if (!raw) return 'Unknown';
  const aliases = {
    [MODE_S_TIER_TOP]: 'S-Tier + Top Tournament',
    [MODE_SA_TIER_TOP4]: 'S/A Tier + Top 4 Tournament',
    [MODE_ALL_META_TOURNAMENT]: 'All Meta + All Tournament',
    [MODE_FULL_META_RANDOM_100]: 'Full Meta + 100 Random',
    [MODE_GAUNTLET_FULL_META_200]: 'GAUNTLET - Full Meta + 200 Random',
    'custom-only': 'Custom Only',
  };
  return aliases[raw] || toTitleWords(raw);
}

function formatDiscordTimestampFromIso(isoString, style = 'F') {
  const millis = Date.parse(String(isoString || ''));
  if (!Number.isFinite(millis)) return null;
  return `<t:${Math.floor(millis / 1000)}:${style}>`;
}

function humanizeOpponentName(item = {}) {
  const rawName = String(item.opponentName || item.name || item.opponentId || 'Unknown opponent').trim();
  const templateLabel = humanizeTemplateKey(item.templateKey || '');
  const featuredMatch = rawName.match(/^Featured\s*[–-]\s*(.+)$/i);
  if (featuredMatch) {
    return `Featured Team ${featuredMatch[1]}${templateLabel ? ` (${templateLabel})` : ''}`;
  }
  return rawName;
}

function buildBenchmarkSuiteTakeaway({ winRate = 0, goodMatchups = [], dangerMatchups = [] } = {}) {
  const best = Array.isArray(goodMatchups) && goodMatchups.length ? goodMatchups[0].templateLabel : null;
  const worst = Array.isArray(dangerMatchups) && dangerMatchups.length ? dangerMatchups[0].templateLabel : null;
  const overall = `${Math.round(Number(winRate || 0))}% overall`;

  if (best && worst) {
    return `Best into ${best}. Biggest danger: ${worst}. ${overall}.`;
  }
  if (worst) {
    return `Biggest danger: ${worst}. ${overall}.`;
  }
  if (best) {
    return `Best into ${best}. ${overall}.`;
  }
  return overall;
}

function formatWinChanceValue(value) {
  return `${Math.round(Number(value || 0))}%`;
}

function getConfidenceLabel(gamesPlayed = 0) {
  const games = Number(gamesPlayed || 0);
  if (games >= 10) return 'High';
  if (games >= 5) return 'Medium';
  return 'Low';
}

function formatAnalysisPercent(value = 0) {
  const parsed = Number(value);
  return `${Math.round(Number.isFinite(parsed) ? parsed : 0)}%`;
}

function formatAnalysisRecord(item = {}) {
  return `${Number(item.wins || 0)}-${Number(item.losses || 0)}-${Number(item.ties || 0)}`;
}

function analysisMatchupLabel(item = {}) {
  return item.templateLabel || humanizeTemplateKey(item.templateKey || item.name || '') || 'Unknown matchup';
}

function analysisThreatName(item = {}) {
  return item.pokemon || item.species || item.name || 'Unknown threat';
}

function buildDeterministicReportAnalyzer(summary = {}) {
  const dangerMatchups = Array.isArray(summary.dangerMatchups) ? summary.dangerMatchups : [];
  const neutralMatchups = Array.isArray(summary.neutralMatchups) ? summary.neutralMatchups : [];
  const goodMatchups = Array.isArray(summary.goodMatchups) ? summary.goodMatchups : [];
  const pokemonThreats = Array.isArray(summary.pokemonThreats) ? summary.pokemonThreats : [];
  const topDanger = [...dangerMatchups, ...neutralMatchups.filter((item) => Number(item.winRate || 0) < 50)]
    .sort((a, b) => (
      Number(a.winRate || 0) - Number(b.winRate || 0)
      || Number(b.gamesPlayed || 0) - Number(a.gamesPlayed || 0)
      || analysisMatchupLabel(a).localeCompare(analysisMatchupLabel(b))
    ))[0] || null;
  const topThreat = pokemonThreats
    .slice()
    .sort((a, b) => (
      Number(b.lossRate || 0) - Number(a.lossRate || 0)
      || Number(b.gamesPlayed || 0) - Number(a.gamesPlayed || 0)
      || analysisThreatName(a).localeCompare(analysisThreatName(b))
    ))[0] || null;
  const bestMatchup = goodMatchups
    .slice()
    .sort((a, b) => (
      Number(b.winRate || 0) - Number(a.winRate || 0)
      || Number(b.gamesPlayed || 0) - Number(a.gamesPlayed || 0)
      || analysisMatchupLabel(a).localeCompare(analysisMatchupLabel(b))
    ))[0] || null;

  const weaknessLines = [];
  if (topDanger) {
    const label = analysisMatchupLabel(topDanger);
    const rate = formatAnalysisPercent(topDanger.winRate);
    const prefix = Number(topDanger.winRate || 0) <= 25 ? 'Hard counter' : 'Struggles vs';
    weaknessLines.push(`- ${prefix}: ${label} (${rate})`);
  }
  if (topThreat) {
    const threatLabel = Number(topThreat.lossRate || 0) >= 75 ? 'severe threat' : 'pressure point';
    weaknessLines.push(`- ${analysisThreatName(topThreat)} is a ${threatLabel} (${formatAnalysisPercent(topThreat.lossRate)} loss rate when faced)`);
  }
  if (!weaknessLines.length) {
    weaknessLines.push('- Limited data: run more games before treating weaknesses as final');
  }

  const strategyTipLines = [];
  if (topDanger) {
    strategyTipLines.push(`- Practice first into ${analysisMatchupLabel(topDanger)}.`);
    strategyTipLines.push(`- Bring a safer lead plan for ${analysisMatchupLabel(topDanger)}.`);
  }
  if (topThreat) {
    strategyTipLines.push(`- Keep a clear answer ready for ${analysisThreatName(topThreat)}.`);
  }
  if (bestMatchup) {
    strategyTipLines.push(`- Use ${analysisMatchupLabel(bestMatchup)} as your comfort matchup.`);
  }
  if (!strategyTipLines.length) {
    strategyTipLines.push('- Collect more games before changing the team.');
  }

  const improvementProposals = [];
  if (topThreat) {
    improvementProposals.push(`Add or practice a concrete answer to ${analysisThreatName(topThreat)} if it appears on preview.`);
  }
  if (topDanger) {
    improvementProposals.push(`Replay losses into ${analysisMatchupLabel(topDanger)} and script the first three turns.`);
  }
  if (!improvementProposals.length) {
    improvementProposals.push('Collect more matchup data before making major team changes.');
  }

  return {
    source: 'compactSummary.deterministicAnalysis',
    weaknesses: weaknessLines.slice(0, 4),
    strategyTips: strategyTipLines.slice(0, 4),
    improvementProposals: improvementProposals.slice(0, 2),
  };
}

function parsePokemonSpeciesFromHeader(headerLine = '') {
  const raw = String(headerLine || '').split(' @ ')[0].trim();
  if (!raw) return null;
  const match = raw.match(/\(([^()]+)\)\s*$/);
  if (match) {
    const inside = String(match[1] || '').trim();
    if (inside && !['m', 'f'].includes(inside.toLowerCase())) return inside;
    return raw.slice(0, match.index).trim() || null;
  }
  return raw;
}

function parsePokemonSpeciesFromTeamExport(teamExport = '') {
  return String(teamExport || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => {
      const header = String(block || '').split('\n').map((line) => line.trim()).find(Boolean);
      return parsePokemonSpeciesFromHeader(header);
    })
    .filter(Boolean)
    .slice(0, 6);
}

function parsePokemonMembersFromTeamExport(teamExport = '') {
  return String(teamExport || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = String(block || '').split('\n').map((line) => line.trim()).filter(Boolean);
      const header = lines[0] || '';
      const species = parsePokemonSpeciesFromHeader(header);
      if (!species) return null;
      const itemMatch = header.match(/\s@\s(.+)$/);
      const abilityLine = lines.find((line) => /^Ability:/i.test(line)) || '';
      return {
        species,
        speciesKey: templateLabelDedupeKey(species).replace(/\s+/g, '-'),
        item: itemMatch ? itemMatch[1].trim() : '',
        itemKey: templateLabelDedupeKey(itemMatch ? itemMatch[1] : '').replace(/\s+/g, '-'),
        ability: abilityLine.replace(/^Ability:\s*/i, '').trim(),
        abilityKey: templateLabelDedupeKey(abilityLine.replace(/^Ability:\s*/i, '')).replace(/\s+/g, '-'),
        moveKeys: lines
          .filter((line) => line.startsWith('- '))
          .map((line) => templateLabelDedupeKey(line.slice(2)).replace(/\s+/g, '-'))
          .filter(Boolean),
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

const FINAL_ARCHETYPE_LABELS = {
  rain: 'Rain',
  sun: 'Sun',
  sand: 'Sand',
  snow: 'Snow',
  'trick-room': 'Trick Room',
  'hard-trick-room': 'Hard Trick Room',
  tailwind: 'Tailwind',
  'hyper-offense': 'Hyper Offense',
  'bulky-offense': 'Bulky Offense',
  balance: 'Balance',
  stall: 'Stall',
  'perish-trap': 'Perish Trap',
  'beat-up': 'Beat Up',
  'bulky-sun': 'Bulky Sun',
  'hyper-sun': 'Hyper Sun',
  'trick-room-sun': 'Trick Room Sun',
  'sun-balance': 'Sun Balance',
  'rain-offense': 'Rain Offense',
  'rain-balance': 'Rain Balance',
  'bulky-rain': 'Bulky Rain',
  'balance-trick-room': 'Balance Trick Room',
  'balance-tailwind': 'Balance Tailwind',
  'bulky-screens': 'Bulky Screens',
  'fast-coaching': 'Fast Coaching',
  goodstuffs: 'Goodstuffs',
};

const FINAL_ARCHETYPE_GLOSSARY = {
  rain: 'Rain teams use rain setters and rain abusers to create fast Water pressure.',
  sun: 'Sun teams use sunlight to boost Fire pressure and enable sun-based sweepers.',
  sand: 'Sand teams use sand chip, bulk, and sand abilities to control longer games.',
  snow: 'Snow teams use snow support to improve Ice-type positioning and bulk.',
  'trick-room': 'Trick Room teams reverse speed order so slower attackers can move first.',
  'hard-trick-room': 'Hard Trick Room teams commit heavily to slow attackers and repeated Room turns.',
  tailwind: 'Tailwind teams use temporary speed control to attack before the opponent can settle.',
  'hyper-offense': 'Hyper Offense teams trade defensive padding for immediate pressure and fast KOs.',
  'bulky-offense': 'Bulky Offense teams keep strong damage while adding enough bulk to pivot safely.',
  balance: 'Balance teams mix pressure, defensive tools, and flexible speed control.',
  stall: 'Stall teams aim to survive, recover, and win through attrition.',
  'perish-trap': 'Perish Trap teams combine Perish Song with trapping or positioning tools.',
  'beat-up': 'Beat Up teams use Beat Up to activate an ally or create an immediate combo threat.',
  'bulky-sun': 'Bulky Sun teams combine sun pressure with enough bulk to play longer positioning games.',
  'hyper-sun': 'Hyper Sun teams use sunlight to create immediate offensive pressure.',
  'trick-room-sun': 'Trick Room Sun teams combine slow-mode turns with sun-boosted attackers.',
  'sun-balance': 'Sun Balance teams use sunlight as one flexible mode inside a balanced game plan.',
  'rain-offense': 'Rain Offense teams use rain speed and Water pressure to force fast trades.',
  'rain-balance': 'Rain Balance teams use rain as a flexible mode inside a balanced game plan.',
  'bulky-rain': 'Bulky Rain teams pair rain pressure with bulk and safer pivots.',
  'balance-trick-room': 'Balance Trick Room teams use Room as an important mode without fully committing to hard Room.',
  'balance-tailwind': 'Balance Tailwind teams use Tailwind as a flexible speed mode inside balanced positioning.',
  'bulky-screens': 'Bulky Screens teams use defensive screens to create safer setup and positioning turns.',
  'fast-coaching': 'Fast Coaching teams use Coaching support to accelerate a physical attacker.',
};

const FINAL_ARCHETYPE_TAGS = {
  rain: ['weather', 'speed', 'water'],
  sun: ['weather', 'speed', 'fire'],
  sand: ['weather', 'chip', 'rock'],
  snow: ['weather', 'bulk', 'ice'],
  'trick-room': ['speed-control', 'slow-mode'],
  'hard-trick-room': ['speed-control', 'slow-mode', 'dedicated-mode'],
  tailwind: ['speed-control', 'fast-mode'],
  'hyper-offense': ['offense', 'tempo'],
  'bulky-offense': ['offense', 'bulk', 'positioning'],
  balance: ['positioning', 'flexible'],
  stall: ['defense', 'attrition'],
  'perish-trap': ['control', 'win-condition'],
  'beat-up': ['combo', 'setup'],
  'bulky-sun': ['weather', 'bulk', 'fire', 'positioning'],
  'hyper-sun': ['weather', 'offense', 'tempo', 'fire'],
  'trick-room-sun': ['weather', 'speed-control', 'slow-mode', 'fire'],
  'sun-balance': ['weather', 'positioning', 'fire'],
  'rain-offense': ['weather', 'offense', 'speed', 'water'],
  'rain-balance': ['weather', 'positioning', 'water'],
  'bulky-rain': ['weather', 'bulk', 'water', 'positioning'],
  'balance-trick-room': ['positioning', 'speed-control', 'slow-mode'],
  'balance-tailwind': ['positioning', 'speed-control', 'fast-mode'],
  'bulky-screens': ['bulk', 'support', 'positioning'],
  'fast-coaching': ['support', 'tempo', 'setup'],
};

const FINAL_ARCHETYPE_SIGNATURE_HINTS = {
  Round: 'Round pressure',
  Screens: 'screen-supported setup turns',
  Coaching: 'Coaching-supported physical pressure',
  'Expanding Force': 'Psychic Terrain pressure',
};

const FINAL_ARCHETYPE_STYLE_HINTS = {
  Hyper: {
    glossary: 'a fast pressure shell',
    respect: 'Respect immediate damage and early tempo swings.',
    approach: 'Use a line that can trade quickly or deny its first setup turn.',
  },
  Bulky: {
    glossary: 'a durable pressure shell',
    respect: 'Respect steady damage backed by safer switches.',
    approach: 'Use a line that wins positioning before trying to take KOs.',
  },
  Balance: {
    glossary: 'a flexible positioning shell',
    respect: 'Respect its ability to change modes after preview.',
    approach: 'Use a line that keeps options open and does not overcommit early.',
  },
  Fast: {
    glossary: 'a speed-focused pressure shell',
    respect: 'Respect speed control and fast double-target turns.',
    approach: 'Use a line that controls speed or survives the opening burst.',
  },
};

const FINAL_ARCHETYPE_ALIASES = {
  'rain-offense': 'rain-offense',
  'rain-balance': 'rain-balance',
  'bulky-rain': 'bulky-rain',
  'sun-offense': 'sun',
  'sun-balance': 'sun-balance',
  'bulky-sun': 'bulky-sun',
  'hyper-sun': 'hyper-sun',
  'trick-room-sun': 'trick-room-sun',
  'sand-balance': 'sand',
  'snow-balance': 'snow',
  hail: 'snow',
  trickroom: 'trick-room',
  'trick-room-offense': 'trick-room',
  'balance-trick-room': 'balance-trick-room',
  'balance-tr': 'balance-trick-room',
  room: 'trick-room',
  'hard-tr': 'hard-trick-room',
  'hard-room': 'hard-trick-room',
  'tailwind-offense': 'tailwind',
  'balance-tailwind': 'balance-tailwind',
  'fast-offense': 'hyper-offense',
  'direct-pressure': 'hyper-offense',
  'direct-pressure-offense': 'hyper-offense',
  'bulky-balance': 'balance',
  'redirection-balance': 'balance',
  'good-stuffs': 'goodstuffs',
  'good-stuff': 'goodstuffs',
};

const FINAL_ARCHETYPE_MOVE_GROUPS = {
  rain: ['rain-dance', 'chilling-water', 'water-spout', 'wave-crash', 'surging-strikes', 'hydro-pump', 'muddy-water'],
  sun: ['sunny-day', 'heat-wave', 'eruption', 'solar-beam', 'solar-blade', 'weather-ball'],
  sand: ['sandstorm', 'rock-slide', 'stone-edge'],
  snow: ['snowscape', 'blizzard', 'aurora-veil'],
  trickRoom: ['trick-room'],
  tailwind: ['tailwind'],
  perish: ['perish-song'],
  trap: ['mean-look', 'block', 'spider-web', 'whirlpool', 'fire-spin', 'infestation', 'magma-storm'],
  beatUp: ['beat-up'],
  protect: ['protect', 'detect', 'spiky-shield', 'wide-guard', 'quick-guard', 'king-s-shield'],
  recovery: ['recover', 'roost', 'moonlight', 'soft-boiled', 'slack-off', 'synthesis', 'strength-sap', 'wish'],
  attrition: ['toxic', 'will-o-wisp', 'leech-seed', 'substitute', 'encore', 'disable', 'yawn'],
  support: ['fake-out', 'follow-me', 'rage-powder', 'helping-hand', 'parting-shot', 'wide-guard', 'will-o-wisp', 'taunt', 'encore', 'icy-wind', 'electroweb', 'thunder-wave', 'snarl'],
  setup: ['swords-dance', 'nasty-plot', 'calm-mind', 'dragon-dance', 'bulk-up', 'quiver-dance'],
  spread: ['heat-wave', 'blizzard', 'dazzling-gleam', 'earthquake', 'rock-slide', 'make-it-rain', 'hyper-voice', 'eruption', 'water-spout'],
  priority: ['sucker-punch', 'extreme-speed', 'aqua-jet', 'grassy-glide', 'bullet-punch', 'ice-shard', 'quick-attack'],
};

const FINAL_ARCHETYPE_FALLBACK_SIGNATURE_GROUPS = [
  'protect',
  'recovery',
  'attrition',
  'support',
  'trickRoom',
  'tailwind',
  'perish',
  'trap',
];

const FINAL_ARCHETYPE_FALLBACK_SIGNATURE_BLOCKLIST = new Set([
  'protect',
  'detect',
  'spiky-shield',
  'wide-guard',
  'quick-guard',
  'king-s-shield',
  'helping-hand',
  'fake-out',
]);

const FINAL_ARCHETYPE_SIGNATURE_PLAN_ALIASES = {
  'aurora-veil': 'Screens',
  reflect: 'Screens',
  'light-screen': 'Screens',
  coaching: 'Coaching',
  'expanding-force': 'Expanding Force',
  round: 'Round',
};

const FINAL_ARCHETYPE_ABILITY_GROUPS = {
  rain: ['drizzle', 'swift-swim', 'rain-dish'],
  sun: ['drought', 'chlorophyll', 'solar-power', 'protosynthesis', 'orichalcum-pulse'],
  sand: ['sand-stream', 'sand-rush', 'sand-force', 'sand-veil'],
  snow: ['snow-warning', 'slush-rush', 'ice-body'],
  trap: ['shadow-tag', 'arena-trap'],
  beatUp: ['justified', 'stamina', 'anger-point'],
  support: ['intimidate', 'prankster', 'friend-guard', 'armor-tail', 'hospitality'],
};

const FINAL_ARCHETYPE_ITEM_GROUPS = {
  offense: ['life-orb', 'choice-band', 'choice-specs', 'choice-scarf', 'focus-sash', 'booster-energy', 'expert-belt'],
  bulk: ['sitrus-berry', 'leftovers', 'assault-vest', 'eviolite', 'rocky-helmet', 'safety-goggles', 'colbur-berry', 'shuca-berry', 'clear-amulet'],
  room: ['room-service', 'iron-ball'],
};

const FINAL_ARCHETYPE_SLOW_TRICK_ROOM_SPECIES = new Set([
  'amoonguss',
  'calyrex-ice',
  'cresselia',
  'dusclops',
  'farigiraf',
  'hatterene',
  'indeedee-f',
  'iron-hands',
  'kingambit',
  'porygon2',
  'ursaluna',
  'ursaluna-bloodmoon',
  'torkoal',
]);

function normalizeFinalArchetypeKey(value = '') {
  const key = templateLabelDedupeKey(value).replace(/\s+/g, '-');
  return FINAL_ARCHETYPE_ALIASES[key] || key;
}

function addFinalArchetypeScore(scores, key, amount) {
  if (!key || amount <= 0) return;
  scores.set(key, Number(scores.get(key) || 0) + amount);
}

function getFinalArchetypeScore(scores, key) {
  return Number(scores.get(key) || 0);
}

function titleFinalArchetypeMoveKey(value = '') {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim();
}

function selectFinalArchetypeSignaturePlan(members = []) {
  const blocked = new Set(FINAL_ARCHETYPE_FALLBACK_SIGNATURE_BLOCKLIST);
  FINAL_ARCHETYPE_FALLBACK_SIGNATURE_GROUPS.forEach((group) => {
    (FINAL_ARCHETYPE_MOVE_GROUPS[group] || []).forEach((move) => blocked.add(move));
  });

  const counts = new Map();
  const labels = new Map();
  members.forEach((member) => {
    (member.moveKeys || []).forEach((move) => {
      if (!move || blocked.has(move)) return;
      const label = FINAL_ARCHETYPE_SIGNATURE_PLAN_ALIASES[move] || titleFinalArchetypeMoveKey(move);
      if (!label || blocked.has(templateLabelDedupeKey(label).replace(/\s+/g, '-'))) return;
      counts.set(move, Number(counts.get(move) || 0) + 1);
      labels.set(move, label);
    });
  });

  const best = [...counts.keys()].sort((a, b) => Number(counts.get(b) || 0) - Number(counts.get(a) || 0) || String(labels.get(a) || a).localeCompare(String(labels.get(b) || b)))[0];
  return best ? labels.get(best) : 'Positioning';
}

function finalArchetypeStyleFromScores(scores) {
  if (getFinalArchetypeScore(scores, 'hyper-offense') >= 6) return 'Hyper';
  if (getFinalArchetypeScore(scores, 'bulky-offense') >= 3) return 'Bulky';
  if (getFinalArchetypeScore(scores, 'balance') >= 4) return 'Balance';
  if (getFinalArchetypeScore(scores, 'tailwind') >= 5) return 'Fast';
  return 'Balance';
}

function buildTaxonomyTeachingHints(displayKey = '', displayLabel = '', signaturePlan = '') {
  const key = normalizeFinalArchetypeKey(displayKey);
  const label = cleanText(displayLabel) || FINAL_ARCHETYPE_LABELS[key] || humanizeTemplateKey(key) || 'Balance Positioning';
  const tags = new Set(FINAL_ARCHETYPE_TAGS[key] || []);
  const signature = cleanText(signaturePlan) || label;

  let respectHint = `Respect the main ${label} game plan at preview.`;
  let approachHint = `Use a line that answers its first mode while keeping a backup plan.`;
  if (tags.has('weather')) {
    respectHint = `Respect ${label} turns, boosted damage, and weather timing.`;
    approachHint = `Use a line that controls the first ${label} turns before its pressure snowballs.`;
  } else if (tags.has('slow-mode')) {
    respectHint = `Respect ${label} setup turns and slow attackers moving first.`;
    approachHint = `Use a line that can deny Room or stall out its strongest turns.`;
  } else if (tags.has('fast-mode') || tags.has('tempo')) {
    respectHint = `Respect ${label} speed control and fast pressure.`;
    approachHint = `Use a line that controls speed or survives the opening burst.`;
  } else if (tags.has('bulk') || tags.has('positioning')) {
    respectHint = `Respect ${label} pivots and longer positioning turns.`;
    approachHint = `Use a line that wins positioning before committing to trades.`;
  } else if (tags.has('combo') || tags.has('win-condition')) {
    respectHint = `Respect the ${label} win condition before it gets started.`;
    approachHint = `Use a line that interrupts the setup piece or forces early trades.`;
  }

  return {
    glossaryEntry: FINAL_ARCHETYPE_GLOSSARY[key] || `${label} teams use ${signature} as their main game plan.`,
    respectHint,
    approachHint,
    signaturePlan: signature,
    explanationSource: 'taxonomy',
  };
}

function buildGeneratedTeachingHints(displayLabel = '', style = 'Balance', signaturePlan = 'Positioning') {
  const signature = cleanText(signaturePlan) || 'Positioning';
  const label = cleanText(displayLabel) || `${style} ${signature}`;
  const signaturePhrase = FINAL_ARCHETYPE_SIGNATURE_HINTS[signature] || `${signature} pressure`;
  const styleHint = FINAL_ARCHETYPE_STYLE_HINTS[style] || FINAL_ARCHETYPE_STYLE_HINTS.Balance;
  return {
    glossaryEntry: `${label} teams combine ${styleHint.glossary} with ${signaturePhrase}.`,
    respectHint: `${styleHint.respect} Respect ${signaturePhrase} once it appears.`,
    approachHint: `${styleHint.approach} Keep ${signaturePhrase} from becoming free.`,
    signaturePlan: signature,
    explanationSource: 'generated-display-key',
  };
}

function buildFinalArchetypeTeachingHints({
  displayKey = '',
  displayLabel = '',
  signaturePlan = '',
  scores = null,
} = {}) {
  const key = normalizeFinalArchetypeKey(displayKey);
  if (key && key !== 'goodstuffs' && FINAL_ARCHETYPE_GLOSSARY[key] && !isGenericMatchupGuideLabel(key)) {
    return buildTaxonomyTeachingHints(key, displayLabel || FINAL_ARCHETYPE_LABELS[key], signaturePlan || FINAL_ARCHETYPE_LABELS[key]);
  }
  const style = scores instanceof Map ? finalArchetypeStyleFromScores(scores) : 'Balance';
  return buildGeneratedTeachingHints(displayLabel, style, signaturePlan);
}

function normalizeFinalArchetypeMetadata(metadata = {}, fallbackKey = '', fallbackLabel = '') {
  const displayKey = normalizeFinalArchetypeKey(metadata.displayKey || fallbackKey || metadata.primaryKey || fallbackLabel);
  const primaryKey = normalizeFinalArchetypeKey(metadata.primaryKey || displayKey || fallbackKey);
  const displayLabel = cleanText(metadata.displayLabel)
    || FINAL_ARCHETYPE_LABELS[displayKey]
    || cleanText(fallbackLabel)
    || humanizeTemplateKey(displayKey)
    || 'Balance Positioning';
  const teaching = buildFinalArchetypeTeachingHints({
    displayKey,
    displayLabel,
    signaturePlan: metadata.signaturePlan,
  });
  return {
    ...metadata,
    primaryKey: primaryKey || metadata.primaryKey || 'balance',
    primaryLabel: cleanText(metadata.primaryLabel) || FINAL_ARCHETYPE_LABELS[primaryKey] || displayLabel,
    displayKey: displayKey || metadata.displayKey || templateLabelDedupeKey(displayLabel).replace(/\s+/g, '-'),
    displayLabel,
    glossaryEntry: cleanText(metadata.glossaryEntry) || teaching.glossaryEntry,
    respectHint: cleanText(metadata.respectHint) || teaching.respectHint,
    approachHint: cleanText(metadata.approachHint) || teaching.approachHint,
    signaturePlan: cleanText(metadata.signaturePlan) || teaching.signaturePlan,
    explanationSource: cleanText(metadata.explanationSource) || teaching.explanationSource,
  };
}

function selectFinalArchetypeDisplayKey(primaryKey, secondaryKey, scores) {
  const perishScore = getFinalArchetypeScore(scores, 'perish-trap');
  const beatUpScore = getFinalArchetypeScore(scores, 'beat-up');
  if (primaryKey === 'perish-trap' || perishScore >= 7) return 'perish-trap';
  if (primaryKey === 'beat-up' || beatUpScore >= 7) return 'beat-up';

  const hardRoomScore = getFinalArchetypeScore(scores, 'hard-trick-room');
  const roomScore = getFinalArchetypeScore(scores, 'trick-room');
  const hyperScore = getFinalArchetypeScore(scores, 'hyper-offense');
  const bulkyScore = getFinalArchetypeScore(scores, 'bulky-offense');
  const balanceScore = getFinalArchetypeScore(scores, 'balance');
  const tailwindScore = getFinalArchetypeScore(scores, 'tailwind');
  const weatherScores = ['sun', 'rain', 'sand', 'snow']
    .map((key) => [key, getFinalArchetypeScore(scores, key)])
    .sort((a, b) => b[1] - a[1]);
  const [weatherKey, weatherScore] = weatherScores[0] || ['', 0];

  if (weatherScore >= 4) {
    if (weatherKey === 'sun') {
      if (hardRoomScore >= 10 || roomScore >= 8) return 'trick-room-sun';
      if (hyperScore >= 6) return 'hyper-sun';
      if (bulkyScore >= 3) return 'bulky-sun';
      return 'sun-balance';
    }
    if (weatherKey === 'rain') {
      if (hyperScore >= 6) return 'rain-offense';
      if (balanceScore >= 6) return 'rain-balance';
      if (bulkyScore >= 3) return 'bulky-rain';
      return 'rain-balance';
    }
    return weatherKey;
  }

  if (primaryKey === 'hard-trick-room' || hardRoomScore >= 10) return 'hard-trick-room';
  if (primaryKey === 'trick-room' || roomScore >= 5) {
    if (balanceScore >= 3 || bulkyScore >= 3 || ['balance', 'bulky-offense'].includes(secondaryKey)) return 'balance-trick-room';
    return 'hard-trick-room';
  }
  if (primaryKey === 'tailwind' || tailwindScore >= 5) {
    if (balanceScore >= 4 || bulkyScore >= 5) return 'balance-tailwind';
    return 'tailwind';
  }
  if (['hyper-offense', 'bulky-offense', 'balance'].includes(primaryKey)) return '';
  if (primaryKey && FINAL_ARCHETYPE_LABELS[primaryKey] && primaryKey !== 'goodstuffs' && !isGenericMatchupGuideLabel(primaryKey) && getFinalArchetypeScore(scores, primaryKey) >= 5) return primaryKey;
  return '';
}

function memberHasMove(member = {}, group = '') {
  const moves = new Set(member.moveKeys || []);
  return (FINAL_ARCHETYPE_MOVE_GROUPS[group] || []).some((move) => moves.has(move));
}

function memberHasAbility(member = {}, group = '') {
  return (FINAL_ARCHETYPE_ABILITY_GROUPS[group] || []).includes(member.abilityKey);
}

function memberHasItem(member = {}, group = '') {
  return (FINAL_ARCHETYPE_ITEM_GROUPS[group] || []).includes(member.itemKey);
}

function classifyFinalArchetypeFromTeamExport(teamExport = '', sourceLabel = '') {
  const sourceKey = normalizeFinalArchetypeKey(sourceLabel);
  if (sourceLabel && !isGenericMatchupGuideLabel(sourceLabel) && FINAL_ARCHETYPE_LABELS[sourceKey]) {
    const sourceMetadata = normalizeFinalArchetypeMetadata({
      primaryKey: sourceKey,
      primaryLabel: FINAL_ARCHETYPE_LABELS[sourceKey],
      displayKey: sourceKey,
      displayLabel: FINAL_ARCHETYPE_LABELS[sourceKey],
    });
    return {
      ...sourceMetadata,
      primaryKey: sourceKey,
      primaryLabel: FINAL_ARCHETYPE_LABELS[sourceKey],
      displayKey: sourceKey,
      displayLabel: FINAL_ARCHETYPE_LABELS[sourceKey],
      confidenceBand: 'Medium',
      source: { kind: 'source-label', label: sourceLabel, genericLabel: false },
    };
  }

  const members = parsePokemonMembersFromTeamExport(teamExport);
  const scores = new Map();
  let trickRoomUsers = 0;
  let tailwindUsers = 0;
  let slowMembers = 0;
  let offenseMembers = 0;
  let bulkMembers = 0;
  let supportMembers = 0;
  let protectUsers = 0;
  let recoveryUsers = 0;
  let attritionUsers = 0;
  let setupUsers = 0;
  let spreadUsers = 0;
  let priorityUsers = 0;
  let perishUsers = 0;
  let trapUsers = 0;
  let beatUpUsers = 0;
  let beatUpTargets = 0;

  for (const member of members) {
    let attackCount = 0;
    let supportCount = 0;
    for (const key of ['rain', 'sun', 'sand', 'snow']) {
      if (memberHasAbility(member, key)) addFinalArchetypeScore(scores, key, 4);
      if (memberHasMove(member, key)) addFinalArchetypeScore(scores, key, 2);
    }
    if (memberHasMove(member, 'trickRoom')) {
      trickRoomUsers += 1;
      addFinalArchetypeScore(scores, 'trick-room', 5);
    }
    if (memberHasMove(member, 'tailwind')) {
      tailwindUsers += 1;
      addFinalArchetypeScore(scores, 'tailwind', 5);
    }
    if (memberHasMove(member, 'perish')) {
      perishUsers += 1;
      addFinalArchetypeScore(scores, 'perish-trap', 4);
    }
    if (memberHasMove(member, 'trap') || memberHasAbility(member, 'trap')) {
      trapUsers += 1;
      addFinalArchetypeScore(scores, 'perish-trap', 3);
    }
    if (memberHasMove(member, 'beatUp')) {
      beatUpUsers += 1;
      addFinalArchetypeScore(scores, 'beat-up', 4);
    }
    if (memberHasAbility(member, 'beatUp')) {
      beatUpTargets += 1;
      addFinalArchetypeScore(scores, 'beat-up', 3);
    }
    if (FINAL_ARCHETYPE_SLOW_TRICK_ROOM_SPECIES.has(member.speciesKey) || memberHasItem(member, 'room')) {
      slowMembers += 1;
      addFinalArchetypeScore(scores, 'trick-room', 1);
    }
    if (memberHasMove(member, 'protect')) {
      protectUsers += 1;
      supportCount += 1;
    }
    if (memberHasMove(member, 'recovery')) {
      recoveryUsers += 1;
      supportCount += 1;
    }
    if (memberHasMove(member, 'attrition')) {
      attritionUsers += 1;
      supportCount += 1;
    }
    if (memberHasMove(member, 'support') || memberHasAbility(member, 'support')) {
      supportMembers += 1;
      supportCount += 1;
    }
    if (memberHasMove(member, 'setup')) {
      setupUsers += 1;
      attackCount += 1;
    }
    if (memberHasMove(member, 'spread')) {
      spreadUsers += 1;
      attackCount += 1;
    }
    if (memberHasMove(member, 'priority')) {
      priorityUsers += 1;
      attackCount += 1;
    }
    if (memberHasItem(member, 'offense')) attackCount += 1;
    if (memberHasItem(member, 'bulk')) bulkMembers += 1;
    const supportMoveKeys = new Set([
      ...FINAL_ARCHETYPE_MOVE_GROUPS.protect,
      ...FINAL_ARCHETYPE_MOVE_GROUPS.recovery,
      ...FINAL_ARCHETYPE_MOVE_GROUPS.attrition,
      ...FINAL_ARCHETYPE_MOVE_GROUPS.support,
      ...FINAL_ARCHETYPE_MOVE_GROUPS.trickRoom,
      ...FINAL_ARCHETYPE_MOVE_GROUPS.tailwind,
      ...FINAL_ARCHETYPE_MOVE_GROUPS.perish,
      ...FINAL_ARCHETYPE_MOVE_GROUPS.trap,
    ]);
    attackCount += (member.moveKeys || []).filter((move) => move && !supportMoveKeys.has(move)).length;
    if (attackCount >= 3 || memberHasItem(member, 'offense')) offenseMembers += 1;
  }

  if (trickRoomUsers >= 2 || (trickRoomUsers && slowMembers >= 3)) addFinalArchetypeScore(scores, 'hard-trick-room', 18);
  if (trickRoomUsers && slowMembers) addFinalArchetypeScore(scores, 'trick-room', Math.min(3, slowMembers));
  if (tailwindUsers && offenseMembers >= 3) addFinalArchetypeScore(scores, 'tailwind', 2);
  if (perishUsers && trapUsers) addFinalArchetypeScore(scores, 'perish-trap', 7);
  if (beatUpUsers && beatUpTargets) addFinalArchetypeScore(scores, 'beat-up', 7);
  if (protectUsers >= 4 && (recoveryUsers + attritionUsers) >= 3) addFinalArchetypeScore(scores, 'stall', 8);
  else if (recoveryUsers + attritionUsers >= 4) addFinalArchetypeScore(scores, 'stall', 5);
  if (offenseMembers >= 5 && supportMembers <= 2) addFinalArchetypeScore(scores, 'hyper-offense', 8);
  else if (offenseMembers >= 4 && (setupUsers + spreadUsers + priorityUsers) >= 3) addFinalArchetypeScore(scores, 'hyper-offense', 6);
  if (offenseMembers >= 2 && (bulkMembers + supportMembers) >= 3) addFinalArchetypeScore(scores, 'bulky-offense', 7);
  if (supportMembers >= 3 && offenseMembers >= 2) addFinalArchetypeScore(scores, 'balance', 6);
  if (protectUsers >= 3 && supportMembers >= 2) addFinalArchetypeScore(scores, 'balance', 3);
  if (bulkMembers >= 3) addFinalArchetypeScore(scores, 'bulky-offense', 3);
  if (!scores.size) addFinalArchetypeScore(scores, 'balance', 2);

  const ranked = [...scores.entries()]
    .filter(([key]) => FINAL_ARCHETYPE_LABELS[key] && key !== 'goodstuffs' && !isGenericMatchupGuideLabel(key))
    .sort((a, b) => b[1] - a[1] || FINAL_ARCHETYPE_LABELS[a[0]].localeCompare(FINAL_ARCHETYPE_LABELS[b[0]]));
  const primaryKey = ranked[0]?.[0] || 'balance';
  const secondaryKey = ranked.find(([key]) => key !== primaryKey && Number(scores.get(key) || 0) >= 4)?.[0] || null;
  const topScore = Number(ranked[0]?.[1] || 0);
  const displayKey = selectFinalArchetypeDisplayKey(primaryKey, secondaryKey, scores);
  const signaturePlan = selectFinalArchetypeSignaturePlan(members);
  const displayLabel = displayKey
    ? FINAL_ARCHETYPE_LABELS[displayKey]
    : `${finalArchetypeStyleFromScores(scores)} ${signaturePlan}`;
  const generatedMetadata = normalizeFinalArchetypeMetadata({
    primaryKey,
    primaryLabel: FINAL_ARCHETYPE_LABELS[primaryKey] || 'Balance',
    secondaryKey,
    secondaryLabel: secondaryKey ? FINAL_ARCHETYPE_LABELS[secondaryKey] : null,
    displayKey: displayKey || templateLabelDedupeKey(displayLabel).replace(/\s+/g, '-'),
    displayLabel,
    signaturePlan,
  });
  return {
    ...generatedMetadata,
    primaryKey,
    primaryLabel: FINAL_ARCHETYPE_LABELS[primaryKey] || 'Balance',
    secondaryKey,
    secondaryLabel: secondaryKey ? FINAL_ARCHETYPE_LABELS[secondaryKey] : null,
    displayKey: displayKey || templateLabelDedupeKey(displayLabel).replace(/\s+/g, '-'),
    displayLabel,
    signaturePlan,
    confidenceBand: topScore >= 8 ? 'High' : topScore >= 5 ? 'Medium' : topScore >= 3 ? 'Low' : 'Unknown',
    source: { kind: 'team-export-fallback', label: sourceLabel || '', genericLabel: true },
  };
}

function normalizeSourceResult(source = {}) {
  const direct = String(source.result || source.verdict || '').trim().toLowerCase();
  if (['win', 'loss', 'tie'].includes(direct)) return direct;

  const winner = String(source.winner || '').trim().toLowerCase();
  if (!winner) return null;
  if (winner.includes('tie') || winner.includes('draw')) return 'tie';

  const opponentName = String(source.opponentName || source.archetype || 'Benchmark Opponent').trim().toLowerCase();
  const playerName = String(source.playerName || 'Professor Aegis User').trim().toLowerCase();

  if (winner === 'benchmark opponent' || (opponentName && winner === opponentName)) return 'loss';
  if (winner === 'professor aegis user' || winner === 'you' || (playerName && winner === playerName)) return 'win';
  return null;
}

function buildArchetypeRowsFromMatchArchive(report = {}) {
  const sources = Array.isArray(report?.matchArchive?.sources) ? report.matchArchive.sources : [];
  if (!sources.length) return [];
  const buckets = new Map();

  sources.forEach((source) => {
    if (!source || typeof source !== 'object') return;
    const teamExport = String(source.opponentTeamExport || '').trim();
    const sourceLabel = source.templateLabel
      || source.archetype
      || source.opponentArchetype
      || source.championLabArchetype
      || source.templateKey
      || source.opponentName
      || '';
    const metadata = getArchetypeMetadata(source)
      || classifyFinalArchetypeFromTeamExport(teamExport, sourceLabel);
    const label = getCanonicalArchetypeLabel({ archetypeMetadata: metadata })
      || getSourceTemplateLabel({ ...source, archetypeMetadata: metadata })
      || 'Goodstuffs';
    if (isGenericMatchupGuideLabel(label)) return;
    const key = getCanonicalArchetypeKey({ archetypeMetadata: metadata })
      || templateLabelDedupeKey(label)
      || 'goodstuffs';
    const result = normalizeSourceResult(source);
    if (!result) return;
    const current = buckets.get(key) || {
      templateKey: key,
      templateKeys: [],
      templateLabel: label,
      archetypeMetadata: metadata ? { ...metadata } : null,
      opponents: 0,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      failed: 0,
      totalTurns: 0,
    };
    const rawTemplateKey = String(source.templateKey || '').trim();
    if (rawTemplateKey && !current.templateKeys.includes(rawTemplateKey)) current.templateKeys.push(rawTemplateKey);
    if (key && !current.templateKeys.includes(key)) current.templateKeys.unshift(key);
    current.opponents += 1;
    current.gamesPlayed += 1;
    if (result === 'win') current.wins += 1;
    if (result === 'loss') current.losses += 1;
    if (result === 'tie') current.ties += 1;
    current.totalTurns += Number(source.turns || 0);
    buckets.set(key, current);
  });

  return [...buckets.values()].map((item) => ({
    ...item,
    opponents: Number(item.opponents || 0) || item.templateKeys.length || 1,
    winRate: item.gamesPlayed > 0 ? Number(((item.wins / item.gamesPlayed) * 100).toFixed(2)) : 0,
    averageTurns: item.gamesPlayed > 0 ? Number((item.totalTurns / item.gamesPlayed).toFixed(2)) : 0,
  }));
}

const POKEMON_THREAT_TYPES_BY_SPECIES = {
  amoonguss: ['grass', 'poison'],
  'calyrex ice': ['psychic', 'ice'],
  'calyrex shadow': ['psychic', 'ghost'],
  'chien pao': ['dark', 'ice'],
  incineroar: ['fire', 'dark'],
  miraidon: ['electric', 'dragon'],
  'raging bolt': ['electric', 'dragon'],
  'urshifu rapid strike': ['water', 'fighting'],
  volcarona: ['bug', 'fire'],
  'zamazenta crowned': ['fighting', 'steel'],
};

function normalizePokemonSpeciesKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lookupPokemonThreatTypes(species = '') {
  const key = normalizePokemonSpeciesKey(species);
  return key ? (POKEMON_THREAT_TYPES_BY_SPECIES[key] || []) : [];
}

function buildPokemonThreatRowsFromMatchArchive(report = {}) {
  const sources = Array.isArray(report?.matchArchive?.sources) ? report.matchArchive.sources : [];
  const rowsBySpecies = new Map();

  sources.forEach((source) => {
    if (!source || typeof source !== 'object') return;
    const speciesNames = [...new Set(parsePokemonSpeciesFromTeamExport(source.opponentTeamExport))];
    if (!speciesNames.length) return;

    const result = normalizeSourceResult(source);
    if (!result) return;

    speciesNames.forEach((species) => {
      const key = String(species || '').trim().toLowerCase();
      if (!key) return;
      const current = rowsBySpecies.get(key) || {
        pokemon: species,
        species,
        types: lookupPokemonThreatTypes(species),
        gamesPlayed: 0,
        seen: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        sourceKind: 'pokemon-threat',
      };

      current.gamesPlayed += 1;
      current.seen = current.gamesPlayed;
      if (result === 'win') current.wins += 1;
      if (result === 'loss') current.losses += 1;
      if (result === 'tie') current.ties += 1;
      rowsBySpecies.set(key, current);
    });
  });

  return [...rowsBySpecies.values()]
    .map((row) => ({
      ...row,
      lossRate: row.gamesPlayed ? Math.round((row.losses / row.gamesPlayed) * 100) : 0,
    }))
    .sort((a, b) => (
      b.lossRate - a.lossRate
      || b.gamesPlayed - a.gamesPlayed
      || String(a.species || a.pokemon || '').localeCompare(String(b.species || b.pokemon || ''))
    ))
    .slice(0, 10);
}

function normalizeLeadPairPokemon(item = {}) {
  if (typeof item === 'string') return { name: item, species: item, types: [] };
  if (!item || typeof item !== 'object') return null;
  const species = String(item.species || item.name || item.pokemon || item.label || '').trim();
  if (!species) return null;
  return {
    slot: Number.isFinite(Number(item.slot)) ? Number(item.slot) : null,
    name: species,
    species,
    types: Array.isArray(item.types) ? item.types.filter(Boolean) : [],
  };
}

function normalizeMatchupGuideLabelText(value = '') {
  return String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isGenericMatchupGuideLabel(value = '') {
  const normalized = normalizeMatchupGuideLabelText(value);
  if (!normalized) return true;
  if ([
    'unknown',
    'unknown matchup',
    'unknown template',
    'unlabeled matchup',
    'unlabeled matchup style',
    'opponent',
    'benchmark opponent',
    'tournament',
    'generated random',
    'generated',
    'random',
    'speed control',
    'direct pressure offense',
    'fast offense mirrors',
    'goodstuffs',
    'good stuffs',
    'good stuff',
    'all meta',
    'full meta',
  ].includes(normalized)) {
    return true;
  }
  return normalized.includes(' tournament')
    || normalized.includes('tournament ')
    || normalized.includes('generated random')
    || normalized === 'all meta all tournament'
    || normalized.includes('all meta')
    || normalized.includes('full meta');
}

function getArchetypeMetadata(row = {}) {
  const candidates = [
    row.archetypeMetadata,
    row.opponentArchetypeMetadata,
    row.matchupArchetypeMetadata,
    row.templateArchetypeMetadata,
  ];
  return candidates.find((value) => value && typeof value === 'object') || null;
}

function getCanonicalArchetypeLabel(row = {}) {
  const metadata = getArchetypeMetadata(row);
  if (!metadata) return '';
  return [
    metadata.displayLabel,
    metadata.primaryLabel,
  ]
    .map((value) => String(value || '').trim())
    .find((value) => value && !isGenericMatchupGuideLabel(value)) || '';
}

function getCanonicalArchetypeKey(row = {}) {
  const metadata = getArchetypeMetadata(row);
  const label = getCanonicalArchetypeLabel(row);
  if (!metadata || !label) return '';
  return String(metadata.displayKey || metadata.primaryKey || templateLabelDedupeKey(label) || '').trim();
}

function pickMatchupGuideKeySource(row = {}) {
  const canonicalKey = getCanonicalArchetypeKey(row);
  if (canonicalKey) return canonicalKey;
  const candidates = [
    row.archetypeKey,
    row.templateKey,
    row.key,
    row.championLabArchetype,
    row.opponentArchetype,
    row.archetype,
    row.templateLabel,
    row.archetypeLabel,
    row.label,
  ];
  return candidates
    .map((value) => String(value || '').trim())
    .find((value) => value && !isGenericMatchupGuideLabel(value)) || '';
}

function pickMatchupGuideLabel(row = {}, keySource = '') {
  const canonicalLabel = getCanonicalArchetypeLabel(row);
  if (canonicalLabel) return canonicalLabel;
  const candidates = [
    row.archetypeLabel,
    row.championLabArchetype,
    row.opponentArchetype,
    row.archetype,
    row.templateLabel,
    row.matchupLabel,
    row.name,
    row.opponentName,
    row.label,
    humanizeTemplateKey(keySource),
  ];
  return candidates
    .map((value) => String(value || '').trim())
    .find((value) => value && !isGenericMatchupGuideLabel(value)) || '';
}

function normalizeSweepMatchupGuideRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const keySource = pickMatchupGuideKeySource(row);
      const archetypeLabel = pickMatchupGuideLabel(row, keySource);
      const archetypeKey = keySource || templateLabelDedupeKey(archetypeLabel) || 'unlabeled-matchup-style';
      const rawMetadata = getArchetypeMetadata(row);
      const archetypeMetadata = normalizeFinalArchetypeMetadata(rawMetadata || {}, archetypeKey, archetypeLabel);
      const wins = Number(row.wins || 0);
      const losses = Number(row.losses || 0);
      const ties = Number(row.ties || 0);
      const gamesPlayed = Number(row.gamesPlayed || wins + losses + ties || 0);
      const winRate = Number.isFinite(Number(row.winRate))
        ? Number(row.winRate)
        : gamesPlayed > 0
          ? (wins / gamesPlayed) * 100
          : 0;
      const recommendation = ['use', 'avoid', 'neutral'].includes(String(row.recommendation || '').toLowerCase())
        ? String(row.recommendation).toLowerCase()
        : gamesPlayed >= 2 && winRate >= 60
          ? 'use'
          : gamesPlayed >= 2 && winRate <= 40
            ? 'avoid'
            : 'neutral';
      return {
        archetypeKey,
        archetypeLabel,
        wins,
        losses,
        ties,
        gamesPlayed,
        winRate: Number(winRate.toFixed(2)),
        confidence: row.confidence || getConfidenceLabel(gamesPlayed),
        recommendation,
        archetypeMetadata,
        glossaryEntry: archetypeMetadata.glossaryEntry,
        respectHint: archetypeMetadata.respectHint,
        approachHint: archetypeMetadata.approachHint,
        signaturePlan: archetypeMetadata.signaturePlan,
        explanationSource: archetypeMetadata.explanationSource,
      };
    })
    .filter((row) => row.archetypeLabel && row.gamesPlayed > 0)
    .sort((a, b) => (
      ({ use: 0, neutral: 1, avoid: 2 }[a.recommendation] ?? 1)
      - ({ use: 0, neutral: 1, avoid: 2 }[b.recommendation] ?? 1)
      || b.winRate - a.winRate
      || b.gamesPlayed - a.gamesPlayed
      || a.archetypeLabel.localeCompare(b.archetypeLabel)
    ));
}

function normalizeLeadPairRowsFromSweep(report = {}) {
  const sweep = report?.leadPairSweep && typeof report.leadPairSweep === 'object'
    ? report.leadPairSweep
    : {};
  const rows = Array.isArray(sweep.results) ? sweep.results : [];
  const profile = sweep.profile && typeof sweep.profile === 'object' ? sweep.profile : {};
  return rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const pair = Array.isArray(row.pair)
        ? row.pair.map(normalizeLeadPairPokemon).filter(Boolean).slice(0, 2)
        : [];
      const fallbackLabel = String(row.label || row.pairName || row.name || '').trim();
      const label = pair.length >= 2
        ? pair.map((pokemon) => pokemon.species || pokemon.name).filter(Boolean).join(' + ')
        : fallbackLabel;
      const wins = Number(row.wins || 0);
      const losses = Number(row.losses || 0);
      const ties = Number(row.ties || 0);
      const gamesPlayed = Number(row.gamesPlayed || row.gamesCompleted || row.gamesAttempted || row.gamesRequested || (wins + losses + ties) || 0);
      const winRate = Number.isFinite(Number(row.winRate))
        ? Number(row.winRate)
        : gamesPlayed > 0
          ? (wins / gamesPlayed) * 100
          : 0;
      return {
        pairId: row.pairId || null,
        rank: Number(row.rank || 0),
        pair,
        label,
        winRate: Number(winRate.toFixed(2)),
        gamesPlayed,
        gamesAttempted: Number(row.gamesAttempted || row.gamesRequested || gamesPlayed || 0),
        wins,
        losses,
        ties,
        record: `${wins}-${losses}${ties ? `-${ties}` : ''}`,
        averageTurns: Number(row.averageTurns || 0),
        averageArchetypeSpread: Number(row.averageArchetypeSpread || row.archetypeSpread || row.spreadScore || 0),
        runtimeMs: Number(row.runtimeMs || 0),
        confidence: row.confidence || row.confidenceLabel || (gamesPlayed >= Number(profile.gamesPerPair || 25) ? 'High' : 'Medium'),
        profileId: profile.profileId || null,
        sourceKind: 'lead-pair-sweep',
        matchupGuide: normalizeSweepMatchupGuideRows(row.matchupGuide),
        replayRefs: Array.isArray(row.replayRefs) ? row.replayRefs.filter(Boolean) : [],
        replayArtifactsCount: Array.isArray(row.replayRefs) ? row.replayRefs.filter(Boolean).length : 0,
        why: row.why || 'Best tested opening pair from the fixed Aegis sweep profile.',
      };
    })
    .filter((row) => row.label && row.pair.length >= 2 && row.gamesPlayed > 0)
    .sort((a, b) => (
      b.winRate - a.winRate
      || b.gamesPlayed - a.gamesPlayed
      || b.averageArchetypeSpread - a.averageArchetypeSpread
      || a.label.localeCompare(b.label)
    ))
    .slice(0, 10)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
}

function normalizeCoreRowsFromSweep(report = {}) {
  const sweep = report?.coreSweep && typeof report.coreSweep === 'object'
    ? report.coreSweep
    : {};
  const rows = Array.isArray(sweep.results) ? sweep.results : [];
  const profile = sweep.profile && typeof sweep.profile === 'object' ? sweep.profile : {};
  return rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const plannedCore = Array.isArray(row.plannedCore)
        ? row.plannedCore.map(normalizeLeadPairPokemon).filter(Boolean).slice(0, 4)
        : [];
      const actualSelectedCore = Array.isArray(row.actualSelectedCore)
        ? row.actualSelectedCore.map(normalizeLeadPairPokemon).filter(Boolean).slice(0, 4)
        : [];
      const core = Array.isArray(row.core)
        ? row.core.map(normalizeLeadPairPokemon).filter(Boolean).slice(0, 4)
        : plannedCore;
      const actualLeadPair = Array.isArray(row.actualLeadPair)
        ? row.actualLeadPair.map(normalizeLeadPairPokemon).filter(Boolean).slice(0, 2)
        : [];
      const fallbackLabel = String(row.label || row.coreName || row.name || '').trim();
      const label = core.length >= 4
        ? core.map((pokemon) => pokemon.species || pokemon.name).filter(Boolean).join(' + ')
        : fallbackLabel;
      const wins = Number(row.wins || 0);
      const losses = Number(row.losses || 0);
      const ties = Number(row.ties || 0);
      const gamesPlayed = Number(row.gamesPlayed || (wins + losses + ties) || 0);
      const winRate = Number.isFinite(Number(row.winRate))
        ? Number(row.winRate)
        : gamesPlayed > 0
          ? (wins / gamesPlayed) * 100
          : 0;
      const coreReplayRefs = Array.isArray(row.coreReplayRefs)
        ? row.coreReplayRefs.filter(Boolean)
        : (Array.isArray(row.replayRefs) ? row.replayRefs.filter(Boolean) : []);
      return {
        coreId: row.coreId || null,
        rank: Number(row.rank || row.coreRank || 0),
        coreRank: Number(row.coreRank || row.rank || 0),
        core,
        plannedCore,
        actualSelectedCore,
        actualLeadPair,
        actualCoreSource: row.actualCoreSource || null,
        coreMatched: row.coreMatched === true,
        mismatchReason: row.mismatchReason || null,
        label,
        coreScore: Number(row.coreScore ?? row.preScore ?? 0),
        preScore: Number(row.preScore ?? row.coreScore ?? 0),
        preScoreRank: Number(row.preScoreRank || row.coreRank || row.rank || 0),
        preScoreReasons: Array.isArray(row.preScoreReasons) ? row.preScoreReasons.filter(Boolean) : [],
        winRate: Number(winRate.toFixed(2)),
        gamesPlayed,
        gamesAttempted: Number(row.gamesAttempted || row.gamesRequested || gamesPlayed || 0),
        gamesCompleted: Number(row.gamesCompleted || gamesPlayed || 0),
        gamesValidated: Number(row.gamesValidated || gamesPlayed || 0),
        gamesRejected: Number(row.gamesRejected || 0),
        wins,
        losses,
        ties,
        record: `${wins}-${losses}${ties ? `-${ties}` : ''}`,
        averageTurns: Number(row.averageTurns || 0),
        runtimeMs: Number(row.runtimeMs || 0),
        confidence: row.confidence || row.confidenceLabel || (gamesPlayed >= Number(profile.gamesPerCore || 25) ? 'High' : 'Medium'),
        profileId: profile.profileId || null,
        sourceKind: 'core-sweep',
        matchupGuide: normalizeSweepMatchupGuideRows(row.matchupGuide),
        coreReplayRefs,
        replayRefs: coreReplayRefs,
        replayArtifactsCount: coreReplayRefs.length,
        why: row.why || 'Best tested four-Pokemon core from the fixed Aegis sweep profile.',
      };
    })
    .filter((row) => row.label && row.core.length >= 4 && row.gamesPlayed > 0 && row.coreMatched === true)
    .sort((a, b) => (
      b.winRate - a.winRate
      || b.gamesPlayed - a.gamesPlayed
      || b.coreScore - a.coreScore
      || a.label.localeCompare(b.label)
    ))
    .slice(0, 5)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      coreRank: index + 1,
    }));
}

function buildMatchupBuckets(resultsByTemplate = []) {
  const rows = mergeTemplateMatchupRows(resultsByTemplate).map((item) => ({
    templateKey: item.templateKey,
    templateLabel: getSourceTemplateLabel(item) || item.templateLabel || humanizeTemplateKey(item.templateKey || item.name || '') || 'Goodstuffs',
    archetypeMetadata: item.archetypeMetadata || undefined,
    winRate: Number(item.winRate || 0),
    gamesPlayed: Number(item.gamesPlayed || 0),
    wins: Number(item.wins || 0),
    losses: Number(item.losses || 0),
    ties: Number(item.ties || 0),
    confidence: getConfidenceLabel(item.gamesPlayed || 0),
  }));

  const goodMatchups = rows
    .filter((item) => item.winRate >= 60)
    .sort((a, b) => (b.winRate - a.winRate) || (b.gamesPlayed - a.gamesPlayed) || a.templateLabel.localeCompare(b.templateLabel))
    .slice(0, 3);

  const neutralMatchups = rows
    .filter((item) => item.winRate >= 40 && item.winRate < 60)
    .sort((a, b) => (Math.abs(b.winRate - 50) - Math.abs(a.winRate - 50)) || (b.gamesPlayed - a.gamesPlayed) || a.templateLabel.localeCompare(b.templateLabel))
    .slice(0, 3);

  const dangerMatchups = rows
    .filter((item) => item.winRate < 40)
    .sort((a, b) => (a.winRate - b.winRate) || (b.gamesPlayed - a.gamesPlayed) || a.templateLabel.localeCompare(b.templateLabel))
    .slice(0, 3);

  return { goodMatchups, neutralMatchups, dangerMatchups };
}

function getSourceTemplateLabel(item = {}) {
  const canonicalLabel = getCanonicalArchetypeLabel(item);
  if (canonicalLabel) return canonicalLabel;
  const candidates = [
    item.templateLabel,
    item.archetype,
    item.opponentArchetype,
    item.championLabArchetype,
    item.name,
    humanizeTemplateKey(item.templateKey || ''),
  ];
  return candidates
    .map((value) => String(value || '').trim())
    .find((value) => value && !isGenericMatchupGuideLabel(value)) || '';
}

function templateLabelDedupeKey(label = '') {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeTemplateMatchupRows(resultsByTemplate = []) {
  const buckets = new Map();
  for (const item of Array.isArray(resultsByTemplate) ? resultsByTemplate : []) {
    if (!item) continue;
    const archetypeMetadata = getArchetypeMetadata(item);
    const canonicalKey = getCanonicalArchetypeKey(item);
    const fallbackMetadata = !archetypeMetadata && (
      item.opponentTeamExport
      || item.teamExport
      || item.playerTeamExport
      || item.userTeamExport
    )
      ? classifyFinalArchetypeFromTeamExport(
        item.opponentTeamExport || item.teamExport || item.playerTeamExport || item.userTeamExport,
        item.templateLabel || item.archetype || item.opponentArchetype || item.templateKey || '',
      )
      : null;
    const finalMetadata = archetypeMetadata || fallbackMetadata;
    const finalLabel = getCanonicalArchetypeLabel({ archetypeMetadata: finalMetadata }) || getSourceTemplateLabel(item) || 'Goodstuffs';
    const finalKey = getCanonicalArchetypeKey({ archetypeMetadata: finalMetadata }) || canonicalKey;
    const key = finalKey || templateLabelDedupeKey(finalLabel) || 'goodstuffs';
    const gamesPlayed = Number(item.gamesPlayed || 0);
    const averageTurns = Number(item.averageTurns || 0);
    const existing = buckets.get(key) || {
      templateKey: finalKey || item.templateKey || key,
      templateKeys: [],
      templateLabel: finalLabel,
      archetypeMetadata: finalMetadata ? { ...finalMetadata } : null,
      opponents: 0,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      failed: 0,
      totalTurns: 0,
    };
    const templateKey = item.templateKey || null;
    if (templateKey && !existing.templateKeys.includes(templateKey)) existing.templateKeys.push(templateKey);
    if (finalKey && !existing.templateKeys.includes(finalKey)) existing.templateKeys.unshift(finalKey);
    if (!existing.archetypeMetadata && finalMetadata) existing.archetypeMetadata = { ...finalMetadata };
    existing.opponents += Number(item.opponents || 0);
    existing.gamesPlayed += gamesPlayed;
    existing.wins += Number(item.wins || 0);
    existing.losses += Number(item.losses || 0);
    existing.ties += Number(item.ties || 0);
    existing.failed += Number(item.failed || item.gamesFailed || 0);
    existing.totalTurns += Number.isFinite(averageTurns) ? averageTurns * gamesPlayed : 0;
    buckets.set(key, existing);
  }

  return Array.from(buckets.values()).map((item) => {
    const gamesPlayed = Number(item.gamesPlayed || 0);
    return {
      ...item,
      opponents: Number(item.opponents || 0) || item.templateKeys.length || 1,
      winRate: gamesPlayed > 0 ? Number(((Number(item.wins || 0) / gamesPlayed) * 100).toFixed(2)) : 0,
      averageTurns: gamesPlayed > 0 ? Number((Number(item.totalTurns || 0) / gamesPlayed).toFixed(2)) : 0,
    };
  });
}

function validateBenchmarkSuitePromotion(report = {}) {
  const errors = [];
  const safe = report && typeof report === 'object' ? report : {};
  const totalGamesCompleted = Number(safe.totalGamesCompleted || 0);
  const totalGamesFailed = Number(safe.totalGamesFailed || 0);

  if (!safe || typeof safe !== 'object') {
    errors.push('missing-report');
  }
  if (safe.completedOk !== true) {
    errors.push('main-simulation-not-completed-ok');
  }
  if (!Number.isFinite(totalGamesCompleted) || totalGamesCompleted <= 0) {
    errors.push('main-simulation-has-no-completed-games');
  }
  if (Number.isFinite(totalGamesFailed) && totalGamesFailed > 0) {
    errors.push('main-simulation-has-failed-games');
  }

  const sweep = safe.leadPairSweep && typeof safe.leadPairSweep === 'object'
    ? safe.leadPairSweep
    : null;
  if (!sweep) {
    errors.push('lead-pair-sweep-missing');
  } else {
    const sweepStatus = String(sweep.status || '').trim().toLowerCase();
    const pairsGenerated = Number(sweep.pairsGenerated || 0);
    const pairsSelected = Number(sweep.pairsSelected || pairsGenerated || 0);
    const pairsTested = Number(sweep.pairsTested || 0);
    const gamesRequested = Number(sweep.gamesRequested || 0);
    const gamesCompleted = Number(sweep.gamesCompleted || 0);
    const replayArtifactsCount = Number(sweep.replayArtifactsCount || 0);
    const missingReplayArtifactsCount = Number(sweep.missingReplayArtifactsCount || 0);

    if (sweepStatus !== 'completed') {
      errors.push(`lead-pair-sweep-status-${sweepStatus || 'missing'}`);
    }
    if (!Number.isFinite(pairsGenerated) || pairsGenerated <= 0) {
      errors.push('lead-pair-sweep-has-no-generated-pairs');
    }
    if (!Number.isFinite(pairsSelected) || pairsSelected <= 0) {
      errors.push('lead-pair-sweep-has-no-selected-pairs');
    }
    if (!Number.isFinite(pairsTested) || pairsTested < pairsSelected) {
      errors.push('lead-pair-sweep-incomplete-pairs');
    }
    if (!Number.isFinite(gamesRequested) || gamesRequested <= 0) {
      errors.push('lead-pair-sweep-has-no-requested-games');
    }
    if (!Number.isFinite(gamesCompleted) || gamesCompleted < gamesRequested) {
      errors.push('lead-pair-sweep-incomplete-games');
    }
    if (sweep.replayArtifactsReady !== true) {
      errors.push('lead-pair-replay-artifacts-not-ready');
    }
    if (Number.isFinite(missingReplayArtifactsCount) && missingReplayArtifactsCount > 0) {
      errors.push('lead-pair-replay-artifacts-missing');
    }
    if (!Number.isFinite(replayArtifactsCount) || replayArtifactsCount < gamesCompleted) {
      errors.push('lead-pair-replay-artifact-count-too-low');
    }
  }

  const coreSweep = safe.coreSweep && typeof safe.coreSweep === 'object'
    ? safe.coreSweep
    : null;
  if (!coreSweep) {
    errors.push('core-sweep-missing');
  } else {
    const coreStatus = String(coreSweep.status || '').trim().toLowerCase();
    const coresGenerated = Number(coreSweep.coresGenerated || 0);
    const coresSelected = Number(coreSweep.coresSelected || coresGenerated || 0);
    const coresTested = Number(coreSweep.coresTested || 0);
    const gamesRequested = Number(coreSweep.gamesRequested || 0);
    const gamesCompleted = Number(coreSweep.gamesCompleted || 0);
    const replayArtifactsCount = Number(coreSweep.replayArtifactsCount || 0);
    const missingReplayArtifactsCount = Number(coreSweep.missingReplayArtifactsCount || 0);

    if (coreStatus !== 'completed') {
      errors.push(`core-sweep-status-${coreStatus || 'missing'}`);
    }
    if (!Number.isFinite(coresGenerated) || coresGenerated <= 0) {
      errors.push('core-sweep-has-no-generated-cores');
    }
    if (!Number.isFinite(coresSelected) || coresSelected <= 0) {
      errors.push('core-sweep-has-no-selected-cores');
    }
    if (!Number.isFinite(coresTested) || coresTested < coresSelected) {
      errors.push('core-sweep-incomplete-cores');
    }
    if (!Number.isFinite(gamesRequested) || gamesRequested <= 0) {
      errors.push('core-sweep-has-no-requested-games');
    }
    if (!Number.isFinite(gamesCompleted) || gamesCompleted < gamesRequested) {
      errors.push('core-sweep-incomplete-games');
    }
    if (coreSweep.replayArtifactsReady !== true) {
      errors.push('core-replay-artifacts-not-ready');
    }
    if (Number.isFinite(missingReplayArtifactsCount) && missingReplayArtifactsCount > 0) {
      errors.push('core-replay-artifacts-missing');
    }
    if (!Number.isFinite(replayArtifactsCount) || replayArtifactsCount < gamesCompleted) {
      errors.push('core-replay-artifact-count-too-low');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function formatBenchmarkSuiteSummary(report = {}) {
  const safe = report || {};
  const resultsByTemplate = Array.isArray(safe.resultsByTemplate) ? safe.resultsByTemplate : [];
  const archiveArchetypeRows = buildArchetypeRowsFromMatchArchive(safe);
  const mergedTemplateRows = archiveArchetypeRows.length
    ? mergeTemplateMatchupRows(archiveArchetypeRows)
    : mergeTemplateMatchupRows(resultsByTemplate);
  const resultsByOpponent = Array.isArray(safe.resultsByOpponent) ? safe.resultsByOpponent : [];
  const pokemonThreats = buildPokemonThreatRowsFromMatchArchive(safe);
  const bestLeadPairs = normalizeLeadPairRowsFromSweep(safe);
  const bestCores = normalizeCoreRowsFromSweep(safe);
  const selectionSummary = safe.selectionSummary && typeof safe.selectionSummary === 'object'
    ? { ...safe.selectionSummary }
    : {};
  const { goodMatchups, neutralMatchups, dangerMatchups } = buildMatchupBuckets(mergedTemplateRows);
  const benchmarkModeLabel = humanizeBenchmarkMode(safe.benchmarkMode || selectionSummary.mode || null);
  const selectedCount = Number(selectionSummary.selectedCount || safe.opponentsRequested || 0);
  const availableOpponents = Number(selectionSummary.availableOpponents || 0);
  const totalRegulationOpponents = Number(selectionSummary.totalRegulationOpponents || 0);
  const poolCount = Number.isFinite(availableOpponents) && availableOpponents > 0
    ? availableOpponents
    : totalRegulationOpponents;
  const userTeamArchetypeMetadata = classifyFinalArchetypeFromTeamExport(
    safe.userTeamExport || safe.playerTeamExport || safe.teamExport || '',
    safe.teamArchetype || safe.archetype || '',
  );
  const userTeamArchetype = getCanonicalArchetypeLabel({ archetypeMetadata: userTeamArchetypeMetadata }) || null;

  const summary = {
    reportType: safe.reportType || 'Benchmark Suite Report',
    benchmarkMode: safe.benchmarkMode || null,
    benchmarkModeLabel,
    formatId: safe.formatId || null,
    selectionSummary,
    opponentPoolLabel: benchmarkModeLabel,
    opponentPoolCount: Number.isFinite(poolCount) && poolCount > 0 ? poolCount : null,
    opponentSelectionCount: Number.isFinite(selectedCount) && selectedCount > 0 ? selectedCount : null,
    sourceFields: {
      summary: 'completed-suite-report',
      archetypeRows: mergedTemplateRows.length ? 'resultsByTemplate' : null,
      opponentRows: resultsByOpponent.length ? 'resultsByOpponent' : null,
      threatRows: pokemonThreats.length ? 'matchArchive.sources[].opponentTeamExport/result' : null,
      leadRows: bestLeadPairs.length ? 'leadPairSweep.results' : null,
      coreRows: bestCores.length ? 'coreSweep.results' : null,
    },
    hasRealArchetypeRows: mergedTemplateRows.length > 0,
    hasRealOpponentRows: resultsByOpponent.length > 0,
    hasRealPokemonThreatRows: pokemonThreats.length > 0,
    hasRealLeadPairRows: bestLeadPairs.length > 0,
    hasRealCoreRows: bestCores.length > 0,
    teamArchetype: userTeamArchetype,
    teamArchetypeMetadata: userTeamArchetypeMetadata,
    wins: Number(safe.wins || 0),
    losses: Number(safe.losses || 0),
    ties: Number(safe.ties || 0),
    winRate: Number(safe.winRate || 0),
    averageTurns: Number(safe.averageTurns || 0),
    opponentsRequested: Number(safe.opponentsRequested || 0),
    opponentsCompleted: Number(safe.opponentsCompleted || 0),
    totalGamesRequested: Number(safe.totalGamesRequested || 0),
    totalGamesAttempted: Number(safe.totalGamesAttempted || 0),
    totalGamesCompleted: Number(safe.totalGamesCompleted || 0),
    totalGamesFailed: Number(safe.totalGamesFailed || (safe.failureSummary && safe.failureSummary.failedGames) || 0),
    goodMatchups: goodMatchups.map((item) => ({
      ...item,
      winChance: formatWinChanceValue(item.winRate),
    })),
    neutralMatchups: neutralMatchups.map((item) => ({
      ...item,
      winChance: formatWinChanceValue(item.winRate),
    })),
    dangerMatchups: dangerMatchups.map((item) => ({
      ...item,
      winChance: formatWinChanceValue(item.winRate),
    })),
    practiceFirst: dangerMatchups.length ? `${dangerMatchups[0].templateLabel} (${formatWinChanceValue(dangerMatchups[0].winRate)})` : null,
    templateBreakdown: mergedTemplateRows.map((item) => ({
      templateKey: item.templateKey,
      templateKeys: Array.isArray(item.templateKeys) ? item.templateKeys : undefined,
      templateLabel: getSourceTemplateLabel(item) || item.templateLabel || humanizeTemplateKey(item.templateKey || item.name || '') || 'Goodstuffs',
      archetypeMetadata: item.archetypeMetadata || undefined,
      winRate: Number(item.winRate || 0),
      winChance: formatWinChanceValue(item.winRate),
      gamesPlayed: Number(item.gamesPlayed || 0),
      gamesAttempted: Number(item.gamesAttempted || item.gamesPlayed || 0),
      gamesFailed: Number(item.gamesFailed || 0),
      averageTurns: Number(item.averageTurns || 0),
      confidence: getConfidenceLabel(item.gamesPlayed || 0),
      wins: Number(item.wins || 0),
      losses: Number(item.losses || 0),
      ties: Number(item.ties || 0),
    })),
    pokemonThreats,
    bestLeadPairs,
    bestCores,
    leadPairSweep: safe.leadPairSweep && typeof safe.leadPairSweep === 'object'
      ? {
        status: safe.leadPairSweep.status || null,
        profile: safe.leadPairSweep.profile || null,
        pairsGenerated: Number(safe.leadPairSweep.pairsGenerated || 0),
        pairsSelected: Number(safe.leadPairSweep.pairsSelected || 0),
        finalistLimit: Number(safe.leadPairSweep.finalistLimit || 0),
        pairsTested: Number(safe.leadPairSweep.pairsTested || 0),
        gamesRequested: Number(safe.leadPairSweep.gamesRequested || 0),
        gamesCompleted: Number(safe.leadPairSweep.gamesCompleted || 0),
        replayArtifactsReady: Boolean(safe.leadPairSweep.replayArtifactsReady),
        replayArtifactsCount: Number(safe.leadPairSweep.replayArtifactsCount || 0),
        missingReplayArtifactsCount: Number(safe.leadPairSweep.missingReplayArtifactsCount || 0),
        replayArtifactSource: safe.leadPairSweep.replayArtifactSource || null,
        runtimeMs: Number(safe.leadPairSweep.runtimeMs || 0),
      }
      : null,
    coreSweep: safe.coreSweep && typeof safe.coreSweep === 'object'
      ? {
        status: safe.coreSweep.status || null,
        profile: safe.coreSweep.profile || null,
        coresGenerated: Number(safe.coreSweep.coresGenerated || 0),
        coresSelected: Number(safe.coreSweep.coresSelected || 0),
        finalistLimit: Number(safe.coreSweep.finalistLimit || 0),
        coresTested: Number(safe.coreSweep.coresTested || 0),
        gamesRequested: Number(safe.coreSweep.gamesRequested || 0),
        gamesCompleted: Number(safe.coreSweep.gamesCompleted || 0),
        replayArtifactsReady: Boolean(safe.coreSweep.replayArtifactsReady),
        replayArtifactsCount: Number(safe.coreSweep.replayArtifactsCount || 0),
        missingReplayArtifactsCount: Number(safe.coreSweep.missingReplayArtifactsCount || 0),
        replayArtifactSource: safe.coreSweep.replayArtifactSource || null,
        runtimeMs: Number(safe.coreSweep.runtimeMs || 0),
      }
      : null,
    generatedAt: safe.generatedAt || null,
    generatedDiscord: formatDiscordTimestampFromIso(safe.generatedAt || null),
    noteText: safe.noteText || null,
  };

  summary.takeaway = buildBenchmarkSuiteTakeaway(summary);
  summary.deterministicAnalysis = buildDeterministicReportAnalyzer(summary);
  return summary;
}

function summarizeMockWorkerLoad() {
  const jobCounts = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  for (const job of mockJobs.values()) {
    const status = String(job?.status || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(jobCounts, status)) {
      jobCounts[status] += 1;
    }
  }
  return {
    jobCounts,
    resourceState: {
      activeBattles: 0,
      activeSuiteJobs: jobCounts.queued + jobCounts.running,
      containedFailures: 0,
      launchedBattles: 0,
      scoredBattles: 0,
    },
    cpuPercent: null,
    benchmarkActive: jobCounts.queued > 0 || jobCounts.running > 0,
  };
}

async function pingBenchMarkWorker() {
  const config = getBenchMarkWorkerConfig();
  if (config.mode === 'mock') {
    return {
      ok: true,
      mode: 'mock',
      statusText: 'Local mock worker ready',
      detailText: 'No external worker process required yet',
    };
  }
  const result = await requestJson('GET', `${config.url}/health`);
  return {
    ok: true,
    mode: 'http',
    statusText: result?.statusText || 'Local worker reachable',
    detailText: result?.detailText || config.url,
  };
}

async function getBenchMarkWorkerLoadSnapshot() {
  const config = getBenchMarkWorkerConfig();
  if (config.mode === 'mock') {
    const mockLoad = summarizeMockWorkerLoad();
    return {
      ok: true,
      mode: 'mock',
      statusText: mockLoad.benchmarkActive ? 'Mock BenchMark jobs active' : 'Mock BenchMark idle',
      detailText: 'Mock worker load snapshot',
      readiness: { ok: true, ready: true, status: 'ready' },
      ...mockLoad,
    };
  }

  const result = await requestJson('GET', `${config.url}/health`);
  const jobCounts = result?.jobCounts || {};
  const resourceState = result?.resourceState || {};
  const queued = Number(jobCounts.queued || 0);
  const running = Number(jobCounts.running || 0);
  const activeBattles = Number(resourceState.activeBattles || 0);
  const activeSuiteJobs = Number(resourceState.activeSuiteJobs || 0);
  const cpuPercent = Number.isFinite(Number(result?.cpuPercent)) ? Number(result.cpuPercent) : null;
  return {
    ...result,
    ok: Boolean(result?.ok ?? true),
    mode: 'http',
    jobCounts,
    resourceState,
    cpuPercent,
    readiness: result?.readiness || null,
    benchmarkActive: Boolean(
      result?.benchmarkActive
      || queued > 0
      || running > 0
      || activeBattles > 0
      || activeSuiteJobs > 0
      || result?.readiness?.warmupActive
      || String(result?.readiness?.status || '').toLowerCase() === 'warming',
    ),
  };
}

async function getBenchMarkWorkerCapabilities(formatId = null) {
  const config = getBenchMarkWorkerConfig();
  if (config.mode === 'mock') {
    return {
      ok: true,
      mode: 'mock',
      supportedJobs: ['weakness-report', 'matchup-eval', 'simulate-matchup', 'run-battle-series', 'run-benchmark-suite'],
      benchmarkModes: listBenchmarkModes(null, { formatId }),
      showdown: { enabled: false, fullyReady: false },
      templates: [],
    };
  }
  const result = await requestJson('GET', `${config.url}/capabilities`);
  return {
    ...result,
    benchmarkModes: listBenchmarkModes(result?.benchmarkModes, { formatId }),
  };
}

async function getBenchMarkWorkerReadiness() {
  const config = getBenchMarkWorkerConfig();
  if (config.mode === 'mock') {
    return {
      ok: true,
      ready: true,
      mode: 'mock',
      status: 'ready',
      statusText: 'Mock BenchMark worker ready',
      detailText: 'No external worker process required.',
      checks: { workerListening: true, localBattleExecutionReady: true },
    };
  }

  try {
    const result = await requestJson('GET', `${config.url}/ready`);
    return { ...result, ready: Boolean(result?.ready ?? result?.ok) };
  } catch (error) {
    const payload = error?.payload || null;
    if (payload?.readiness || payload?.status || error?.statusCode === 503) {
      const readiness = payload?.readiness || payload || {};
      return {
        ...readiness,
        ok: false,
        ready: false,
        status: readiness.status || 'not-ready',
        statusText: readiness.statusText || 'BenchMark execution path not ready',
        detailText: readiness.detailText || payload?.error || error?.message || 'BenchMark worker is not ready yet.',
        error: payload?.error || error?.message || null,
        retryable: payload?.retryable !== false,
      };
    }
    throw error;
  }
}

async function validateTeamWithWorker({ teamExport, formatId = null }) {
  const config = getBenchMarkWorkerConfig();
  if (config.mode === 'mock') {
    return {
      ok: true,
      formatId,
      validation: { valid: true, messages: 'Mock validation path used.' },
      packing: { ok: false, packedTeam: null },
    };
  }
  return requestJson('POST', `${config.url}/showdown/validate-team`, {
    team_export: teamExport,
    format_id: formatId,
  });
}

async function submitWeaknessReportJob({ userId, teamExport }) {
  const config = getBenchMarkWorkerConfig();
  if (config.mode === 'mock') {
    const job = createMockJob('weakness-report', userId);
    finalizeMockJob(job.jobId, () => buildWeaknessReportFromTeam(teamExport));
    return {
      ok: true,
      mode: 'mock',
      jobId: job.jobId,
      jobType: job.jobType,
      status: 'queued',
      submittedAt: job.submittedAt,
    };
  }
  return requestJson('POST', `${config.url}/jobs/weakness-report`, {
    user_id: userId,
    team_export: teamExport,
  });
}

async function submitMatchupEvalJob({ userId, teamExport, templateKeys = [], battleCount = 20 }) {
  const config = getBenchMarkWorkerConfig();
  if (config.mode === 'mock') {
    const job = createMockJob('matchup-eval', userId);
    finalizeMockJob(job.jobId, () => buildMatchupEvalFromTeam(teamExport, templateKeys, battleCount, false));
    return {
      ok: true,
      mode: 'mock',
      jobId: job.jobId,
      jobType: job.jobType,
      status: 'queued',
      submittedAt: job.submittedAt,
    };
  }
  return requestJson('POST', `${config.url}/jobs/matchup-eval`, {
    user_id: userId,
    team_export: teamExport,
    template_keys: templateKeys,
    battle_count: battleCount,
  });
}

async function submitSimMatchupJob({ userId, teamExport, templateKeys = [], battleCount = 20, formatId = null }) {
  const config = getBenchMarkWorkerConfig();
  if (config.mode === 'mock') {
    const job = createMockJob('simulate-matchup', userId);
    finalizeMockJob(job.jobId, () => buildSimMatchupScaffold(teamExport, templateKeys, battleCount, false, formatId));
    return {
      ok: true,
      mode: 'mock',
      jobId: job.jobId,
      jobType: job.jobType,
      status: 'queued',
      submittedAt: job.submittedAt,
    };
  }
  return requestJson('POST', `${config.url}/jobs/simulate-matchup`, {
    user_id: userId,
    team_export: teamExport,
    template_keys: templateKeys,
    battle_count: battleCount,
    format_id: formatId,
  });
}

async function submitBattleSeriesJob({ userId, teamExport, opponentId = null, templateKey = null, games = 3, formatId = null }) {
  const config = getBenchMarkWorkerConfig();
  if (config.mode === 'mock') {
    const job = createMockJob('run-battle-series', userId);
    finalizeMockJob(job.jobId, () => ({
      reportType: 'Mock Battle Series',
      noteText: 'Mock fallback does not run real battles.',
      gamesRequested: games,
      generatedAt: new Date().toISOString(),
    }));
    return {
      ok: true,
      mode: 'mock',
      jobId: job.jobId,
      jobType: job.jobType,
      status: 'queued',
      submittedAt: job.submittedAt,
    };
  }
  return requestJson('POST', `${config.url}/jobs/run-battle-series`, {
    user_id: userId,
    team_export: teamExport,
    opponent_id: opponentId,
    template_key: templateKey,
    games,
    format_id: formatId,
  });
}

async function submitBenchmarkSuiteJob({
  userId,
  teamExport,
  teamHash = null,
  mode = MODE_ALL_META_TOURNAMENT,
  sampleSize = null,
  sampleSeed = null,
  battleBudget = DEFAULT_BENCHMARK_BATTLE_BUDGET,
  gamesPerOpponent = 3,
  formatId = null,
  submitTimeoutMs = null,
}) {
  const config = getBenchMarkWorkerConfig();
  const normalizedMode = normalizeBenchmarkMode(mode);
  const normalizedGamesPerOpponent = normalizeBenchmarkSuiteGamesPerOpponent(gamesPerOpponent, formatId);
  const normalizedBattleBudget = normalizeBenchmarkBattleBudget(battleBudget);
  if (config.mode === 'mock') {
    const job = createMockJob('run-benchmark-suite', userId);
    const fixedPoolMode = isChampionLabFixedPoolMode(normalizedMode);
    const sweepMode = isBenchmarkFullPoolMode(normalizedMode);
    const executableCount = fixedPoolMode
      ? getExecutableChampionLabModeCount(normalizedMode, countBenchmarkRepoTeams(formatId).teamCount)
      : sampleSize;
    const allocatedGamesPerOpponent = getAllocatedGamesPerOpponent(executableCount, normalizedBattleBudget);
    const expectedTotalGames = getExpectedTotalGames(executableCount, normalizedBattleBudget);
    finalizeMockJob(job.jobId, () => buildMockBenchmarkSuiteReport({
      mode: normalizedMode,
      sampleSize: executableCount,
      battleBudget: normalizedBattleBudget,
      gamesPerOpponent: allocatedGamesPerOpponent,
      formatId,
    }));
    return {
      ok: true,
      mode: 'mock',
      jobId: job.jobId,
      jobType: job.jobType,
      status: 'queued',
      submittedAt: job.submittedAt,
      benchmarkMode: normalizedMode,
      battleBudget: normalizedBattleBudget,
      battlesPerMatchup: normalizedBattleBudget,
      gamesPerOpponent: allocatedGamesPerOpponent,
      selectedOpponents: sweepMode ? null : executableCount,
      selectionSummary: {
        requestedSampleSize: fixedPoolMode ? null : sampleSize,
        sampleSizeIgnored: fixedPoolMode,
        selectionSeed: sampleSeed,
        selectedCount: executableCount,
        availableOpponents: fixedPoolMode ? executableCount : sampleSize,
        targetOpponentCount: getChampionLabTargetCount(normalizedMode),
        battleBudget: normalizedBattleBudget,
        battlesPerMatchup: normalizedBattleBudget,
        battleBudgetAllocationRule: 'championslab-min-one-per-opponent-floor-budget',
        allocatedGamesPerOpponent,
        expectedTotalGames,
        sweepMode,
        sweepModeLabel: sweepMode ? `${normalizedMode}-sweep` : null,
        excludesUserTeams: sweepMode,
      },
    };
  }

  return requestJson(
    'POST',
    `${config.url}/jobs/run-benchmark-suite`,
    {
      user_id: userId,
      team_export: teamExport,
      team_hash: cleanText(teamHash),
      mode: normalizedMode,
      sample_size: sampleSize,
      sample_seed: sampleSeed,
      battle_budget: normalizedBattleBudget,
      games_per_opponent: normalizedGamesPerOpponent,
      format_id: formatId,
    },
    {
      timeoutMs: Number.isFinite(Number(submitTimeoutMs)) && Number(submitTimeoutMs) > 0
        ? Number(submitTimeoutMs)
        : (Number.isFinite(SUITE_SUBMIT_TIMEOUT_MS) && SUITE_SUBMIT_TIMEOUT_MS > 0
          ? SUITE_SUBMIT_TIMEOUT_MS
          : 30000),
    },
  );
}

function buildBenchmarkJobStatusUrl(config, jobId, options = {}) {
  const includeReport = options?.includeReport !== false;
  const suffix = includeReport ? '' : '?include_report=0';
  return `${config.url}/jobs/${encodeURIComponent(String(jobId || ''))}${suffix}`;
}

async function getBenchmarkJobStatus(jobId, options = {}) {
  const config = getBenchMarkWorkerConfig();
  if (config.mode === 'mock') return getMockJobStatus(jobId);
  const includeReport = options?.includeReport !== false;
  const requestedTimeoutMs = Number(options?.timeoutMs);
  const defaultTimeoutMs = includeReport
    ? (Number.isFinite(REPORT_FETCH_TIMEOUT_MS) && REPORT_FETCH_TIMEOUT_MS > 0 ? REPORT_FETCH_TIMEOUT_MS : 120000)
    : (Number.isFinite(JOB_STATUS_TIMEOUT_MS) && JOB_STATUS_TIMEOUT_MS > 0 ? JOB_STATUS_TIMEOUT_MS : config.timeoutMs);
  return requestJson('GET', buildBenchmarkJobStatusUrl(config, jobId, { includeReport }), null, {
    timeoutMs: Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0 ? requestedTimeoutMs : defaultTimeoutMs,
  });
}


async function cancelBenchmarkJob(jobId) {
  const config = getBenchMarkWorkerConfig();
  if (config.mode === 'mock') {
    const job = mockJobs.get(String(jobId || ''));
    if (!job) {
      return { ok: false, mode: 'mock', status: 'missing', error: 'BenchMark job was not found.' };
    }
    if (!['completed', 'failed', 'cancelled'].includes(String(job.status || '').toLowerCase())) {
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      job.error = null;
    }
    return {
      ok: true,
      mode: 'mock',
      jobId: job.jobId,
      jobType: job.jobType,
      status: job.status,
      submittedAt: job.submittedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      report: job.report,
    };
  }
  return requestJson('POST', `${config.url}/jobs/${encodeURIComponent(String(jobId || ''))}/cancel`);
}

async function getWeaknessReportJobStatus(jobId) {
  return getBenchmarkJobStatus(jobId);
}

module.exports = {
  INSTANT_MODE_RESULT_CONTRACT,
  buildInstantModePaperReportPayloadFixture,
  buildInstantModeResultFixture,
  getBenchMarkWorkerConfig,
  buildMockWeaknessReportFromTeam: buildWeaknessReportFromTeam,
  listBenchmarkModes,
  countBenchmarkAegisOpponentPoolTeams,
  formatBenchmarkSuiteSummary,
  validateBenchmarkSuitePromotion,
  pingBenchMarkWorker,
  getBenchMarkWorkerLoadSnapshot,
  getBenchMarkWorkerCapabilities,
  getBenchMarkWorkerReadiness,
  validateTeamWithWorker,
  submitWeaknessReportJob,
  submitMatchupEvalJob,
  submitSimMatchupJob,
  submitBattleSeriesJob,
  submitBenchmarkSuiteJob,
  getBenchmarkJobStatus,
  cancelBenchmarkJob,
  getWeaknessReportJobStatus,
};
