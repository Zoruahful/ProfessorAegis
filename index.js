require('dotenv').config();

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const {
  initializeDatabase,
  ensurePlayerExists,
  getPlayerById,
  getPlayerStats,
  getTopPlayers,
  resetSeasonStatsForAllPlayers,
  syncRegisteredStateForSeason,
  syncAcademyMembers,
  listAcademyMembers,
  hasSeasonTeamForSeason,
  upsertSeasonTeam,
  isShowdownNameTakenByAnotherUser,
  deleteSeasonTeamForSeason,
  getSeasonTeamForSeason,
  listTeamSeasonsForUser,
  getPendingIncomingChallengeForUser,
  getPendingOutgoingChallengeForUser,
  getActiveBattleForUser,
  getLatestUnresolvedBattleForUser,
  createBattleChallenge,
  setBattleRoomInfo,
  getBattleByRoomChannelId,
  getBattleById,
  getBattleGamesForBattle,
  getCurrentBattleGame,
  getBattleGameById,
  getBattleGameByNumber,
  acceptBattleChallenge,
  declineBattleChallenge,
  cancelBattleChallenge,
  attachShowdownLinkToGame,
  setBattleGameSpectatorState,
  completeBattleGameFromSpectator,
  setBattleReplayUrlForGame,
  cancelAllUnresolvedBattles,
  nukeDatabase,
  getStateValueJSON,
  setStateValueJSON,
  getBenchmarkTeamState,
  setBenchmarkTeamState,
  getBenchmarkLatestJobState,
  upsertBenchmarkJobState,
  getBenchmarkLatestReport,
  getBenchmarkLatestReportMeta,
  saveBenchmarkLatestReport,
  listBenchmarkJobHistoryForUser,
  initializePostgresIntegration,
  getPostgresRuntimeStatus,
  getPostgresPool,
  normalizeBenchmarkPersistenceOnStartup,
  clearBenchmarkToolData,
  clearBenchmarkUserDataExceptTeam,
} = require('./services/database');

const {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionsBitField,
} = require('discord.js');

const {
  getLeagueState,
  startLeagueSeason,
  endLeagueSeason,
  buildSeasonAnnouncementData,
  setBattleRoomCategory,
  setRegulationInfo,
  clearRegulationInfo,
  setPlayoffMinimumMatches,
  buildDiscordTimestamp,
  getEtParts,
} = require('./services/leagueState');

const {
  resolveAnnouncementChannel,
  queueSeasonStartedAnnouncement,
  queueSeasonEndedAnnouncement,
} = require('./services/announcementService');

const {
  getPendingReminder,
  getReminderMessagePayload,
  markReminderSent,
} = require('./services/leagueScheduler');

const { makeCustomId, parseCustomId, buildTrainerSelectRow } = require('./services/menuCommon');

const {
  buildPublicMenuEmbed,
  buildPublicMenuRow,
  buildPrivateMainMenuEmbed,
  buildPrivateMainMenuShellEmbed,
  buildPrivateSectionShellEmbed,
  buildPrivateMainMenuRow,
} = require('./services/MainMenu');

const {
  buildRegistrationsMenuEmbed,
  buildRegistrationsMenuRow,
  buildRegistrationTeamModal,
} = require('./services/Registration');

const {
  buildProfileMenuEmbed,
  buildProfileMenuRow,
  buildProfileEmbed,
} = require('./services/Profile');

const {
  buildTeamsMenuEmbed,
  buildTeamsMenuRow,
  buildNoTeamsEmbed,
  buildViewTrainerTeamsEmbed,
  buildTeamSeasonSelectRow,
  buildTeamDisplayEmbed,
} = require('./services/Teams');

const {
  buildLeagueMenuEmbed,
  buildLeagueMenuRow,
  buildLeaderboardEmbed,
  buildMyLeagueEmbed,
  buildTrainerLeagueEmbed,
} = require('./services/League');

const {
  buildBattleMenuEmbed,
  buildBattleMenuRow,
  buildBattleOpenChallengersEmbed,
  buildBattleOpponentSelectRow,
  buildBattleRoomEmbed,
  buildBattleRoomSharedRow,
  buildBattleControlPanelEmbed,
  buildBattleControlPanelRows,
  buildBattleAttachLinkModal,
  buildBattleArchiveReplayModal,
} = require('./services/Battle');

const {
  buildBenchMarkMenuEmbed,
  buildBenchMarkMenuShellEmbed,
  buildBenchMarkMenuRow,
  buildBenchMarkMenuShellRow,
  buildBenchMarkInstantModeShellEmbed,
  buildBenchMarkInstantModeShellRow,
  buildBenchMarkInstantProjectionResultEmbed,
  buildBenchMarkInstantProjectionReportTabRow,
  buildBenchMarkInstantProjectionResultRow,
  buildBenchMarkSuiteLeadPairProgressBlock,
  buildBenchMarkSuiteDownloadRow,
  buildBenchMarkTeamModal,
  buildBenchMarkSubmittedTeamEmbed,
  buildBenchMarkSubmittedTeamExportRow,
  buildBenchMarkReportEmbed,
  buildBenchMarkMatchupEvalEmbed,
  buildBenchMarkSuiteEmbed,
  buildBenchMarkSuiteConfigEmbed,
  buildBenchMarkSuiteConfigShellEmbed,
  buildBenchMarkSuiteReportShellEmbed,
  buildBenchMarkSuiteHistoryShellEmbed,
  buildBenchMarkLoadTeamShellEmbed,
  buildBenchMarkSuiteConfigRow,
  buildBenchMarkSuiteFormatRow,
  buildBenchMarkSuiteModeRow,
  buildBenchMarkSuiteBattleBudgetRow,
  buildBenchMarkSuiteGamesPerOpponentRow,
  buildBenchMarkSuiteReportTabRow,
  buildBenchMarkSuiteHistoryRow,
  buildBenchMarkLoadTeamRow,
  buildBenchMarkClearDataConfirmEmbed,
  buildBenchMarkClearDataConfirmRow,
} = require('./services/BenchMark');
const { buildBenchmarkPaperReportPdfAttachment } = require('./services/benchmark_paper_report');
const { tryCreateInstantProjectionResult } = require('./services/instant_projection_service');

const {
  submitWeaknessReportJob,
  submitMatchupEvalJob,
  submitBenchmarkSuiteJob,
  getBenchMarkWorkerReadiness,
  getBenchmarkJobStatus,
  cancelBenchmarkJob,
  getWeaknessReportJobStatus,
  formatBenchmarkSuiteSummary,
  validateBenchmarkSuitePromotion,
  getBenchMarkWorkerCapabilities,
} = require('./services/benchmarkService');
const {
  CHAMPIONS_SP_FORMAT_ID,
  buildChampionsSpDisplayTeamExport,
  convertChampionsSpTeamExportForShowdown,
  detectChampionsSpTeamMode,
  validateChampionsSpTeamShape,
} = require('./services/championsSpTeamParser');

const {
  buildAdminPanelEmbed,
  buildAdminPanelRow,
  buildLeagueControlEmbed,
  buildLeagueControlRow,
  buildBattleCategoryEmbed,
  buildBattleCategorySelectRow,
  buildRegulationModal,
  buildPlayoffMinimumModal,
} = require('./services/Admin');

const {
  parseShowdownBattleLink,
  startSpectatorSession,
  stopSpectatorSession,
} = require('./services/showdownSpectator');

function csvEnv(name) {
  return String(process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const TRAINER_ROLE_ID = String(process.env.TRAINER_ROLE_ID || '').trim();
const ADMIN_USER_IDS = csvEnv('ADMIN_USER_IDS');
const ADMIN_ROLE_IDS = csvEnv('ADMIN_ROLE_IDS');
const ACADEMY_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const benchmarkSuitePollers = new Map();
const benchmarkWarmupUiPollers = new Map();
const benchmarkMenuPayloadCache = new Map();
const benchmarkMenuSnapshotCache = new Map();
const benchmarkMenuSnapshotRefreshes = new Map();
const benchmarkMenuStateCache = new Map();
const benchmarkSuiteReportCache = new Map();
const benchmarkSuiteHistoryReportsCache = new Map();
const benchmarkSuiteCapabilitiesCache = new Map();
const benchmarkSuiteCapabilitiesRefreshes = new Map();
const benchmarkSuiteSettingsSnapshotCache = new Map();
const mainMenuPayloadCache = new Map();
const menuHydrationTokens = new Map();
const menuTimingSamples = [];
let botDebugServer = null;
const BENCHMARK_MENU_PAYLOAD_CACHE_TTL_MS = Number(process.env.BENCHMARK_MENU_PAYLOAD_CACHE_TTL_MS || 15000);
const BENCHMARK_MENU_SNAPSHOT_CACHE_TTL_MS = Number(process.env.BENCHMARK_MENU_SNAPSHOT_CACHE_TTL_MS || 60000);
const BENCHMARK_MENU_STATE_CACHE_TTL_MS = Number(process.env.BENCHMARK_MENU_STATE_CACHE_TTL_MS || 15000);
const BENCHMARK_MENU_ACTIVE_STATE_CACHE_TTL_MS = Number(process.env.BENCHMARK_MENU_ACTIVE_STATE_CACHE_TTL_MS || 750);
const BENCHMARK_SUITE_REPORT_CACHE_TTL_MS = Number(process.env.BENCHMARK_SUITE_REPORT_CACHE_TTL_MS || 60000);
const BENCHMARK_HISTORY_REPORTS_CACHE_TTL_MS = Number(process.env.BENCHMARK_HISTORY_REPORTS_CACHE_TTL_MS || 60000);
const MENU_TIMING_WARN_MS = Number(process.env.MENU_TIMING_WARN_MS || 750);
const MENU_TIMING_SAMPLE_LIMIT = 200;
const MENU_TIMING_VERBOSE = ['1', 'true', 'yes'].includes(String(process.env.MENU_TIMING_VERBOSE || '').toLowerCase());
const BOT_DEBUG_SERVER_ENABLED = String(process.env.AEGIS_BOT_DEBUG_SERVER_ENABLED || '1').trim() !== '0';
const BOT_DEBUG_HOST = '127.0.0.1';
const BOT_DEBUG_PORT = Number(process.env.AEGIS_BOT_DEBUG_PORT || 8788);
const MENU_TIMING_PHASES = {
  ack: {
    targetMs: Number(process.env.MENU_TIMING_ACK_TARGET_MS || 500),
    warnMs: Number(process.env.MENU_TIMING_ACK_WARN_MS || 1000),
  },
  shell: {
    targetMs: Number(process.env.MENU_TIMING_SHELL_TARGET_MS || 750),
    warnMs: Number(process.env.MENU_TIMING_SHELL_WARN_MS || 1200),
  },
  hydrate: {
    targetMs: Number(process.env.MENU_TIMING_HYDRATE_TARGET_MS || 2000),
    warnMs: Number(process.env.MENU_TIMING_HYDRATE_WARN_MS || 5000),
  },
  total: {
    targetMs: Number(process.env.MENU_TIMING_TOTAL_TARGET_MS || 2500),
    warnMs: Number(process.env.MENU_TIMING_TOTAL_WARN_MS || 6000),
  },
};
const BENCHMARK_SUITE_CAPABILITIES_CACHE_TTL_MS = Number(process.env.BENCHMARK_SUITE_CAPABILITIES_CACHE_TTL_MS || 300000);
const BENCHMARK_SUITE_SETTINGS_SNAPSHOT_CACHE_TTL_MS = Number(process.env.BENCHMARK_SUITE_SETTINGS_SNAPSHOT_CACHE_TTL_MS || 5000);
const BENCHMARK_MODAL_PREFILL_TIMEOUT_MS = Number(process.env.BENCHMARK_MODAL_PREFILL_TIMEOUT_MS || 1000);
const MAIN_MENU_PAYLOAD_CACHE_TTL_MS = Number(process.env.MAIN_MENU_PAYLOAD_CACHE_TTL_MS || 15000);

function clearBenchMarkMenuPayloadCache(userId = null) {
  if (userId) {
    const key = String(userId);
    benchmarkMenuPayloadCache.delete(key);
    benchmarkMenuStateCache.delete(key);
    clearBenchMarkSuiteReportCache(userId);
    clearBenchMarkSuiteHistoryReportsCache(userId);
    return;
  }
  benchmarkMenuPayloadCache.clear();
  benchmarkMenuStateCache.clear();
  clearBenchMarkSuiteReportCache();
  clearBenchMarkSuiteHistoryReportsCache();
}

function clearBenchMarkMenuSnapshotCache(userId = null) {
  if (userId) {
    benchmarkMenuSnapshotCache.delete(String(userId));
    return;
  }
  benchmarkMenuSnapshotCache.clear();
}

function clearBenchMarkMenuStateCache(userId = null) {
  if (userId) {
    benchmarkMenuStateCache.delete(String(userId));
    return;
  }
  benchmarkMenuStateCache.clear();
}

function clearBenchMarkSuiteSettingsSnapshotCache(userId = null) {
  if (userId) {
    benchmarkSuiteSettingsSnapshotCache.delete(String(userId));
    return;
  }
  benchmarkSuiteSettingsSnapshotCache.clear();
}

function clearBenchMarkSuiteReportCache(userId = null) {
  if (!userId) {
    benchmarkSuiteReportCache.clear();
    return;
  }
  const prefix = `${String(userId)}:`;
  for (const key of Array.from(benchmarkSuiteReportCache.keys())) {
    if (String(key).startsWith(prefix)) {
      benchmarkSuiteReportCache.delete(key);
    }
  }
}

function clearBenchMarkSuiteHistoryReportsCache(userId = null) {
  if (!userId) {
    benchmarkSuiteHistoryReportsCache.clear();
    return;
  }
  const prefix = `${String(userId)}:`;
  for (const key of Array.from(benchmarkSuiteHistoryReportsCache.keys())) {
    if (String(key).startsWith(prefix)) {
      benchmarkSuiteHistoryReportsCache.delete(key);
    }
  }
}

function clearBenchMarkMenuCaches(userId = null) {
  clearBenchMarkMenuPayloadCache(userId);
  clearBenchMarkMenuSnapshotCache(userId);
  clearBenchMarkMenuStateCache(userId);
  clearBenchMarkSuiteSettingsSnapshotCache(userId);
  clearBenchMarkSuiteReportCache(userId);
  clearBenchMarkSuiteHistoryReportsCache(userId);
}

function resolveMenuTimingNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getMenuTimingPhaseConfig(phase = null, overrides = {}) {
  const config = MENU_TIMING_PHASES[phase] || {};
  const fallbackWarnMs = resolveMenuTimingNumber(MENU_TIMING_WARN_MS, 750);
  const warnMs = resolveMenuTimingNumber(overrides.warnMs, resolveMenuTimingNumber(config.warnMs, fallbackWarnMs));
  const targetMs = resolveMenuTimingNumber(overrides.targetMs, resolveMenuTimingNumber(config.targetMs, warnMs));
  return { targetMs, warnMs };
}

function sanitizeMenuTimingLabel(value = 'unknown') {
  const cleaned = String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
  return cleaned || 'unknown';
}

function resolveMenuTimingSeverity(elapsedMs, targetMs, warnMs) {
  if (elapsedMs >= warnMs) return 'warn';
  if (elapsedMs >= targetMs) return 'target-miss';
  return 'ok';
}

function parseMenuTimingLabel(label = 'unknown', fallbackPhase = 'unknown') {
  const safeLabel = sanitizeMenuTimingLabel(label);
  const match = safeLabel.match(/^menu\.(ack|shell|hydrate|total)\.(.+)$/);
  const phase = match?.[1] || (['ack', 'shell', 'hydrate', 'total'].includes(fallbackPhase) ? fallbackPhase : 'unknown');
  const path = sanitizeMenuTimingLabel(match?.[2] || safeLabel);
  return { label: safeLabel, phase, path };
}

function recordMenuTimingSample(label, elapsedMs, options = {}, timingConfig = {}) {
  const targetMs = resolveMenuTimingNumber(timingConfig.targetMs, 0);
  const warnMs = resolveMenuTimingNumber(timingConfig.warnMs, targetMs || MENU_TIMING_WARN_MS);
  const safeElapsedMs = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.round(elapsedMs) : 0;
  const parsed = parseMenuTimingLabel(label, options.phase);
  const sample = {
    timestamp: new Date().toISOString(),
    label: parsed.label,
    path: parsed.path,
    phase: parsed.phase,
    elapsedMs: safeElapsedMs,
    targetMs,
    warnMs,
    severity: resolveMenuTimingSeverity(safeElapsedMs, targetMs, warnMs),
  };
  menuTimingSamples.push(sample);
  while (menuTimingSamples.length > MENU_TIMING_SAMPLE_LIMIT) {
    menuTimingSamples.shift();
  }
  return sample;
}

function getMenuTimingSamples({ limit = MENU_TIMING_SAMPLE_LIMIT } = {}) {
  const safeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(Number(limit), MENU_TIMING_SAMPLE_LIMIT)
    : MENU_TIMING_SAMPLE_LIMIT;
  return menuTimingSamples.slice(-safeLimit);
}

function buildMenuTimingDebugPayload(options = {}) {
  const samples = getMenuTimingSamples(options);
  const summaryByKey = new Map();
  for (const sample of samples) {
    const key = `${sample.path}:${sample.phase}`;
    const current = summaryByKey.get(key) || {
      path: sample.path,
      phase: sample.phase,
      count: 0,
      totalMs: 0,
      maxMs: 0,
      latestMs: 0,
      warnings: 0,
      targetMisses: 0,
    };
    current.count += 1;
    current.totalMs += sample.elapsedMs;
    current.maxMs = Math.max(current.maxMs, sample.elapsedMs);
    current.latestMs = sample.elapsedMs;
    if (sample.severity === 'warn') current.warnings += 1;
    if (sample.severity === 'target-miss') current.targetMisses += 1;
    summaryByKey.set(key, current);
  }

  const summary = Array.from(summaryByKey.values())
    .map((entry) => ({
      path: entry.path,
      phase: entry.phase,
      count: entry.count,
      maxMs: entry.maxMs,
      avgMs: entry.count ? Math.round(entry.totalMs / entry.count) : 0,
      latestMs: entry.latestMs,
      warnings: entry.warnings,
      targetMisses: entry.targetMisses,
    }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.phase.localeCompare(b.phase));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    sampleLimit: MENU_TIMING_SAMPLE_LIMIT,
    count: samples.length,
    summary,
    samples,
  };
}

function writeBotDebugJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function isLocalDebugRequest(req) {
  const remoteAddress = String(req.socket?.remoteAddress || '');
  return remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1';
}

function handleBotDebugRequest(req, res) {
  if (!isLocalDebugRequest(req)) {
    writeBotDebugJson(res, 403, { ok: false, error: 'local_only' });
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(req.url || '/', `http://${BOT_DEBUG_HOST}`);
  } catch {
    writeBotDebugJson(res, 400, { ok: false, error: 'invalid_request' });
    return;
  }

  if (req.method === 'GET' && requestUrl.pathname === '/debug/menu-timing') {
    const limit = Number(requestUrl.searchParams.get('limit') || MENU_TIMING_SAMPLE_LIMIT);
    writeBotDebugJson(res, 200, buildMenuTimingDebugPayload({ limit }));
    return;
  }

  writeBotDebugJson(res, 404, { ok: false, error: 'not_found' });
}

function startBotDebugServer() {
  if (!BOT_DEBUG_SERVER_ENABLED || botDebugServer) return;
  if (!Number.isInteger(BOT_DEBUG_PORT) || BOT_DEBUG_PORT <= 0 || BOT_DEBUG_PORT > 65535) {
    console.warn('[Bot Debug] Disabled: invalid AEGIS_BOT_DEBUG_PORT value.');
    return;
  }

  const server = http.createServer(handleBotDebugRequest);
  server.on('error', (error) => {
    console.warn(`[Bot Debug] Local debug server unavailable on ${BOT_DEBUG_HOST}:${BOT_DEBUG_PORT}:`, error?.message || error);
  });
  server.listen(BOT_DEBUG_PORT, BOT_DEBUG_HOST, () => {
    console.log(`[Bot Debug] Local diagnostics listening on http://${BOT_DEBUG_HOST}:${BOT_DEBUG_PORT}`);
  });
  botDebugServer = server;
}

function logMenuTiming(label, startedAt, options = {}) {
  const elapsedMs = Date.now() - Number(startedAt || Date.now());
  const { targetMs, warnMs } = getMenuTimingPhaseConfig(options.phase, options);
  const sample = recordMenuTimingSample(label, elapsedMs, options, { targetMs, warnMs });
  if (sample.severity === 'warn') {
    console.warn(`[Menu Timing] ${label} took ${elapsedMs}ms (target ${targetMs}ms, warn ${warnMs}ms)`);
  } else if (options.logTargetMiss && sample.severity === 'target-miss') {
    console.warn(`[Menu Timing] ${label} missed target at ${elapsedMs}ms (target ${targetMs}ms)`);
  } else if (MENU_TIMING_VERBOSE) {
    console.log(`[Menu Timing] ${label} completed in ${elapsedMs}ms (target ${targetMs}ms, warn ${warnMs}ms)`);
  }
  return elapsedMs;
}

function normalizeMenuTimingPath(pathValue = 'unknown') {
  const normalized = String(pathValue || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
}

function buildMenuTimingLabel(phase, pathValue) {
  return `menu.${phase}.${normalizeMenuTimingPath(pathValue)}`;
}

function startMenuHydrationToken(key) {
  if (!key) return null;
  const tokenKey = String(key);
  const nextValue = Number(menuHydrationTokens.get(tokenKey) || 0) + 1;
  menuHydrationTokens.set(tokenKey, nextValue);
  return { key: tokenKey, value: nextValue };
}

function isMenuHydrationTokenCurrent(token) {
  if (!token?.key) return true;
  return menuHydrationTokens.get(token.key) === token.value;
}

function getMenuInteractionAckMode(interaction, ackMode = 'auto') {
  if (ackMode && ackMode !== 'auto') return ackMode;
  return interaction?.isMessageComponent?.() ? 'deferUpdate' : 'deferReply';
}

function getDiscordErrorCode(error) {
  return error?.code || error?.rawError?.code || error?.status || null;
}

function isMenuStaleInteractionError(error) {
  const code = String(getDiscordErrorCode(error) || '');
  const message = String(error?.message || error?.rawError?.message || '').toLowerCase();
  return ['10008', '10015', '10062'].includes(code)
    || message.includes('unknown interaction')
    || message.includes('unknown message')
    || message.includes('unknown webhook');
}

function isMenuDuplicateAckError(error) {
  const code = String(getDiscordErrorCode(error) || '');
  const message = String(error?.message || error?.rawError?.message || '').toLowerCase();
  return code === '40060' || message.includes('already been acknowledged');
}

function describeMenuError(error) {
  const code = getDiscordErrorCode(error);
  const message = error?.message || error?.rawError?.message || String(error || 'Unknown error');
  return code ? `${message} (code ${code})` : message;
}

async function resolveMenuPayload(payloadOrFactory, interaction) {
  if (typeof payloadOrFactory === 'function') {
    return payloadOrFactory(interaction);
  }
  return payloadOrFactory;
}

async function safelyEditMenuReply(interaction, payload, label) {
  try {
    await interaction.editReply(payload);
    return true;
  } catch (error) {
    if (isMenuStaleInteractionError(error) || isMenuDuplicateAckError(error)) {
      console.warn(`[Menu Hydration] ${label} skipped: ${describeMenuError(error)}`);
      return false;
    }
    console.error(`[Menu Hydration] ${label} failed:`, error);
    return false;
  }
}

async function acknowledgeMenuShellInteraction(interaction, options = {}) {
  const pathValue = options.path || 'unknown';
  const label = buildMenuTimingLabel('ack', pathValue);
  const startedAt = Date.now();
  const ackMode = getMenuInteractionAckMode(interaction, options.ackMode);

  if (interaction?.deferred || interaction?.replied || ackMode === 'none') {
    logMenuTiming(label, startedAt, { phase: 'ack', logTargetMiss: true });
    return { ok: true, mode: ackMode, alreadyAcknowledged: Boolean(interaction?.deferred || interaction?.replied) };
  }

  try {
    if (ackMode === 'deferReply' || ackMode === 'reply') {
      await interaction.deferReply({ flags: options.flags || MessageFlags.Ephemeral });
    } else if (ackMode === 'deferUpdate' || ackMode === 'update') {
      await interaction.deferUpdate();
    } else {
      throw new Error(`Unsupported menu ack mode: ${ackMode}`);
    }
    logMenuTiming(label, startedAt, { phase: 'ack', logTargetMiss: true });
    return { ok: true, mode: ackMode, alreadyAcknowledged: false };
  } catch (error) {
    if (isMenuStaleInteractionError(error) || isMenuDuplicateAckError(error)) {
      console.warn(`[Menu Hydration] ${label} skipped: ${describeMenuError(error)}`);
      return { ok: false, mode: ackMode, error };
    }
    console.error(`[Menu Hydration] ${label} failed:`, error);
    return { ok: false, mode: ackMode, error };
  }
}

async function runMenuHydration(interaction, options = {}, totalStartedAt = Date.now(), hydrationToken = null) {
  const pathValue = options.path || 'unknown';
  const hydrateLabel = buildMenuTimingLabel('hydrate', pathValue);
  const hydrateStartedAt = Date.now();

  if (!options.hydratePayload) {
    logMenuTiming(hydrateLabel, hydrateStartedAt, { phase: 'hydrate', logTargetMiss: true });
    logMenuTiming(buildMenuTimingLabel('total', pathValue), totalStartedAt, { phase: 'total', logTargetMiss: true });
    return { ok: true, skipped: true };
  }

  try {
    const hydratedPayload = await resolveMenuPayload(options.hydratePayload, interaction);
    if (!isMenuHydrationTokenCurrent(hydrationToken)) {
      console.warn(`[Menu Hydration] ${hydrateLabel} skipped stale hydration.`);
      logMenuTiming(hydrateLabel, hydrateStartedAt, { phase: 'hydrate', logTargetMiss: true });
      logMenuTiming(buildMenuTimingLabel('total', pathValue), totalStartedAt, { phase: 'total', logTargetMiss: true });
      return { ok: true, skipped: true, stale: true };
    }
    if (!hydratedPayload) {
      logMenuTiming(hydrateLabel, hydrateStartedAt, { phase: 'hydrate', logTargetMiss: true });
      logMenuTiming(buildMenuTimingLabel('total', pathValue), totalStartedAt, { phase: 'total', logTargetMiss: true });
      return { ok: true, skipped: true };
    }
    const edited = await safelyEditMenuReply(interaction, hydratedPayload, hydrateLabel);
    logMenuTiming(hydrateLabel, hydrateStartedAt, { phase: 'hydrate', logTargetMiss: true });
    logMenuTiming(buildMenuTimingLabel('total', pathValue), totalStartedAt, { phase: 'total', logTargetMiss: true });
    return { ok: edited };
  } catch (error) {
    console.error(`[Menu Hydration] ${hydrateLabel} failed:`, error);
    if (typeof options.onHydrationError === 'function') {
      await Promise.resolve(options.onHydrationError(error, interaction)).catch((handlerError) => {
        console.error(`[Menu Hydration] ${hydrateLabel} error handler failed:`, handlerError);
      });
    }
    logMenuTiming(hydrateLabel, hydrateStartedAt, { phase: 'hydrate', logTargetMiss: true });
    logMenuTiming(buildMenuTimingLabel('total', pathValue), totalStartedAt, { phase: 'total', logTargetMiss: true });
    return { ok: false, error };
  }
}

async function renderMenuShellThenHydrate(interaction, options = {}) {
  const pathValue = options.path || 'unknown';
  const totalStartedAt = Date.now();
  const hydrationToken = startMenuHydrationToken(options.hydrationKey);
  const ackResult = await acknowledgeMenuShellInteraction(interaction, options);
  if (!ackResult.ok) {
    return {
      ok: false,
      acked: false,
      shellVisible: false,
      hydration: Promise.resolve({ ok: false, error: ackResult.error }),
      error: ackResult.error,
    };
  }

  const shellLabel = buildMenuTimingLabel('shell', pathValue);
  const shellStartedAt = Date.now();
  try {
    const shellPayload = await resolveMenuPayload(options.shellPayload, interaction);
    if (shellPayload) {
      const shellVisible = await safelyEditMenuReply(interaction, shellPayload, shellLabel);
      logMenuTiming(shellLabel, shellStartedAt, { phase: 'shell', logTargetMiss: true });
      if (!shellVisible) {
        return {
          ok: false,
          acked: true,
          shellVisible: false,
          hydration: Promise.resolve({ ok: false }),
        };
      }
    } else {
      logMenuTiming(shellLabel, shellStartedAt, { phase: 'shell', logTargetMiss: true });
    }
  } catch (error) {
    console.error(`[Menu Hydration] ${shellLabel} failed:`, error);
    if (typeof options.onShellError === 'function') {
      await Promise.resolve(options.onShellError(error, interaction)).catch((handlerError) => {
        console.error(`[Menu Hydration] ${shellLabel} error handler failed:`, handlerError);
      });
    }
    logMenuTiming(shellLabel, shellStartedAt, { phase: 'shell', logTargetMiss: true });
    return {
      ok: false,
      acked: true,
      shellVisible: false,
      hydration: Promise.resolve({ ok: false, error }),
      error,
    };
  }

  const hydration = runMenuHydration(interaction, options, totalStartedAt, hydrationToken);
  if (options.awaitHydration) {
    const hydrationResult = await hydration;
    return {
      ok: hydrationResult.ok,
      acked: true,
      shellVisible: true,
      hydration: Promise.resolve(hydrationResult),
      hydrationResult,
    };
  }

  return {
    ok: true,
    acked: true,
    shellVisible: true,
    hydration,
  };
}

function getCachedBenchMarkMenuPayload(userId) {
  const key = String(userId || '');
  const entry = benchmarkMenuPayloadCache.get(key);
  if (!entry) return null;
  const ttl = Number.isFinite(BENCHMARK_MENU_PAYLOAD_CACHE_TTL_MS) && BENCHMARK_MENU_PAYLOAD_CACHE_TTL_MS > 0
    ? BENCHMARK_MENU_PAYLOAD_CACHE_TTL_MS
    : 15000;
  if ((Date.now() - Number(entry.createdAt || 0)) > ttl) {
    benchmarkMenuPayloadCache.delete(key);
    return null;
  }
  return entry.payload || null;
}

function setCachedBenchMarkMenuPayload(userId, payload) {
  if (!payload) return payload;
  benchmarkMenuPayloadCache.set(String(userId || ''), {
    createdAt: Date.now(),
    payload,
  });
  return payload;
}

function getMainMenuPayloadCacheKey(interaction) {
  return `${interaction?.user?.id || ''}:${isBotAdmin(interaction) ? 'admin' : 'user'}`;
}

function getCachedMainMenuPayload(interaction) {
  const key = getMainMenuPayloadCacheKey(interaction);
  if (!key) return null;
  const entry = mainMenuPayloadCache.get(key);
  if (!entry) return null;
  const ttl = Number.isFinite(MAIN_MENU_PAYLOAD_CACHE_TTL_MS) && MAIN_MENU_PAYLOAD_CACHE_TTL_MS > 0
    ? MAIN_MENU_PAYLOAD_CACHE_TTL_MS
    : 15000;
  if ((Date.now() - Number(entry.createdAt || 0)) > ttl) {
    mainMenuPayloadCache.delete(key);
    return null;
  }
  return entry.payload || null;
}

function setCachedMainMenuPayload(interaction, payload) {
  if (!payload) return payload;
  const key = getMainMenuPayloadCacheKey(interaction);
  if (!key) return payload;
  mainMenuPayloadCache.set(key, {
    createdAt: Date.now(),
    payload,
  });
  return payload;
}

function isBenchMarkMenuStateActive(state = {}) {
  return [
    state?.jobState,
    state?.matchupJobState,
    state?.suiteJobState,
    state?.warmupState,
  ].some(isActiveBenchMarkJobState);
}

function getBenchMarkMenuStateCacheTtlMs(state = {}) {
  const idleTtl = Number.isFinite(BENCHMARK_MENU_STATE_CACHE_TTL_MS) && BENCHMARK_MENU_STATE_CACHE_TTL_MS > 0
    ? BENCHMARK_MENU_STATE_CACHE_TTL_MS
    : 3000;
  const activeTtl = Number.isFinite(BENCHMARK_MENU_ACTIVE_STATE_CACHE_TTL_MS) && BENCHMARK_MENU_ACTIVE_STATE_CACHE_TTL_MS > 0
    ? BENCHMARK_MENU_ACTIVE_STATE_CACHE_TTL_MS
    : 750;
  return isBenchMarkMenuStateActive(state) ? Math.min(idleTtl, activeTtl) : idleTtl;
}

function getCachedBenchMarkMenuState(userId) {
  const key = String(userId || '');
  const entry = benchmarkMenuStateCache.get(key);
  if (!entry) return null;
  const state = entry.state || null;
  const ttl = getBenchMarkMenuStateCacheTtlMs(state);
  if ((Date.now() - Number(entry.createdAt || 0)) > ttl) {
    benchmarkMenuStateCache.delete(key);
    return null;
  }
  return state;
}

function setCachedBenchMarkMenuState(userId, state) {
  if (!state) return state;
  benchmarkMenuStateCache.set(String(userId || ''), {
    createdAt: Date.now(),
    state,
  });
  return state;
}

async function resolveBenchMarkMenuStateSnapshot(userId, overrides = {}) {
  const startedAt = Date.now();
  const hasOverrides = Object.keys(overrides || {}).length > 0;
  if (!hasOverrides) {
    const cached = getCachedBenchMarkMenuState(userId);
    if (cached) {
      logMenuTiming('resolveBenchMarkMenuStateSnapshot cached', startedAt);
      return cached;
    }
  }

  const [
    benchmarkState,
    jobState,
    matchupJobState,
    suiteJobState,
    warmupState,
    suiteConfig,
    lastReportState,
    lastMatchupEvalState,
  ] = await Promise.all([
    Object.prototype.hasOwnProperty.call(overrides, 'benchmarkState')
      ? Promise.resolve(overrides.benchmarkState)
      : getBenchMarkTeamState(userId),
    Object.prototype.hasOwnProperty.call(overrides, 'jobState')
      ? Promise.resolve(overrides.jobState)
      : getBenchMarkJobState(userId),
    Object.prototype.hasOwnProperty.call(overrides, 'matchupJobState')
      ? Promise.resolve(overrides.matchupJobState)
      : getBenchMarkMatchupJobState(userId),
    Object.prototype.hasOwnProperty.call(overrides, 'suiteJobState')
      ? Promise.resolve(overrides.suiteJobState)
      : getBenchMarkSuiteJobState(userId),
    Object.prototype.hasOwnProperty.call(overrides, 'warmupState')
      ? Promise.resolve(overrides.warmupState)
      : getBenchMarkWarmupState(),
    Object.prototype.hasOwnProperty.call(overrides, 'suiteConfig')
      ? Promise.resolve(overrides.suiteConfig)
      : getBenchMarkSuiteConfig(userId),
    Object.prototype.hasOwnProperty.call(overrides, 'lastReportState')
      ? Promise.resolve(overrides.lastReportState)
      : getBenchMarkLastReportMeta(userId),
    Object.prototype.hasOwnProperty.call(overrides, 'lastMatchupEvalState')
      ? Promise.resolve(overrides.lastMatchupEvalState)
      : getBenchMarkLastMatchupEvalMeta(userId),
  ]);
  const lastSuiteReportState = Object.prototype.hasOwnProperty.call(overrides, 'lastSuiteReportState')
    ? overrides.lastSuiteReportState
    : await getBenchMarkLastSuiteReportMeta(userId, benchmarkState);

  const snapshot = setCachedBenchMarkMenuState(userId, {
    benchmarkState,
    jobState,
    matchupJobState,
    suiteJobState,
    warmupState,
    suiteConfig,
    lastReportState,
    lastMatchupEvalState,
    lastSuiteReportState,
  });
  logMenuTiming('resolveBenchMarkMenuStateSnapshot', startedAt);
  return snapshot;
}

function isValidDiscordMessagePayload(payload) {
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload));
}

function buildBenchMarkFallbackPayload(interaction, notice = null) {
  const safeNotice = cleanText(notice || 'Battle Simulator menu data is still loading. Please try the menu again.');
  try {
    return {
      content: '',
      embeds: [
        buildBenchMarkMenuEmbed({
          suiteStatusText: 'Loading menu metadata ⏳',
          suiteConfigText: 'Settings temporarily unavailable',
          readinessText: safeNotice,
          hasSubmittedTeam: false,
          teamPreviewText: 'Team status temporarily unavailable',
        }),
      ],
      components: buildBenchMarkMenuComponents({
        ownerId: interaction.user.id,
        hasSubmittedTeam: false,
        hasLastReport: false,
        hasActiveJob: false,
        hasLastMatchupEval: false,
        hasActiveMatchupJob: false,
        hasLastSuiteReport: false,
        hasActiveSuiteJob: false,
        hasMatchArchiveReady: false,
        benchmarkWarmupActive: false,
        hasHistoryProfiles: false,
      }),
      files: [],
    };
  } catch (error) {
    console.error('[BenchMark Menu] Fallback payload failed:', error);
    return {
      content: safeNotice,
      embeds: [],
      components: [],
      files: [],
    };
  }
}

function resolveWithTimeoutOrNull(promise, timeoutMs = BENCHMARK_MODAL_PREFILL_TIMEOUT_MS, label = 'async value') {
  const limit = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1000;
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[BenchMark Menu] ${label} timed out after ${limit}ms; continuing without it.`);
      resolve(null);
    }, limit);

    Promise.resolve(promise)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.warn(`[BenchMark Menu] ${label} failed:`, error?.message || error);
        resolve(null);
      });
  });
}

function getCachedBenchMarkMenuSnapshot(userId) {
  const key = String(userId || '');
  const entry = benchmarkMenuSnapshotCache.get(key);
  if (!entry) return null;
  const ttl = Number.isFinite(BENCHMARK_MENU_SNAPSHOT_CACHE_TTL_MS) && BENCHMARK_MENU_SNAPSHOT_CACHE_TTL_MS > 0
    ? BENCHMARK_MENU_SNAPSHOT_CACHE_TTL_MS
    : 60000;
  if ((Date.now() - Number(entry.createdAt || 0)) > ttl) {
    benchmarkMenuSnapshotCache.delete(key);
    return null;
  }
  return entry.snapshot || null;
}

function setCachedBenchMarkMenuSnapshot(userId, snapshot) {
  if (!snapshot) return snapshot;
  const key = String(userId || '');
  benchmarkMenuSnapshotCache.set(key, {
    createdAt: Date.now(),
    snapshot,
  });
  return snapshot;
}

function scheduleBenchMarkMenuSnapshotRefresh(userId, context = {}) {
  const key = String(userId || '');
  if (!key || benchmarkMenuSnapshotRefreshes.has(key)) return;
  const refresh = (async () => {
    try {
      const benchmarkState = context.benchmarkState || await getBenchMarkTeamState(userId);
      const latestSuiteReportState = context.lastSuiteReportState
        || await getBenchMarkLastSuiteReportMeta(userId, benchmarkState);
      const hasSubmittedTeam = Boolean(cleanText(benchmarkState?.team_export));
      const [loadTeamProfiles, startupReadiness] = await Promise.all([
        listBenchMarkLoadTeamProfiles(userId, latestSuiteReportState, benchmarkState).catch(() => []),
        hasSubmittedTeam ? getBenchMarkWorkerReadiness().catch(() => null) : Promise.resolve(null),
      ]);
      setCachedBenchMarkMenuSnapshot(userId, {
        hasHistoryProfiles: Array.isArray(loadTeamProfiles) && loadTeamProfiles.length > 0,
        startupReadiness,
        refreshedAt: new Date().toISOString(),
      });
    } catch (error) {
      // Menu snapshots are an optimization only; failed refreshes must not block Discord navigation.
    } finally {
      benchmarkMenuSnapshotRefreshes.delete(key);
    }
  })();
  benchmarkMenuSnapshotRefreshes.set(key, refresh);
}

function isCompletedBenchMarkSuiteJob(state = {}) {
  return String(state?.status || '').toLowerCase() === 'completed' && Boolean(state?.job_id);
}

function isActiveBenchMarkJobState(state = {}) {
  return ['queued', 'running', 'cancelling', 'submitting'].includes(String(state?.status || '').toLowerCase());
}


function hasSavedMatchArchive(report = {}) {
  const matchArchive = report?.matchArchive && typeof report.matchArchive === 'object'
    ? report.matchArchive
    : {};

  const hasSources = Array.isArray(matchArchive.sources) && matchArchive.sources.filter(Boolean).length > 0;
  const hasLegacyFiles = Array.isArray(matchArchive.files) && matchArchive.files.filter(Boolean).length > 0;
  const sourceCount = Math.max(0, Number(matchArchive.sourceCount) || 0);
  const renderedCount = Math.max(0, Number(matchArchive.renderedCount) || 0);
  return Boolean(matchArchive.ready === true || hasSources || hasLegacyFiles || sourceCount > 0 || renderedCount > 0);
}

function hasSavedPaperReport(report = {}) {
  return Boolean(report && typeof report === 'object' && (
    report.compactSummary
    || report.summary
    || report.overview
    || report.totalGamesCompleted
    || report.gamesCompleted
    || report.games
    || report.record
  ));
}
function sanitizeArchivePathPart(value, fallback = 'matchup') {
  const cleaned = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function buildArchiveCompileProgressBar(percentValue) {
  const normalized = Number(percentValue);
  if (!Number.isFinite(normalized)) return '▭▭▭▭▭▭▭▭▭▭ 0%';
  const clamped = Math.max(0, Math.min(100, Math.round(normalized)));
  const filled = Math.max(0, Math.min(10, Math.round(clamped / 10)));
  return `${'◼'.repeat(filled)}${'▭'.repeat(10 - filled)} ${clamped}%`;
}

async function showArchiveCompileProgress(interaction, sharedRowProps = {}, stage = {}) {
  const percent = Number(stage?.percent ?? 0);
  const step = String(stage?.step || 'Preparing archive files...').trim();
  const teamPreviewText = sharedRowProps.teamPreviewText || 'Team on file';

  await interaction.editReply({
    content: '',
    embeds: [
      buildBenchMarkMenuEmbed({
        queueStatusText: 'Idle',
        matchupStatusText: 'Idle',
        suiteStatusText: 'Compiling Simulation Archive 📦',
        suiteConfigText: 'Using your last completed Simulation Report',
        readinessText: 'Professor Aegis is packaging replay pages into a zip archive',
        hasSubmittedTeam: Boolean(sharedRowProps.hasSubmittedTeam),
        teamPreviewText,
        liveProgressBlocks: [
          {
            title: 'Simulation Archive',
            lines: [
              `📦 ${buildArchiveCompileProgressBar(percent)}`,
              '',
              `⚡ ${step}`,
            ],
          },
        ],
      }),
    ],
    components: sharedRowProps.useSuiteReportDropdown
      ? buildBenchMarkSuiteViewComponents({
        ...sharedRowProps,
        hasMatchArchiveReady: false,
      }, null)
      : buildBenchMarkMenuComponents({
        ...sharedRowProps,
        hasMatchArchiveReady: false,
      }),
    files: [],
  });
}

async function showPaperReportCompileProgress(interaction, sharedRowProps = {}, stage = {}) {
  const percent = Number(stage?.percent ?? 0);
  const step = String(stage?.step || 'Preparing Paper Report PDF...').trim();
  const teamPreviewText = sharedRowProps.teamPreviewText || 'Team on file';

  await interaction.editReply({
    content: '',
    embeds: [
      buildBenchMarkMenuEmbed({
        queueStatusText: 'Idle',
        matchupStatusText: 'Idle',
        suiteStatusText: 'Building Paper Report 📄',
        suiteConfigText: 'Converting your last Simulation Report into a PDF',
        readinessText: 'Professor Aegis is formatting the clean paper report download',
        hasSubmittedTeam: Boolean(sharedRowProps.hasSubmittedTeam),
        teamPreviewText,
        liveProgressBlocks: [
          {
            title: 'Paper Report PDF',
            lines: [
              `📄 ${buildArchiveCompileProgressBar(percent)}`,
              '',
              `⚡ ${step}`,
            ],
          },
        ],
      }),
    ],
    components: sharedRowProps.useHistoryReportDropdown
      ? buildBenchMarkHistoryViewComponents({
        ...sharedRowProps,
        hasPaperReportReady: false,
      }, sharedRowProps.historyReports || [], sharedRowProps.historyIndex || 0)
      : sharedRowProps.useSuiteReportDropdown
        ? buildBenchMarkSuiteViewComponents({
          ...sharedRowProps,
          hasPaperReportReady: false,
        }, null)
        : buildBenchMarkMenuComponents({
          ...sharedRowProps,
          hasPaperReportReady: false,
        }),
    files: [],
  });
}

async function showLastMatchupReportLoadProgress(interaction, sharedRowProps = {}, stage = {}) {
  const percent = Number(stage?.percent ?? 0);
  const step = String(stage?.step || 'Loading Simulation Report...').trim();
  const teamPreviewText = sharedRowProps.teamPreviewText || 'Team on file';

  await interaction.editReply({
    content: '',
    embeds: [
      buildBenchMarkMenuEmbed({
        queueStatusText: 'Idle',
        matchupStatusText: 'Idle',
        suiteStatusText: 'Loading Simulation Report 🏆',
        suiteConfigText: 'Opening your completed Simulation Report',
        readinessText: 'Professor Aegis is reading the saved report data',
        hasSubmittedTeam: Boolean(sharedRowProps.hasSubmittedTeam),
        teamPreviewText,
        liveProgressBlocks: [
          {
            title: 'Simulation Report',
            lines: [
              `🏆 Loading Simulation Report ${buildArchiveCompileProgressBar(percent)}`,
              '',
              `⚡ ${step}`,
            ],
          },
        ],
      }),
    ],
    components: buildBenchMarkMenuComponents({
      ...sharedRowProps,
      hasMatchArchiveReady: false,
    }),
    files: [],
  });
}

function getMatchArchiveFailureMessage(report = {}, archive = null) {
  const matchArchive = report?.matchArchive && typeof report.matchArchive === 'object' ? report.matchArchive : {};
  const savedSourceCount = Array.isArray(matchArchive?.sources) ? matchArchive.sources.filter(Boolean).length : 0;
  const savedFileCount = Array.isArray(matchArchive?.files) ? matchArchive.files.filter(Boolean).length : 0;
  const rebuiltSourceCount = Array.isArray(archive?.sources)
    ? archive.sources.filter(Boolean).length
    : Math.max(0, Number(archive?.sourceCount) || 0);
  const renderedFileCount = Array.isArray(archive?.files)
    ? archive.files.filter((entry) => entry && entry.relativePath && entry.html).length
    : Math.max(0, Number(archive?.renderedCount) || 0);

  if (!archive) {
    return 'Archive rebuild failed before replay pages could be prepared.';
  }
  if (!savedSourceCount && !savedFileCount) {
    return 'No saved Simulation Archive data was found in the last Simulation Report.';
  }
  if (!rebuiltSourceCount) {
    return 'The archive rebuild returned no replay sources.';
  }
  if (!renderedFileCount) {
    return 'Replay sources were found, but no replay HTML files were rendered.';
  }
  if (archive?.zipCreated === false) {
    return 'Replay HTML was rendered, but the Simulation Archive zip was not created.';
  }
  return 'Professor Aegis could not build that Simulation Archive.';
}

const MATCH_ARCHIVE_FILENAME = 'matchup-report-archive.zip';
const DISCORD_STANDARD_ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024;
const MATCH_ARCHIVE_SAFE_ATTACHMENT_BYTES = Math.floor(DISCORD_STANDARD_ATTACHMENT_LIMIT_BYTES * 0.99);
const MATCH_ARCHIVE_PART_TARGET_BYTES = Math.floor(DISCORD_STANDARD_ATTACHMENT_LIMIT_BYTES * 0.98);
const MATCH_ARCHIVE_MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MATCH_ARCHIVE_PYTHON_COMMAND = process.platform === 'win32' ? 'python' : 'python3';
const MATCH_ARCHIVE_BUILD_TIMEOUT_MS = 5 * 60 * 1000;
const MATCH_ARCHIVE_PROGRESS_HEARTBEAT_MS = 15000;

function runMatchArchivePython(args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(MATCH_ARCHIVE_PYTHON_COMMAND, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      const error = new Error('Simulation Archive packaging timed out before the download could be prepared.');
      error.code = 'ETIMEDOUT';
      reject(error);
    }, MATCH_ARCHIVE_BUILD_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(stderr.trim() || stdout.trim() || `Simulation Archive packaging exited with code ${code}.`);
      error.code = code;
      error.signal = signal;
      reject(error);
    });
  });
}

function buildSingleMatchArchiveAttachment(zipBuffer, filename = MATCH_ARCHIVE_FILENAME) {
  return [{ attachment: Buffer.isBuffer(zipBuffer) ? zipBuffer : Buffer.from(zipBuffer || []), name: filename }];
}

async function sendMatchArchiveZip(interaction, archiveDownload, sharedRowProps = {}, context = {}) {
  const onProgress = typeof context?.onProgress === 'function' ? context.onProgress : null;
  if (onProgress) await onProgress({ percent: 86, step: 'Checking Simulation Archive download size...' });

  const files = Array.isArray(archiveDownload)
    ? archiveDownload
    : buildSingleMatchArchiveAttachment(archiveDownload);
  const isSplitArchive = files.length > 1;
  if (isSplitArchive && onProgress) {
    await onProgress({ percent: 92, step: `Splitting Simulation Archive into ${files.length} ordered download parts...` });
  }
  if (onProgress) {
    await onProgress({
      percent: 98,
      step: isSplitArchive ? `Sending ${files.length} Simulation Archive parts...` : 'Sending Simulation Archive zip...',
    });
  }

  const firstBatch = files.slice(0, MATCH_ARCHIVE_MAX_ATTACHMENTS_PER_MESSAGE);
  await interaction.editReply({
    content: isSplitArchive
      ? `Simulation Archive ready in ${files.length} ordered parts. Parts 1-${firstBatch.length} attached.`
      : 'Simulation Archive ready.',
    files: firstBatch,
    embeds: [],
    components: sharedRowProps.useSuiteReportDropdown
      ? buildBenchMarkSuiteViewComponents(sharedRowProps, null)
      : buildBenchMarkMenuComponents(sharedRowProps),
  });

  for (let start = MATCH_ARCHIVE_MAX_ATTACHMENTS_PER_MESSAGE; start < files.length; start += MATCH_ARCHIVE_MAX_ATTACHMENTS_PER_MESSAGE) {
    const batch = files.slice(start, start + MATCH_ARCHIVE_MAX_ATTACHMENTS_PER_MESSAGE);
    if (onProgress) {
      await onProgress({
        percent: 98,
        step: `Sending Simulation Archive parts ${start + 1}-${start + batch.length} of ${files.length}...`,
      });
    }
    await interaction.followUp({
      content: `Simulation Archive parts ${start + 1}-${start + batch.length} of ${files.length}.`,
      files: batch,
    });
  }
}

async function buildPaperReportWithProgress(interaction, report = {}, options = {}, sharedRowProps = {}) {
  const progressSteps = [
    { percent: 28, step: 'Laying out report sections...' },
    { percent: 44, step: 'Loading the Discord avatar header...' },
    { percent: 62, step: 'Rendering the Paper Report page...' },
    { percent: 78, step: 'Printing the final PDF download...' },
  ];
  let stepIndex = 0;

  await showPaperReportCompileProgress(interaction, sharedRowProps, {
    percent: 8,
    step: 'Opening the Paper Report printer...',
  });

  const heartbeat = setInterval(() => {
    const step = progressSteps[Math.min(stepIndex, progressSteps.length - 1)];
    stepIndex += 1;
    showPaperReportCompileProgress(interaction, sharedRowProps, step).catch(() => {});
  }, 5000);

  try {
    const paperReport = await buildBenchmarkPaperReportPdfAttachment(report, options);
    await showPaperReportCompileProgress(interaction, sharedRowProps, {
      percent: 96,
      step: 'Paper Report PDF ready. Attaching download...',
    });
    return paperReport;
  } finally {
    clearInterval(heartbeat);
  }
}

async function buildMatchArchiveZip(report = {}, context = {}) {
  const reportWithContext = { ...report, __userId: context?.userId || report?.__userId || report?.userId || null };
  const onProgress = typeof context?.onProgress === 'function' ? context.onProgress : null;
  const paperReportOptions = {
    trainerName: context?.trainerName || 'Trainer',
    serverName: context?.serverName || 'Professor Aegis',
    avatarUrl: context?.avatarUrl || null,
    filename: 'BattleSimulationPaperReport',
  };
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-match-archive-'));
  const reportPath = path.join(tempRoot, 'report.json');
  const outputPath = path.join(tempRoot, 'archive-build.json');
  const zipPath = path.join(tempRoot, 'matchup-report-archive.zip');
  const partsDir = path.join(tempRoot, 'parts');
  const servicesPath = path.join(__dirname, 'services');

  try {
    if (onProgress) await onProgress({ percent: 12, step: 'Rendering Paper Report PDF for archive root...' });
    const paperReport = await buildBenchmarkPaperReportPdfAttachment(reportWithContext, paperReportOptions);
    const paperReportBuffer = Buffer.isBuffer(paperReport?.attachment)
      ? paperReport.attachment
      : Buffer.from(paperReport?.attachment || []);
    if (!paperReportBuffer.length) {
      throw new Error('Paper Report PDF renderer returned an empty file.');
    }
    reportWithContext.__paperReportPdfBase64 = paperReportBuffer.toString('base64');
  } catch (error) {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    throw new Error(error?.message || 'Professor Aegis could not build the Paper Report PDF for the Simulation Archive.');
  }

  fs.writeFileSync(reportPath, JSON.stringify(reportWithContext), 'utf8');

  if (onProgress) await onProgress({ percent: 18, step: 'Rebuilding replay HTML from the last Simulation Report...' });
  if (onProgress) await onProgress({ percent: 52, step: 'Preparing replay pages for zip packaging...' });
  if (onProgress) await onProgress({ percent: 78, step: 'Building and checking the Simulation Archive zip...' });

  const py = [
    'import base64, json, sys, zipfile',
    'from pathlib import Path',
    'sys.path.insert(0, sys.argv[1])',
    'from benchmark_archive_builder import _build_zip_entries, rebuild_match_archive_from_saved_report',
    'with open(sys.argv[2], "r", encoding="utf-8") as fh:',
    '    report = json.load(fh)',
    'zip_path = Path(sys.argv[3])',
    'output_path = Path(sys.argv[4])',
    'parts_dir = Path(sys.argv[5])',
    'max_part_bytes = int(sys.argv[6])',
    'target_part_bytes = int(sys.argv[7])',
    'archive = rebuild_match_archive_from_saved_report(report)',
    'entries = _build_zip_entries(archive, report)',
    'replay_entries = [entry for entry in entries if str(entry.get("relativePath") or "") != "PaperReport.pdf"]',
    'includes_paper_report_pdf = any(str(entry.get("relativePath") or "") == "PaperReport.pdf" for entry in entries)',
    'result = {',
    '    "ready": bool(replay_entries),',
    '    "builderVersion": archive.get("builderVersion"),',
    '    "archiveRoot": archive.get("archiveRoot"),',
    '    "sourceCount": len(list(archive.get("sources") or [])),',
    '    "renderedCount": len(replay_entries),',
    '    "includesPaperReportPdf": includes_paper_report_pdf,',
    '    "zipCreated": False,',
    '}',
    'result["splitPartPaths"] = []',
    'result["splitPartCount"] = 0',
    'if entries:',
    '    def write_zip(target, batch):',
    '        with zipfile.ZipFile(str(target), "w", zipfile.ZIP_DEFLATED) as zf:',
    '            for item in batch:',
    '                if item.get("bytes") is not None:',
    '                    zf.writestr(item["relativePath"], item.get("bytes") or b"")',
    '                else:',
    '                    zf.writestr(item["relativePath"], str(item.get("text") or ""))',
    '    zip_path.parent.mkdir(parents=True, exist_ok=True)',
    '    write_zip(zip_path, entries)',
    '    result["zipCreated"] = zip_path.exists()',
    '    result["zipPath"] = str(zip_path)',
    '    if zip_path.exists() and zip_path.stat().st_size > max_part_bytes:',
    '        parts_dir.mkdir(parents=True, exist_ok=True)',
    '        def zip_size_for_entry(entry, index):',
    '            sample_path = parts_dir / f"_sample_{index}.zip"',
    '            write_zip(sample_path, [entry])',
    '            size = sample_path.stat().st_size',
    '            try:',
    '                sample_path.unlink()',
    '            except FileNotFoundError:',
    '                pass',
    '            return size',
    '        groups = []',
    '        current = []',
    '        current_size = 0',
    '        single_oversized = []',
    '        for entry_index, entry in enumerate(entries, start=1):',
    '            entry_size = zip_size_for_entry(entry, entry_index)',
    '            if entry_size > max_part_bytes:',
    '                single_oversized.append(entry.get("relativePath") or f"entry-{entry_index}")',
    '                continue',
    '            if current and current_size + entry_size > target_part_bytes:',
    '                groups.append(current)',
    '                current = [entry]',
    '                current_size = entry_size',
    '            else:',
    '                current.append(entry)',
    '                current_size += entry_size',
    '        if current:',
    '            groups.append(current)',
    '        part_paths = []',
    '        part_sizes = []',
    '        oversized_parts = list(single_oversized)',
    '        for index, group in enumerate(groups, start=1):',
    '            part_name = f"SimulationArchive-Part{index}.zip"',
    '            part_path = parts_dir / part_name',
    '            write_zip(part_path, group)',
    '            part_size = part_path.stat().st_size',
    '            part_sizes.append(part_size)',
    '            if part_size > max_part_bytes:',
    '                oversized_parts.append(part_name)',
    '            part_paths.append(str(part_path))',
    '        result["splitPartPaths"] = part_paths',
    '        result["splitPartNames"] = [Path(part_path).name for part_path in part_paths]',
    '        result["splitPartSizes"] = part_sizes',
    '        result["splitPartCount"] = len(part_paths)',
    '        result["splitOversizedParts"] = oversized_parts',
    '        result["splitEntryCount"] = len(entries)',
    '        result["splitReplayEntryCount"] = len(replay_entries)',
    '        result["splitCreated"] = bool(part_paths) and not oversized_parts',
    '        if oversized_parts:',
    '            result["splitError"] = "At least one replay file is too large to fit in a safe Discord ZIP part."',
    'with open(output_path, "w", encoding="utf-8") as fh:',
    '    json.dump(result, fh)',
  ].join('\n');

  let archiveMeta = null;
  try {
    const archiveBuildArgs = ['-c', py, servicesPath, reportPath, zipPath, outputPath, partsDir, String(MATCH_ARCHIVE_SAFE_ATTACHMENT_BYTES), String(MATCH_ARCHIVE_PART_TARGET_BYTES)];
    const heartbeatSteps = [
      'Rendering replay pages for the Simulation Archive...',
      'Packaging replay pages into ZIP files...',
      'Checking archive size and split groups...',
      'Preparing extractable ZIP downloads...',
    ];
    let heartbeatIndex = 0;
    const heartbeat = onProgress
      ? setInterval(() => {
        const step = heartbeatSteps[heartbeatIndex % heartbeatSteps.length];
        heartbeatIndex += 1;
        onProgress({ percent: 79 + Math.min(4, heartbeatIndex), step }).catch(() => {});
      }, MATCH_ARCHIVE_PROGRESS_HEARTBEAT_MS)
      : null;
    try {
      await runMatchArchivePython(archiveBuildArgs);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
    if (!fs.existsSync(outputPath)) {
      console.error('[BenchMark Archive] zip build failed: python completed without writing archive metadata.');
      throw new Error('Professor Aegis could not verify the Simulation Archive build result.');
    }
    archiveMeta = JSON.parse(fs.readFileSync(outputPath, 'utf8') || '{}');
    console.log(`[BenchMark Archive] zip build ready=${Boolean(archiveMeta?.ready)} sources=${Number(archiveMeta?.sourceCount || 0)} rendered=${Number(archiveMeta?.renderedCount || 0)} zipped=${Boolean(archiveMeta?.zipCreated)}`);
    if (!archiveMeta?.zipCreated || !fs.existsSync(zipPath)) {
      const failureMessage = getMatchArchiveFailureMessage(reportWithContext, archiveMeta);
      console.log(`[BenchMark Archive] zip build aborted: ${failureMessage}`);
      throw new Error(failureMessage);
    }
  } catch (error) {
    console.error('[BenchMark Archive] zip build failed:', error?.message || error);
    if (error?.signal === 'SIGTERM' || error?.code === 'ETIMEDOUT') {
      throw new Error('Simulation Archive packaging timed out before the download could be prepared.');
    }
    if (error instanceof Error && error.message) throw error;
    throw new Error('Professor Aegis could not build that Simulation Archive.');
  }

  let buffer = null;
  let splitFiles = null;
  try {
    buffer = fs.readFileSync(zipPath);
    if (Array.isArray(archiveMeta?.splitPartPaths) && archiveMeta.splitPartPaths.length > 0) {
      if (archiveMeta?.splitError || archiveMeta?.splitCreated === false) {
        throw new Error(archiveMeta.splitError || 'Professor Aegis could not split that Simulation Archive into safe ZIP parts.');
      }
      splitFiles = archiveMeta.splitPartPaths.map((partPath) => ({
        attachment: fs.readFileSync(partPath),
        name: path.basename(partPath),
      }));
    }
  } catch (error) {
    console.error('[BenchMark Archive] zip read failed:', error?.message || error);
    if (error instanceof Error && error.message) throw error;
    throw new Error('The Simulation Archive zip was created, but it could not be read back for download.');
  } finally {
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
  if (splitFiles?.length > 0) {
    if (onProgress) await onProgress({ percent: 84, step: `Simulation Archive ready in ${splitFiles.length} extractable ZIP parts.` });
    return splitFiles;
  }
  if (onProgress) await onProgress({ percent: 84, step: 'Simulation Archive ready. Preparing download...' });
  return buffer;
}

function buildBenchMarkMenuComponents(sharedRowProps = {}) {
  const rows = [buildBenchMarkMenuRow(sharedRowProps)];
  const downloadRow = (sharedRowProps.showPaperReportButton || sharedRowProps.showMatchArchiveButton)
    ? buildBenchMarkSuiteDownloadRow(sharedRowProps)
    : null;
  if (downloadRow) rows.push(downloadRow);
  return rows;
}

const BENCHMARK_HISTORY_REPORT_LIMIT = 3;
const BENCHMARK_HISTORY_FETCH_LIMIT = 40;
const BENCHMARK_HISTORY_EMPTY_NOTICE = 'No previous Simulation Report History is available yet. Run a Simulation Report with a different team, then History will show previous profiles.';
const BENCHMARK_PROFILE_RECENT_RUN_LIMIT = 25;
const BENCHMARK_PROFILE_BATTLE_LIMIT = 25000;

function normalizeBenchMarkHistoryKey(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function collectBenchMarkHistoryKeys(state = {}) {
  const report = state?.report && typeof state.report === 'object' ? state.report : {};
  return [
    state?.id,
    state?.job_id,
    state?.jobId,
    state?.report_id,
    state?.reportId,
    report.report_id,
    report.reportId,
    report.job_id,
    report.jobId,
  ].map(normalizeBenchMarkHistoryKey).filter(Boolean);
}

function getBenchMarkHistoryDateMs(value) {
  const ms = Date.parse(String(value || '').trim());
  return Number.isFinite(ms) ? ms : 0;
}

function getBenchMarkHistoryPrimaryDateMs(row = {}) {
  const report = row?.report && typeof row.report === 'object' ? row.report : {};
  return Math.max(
    getBenchMarkHistoryDateMs(row.completed_at),
    getBenchMarkHistoryDateMs(row.updated_at),
    getBenchMarkHistoryDateMs(report.generatedAt),
    getBenchMarkHistoryDateMs(report.generated_at),
  );
}

function getBenchMarkHistoryGeneratedDateMs(row = {}) {
  const report = row?.report && typeof row.report === 'object' ? row.report : {};
  return Math.max(
    getBenchMarkHistoryDateMs(report.generatedAt),
    getBenchMarkHistoryDateMs(report.generated_at),
  );
}

function getBenchMarkHistoryTieId(row = {}) {
  const keys = collectBenchMarkHistoryKeys(row);
  return keys.length ? keys[keys.length - 1] : '';
}

function getBenchMarkHistoryReportsCacheTtlMs() {
  return Number.isFinite(BENCHMARK_HISTORY_REPORTS_CACHE_TTL_MS) && BENCHMARK_HISTORY_REPORTS_CACHE_TTL_MS > 0
    ? BENCHMARK_HISTORY_REPORTS_CACHE_TTL_MS
    : 60000;
}

function buildBenchMarkHistoryReportsCacheKey(userId, latestState = {}, targetTeamHash = '', options = {}) {
  const latestKeys = collectBenchMarkHistoryKeys(latestState || {});
  const latestKey = latestKeys[0] || getBenchMarkSuiteHistoryTeamHashFromRow(latestState || {}) || 'none';
  const teamKey = cleanText(targetTeamHash || getBenchMarkSuiteHistoryTeamHashFromRow(latestState || {}) || 'unscoped');
  const mode = options?.includeReport === false ? 'lite' : 'full';
  return `${String(userId || '')}:${teamKey || 'unscoped'}:${latestKey}:${mode}`;
}

function cloneBenchMarkHistoryReports(reports = []) {
  return Array.isArray(reports) ? reports.map((row) => ({ ...row })) : [];
}

function getCachedBenchMarkPreviousSuiteReports(cacheKey) {
  const entry = benchmarkSuiteHistoryReportsCache.get(String(cacheKey || ''));
  if (!entry) return null;
  if ((Date.now() - Number(entry.createdAt || 0)) > getBenchMarkHistoryReportsCacheTtlMs()) {
    benchmarkSuiteHistoryReportsCache.delete(String(cacheKey || ''));
    return null;
  }
  return cloneBenchMarkHistoryReports(entry.reports);
}

function setCachedBenchMarkPreviousSuiteReports(cacheKey, reports = []) {
  if (!cacheKey) return cloneBenchMarkHistoryReports(reports);
  benchmarkSuiteHistoryReportsCache.set(String(cacheKey), {
    createdAt: Date.now(),
    reports: cloneBenchMarkHistoryReports(reports),
  });
  return cloneBenchMarkHistoryReports(reports);
}

function isCompletedBenchMarkHistoryRow(row = {}) {
  const status = String(row?.status || '').trim().toLowerCase();
  if (!row?.report || typeof row.report !== 'object') return false;
  if (!status) return true;
  return ['complete', 'completed', 'done'].includes(status);
}

function isLatestBenchMarkHistoryRow(row = {}, latestState = {}) {
  const latestKeys = new Set(collectBenchMarkHistoryKeys(latestState));
  if (!latestKeys.size) return false;
  return collectBenchMarkHistoryKeys(row).some((key) => latestKeys.has(key));
}

async function listBenchMarkPreviousSuiteReports(userId, latestState = null, benchmarkStateOrTeamExport = null, options = {}) {
  const startedAt = Date.now();
  const includeReport = options?.includeReport !== false;
  const { teamHash: targetTeamHash } = await resolveBenchMarkSuiteReportContext(userId, benchmarkStateOrTeamExport);
  const cacheKey = buildBenchMarkHistoryReportsCacheKey(userId, latestState || {}, targetTeamHash, { includeReport });
  const cachedReports = getCachedBenchMarkPreviousSuiteReports(cacheKey);
  if (cachedReports) {
    logMenuTiming('listBenchMarkPreviousSuiteReports cached', startedAt);
    return cachedReports;
  }

  const rows = await listBenchMarkJobHistory(userId, 'run-benchmark-suite', BENCHMARK_HISTORY_FETCH_LIMIT, { includeReport });
  const hasAnyTeamHashRows = rows.some((row) => Boolean(getBenchMarkSuiteHistoryTeamHashFromRow(row)));
  const sortedRows = rows
    .filter((row) => isCompletedBenchMarkHistoryRow(row))
    .filter((row) => !isLatestBenchMarkHistoryRow(row, latestState || {}))
    .sort((a, b) => {
      const primaryDateDiff = getBenchMarkHistoryPrimaryDateMs(b) - getBenchMarkHistoryPrimaryDateMs(a);
      if (primaryDateDiff) return primaryDateDiff;
      const generatedDateDiff = getBenchMarkHistoryGeneratedDateMs(b) - getBenchMarkHistoryGeneratedDateMs(a);
      if (generatedDateDiff) return generatedDateDiff;
      return String(getBenchMarkHistoryTieId(b)).localeCompare(String(getBenchMarkHistoryTieId(a)), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });

  if (!hasAnyTeamHashRows) {
    const reports = setCachedBenchMarkPreviousSuiteReports(cacheKey, sortedRows
      .slice(0, BENCHMARK_HISTORY_REPORT_LIMIT)
      .map((row) => sanitizeBenchMarkSuiteHistoryReport(row)));
    logMenuTiming('listBenchMarkPreviousSuiteReports', startedAt);
    return reports;
  }

  const latestTeamHash = targetTeamHash || getBenchMarkSuiteHistoryTeamHashFromRow(latestState || {});
  const seenTeamHashes = new Set();
  const uniqueProfiles = [];
  for (const row of sortedRows) {
    const rowTeamHash = getBenchMarkSuiteHistoryTeamHashFromRow(row);
    if (!rowTeamHash) continue;
    if (latestTeamHash && rowTeamHash === latestTeamHash) continue;
    if (seenTeamHashes.has(rowTeamHash)) continue;
    seenTeamHashes.add(rowTeamHash);
    uniqueProfiles.push(sanitizeBenchMarkSuiteHistoryReport(row));
    if (uniqueProfiles.length >= BENCHMARK_HISTORY_REPORT_LIMIT) break;
  }
  const reports = setCachedBenchMarkPreviousSuiteReports(cacheKey, uniqueProfiles);
  logMenuTiming('listBenchMarkPreviousSuiteReports', startedAt);
  return reports;
}

async function hasBenchMarkPreviousSuiteHistory(userId, latestState = null, benchmarkStateOrTeamExport = null) {
  const startedAt = Date.now();
  const reports = await listBenchMarkPreviousSuiteReports(userId, latestState, benchmarkStateOrTeamExport, { includeReport: false });
  logMenuTiming('hasBenchMarkPreviousSuiteHistory', startedAt);
  return Array.isArray(reports) && reports.length > 0;
}

function getBenchMarkHistoryIndexFromValue(value) {
  const match = String(value || '').match(/^history_(\d+)$/);
  if (!match) return -1;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 && index < BENCHMARK_HISTORY_REPORT_LIMIT ? index : -1;
}

function getBenchMarkLoadTeamIndexFromValue(value) {
  const match = String(value || '').match(/^load_team_(\d+)$/);
  if (!match) return -1;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 && index < BENCHMARK_HISTORY_REPORT_LIMIT ? index : -1;
}

function getBenchMarkHistoryTeamExport(row = {}) {
  const request = row && typeof row === 'object' ? row.request || {} : {};
  const report = row && typeof row === 'object' ? row.report || {} : {};
  const savedReport = report.savedReport && typeof report.savedReport === 'object' ? report.savedReport : {};
  return cleanText(
    request.teamExport
      || request.team_export
      || report.userTeamExport
      || report.playerTeamExport
      || report.teamExport
      || savedReport.userTeamExport
      || savedReport.playerTeamExport
      || savedReport.teamExport
      || null,
  );
}

function filterBenchMarkLoadTeamProfiles(historyReports = []) {
  return historyReports.filter((row) => looksLikeTeamExport(getBenchMarkHistoryTeamExport(row)));
}

async function listBenchMarkLoadTeamProfiles(userId, latestState = null, benchmarkStateOrTeamExport = null, options = {}) {
  const includeReport = options?.includeReport === true;
  const historyReports = await listBenchMarkPreviousSuiteReports(userId, latestState, benchmarkStateOrTeamExport, { includeReport });
  return filterBenchMarkLoadTeamProfiles(historyReports);
}

async function showBenchMarkLoadTeamSelector(interaction, notice = null) {
  const startedAt = Date.now();
  await renderMenuShellThenHydrate(interaction, {
    path: 'benchmark.load-team.open',
    hydrationKey: `benchmark:${interaction.user.id}:load-team`,
    shellPayload: () => buildBenchMarkLoadTeamShellPayload(interaction, 'Opening saved team profiles...'),
    hydratePayload: () => buildBenchMarkLoadTeamSelectorPayload(interaction, notice),
  });
  logMenuTiming('showBenchMarkLoadTeamSelector', startedAt);
  return true;
}

function buildBenchMarkHistoryViewComponents(sharedRowProps = {}, historyReports = [], historyIndex = -1) {
  if (!Number.isInteger(Number(historyIndex)) || Number(historyIndex) < 0) {
    return [
      buildBenchMarkSuiteHistoryRow({
        ownerId: sharedRowProps.ownerId,
        historyReports,
        selectedHistoryIndex: -1,
        hasPaperReportReady: false,
      }),
    ].filter(Boolean);
  }
  return [
    buildBenchMarkSuiteReportTabRow({
      ownerId: sharedRowProps.ownerId,
      selectedReportTab: sharedRowProps.selectedReportTab,
      hasPaperReportReady: sharedRowProps.hasPaperReportReady,
      hasMatchArchiveReady: false,
      hasLoadTeamReady: true,
      customIdBase: 'benchmark_suite_history_select',
      customIdParts: [String(historyIndex)],
    }),
  ].filter(Boolean);
}

function getBenchMarkInteractionDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user?.username || 'Trainer';
}

function normalizeBenchMarkSuiteReportTabValue(tab = 'overview') {
  const value = String(tab || '').trim().toLowerCase();
  if (['overview', 'threats', 'leads', 'core'].includes(value)) return value;
  return 'overview';
}

function buildBenchMarkSuiteReportShellPayload(interaction, {
  reportTab = 'overview',
  history = false,
  historyIndex = -1,
  notice = null,
} = {}) {
  const selectedReportTab = normalizeBenchMarkSuiteReportTabValue(reportTab);
  return {
    content: '',
    embeds: [
      buildBenchMarkSuiteReportShellEmbed({
        username: getBenchMarkInteractionDisplayName(interaction),
        reportTab: selectedReportTab,
        history,
        notice,
      }),
    ],
    components: history
      ? buildBenchMarkHistoryViewComponents({
        ownerId: interaction.user.id,
        selectedReportTab,
        hasPaperReportReady: false,
      }, [], historyIndex)
      : buildBenchMarkSuiteViewComponents({
        ownerId: interaction.user.id,
        selectedReportTab,
        hasPaperReportReady: false,
        hasMatchArchiveReady: false,
      }),
    files: [],
  };
}

function buildBenchMarkHistoryShellPayload(interaction, notice = null) {
  return {
    content: '',
    embeds: [
      buildBenchMarkSuiteHistoryShellEmbed({
        username: getBenchMarkInteractionDisplayName(interaction),
        notice,
      }),
    ],
    components: [
      buildBenchMarkSuiteHistoryRow({
        ownerId: interaction.user.id,
        historyReports: [],
        hasPaperReportReady: false,
      }),
    ],
    files: [],
  };
}

function buildBenchMarkLoadTeamShellPayload(interaction, notice = null) {
  return {
    content: '',
    embeds: [
      buildBenchMarkLoadTeamShellEmbed({
        username: getBenchMarkInteractionDisplayName(interaction),
        notice,
      }),
    ],
    components: [
      buildBenchMarkLoadTeamRow({
        ownerId: interaction.user.id,
        historyReports: [],
      }),
    ],
    files: [],
  };
}

async function buildLatestBenchMarkSuiteReportPayload(interaction, reportTab = 'overview') {
  const selectedReportTab = normalizeBenchMarkSuiteReportTabValue(reportTab);
  const {
    benchmarkState,
    jobState,
    matchupJobState,
    suiteJobState,
    warmupState,
    lastReportState,
    lastMatchupEvalState,
    lastSuiteReportState,
  } = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
  const hasLastSuiteReport = Boolean(lastSuiteReportState?.has_report || lastSuiteReportState?.report_id || lastSuiteReportState?.report);

  if (!hasLastSuiteReport) {
    return buildBenchMarkPayload(interaction, 'No completed Simulation Report is on file yet.');
  }

  let lastSuiteReportFullState = await getBenchMarkLastSuiteReport(interaction.user.id, benchmarkState);

  if (!lastSuiteReportFullState?.report && isCompletedBenchMarkSuiteJob(suiteJobState)) {
    const status = await getBenchmarkJobStatus(suiteJobState.job_id, { includeReport: true });
    if (status?.status === 'completed' && status?.report) {
      const suiteReportValidation = buildPromotableBenchMarkSuiteReport(status);
      if (!suiteReportValidation?.ok) {
        await persistBenchMarkSuiteStatus(interaction.user.id, suiteJobState, {
          ...status,
          report: null,
        });
        clearBenchMarkMenuPayloadCache(interaction.user.id);
        return buildBenchMarkPayload(interaction, buildBenchMarkSuiteDiscardNotice(suiteReportValidation));
      }
      const suiteReport = suiteReportValidation.report;
      const savedReportState = await setBenchMarkLastSuiteReport(interaction.user.id, suiteReport);
      clearBenchMarkMenuPayloadCache(interaction.user.id);
      lastSuiteReportFullState = { ...savedReportState, report: suiteReport };
    }
  }

  if (!lastSuiteReportFullState?.report) {
    return buildBenchMarkPayload(interaction, 'No completed Simulation Report is on file yet.');
  }

  const hasActiveSuiteJob = ['queued', 'running', 'cancelling'].includes(String(suiteJobState?.status || '').toLowerCase());
  const sharedRowProps = {
    ownerId: interaction.user.id,
    hasSubmittedTeam: Boolean(cleanText(benchmarkState?.team_export)),
    hasLastReport: Boolean(lastReportState?.has_report || lastReportState?.report_id || lastReportState?.report),
    hasActiveJob: ['queued', 'running'].includes(String(jobState?.status || '').toLowerCase()),
    hasLastMatchupEval: Boolean(lastMatchupEvalState?.has_report || lastMatchupEvalState?.report_id || lastMatchupEvalState?.report),
    hasActiveMatchupJob: ['queued', 'running'].includes(String(matchupJobState?.status || '').toLowerCase()),
    hasLastSuiteReport: true,
    hasActiveSuiteJob,
    hasMatchArchiveReady: !hasActiveSuiteJob && hasSavedMatchArchive(lastSuiteReportFullState.report),
    hasPaperReportReady: hasSavedPaperReport(lastSuiteReportFullState.report),
    showMatchArchiveButton: true,
    showPaperReportButton: true,
    useSuiteReportDropdown: true,
    benchmarkWarmupActive: isBenchMarkWarmupActive(warmupState),
    selectedReportTab,
  };

  return {
    content: '',
    embeds: [
      buildBenchMarkSuiteEmbed({
        username: getBenchMarkInteractionDisplayName(interaction),
        report: lastSuiteReportFullState.report,
        reportTab: selectedReportTab,
      }),
    ],
    components: buildBenchMarkSuiteViewComponents(sharedRowProps),
    files: [],
  };
}

async function buildBenchMarkHistoryMenuPayload(interaction, notice = null) {
  const { benchmarkState, lastSuiteReportState } = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
  const historyReports = await listBenchMarkPreviousSuiteReports(
    interaction.user.id,
    lastSuiteReportState,
    benchmarkState,
    { includeReport: false },
  );

  if (!historyReports.length) {
    return buildBenchMarkPayload(
      interaction,
      notice || BENCHMARK_HISTORY_EMPTY_NOTICE,
    );
  }

  const payload = await buildBenchMarkPayload(
    interaction,
    notice || `Choose one of your ${historyReports.length} previous Simulation Reports. History offers Paper Report downloads only.`,
  );
  return {
    ...payload,
    components: [
      buildBenchMarkSuiteHistoryRow({
        ownerId: interaction.user.id,
        historyReports,
      }),
    ],
    files: [],
  };
}

async function buildBenchMarkHistoryReportPayload(interaction, historyIndex, reportTab = 'overview') {
  const selectedReportTab = normalizeBenchMarkSuiteReportTabValue(reportTab);
  const {
    benchmarkState,
    jobState,
    matchupJobState,
    suiteJobState,
    warmupState,
    lastReportState,
    lastMatchupEvalState,
    lastSuiteReportState,
  } = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
  const historyReports = await listBenchMarkPreviousSuiteReports(
    interaction.user.id,
    lastSuiteReportState,
    benchmarkState,
  );
  const historyReport = historyReports[historyIndex] || null;

  if (!historyReport?.report) {
    const payload = await buildBenchMarkPayload(interaction, 'That previous Simulation Report is unavailable now. History keeps the latest plus previous three reports.');
    return {
      ...payload,
      components: historyReports.length
        ? buildBenchMarkHistoryViewComponents({
          ownerId: interaction.user.id,
          historyReports,
          hasPaperReportReady: false,
        }, historyReports, -1)
        : payload.components,
      files: [],
    };
  }

  const hasActiveSuiteJob = ['queued', 'running', 'cancelling'].includes(String(suiteJobState?.status || '').toLowerCase());
  const sharedRowProps = {
    ownerId: interaction.user.id,
    hasSubmittedTeam: Boolean(cleanText(benchmarkState?.team_export)),
    hasLastReport: Boolean(lastReportState?.has_report || lastReportState?.report_id || lastReportState?.report),
    hasActiveJob: ['queued', 'running'].includes(String(jobState?.status || '').toLowerCase()),
    hasLastMatchupEval: Boolean(lastMatchupEvalState?.has_report || lastMatchupEvalState?.report_id || lastMatchupEvalState?.report),
    hasActiveMatchupJob: ['queued', 'running'].includes(String(matchupJobState?.status || '').toLowerCase()),
    hasLastSuiteReport: Boolean(lastSuiteReportState?.has_report || lastSuiteReportState?.report_id || lastSuiteReportState?.report),
    hasActiveSuiteJob,
    hasMatchArchiveReady: false,
    hasPaperReportReady: hasSavedPaperReport(historyReport.report),
    showMatchArchiveButton: false,
    showPaperReportButton: false,
    historyReports,
    historyIndex,
    useHistoryReportDropdown: true,
    useSuiteReportDropdown: false,
    benchmarkWarmupActive: isBenchMarkWarmupActive(warmupState),
    selectedReportTab,
  };

  return {
    content: '',
    embeds: [
      buildBenchMarkSuiteEmbed({
        username: getBenchMarkInteractionDisplayName(interaction),
        report: historyReport.report,
        reportTab: selectedReportTab,
      }),
    ],
    components: buildBenchMarkHistoryViewComponents(sharedRowProps, historyReports, historyIndex),
    files: [],
  };
}

async function buildBenchMarkLoadTeamSelectorPayload(interaction, notice = null) {
  const menuState = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
  const benchmarkState = menuState.benchmarkState;
  const latestSuiteReportState = menuState.lastSuiteReportState;
  const loadTeamProfiles = await listBenchMarkLoadTeamProfiles(interaction.user.id, latestSuiteReportState, benchmarkState, { includeReport: false });
  if (!loadTeamProfiles.length) {
    return buildBenchMarkPayload(interaction, notice || 'No previous Battle Simulator teams are available to load yet.');
  }

  const payload = await buildBenchMarkPayload(
    interaction,
    notice || `Choose one of your ${loadTeamProfiles.length} previous Battle Simulator teams to load.`,
  );
  return {
    ...payload,
    components: [buildBenchMarkLoadTeamRow({
      ownerId: interaction.user.id,
      historyReports: loadTeamProfiles,
    })],
    files: [],
  };
}

async function buildBenchMarkLoadTeamSelectionPayload(interaction, loadTeamIndex) {
  const { benchmarkState, lastSuiteReportState: latestSuiteReportState } = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
  const loadTeamProfiles = await listBenchMarkLoadTeamProfiles(interaction.user.id, latestSuiteReportState, benchmarkState, { includeReport: false });
  const selectedProfile = loadTeamProfiles[loadTeamIndex] || null;
  const teamExport = getBenchMarkHistoryTeamExport(selectedProfile);
  const importValidation = validateBenchMarkTeamImport(teamExport);
  if (!importValidation.ok) {
    return buildBenchMarkPayload(interaction, importValidation.message || 'That previous team could not be loaded.');
  }

  await setBenchMarkTeamState(interaction.user.id, teamExport);
  await clearBenchMarkLoadedTeamRuntimeState(interaction.user.id, teamExport);
  clearBenchMarkMenuPayloadCache(interaction.user.id);
  return buildBenchMarkPayload(interaction, 'Previous Battle Simulator team loaded. Your submitted team has been updated.');
}

const BENCHMARK_WARMUP_STATE_KEY = 'benchmark_startup_warmup_state';
const BENCHMARK_STARTUP_WARMUP_ENABLED = String(process.env.BENCHMARK_STARTUP_WARMUP_ENABLED || '1').trim() !== '0';
const BENCHMARK_STARTUP_WARMUP_DELAY_MS = Number(process.env.BENCHMARK_STARTUP_WARMUP_DELAY_MS || 0);
const BENCHMARK_STARTUP_WARMUP_TIMEOUT_MS = Number(process.env.BENCHMARK_STARTUP_WARMUP_TIMEOUT_MS || 240000);
const BENCHMARK_STARTUP_WARMUP_USER_ID = '__benchmark_startup_warmup__';
const BENCHMARK_STARTUP_WARMUP_TEAM_EXPORT = `Farigiraf @ Sitrus Berry
Ability: Armor Tail
Level: 50
Tera Type: Fairy
EVs: 244 HP / 132 Def / 76 SpA / 52 SpD / 4 Spe
Modest Nature
IVs: 0 Atk
- Psychic Noise
- Dazzling Gleam
- Energy Ball
- Ally Switch

Zoroark-Hisui @ Life Orb
Ability: Illusion
Level: 50
Tera Type: Normal
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
IVs: 0 Atk
- Shadow Ball
- Flamethrower
- Sludge Bomb
- Protect

Whimsicott @ Focus Sash
Ability: Prankster
Level: 50
Tera Type: Ghost
EVs: 68 HP / 4 Def / 212 SpA / 4 SpD / 220 Spe
Timid Nature
IVs: 0 Atk
- Tailwind
- Moonblast
- Encore
- Helping Hand

Urshifu-Rapid-Strike @ Mystic Water
Ability: Unseen Fist
Level: 50
Tera Type: Fire
EVs: 252 Atk / 4 SpD / 252 Spe
Adamant Nature
- Surging Strikes
- Close Combat
- U-turn
- Protect

Rillaboom @ Assault Vest
Ability: Grassy Surge
Level: 50
Tera Type: Fire
EVs: 196 HP / 196 Atk / 4 Def / 108 SpD / 4 Spe
Adamant Nature
- Fake Out
- Wood Hammer
- Grassy Glide
- Stomping Tantrum

Arcanine-Hisui @ Safety Goggles
Ability: Intimidate
Level: 50
Tera Type: Fire
EVs: 252 Atk / 4 SpD / 252 Spe
Jolly Nature
- Flare Blitz
- Rock Slide
- Iron Head
- Protect`;

const BENCHMARK_SUITE_CONFIG_STATE_PREFIX = 'benchmark_suite_config';
const BENCHMARK_SUITE_REPORT_TYPE_PREFIX = 'run-benchmark-suite';
const BENCHMARK_SUITE_CHAMPIONS_FORMAT_ID = 'gen9championscustomgame';
const BENCHMARK_SUITE_STANDARD_FORMAT_ID = 'gen9benchmarkdoublesag';
const BENCHMARK_SUITE_FORMAT_OPTIONS = [BENCHMARK_SUITE_CHAMPIONS_FORMAT_ID];
const BENCHMARK_SUITE_MODE_S_TIER_TOP = 's-tier-top-tournament';
const BENCHMARK_SUITE_MODE_SA_TIER_TOP4 = 'sa-tier-top4-tournament';
const BENCHMARK_SUITE_MODE_ALL_META_TOURNAMENT = 'all-meta-all-tournament';
const BENCHMARK_SUITE_MODE_FULL_META_RANDOM_100 = 'full-meta-random-100';
const BENCHMARK_SUITE_MODE_GAUNTLET_FULL_META_200 = 'gauntlet-full-meta-200';
const BENCHMARK_SUITE_MODE_OPTIONS = [
  BENCHMARK_SUITE_MODE_S_TIER_TOP,
  BENCHMARK_SUITE_MODE_SA_TIER_TOP4,
  BENCHMARK_SUITE_MODE_ALL_META_TOURNAMENT,
  BENCHMARK_SUITE_MODE_FULL_META_RANDOM_100,
  BENCHMARK_SUITE_MODE_GAUNTLET_FULL_META_200,
];
const BENCHMARK_SUITE_MODE_LABELS = {
  [BENCHMARK_SUITE_MODE_S_TIER_TOP]: 'S-Tier + Top Tournament',
  [BENCHMARK_SUITE_MODE_SA_TIER_TOP4]: 'S/A Tier + Top 4 Tournament',
  [BENCHMARK_SUITE_MODE_ALL_META_TOURNAMENT]: 'All Meta + All Tournament',
  [BENCHMARK_SUITE_MODE_FULL_META_RANDOM_100]: 'Full Meta + 100 Random',
  [BENCHMARK_SUITE_MODE_GAUNTLET_FULL_META_200]: 'GAUNTLET - Full Meta + 200 Random',
};
const BENCHMARK_SUITE_MODE_TARGET_COUNTS = {
  [BENCHMARK_SUITE_MODE_S_TIER_TOP]: 271,
  [BENCHMARK_SUITE_MODE_SA_TIER_TOP4]: 545,
  [BENCHMARK_SUITE_MODE_ALL_META_TOURNAMENT]: 1050,
  [BENCHMARK_SUITE_MODE_FULL_META_RANDOM_100]: 1150,
  [BENCHMARK_SUITE_MODE_GAUNTLET_FULL_META_200]: 1250,
};
const BENCHMARK_SUITE_BATTLE_BUDGET_OPTIONS = [100, 200, 300, 850, 1250];
const BENCHMARK_SUITE_GAMES_PER_OPPONENT_OPTIONS = [1, 3];
const BENCHMARK_SUITE_DEFAULT_CONFIG = {
  mode: BENCHMARK_SUITE_MODE_ALL_META_TOURNAMENT,
  sample_size: 25,
  battle_budget: 200,
  games_per_opponent: 1,
  format_id: BENCHMARK_SUITE_CHAMPIONS_FORMAT_ID,
};

let reminderCheckInFlight = false;
let academySyncInFlight = false;

function isBotAdmin(interaction) {
  const userId = interaction.user?.id;
  const member = interaction.member;
  if (!userId || !member) return false;
  if (ADMIN_USER_IDS.includes(userId)) return true;
  if (member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }
  return member.roles?.cache?.some((role) => ADMIN_ROLE_IDS.includes(role.id)) || false;
}

function cleanText(text) {
  return String(text || '').trim();
}

function looksLikeTeamExport(teamExport) {
  const normalized = String(teamExport || '').replace(/\r\n/g, '\n').trim();
  if (!normalized || normalized.length < 20) return false;
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const hasAbilityLine = lines.some((line) => line.startsWith('Ability:'));
  const hasMoveLine = lines.some((line) => line.startsWith('- '));
  const hasHeaderLine = lines.some((line) => line.includes(' @ '));
  return lines.length >= 4 && (hasAbilityLine || hasMoveLine || hasHeaderLine);
}

function normalizeBenchMarkTeamExportForHash(teamExport = '') {
  const normalized = String(teamExport || '').replace(/\r\n/g, '\n').trim();
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.join('\n');
}

function buildBenchMarkSuiteTeamHash(teamExport = '') {
  const canonical = normalizeBenchMarkTeamExportForHash(teamExport);
  if (!canonical) return null;
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function buildBenchMarkSuiteReportType(teamHash = null) {
  const safeHash = String(teamHash || '').trim();
  return safeHash ? `${BENCHMARK_SUITE_REPORT_TYPE_PREFIX}:${safeHash}` : BENCHMARK_SUITE_REPORT_TYPE_PREFIX;
}

function detectBenchMarkTeamExportMode(teamExport) {
  if (!looksLikeTeamExport(teamExport)) {
    return { ok: false, message: 'That does not look like a valid Pokémon Showdown export.' };
  }

  const detection = detectChampionsSpTeamMode(teamExport);
  if (detection.mode === 'mixed') {
    return {
      ok: false,
      mode: 'mixed',
      message: 'Champion team import failed: Mixed team format.',
    };
  }
  if (detection.mode === 'sp' || detection.mode === 'champions-ev') {
    const championsValidation = validateChampionsSpTeamShape(teamExport);
    if (!championsValidation.ok) {
      return {
        ok: false,
        mode: detection.mode,
        message: `Champion team import failed: ${championsValidation.reason}.`,
      };
    }
    return { ok: true, mode: detection.mode };
  }

  if (detection.mode === 'ev' || detection.mode === 'standard-ev') return { ok: true, mode: 'standard-ev' };
  return { ok: true, mode: 'standard' };
}

function validateBenchMarkTeamImport(teamExport) {
  const detection = detectBenchMarkTeamExportMode(teamExport);
  if (!detection.ok) return { ok: false, message: detection.message, mode: detection.mode };
  return { ok: true, mode: detection.mode };
}

function formatTeamCodeBlock(teamExport) {
  const safeText = String(teamExport || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .replace(/```/g, '``\u200b`');
  return `\`\`\`\n${safeText}\n\`\`\``;
}

function buildBenchMarkSubmittedTeamExport(teamExport, exportMode) {
  const raw = cleanText(teamExport);
  if (!looksLikeTeamExport(raw)) {
    throw new Error('Saved BenchMark team export is missing or invalid.');
  }

  const mode = String(exportMode || '').trim().toLowerCase();
  const detection = detectChampionsSpTeamMode(raw);
  if (detection.mode === 'mixed') {
    throw new Error('Saved BenchMark team export mixes EVs and SPs.');
  }

  if (mode === 'standard') {
    return detection.mode === 'sp' || detection.mode === 'champions-ev'
      ? convertChampionsSpTeamExportForShowdown(raw, CHAMPIONS_SP_FORMAT_ID)
      : raw;
  }

  if (mode === 'champion') {
    const validation = validateChampionsSpTeamShape(raw);
    if (!validation.ok) {
      throw new Error(`Saved BenchMark team cannot be converted to Champion Export: ${validation.reason}`);
    }
    return buildChampionsSpDisplayTeamExport(raw, CHAMPIONS_SP_FORMAT_ID);
  }

  throw new Error('Unknown BenchMark export format.');
}

function buildBenchMarkSubmittedTeamDisplayExport(teamExport, formatId) {
  const selectedFormat = cleanText(formatId).toLowerCase();
  try {
    return buildBenchMarkSubmittedTeamExport(
      teamExport,
      selectedFormat === CHAMPIONS_SP_FORMAT_ID ? 'champion' : 'standard',
    );
  } catch {
    return teamExport;
  }
}

async function replyBenchMarkSubmittedTeamExport(interaction, teamExport, exportMode, options = {}) {
  const mode = String(exportMode || '').trim().toLowerCase();
  const label = mode === 'champion' ? 'Champion Export' : 'Standard Export';
  const existingComponents = Array.isArray(options.components) ? options.components : [];
  const components = existingComponents.length
    ? existingComponents
    : [buildBenchMarkSubmittedTeamExportRow({ ownerId: interaction.user.id, hasSubmittedTeam: true })].filter(Boolean);
  try {
    const exportText = buildBenchMarkSubmittedTeamExport(teamExport, mode);
    const safeText = String(exportText || '').replace(/```/g, '``\u200b`');
    const content = `**${label}**\n\`\`\`\n${safeText}\n\`\`\``;
    if (content.length <= 1900) {
      await interaction.update({ content, embeds: [], components, attachments: [] });
      return;
    }

    await interaction.update({
      content: `**${label}** attached.`,
      embeds: [],
      components,
      attachments: [],
      files: [{
        attachment: Buffer.from(String(exportText || ''), 'utf8'),
        name: mode === 'champion' ? 'champion-export.txt' : 'standard-export.txt',
      }],
    });
  } catch (error) {
    await interaction.update({
      content: error?.message || `Professor Aegis could not build the ${label}.`,
      embeds: [],
      components,
      attachments: [],
    });
  }
}

function buildBattleScoringConfig(leagueState = {}) {
  return {
    gameWinPoints: Number.isInteger(leagueState?.battle_points_per_game_win)
      ? leagueState.battle_points_per_game_win
      : 50,
    sweepBonusPoints: Number.isInteger(leagueState?.battle_sweep_bonus_points)
      ? leagueState.battle_sweep_bonus_points
      : 25,
    bestOf: Number.isInteger(leagueState?.battle_best_of)
      ? leagueState.battle_best_of
      : 3,
  };
}

async function getBattleTestMode() {
  const state = await getStateValueJSON('battle_test_mode', { enabled: false });
  return Boolean(state?.enabled);
}

async function setBattleTestMode(enabled) {
  await setStateValueJSON('battle_test_mode', {
    enabled: Boolean(enabled),
    updated_at: new Date().toISOString(),
  });
}

function isBattleWindowOpenNow(now = new Date()) {
  const et = getEtParts(now);
  if (et.weekday !== 'Sat') return false;
  if (et.hour < 0 || et.hour > 23) return false;
  if (et.hour === 23 && et.minute > 59) return false;
  return true;
}

function getBattleWindowKey(now = new Date()) {
  const et = getEtParts(now);
  return `${et.year}-${String(et.month).padStart(2, '0')}-${String(et.day).padStart(2, '0')}`;
}

function toShowdownId(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sanitizeRoomSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'trainer';
}

function formatRegulationText(leagueState) {
  if (leagueState.regulation_name && leagueState.regulation_url) {
    return `[${leagueState.regulation_name}](${leagueState.regulation_url})`;
  }
  return leagueState.regulation_name || 'Not set';
}

function withOptionalFooter(embed, notice) {
  if (notice) embed.setFooter({ text: notice });
  return embed;
}

function resolveRegistrationSeasonNumber(leagueState) {
  return leagueState.league_active ? Number(leagueState.season_number || 1) : Number(leagueState.season_number || 0) + 1;
}

async function syncAcademyMembersFromGuild(reason = 'manual') {
  if (academySyncInFlight) {
    console.log(`[Academy Sync] Skipping ${reason}; sync already in flight.`);
    return;
  }
  academySyncInFlight = true;
  const startedAt = Date.now();
  try {
    console.log(`[Academy Sync] ${reason} started.`);
    const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
    if (!guild) {
      console.warn(`[Academy Sync] ${reason} skipped: guild not found.`);
      return;
    }
    const members = await guild.members.fetch();
    const trainerMembers = members.filter((member) => !member.user.bot && member.roles.cache.has(TRAINER_ROLE_ID));
    const records = trainerMembers.map((member) => ({
      userId: member.id,
      username: member.displayName || member.user.username,
    }));
    await syncAcademyMembers(records);
    console.log(
      `[Academy Sync] ${reason} completed in ${Date.now() - startedAt}ms `
      + `(members=${members.size}, trainers=${records.length}).`,
    );
  } catch (error) {
    console.error(`[Academy Sync] ${reason} failed after ${Date.now() - startedAt}ms:`, error);
  } finally {
    academySyncInFlight = false;
  }
}

function scheduleInitialAcademyMembersSync(delayMs = 5000) {
  const safeDelayMs = Number.isFinite(Number(delayMs)) && Number(delayMs) >= 0
    ? Number(delayMs)
    : 5000;
  console.log(`[Academy Sync] Initial sync scheduled in ${safeDelayMs}ms.`);
  setTimeout(() => {
    syncAcademyMembersFromGuild('initial delayed startup').catch((error) =>
      console.error('[Academy Sync] initial delayed startup failed:', error),
    );
  }, safeDelayMs);
}

async function runLeagueReminderCheck() {
  if (reminderCheckInFlight) return;
  reminderCheckInFlight = true;
  try {
    const reminderData = await getPendingReminder();
    if (!reminderData?.announcementChannelId) return;
    const channel = await resolveAnnouncementChannel(client, reminderData.announcementChannelId);
    if (!channel) return;
    const payload = await getReminderMessagePayload(reminderData);
    await channel.send(payload);
    await markReminderSent(reminderData.reminderKey);
  } catch (error) {
    console.error('League reminder check failed:', error);
  } finally {
    reminderCheckInFlight = false;
  }
}

function replyNotAuthorized(interaction, content = 'You are not allowed to do that.') {
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  return interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
}

function replyWrongOwner(interaction) {
  return replyNotAuthorized(interaction, 'That control panel belongs to another trainer.');
}

async function ensureScopedOwnership(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed.scoped) return { ok: true, parsed };
  if (parsed.ownerId !== interaction.user.id) {
    await replyWrongOwner(interaction);
    return { ok: false, parsed };
  }
  return { ok: true, parsed };
}

function randomSubmitter(battle) {
  return Math.random() < 0.5 ? battle.challenger_user_id : battle.opponent_user_id;
}

function buildBenchMarkSuiteConfigStateKey(userId) {
  return `${BENCHMARK_SUITE_CONFIG_STATE_PREFIX}:${userId}`;
}

function normalizeBenchMarkSuiteMode(value) {
  const raw = cleanText(value).toLowerCase();
  const aliases = {
    'featured-only': BENCHMARK_SUITE_MODE_S_TIER_TOP,
    'random-sample': BENCHMARK_SUITE_MODE_FULL_META_RANDOM_100,
    'full-reg': BENCHMARK_SUITE_MODE_ALL_META_TOURNAMENT,
    's-tier + top tournament': BENCHMARK_SUITE_MODE_S_TIER_TOP,
    's/a tier + top 4 tournament': BENCHMARK_SUITE_MODE_SA_TIER_TOP4,
    'all meta + all tournament': BENCHMARK_SUITE_MODE_ALL_META_TOURNAMENT,
    'full meta + 100 random': BENCHMARK_SUITE_MODE_FULL_META_RANDOM_100,
    'gauntlet - full meta + 200 random': BENCHMARK_SUITE_MODE_GAUNTLET_FULL_META_200,
  };
  const normalized = aliases[raw] || raw;
  return BENCHMARK_SUITE_MODE_OPTIONS.includes(normalized) ? normalized : BENCHMARK_SUITE_DEFAULT_CONFIG.mode;
}

function isBenchMarkSuiteFixedPoolMode(mode) {
  return Boolean(BENCHMARK_SUITE_MODE_TARGET_COUNTS[normalizeBenchMarkSuiteMode(mode)]);
}

function isBenchMarkSuiteSweepMode(mode) {
  const normalized = normalizeBenchMarkSuiteMode(mode);
  return normalized === BENCHMARK_SUITE_MODE_ALL_META_TOURNAMENT
    || normalized === BENCHMARK_SUITE_MODE_FULL_META_RANDOM_100
    || normalized === BENCHMARK_SUITE_MODE_GAUNTLET_FULL_META_200;
}

function getBenchMarkSuiteTargetCount(mode) {
  return BENCHMARK_SUITE_MODE_TARGET_COUNTS[normalizeBenchMarkSuiteMode(mode)] || null;
}

function getBenchMarkSuiteRequestedSampleSize(mode, sampleSize) {
  return isBenchMarkSuiteFixedPoolMode(mode) ? null : sampleSize;
}

function getBenchMarkSuiteInitialOpponentCount(mode, sampleSize) {
  return getBenchMarkSuiteTargetCount(mode) || sampleSize;
}

function getBenchMarkSuiteAllocatedGamesPerOpponent(selectedCount, battleBudget) {
  const opponents = Math.max(Number(selectedCount) || 0, 0);
  const budget = normalizeBenchMarkSuiteBattleBudget(battleBudget);
  if (opponents <= 0) return 1;
  return Math.max(1, Math.floor(budget / opponents));
}

function getBenchMarkSuiteExpectedTotalGames(selectedCount, battleBudget) {
  const opponents = Math.max(Number(selectedCount) || 0, 0);
  if (opponents <= 0) return 0;
  return opponents * getBenchMarkSuiteAllocatedGamesPerOpponent(opponents, battleBudget);
}

function getBenchMarkSuiteSweepModeLabel(mode) {
  return isBenchMarkSuiteSweepMode(mode) ? `${normalizeBenchMarkSuiteMode(mode)}-sweep` : null;
}

function getBenchMarkSuiteSelectionSummarySeed(config = {}) {
  const mode = normalizeBenchMarkSuiteMode(config.mode);
  const requestedSampleSize = getBenchMarkSuiteRequestedSampleSize(mode, config.sample_size);
  const targetOpponentCount = getBenchMarkSuiteTargetCount(mode);
  const sweepMode = isBenchMarkSuiteSweepMode(mode);
  const battleBudget = normalizeBenchMarkSuiteBattleBudget(config.battle_budget);
  const allocatedGamesPerOpponent = getBenchMarkSuiteAllocatedGamesPerOpponent(targetOpponentCount, battleBudget);
  return {
    requestedSampleSize,
    sampleSizeIgnored: isBenchMarkSuiteFixedPoolMode(mode),
    selectionSeed: null,
    availableOpponents: null,
    targetOpponentCount,
    battleBudget,
    battlesPerMatchup: battleBudget,
    battleBudgetAllocationRule: 'championslab-min-one-per-opponent-floor-budget',
    allocatedGamesPerOpponent,
    expectedTotalGames: targetOpponentCount ? targetOpponentCount * allocatedGamesPerOpponent : null,
    sweepMode,
    sweepModeLabel: getBenchMarkSuiteSweepModeLabel(mode),
    excludesUserTeams: sweepMode,
  };
}

function normalizeBenchMarkSuiteFormatId(value) {
  const raw = cleanText(value).toLowerCase();
  return BENCHMARK_SUITE_FORMAT_OPTIONS.includes(raw) ? raw : BENCHMARK_SUITE_DEFAULT_CONFIG.format_id;
}

function isBenchMarkSuiteChampionFormat(formatId) {
  return cleanText(formatId).toLowerCase() === BENCHMARK_SUITE_CHAMPIONS_FORMAT_ID;
}

function normalizeBenchMarkSuiteSampleSize(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : BENCHMARK_SUITE_DEFAULT_CONFIG.sample_size;
}

function normalizeBenchMarkSuiteBattleBudget(value) {
  const parsed = Number(value);
  return BENCHMARK_SUITE_BATTLE_BUDGET_OPTIONS.includes(parsed)
    ? parsed
    : BENCHMARK_SUITE_DEFAULT_CONFIG.battle_budget;
}

function normalizeBenchMarkSuiteGamesPerOpponent(value, formatId = BENCHMARK_SUITE_DEFAULT_CONFIG.format_id) {
  if (isBenchMarkSuiteChampionFormat(formatId)) return 1;
  const parsed = Number(value);
  return BENCHMARK_SUITE_GAMES_PER_OPPONENT_OPTIONS.includes(parsed)
    ? parsed
    : BENCHMARK_SUITE_DEFAULT_CONFIG.games_per_opponent;
}

function humanizeBenchMarkSuiteMode(mode) {
  const value = normalizeBenchMarkSuiteMode(mode);
  return BENCHMARK_SUITE_MODE_LABELS[value] || BENCHMARK_SUITE_MODE_LABELS[BENCHMARK_SUITE_DEFAULT_CONFIG.mode];
}

function humanizeBenchMarkSuiteFormat(formatId) {
  const value = String(formatId || '').trim().toLowerCase();
  if (value === BENCHMARK_SUITE_STANDARD_FORMAT_ID) return 'Standard';
  return 'Champions';
}

function formatBenchMarkSuiteConfigText(config = {}) {
  const formatText = humanizeBenchMarkSuiteFormat(config.format_id);
  const modeText = humanizeBenchMarkSuiteMode(config.mode);
  const targetCount = getBenchMarkSuiteTargetCount(config.mode);
  const sampleText = targetCount
    ? `${targetCount} teams`
    : `${Number(config.sample_size || BENCHMARK_SUITE_DEFAULT_CONFIG.sample_size)} opponents`;
  const battleBudget = normalizeBenchMarkSuiteBattleBudget(config.battle_budget);
  const battleBudgetText = isBenchMarkSuiteChampionFormat(config.format_id)
    ? `${battleBudget}-Battle Budget`
    : `${battleBudget} Battles per Matchup`;
  const gamesText = isBenchMarkSuiteChampionFormat(config.format_id)
    ? 'BO1 allocation'
    : `BO${Number(config.games_per_opponent || BENCHMARK_SUITE_DEFAULT_CONFIG.games_per_opponent)}`;
  return `${formatText} • ${modeText} • ${sampleText} • ${battleBudgetText} • ${gamesText}`;
}

function normalizeBenchMarkSuiteConfig(raw = {}) {
  const formatId = normalizeBenchMarkSuiteFormatId(raw?.format_id);
  return {
    mode: normalizeBenchMarkSuiteMode(raw?.mode),
    sample_size: normalizeBenchMarkSuiteSampleSize(raw?.sample_size),
    battle_budget: normalizeBenchMarkSuiteBattleBudget(raw?.battle_budget ?? raw?.battleBudget ?? raw?.iterations),
    games_per_opponent: normalizeBenchMarkSuiteGamesPerOpponent(raw?.games_per_opponent, formatId),
    format_id: formatId,
  };
}

async function getBenchMarkSuiteConfig(userId) {
  const raw = await getStateValueJSON(
    buildBenchMarkSuiteConfigStateKey(userId),
    BENCHMARK_SUITE_DEFAULT_CONFIG,
  );
  return normalizeBenchMarkSuiteConfig(raw);
}

async function setBenchMarkSuiteConfig(userId, nextConfig = {}, currentConfig = null) {
  const current = currentConfig
    ? normalizeBenchMarkSuiteConfig(currentConfig)
    : await getBenchMarkSuiteConfig(userId);
  const nextFormatId = Object.prototype.hasOwnProperty.call(nextConfig || {}, 'format_id')
    ? normalizeBenchMarkSuiteFormatId(nextConfig.format_id)
    : normalizeBenchMarkSuiteFormatId(current.format_id);
  const merged = {
    mode: Object.prototype.hasOwnProperty.call(nextConfig || {}, 'mode')
      ? normalizeBenchMarkSuiteMode(nextConfig.mode)
      : current.mode,
    sample_size: Object.prototype.hasOwnProperty.call(nextConfig || {}, 'sample_size')
      ? normalizeBenchMarkSuiteSampleSize(nextConfig.sample_size)
      : current.sample_size,
    battle_budget: Object.prototype.hasOwnProperty.call(nextConfig || {}, 'battle_budget')
      ? normalizeBenchMarkSuiteBattleBudget(nextConfig.battle_budget)
      : normalizeBenchMarkSuiteBattleBudget(current.battle_budget),
    games_per_opponent: Object.prototype.hasOwnProperty.call(nextConfig || {}, 'games_per_opponent')
      ? normalizeBenchMarkSuiteGamesPerOpponent(nextConfig.games_per_opponent, nextFormatId)
      : normalizeBenchMarkSuiteGamesPerOpponent(current.games_per_opponent, nextFormatId),
    format_id: nextFormatId,
  };
  await setStateValueJSON(buildBenchMarkSuiteConfigStateKey(userId), merged);
  clearBenchMarkMenuCaches(userId);
  return merged;
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDefaultBenchMarkWarmupState() {
  return {
    active: false,
    status: 'idle',
    job_id: null,
    started_at: null,
    completed_at: null,
    error: null,
    progress: null,
  };
}

async function getBenchMarkWarmupState() {
  const raw = await getStateValueJSON(BENCHMARK_WARMUP_STATE_KEY, buildDefaultBenchMarkWarmupState());
  return {
    ...buildDefaultBenchMarkWarmupState(),
    ...(raw || {}),
  };
}

async function setBenchMarkWarmupState(nextState = {}) {
  const current = await getBenchMarkWarmupState();
  const merged = {
    ...current,
    ...(nextState || {}),
  };
  await setStateValueJSON(BENCHMARK_WARMUP_STATE_KEY, merged);
  clearBenchMarkSuiteSettingsSnapshotCache();
  return merged;
}

function isBenchMarkWarmupActive(state = {}) {
  return Boolean(state?.active) && ['queued', 'running', 'cancelling', 'submitting'].includes(String(state?.status || '').toLowerCase());
}

function formatBenchMarkWarmupStatusText(state = {}) {
  const status = String(state?.status || 'idle').toLowerCase();
  const progress = state?.progress || {};
  const percent = Number.isFinite(Number(progress.percent)) ? ` • ${Number(progress.percent)}%` : '';

  if (status === 'submitting') return `Starting ⏳${percent}`;
  if (status === 'queued') return `Queued ⏳${percent}`;
  if (status === 'running') return `Running 🔥${percent}`;
  if (status === 'completed') return 'Completed ✅';
  if (status === 'failed') return `${state?.error ? truncateBenchMarkStatusText(state.error, 120) : 'Matchup Report could not safely complete. Please try again in a few minutes.'}`;
  return 'Idle';
}

function formatBenchMarkWarmupDetailText(state = {}) {
  const status = String(state?.status || 'idle').toLowerCase();
  if (!['submitting', 'queued', 'running', 'cancelling'].includes(status)) return null;

  const progress = state?.progress || {};
  const parts = [];
  if (cleanText(progress.progressBar)) parts.push(cleanText(progress.progressBar));
  if (
    Number.isFinite(Number(progress.processedGames))
    && Number.isFinite(Number(progress.totalGames))
    && Number(progress.totalGames) > 0
  ) {
    parts.push(`Games ${Number(progress.processedGames)}/${Number(progress.totalGames)}`);
  }
  if (
    Number.isFinite(Number(progress.processedOpponents))
    && Number.isFinite(Number(progress.totalOpponents))
    && Number(progress.totalOpponents) > 0
  ) {
    parts.push(`Opponents ${Number(progress.processedOpponents)}/${Number(progress.totalOpponents)}`);
  }
  if (cleanText(progress.currentStep)) parts.push(truncateBenchMarkStatusText(progress.currentStep, 90));
  return parts.length ? parts.join(' • ') : null;
}

function buildBenchMarkWarmupNotice(state = {}) {
  const statusText = formatBenchMarkWarmupStatusText(state);
  const detailText = formatBenchMarkWarmupDetailText(state);
  return ['Professor Aegis startup warm-up is still running.', statusText, detailText].filter(Boolean).join(' • ');
}

function isBenchMarkStartupReadinessGateActive(readiness = {}) {
  const status = String(readiness?.status || '').toLowerCase();
  const warmCache = readiness?.startupWarmCache || {};
  return Boolean(
    readiness?.warmupActive
    || status === 'warming'
    || (warmCache?.enabled && !warmCache?.ready && !['disabled', 'skipped', 'failed'].includes(String(warmCache?.status || '').toLowerCase()))
  );
}

function formatBenchMarkStartupReadinessNotice(readiness = {}) {
  const warmCache = readiness?.startupWarmCache || {};
  const statusText = cleanText(readiness?.statusText || warmCache?.statusText || 'BenchMark startup warm cache is still preparing.');
  const detailText = cleanText(readiness?.detailText || warmCache?.detailText || 'Matchup reports will unlock automatically when warm cache is ready.');
  const elapsedMs = Number(warmCache?.elapsedMs || 0);
  const elapsedText = elapsedMs > 0 ? `Elapsed ${Math.round(elapsedMs / 1000)}s` : null;
  return ['Professor Aegis is finishing startup readiness.', statusText, detailText, elapsedText].filter(Boolean).join(' • ');
}

async function waitForBenchMarkWarmupJob(jobId, timeoutMs = BENCHMARK_STARTUP_WARMUP_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await getBenchmarkJobStatus(jobId, { includeReport: false });
    await setBenchMarkWarmupState({
      active: ['queued', 'running', 'cancelling', 'submitting'].includes(String(status?.status || '').toLowerCase()),
      status: status?.status || 'idle',
      job_id: status?.jobId || jobId,
      started_at: status?.startedAt || null,
      completed_at: status?.completedAt || null,
      error: status?.error || null,
      progress: status?.progress || null,
    });

    const normalizedStatus = String(status?.status || '').toLowerCase();
    if (['completed', 'failed', 'cancelled'].includes(normalizedStatus)) {
      await setBenchMarkWarmupState({
        active: false,
        status: normalizedStatus,
        job_id: status?.jobId || jobId,
        started_at: status?.startedAt || null,
        completed_at: status?.completedAt || new Date().toISOString(),
        error: status?.error || null,
        progress: status?.progress || null,
      });
      return status;
    }

    await sleep(2500);
  }

  await setBenchMarkWarmupState({
    active: false,
    status: 'failed',
    completed_at: new Date().toISOString(),
    error: 'BenchMark startup warm-up timed out before completion.',
  });
  throw new Error('BenchMark startup warm-up timed out before completion.');
}

async function runBenchMarkStartupWarmup() {
  if (!BENCHMARK_STARTUP_WARMUP_ENABLED) {
    await setBenchMarkWarmupState({ active: false, status: 'idle', progress: null, error: null, job_id: null });
    console.log('[BenchMark Warmup] Startup warm-up disabled.');
    return;
  }

  try {
    await setBenchMarkWarmupState({
      active: true,
      status: 'submitting',
      job_id: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null,
      progress: {
        phase: 'submitting',
        percent: 0,
        progressBar: '[--------------------] 0%',
        currentStep: 'Preparing startup warm-up benchmark suite',
        processedGames: 0,
        totalGames: 1,
        processedOpponents: 0,
        totalOpponents: 1,
      },
    });

    if (Number.isFinite(BENCHMARK_STARTUP_WARMUP_DELAY_MS) && BENCHMARK_STARTUP_WARMUP_DELAY_MS > 0) {
      await sleep(BENCHMARK_STARTUP_WARMUP_DELAY_MS);
    }

    console.log('[BenchMark Warmup] Starting hidden featured-only warm-up suite...');
    const queued = await submitBenchmarkSuiteJob({
      userId: BENCHMARK_STARTUP_WARMUP_USER_ID,
      teamExport: BENCHMARK_STARTUP_WARMUP_TEAM_EXPORT,
      teamHash: buildBenchMarkSuiteTeamHash(BENCHMARK_STARTUP_WARMUP_TEAM_EXPORT),
      mode: 'featured-only',
      sampleSize: 1,
      gamesPerOpponent: 1,
      formatId: 'gen9benchmarkdoublesag',
      submitTimeoutMs: BENCHMARK_STARTUP_WARMUP_TIMEOUT_MS,
    });

    if (!queued?.jobId) {
      throw new Error('Worker did not return a startup warm-up job id.');
    }

    await setBenchMarkWarmupState({
      active: true,
      status: queued.status || 'queued',
      job_id: queued.jobId,
      started_at: queued.startedAt || null,
      completed_at: null,
      error: null,
      progress: queued.progress || {
        phase: 'queued',
        percent: 0,
        progressBar: '[--------------------] 0%',
        currentStep: 'Queued hidden startup warm-up benchmark suite',
        processedGames: 0,
        totalGames: 1,
        processedOpponents: 0,
        totalOpponents: 1,
      },
    });

    console.log(`[BenchMark Warmup] Queued hidden warm-up job ${queued.jobId}. Waiting for completion...`);
    const finalStatus = await waitForBenchMarkWarmupJob(queued.jobId, BENCHMARK_STARTUP_WARMUP_TIMEOUT_MS);
    if (String(finalStatus?.status || '').toLowerCase() === 'completed') {
      console.log('[BenchMark Warmup] Hidden warm-up suite completed successfully.');
      return;
    }
    console.log(`[BenchMark Warmup] Hidden warm-up suite finished with status: ${finalStatus?.status || 'unknown'}.`);
    if (finalStatus?.error) console.log(`[BenchMark Warmup] Detail: ${finalStatus.error}`);
  } catch (error) {
    await setBenchMarkWarmupState({
      active: false,
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: error?.message || 'BenchMark startup warm-up failed.',
    });
    console.error('[BenchMark Warmup] Hidden startup warm-up failed:', error?.message || error);
  }
}


async function getBenchMarkTeamState(userId) {
  return getBenchmarkTeamState(userId);
}

async function setBenchMarkTeamState(userId, teamExport) {
  const saved = await setBenchmarkTeamState(userId, teamExport);
  clearBenchMarkMenuCaches(userId);
  return saved;
}

async function getBenchMarkJobState(userId) {
  return getBenchmarkLatestJobState(userId, 'weakness-report');
}

async function setBenchMarkJobState(userId, jobState = {}) {
  const saved = await upsertBenchmarkJobState({
    userId,
    jobType: 'weakness-report',
    workerJobId: Object.prototype.hasOwnProperty.call(jobState || {}, 'job_id')
      ? jobState.job_id
      : undefined,
    status: Object.prototype.hasOwnProperty.call(jobState || {}, 'status')
      ? jobState.status
      : undefined,
    submittedAt: Object.prototype.hasOwnProperty.call(jobState || {}, 'submitted_at')
      ? jobState.submitted_at
      : undefined,
    startedAt: Object.prototype.hasOwnProperty.call(jobState || {}, 'started_at')
      ? jobState.started_at
      : undefined,
    completedAt: Object.prototype.hasOwnProperty.call(jobState || {}, 'completed_at')
      ? jobState.completed_at
      : undefined,
    error: Object.prototype.hasOwnProperty.call(jobState || {}, 'error')
      ? jobState.error
      : undefined,
    progress: Object.prototype.hasOwnProperty.call(jobState || {}, 'progress')
      ? jobState.progress
      : undefined,
    request: Object.prototype.hasOwnProperty.call(jobState || {}, 'request')
      ? jobState.request
      : undefined,
    formatId: Object.prototype.hasOwnProperty.call(jobState || {}, 'format_id')
      ? jobState.format_id
      : undefined,
    benchmarkMode: Object.prototype.hasOwnProperty.call(jobState || {}, 'benchmark_mode')
      ? jobState.benchmark_mode
      : undefined,
    selectionSummary: Object.prototype.hasOwnProperty.call(jobState || {}, 'selection_summary')
      ? jobState.selection_summary
      : undefined,
    report: Object.prototype.hasOwnProperty.call(jobState || {}, 'report')
      ? jobState.report
      : undefined,
  });
  clearBenchMarkMenuCaches(userId);
  return saved;
}

async function getBenchMarkLastReport(userId) {
  return getBenchmarkLatestReport(userId, 'weakness-report');
}

async function getBenchMarkLastReportMeta(userId) {
  return getBenchmarkLatestReportMeta(userId, 'weakness-report');
}

async function setBenchMarkLastReport(userId, report) {
  const jobState = await getBenchMarkJobState(userId);
  const saved = await saveBenchmarkLatestReport(
    userId,
    'weakness-report',
    report,
    jobState?.job_id || null,
  );
  clearBenchMarkMenuCaches(userId);
  return saved;
}

async function getBenchMarkMatchupJobState(userId) {
  return getBenchmarkLatestJobState(userId, 'matchup-eval');
}

async function setBenchMarkMatchupJobState(userId, jobState = {}) {
  const saved = await upsertBenchmarkJobState({
    userId,
    jobType: 'matchup-eval',
    workerJobId: Object.prototype.hasOwnProperty.call(jobState || {}, 'job_id')
      ? jobState.job_id
      : undefined,
    status: Object.prototype.hasOwnProperty.call(jobState || {}, 'status')
      ? jobState.status
      : undefined,
    submittedAt: Object.prototype.hasOwnProperty.call(jobState || {}, 'submitted_at')
      ? jobState.submitted_at
      : undefined,
    startedAt: Object.prototype.hasOwnProperty.call(jobState || {}, 'started_at')
      ? jobState.started_at
      : undefined,
    completedAt: Object.prototype.hasOwnProperty.call(jobState || {}, 'completed_at')
      ? jobState.completed_at
      : undefined,
    error: Object.prototype.hasOwnProperty.call(jobState || {}, 'error')
      ? jobState.error
      : undefined,
    progress: Object.prototype.hasOwnProperty.call(jobState || {}, 'progress')
      ? jobState.progress
      : undefined,
    request: Object.prototype.hasOwnProperty.call(jobState || {}, 'request')
      ? jobState.request
      : undefined,
    formatId: Object.prototype.hasOwnProperty.call(jobState || {}, 'format_id')
      ? jobState.format_id
      : undefined,
    benchmarkMode: Object.prototype.hasOwnProperty.call(jobState || {}, 'benchmark_mode')
      ? jobState.benchmark_mode
      : undefined,
    selectionSummary: Object.prototype.hasOwnProperty.call(jobState || {}, 'selection_summary')
      ? jobState.selection_summary
      : undefined,
    report: Object.prototype.hasOwnProperty.call(jobState || {}, 'report')
      ? jobState.report
      : undefined,
  });
  clearBenchMarkMenuCaches(userId);
  return saved;
}

async function getBenchMarkLastMatchupEval(userId) {
  return getBenchmarkLatestReport(userId, 'matchup-eval');
}

async function getBenchMarkLastMatchupEvalMeta(userId) {
  return getBenchmarkLatestReportMeta(userId, 'matchup-eval');
}

async function setBenchMarkLastMatchupEval(userId, report) {
  const jobState = await getBenchMarkMatchupJobState(userId);
  const saved = await saveBenchmarkLatestReport(
    userId,
    'matchup-eval',
    report,
    jobState?.job_id || null,
  );
  clearBenchMarkMenuCaches(userId);
  return saved;
}

async function resolveBenchMarkSuiteReportContext(userId, benchmarkStateOrTeamExport = null) {
  const teamExport = typeof benchmarkStateOrTeamExport === 'string'
    ? benchmarkStateOrTeamExport
    : (benchmarkStateOrTeamExport && Object.prototype.hasOwnProperty.call(benchmarkStateOrTeamExport, 'team_export'))
      ? benchmarkStateOrTeamExport.team_export
      : (await getBenchMarkTeamState(userId))?.team_export;
  const teamHash = buildBenchMarkSuiteTeamHash(teamExport);
  return {
    teamHash,
    reportType: buildBenchMarkSuiteReportType(teamHash),
  };
}

async function getBenchMarkSuiteLatestFallback(userId, teamHash, reportType) {
  const scoped = await getBenchmarkLatestReport(userId, reportType);
  if (scoped) return scoped;
  if (!teamHash && reportType !== 'run-benchmark-suite') {
    return getBenchmarkLatestReport(userId, 'run-benchmark-suite');
  }
  return null;
}

async function getBenchMarkSuiteLatestMetaFallback(userId, teamHash, reportType) {
  const scoped = await getBenchmarkLatestReportMeta(userId, reportType);
  if (scoped) return scoped;
  if (!teamHash && reportType !== 'run-benchmark-suite') {
    return getBenchmarkLatestReportMeta(userId, 'run-benchmark-suite');
  }
  return null;
}

function getBenchMarkSuiteReportCacheTtlMs() {
  return Number.isFinite(BENCHMARK_SUITE_REPORT_CACHE_TTL_MS) && BENCHMARK_SUITE_REPORT_CACHE_TTL_MS > 0
    ? BENCHMARK_SUITE_REPORT_CACHE_TTL_MS
    : 60000;
}

function buildBenchMarkSuiteReportCacheKey(userId, teamHash, reportType) {
  return `${String(userId || '')}:${cleanText(teamHash) || 'unscoped'}:${cleanText(reportType) || 'run-benchmark-suite'}`;
}

function getCachedBenchMarkSuiteReport(cacheKey) {
  const entry = benchmarkSuiteReportCache.get(String(cacheKey || ''));
  if (!entry) return null;
  if ((Date.now() - Number(entry.createdAt || 0)) > getBenchMarkSuiteReportCacheTtlMs()) {
    benchmarkSuiteReportCache.delete(String(cacheKey || ''));
    return null;
  }
  return entry.reportState || null;
}

function setCachedBenchMarkSuiteReport(cacheKey, reportState) {
  if (!cacheKey || !reportState) return reportState || null;
  benchmarkSuiteReportCache.set(String(cacheKey), {
    createdAt: Date.now(),
    reportState,
  });
  return reportState;
}

async function getBenchMarkSuiteJobState(userId) {
  return getBenchmarkLatestJobState(userId, 'run-benchmark-suite');
}

async function setBenchMarkSuiteJobState(userId, jobState = {}) {
  const saved = await upsertBenchmarkJobState({
    userId,
    jobType: 'run-benchmark-suite',
    workerJobId: Object.prototype.hasOwnProperty.call(jobState || {}, 'job_id')
      ? jobState.job_id
      : undefined,
    status: Object.prototype.hasOwnProperty.call(jobState || {}, 'status')
      ? jobState.status
      : undefined,
    submittedAt: Object.prototype.hasOwnProperty.call(jobState || {}, 'submitted_at')
      ? jobState.submitted_at
      : undefined,
    startedAt: Object.prototype.hasOwnProperty.call(jobState || {}, 'started_at')
      ? jobState.started_at
      : undefined,
    completedAt: Object.prototype.hasOwnProperty.call(jobState || {}, 'completed_at')
      ? jobState.completed_at
      : undefined,
    error: Object.prototype.hasOwnProperty.call(jobState || {}, 'error')
      ? jobState.error
      : undefined,
    progress: Object.prototype.hasOwnProperty.call(jobState || {}, 'progress')
      ? jobState.progress
      : undefined,
    request: Object.prototype.hasOwnProperty.call(jobState || {}, 'request')
      ? jobState.request
      : undefined,
    formatId: Object.prototype.hasOwnProperty.call(jobState || {}, 'format_id')
      ? jobState.format_id
      : undefined,
    benchmarkMode: Object.prototype.hasOwnProperty.call(jobState || {}, 'benchmark_mode')
      ? jobState.benchmark_mode
      : undefined,
    selectionSummary: Object.prototype.hasOwnProperty.call(jobState || {}, 'selection_summary')
      ? jobState.selection_summary
      : undefined,
    report: Object.prototype.hasOwnProperty.call(jobState || {}, 'report')
      ? jobState.report
      : undefined,
  });
  clearBenchMarkMenuCaches(userId);
  return saved;
}

async function getBenchMarkLastSuiteReport(userId, benchmarkStateOrTeamExport = null) {
  const startedAt = Date.now();
  const { teamHash, reportType } = await resolveBenchMarkSuiteReportContext(userId, benchmarkStateOrTeamExport);
  const cacheKey = buildBenchMarkSuiteReportCacheKey(userId, teamHash, reportType);
  const cached = getCachedBenchMarkSuiteReport(cacheKey);
  if (cached) {
    logMenuTiming('getBenchMarkLastSuiteReport cached', startedAt);
    return cached;
  }
  const reportState = await getBenchMarkSuiteLatestFallback(userId, teamHash, reportType);
  const cachedReportState = setCachedBenchMarkSuiteReport(cacheKey, reportState);
  logMenuTiming('getBenchMarkLastSuiteReport', startedAt);
  return cachedReportState;
}

async function getBenchMarkLastSuiteReportMeta(userId, benchmarkStateOrTeamExport = null) {
  const { teamHash, reportType } = await resolveBenchMarkSuiteReportContext(userId, benchmarkStateOrTeamExport);
  return getBenchMarkSuiteLatestMetaFallback(userId, teamHash, reportType);
}

function getBenchMarkSuiteHistoryTeamHashFromRow(row = {}) {
  const request = row && typeof row === 'object' ? row.request || {} : {};
  const report = row && typeof row === 'object' ? row.report || {} : {};
  return cleanText(
    request?.teamHash
      || request?.team_hash
      || report?.teamHash
      || report?.team_hash
      || null,
  );
}

function buildBenchMarkSuiteProfileRunSummary(report = {}, row = {}) {
  const safeReport = report && typeof report === 'object' ? report : {};
  const summary = safeReport.compactSummary && typeof safeReport.compactSummary === 'object'
    ? safeReport.compactSummary
    : {};
  const generatedAt = cleanText(
    safeReport.generatedAt
      || safeReport.generated_at
      || row.completed_at
      || row.updated_at
      || null,
  );
  const reportId = cleanText(
    safeReport?.savedReport?.reportId
      || safeReport.reportId
      || safeReport.report_id
      || row.report_id
      || null,
  );
  const jobId = cleanText(
    safeReport?.savedReport?.workerJobId
      || safeReport?.savedReport?.worker_job_id
      || safeReport.jobId
      || safeReport.job_id
      || row.job_id
      || row.worker_job_id
      || null,
  );
  return {
    reportId,
    jobId,
    generatedAt,
    wins: Number(safeReport.wins ?? summary.wins ?? 0),
    losses: Number(safeReport.losses ?? summary.losses ?? 0),
    ties: Number(safeReport.ties ?? summary.ties ?? 0),
    totalGamesCompleted: Number(safeReport.totalGamesCompleted ?? summary.totalGamesCompleted ?? 0),
    totalTurns: Number(safeReport.totalTurns ?? summary.totalTurns ?? 0),
    averageTurns: Number(safeReport.averageTurns ?? summary.averageTurns ?? 0),
    winRate: Number(safeReport.winRate ?? summary.winRate ?? 0),
  };
}

function getBenchMarkSuiteProfileRunKey(run = {}) {
  return cleanText(run.reportId || run.jobId || run.generatedAt || null);
}

function buildBenchMarkSuiteProfileAggregateFromReport(report = {}) {
  const safeReport = report && typeof report === 'object' ? report : {};
  const retention = safeReport.profileRetention && typeof safeReport.profileRetention === 'object'
    ? safeReport.profileRetention
    : {};
  const aggregate = retention.aggregate && typeof retention.aggregate === 'object'
    ? retention.aggregate
    : null;
  if (aggregate) {
    return {
      completedRuns: Number(aggregate.completedRuns || 0),
      totalGamesCompleted: Number(aggregate.totalGamesCompleted || 0),
      wins: Number(aggregate.wins || 0),
      losses: Number(aggregate.losses || 0),
      ties: Number(aggregate.ties || 0),
      totalTurns: Number(aggregate.totalTurns || 0),
    };
  }

  const run = buildBenchMarkSuiteProfileRunSummary(safeReport);
  return {
    completedRuns: run.totalGamesCompleted > 0 ? 1 : 0,
    totalGamesCompleted: run.totalGamesCompleted,
    wins: run.wins,
    losses: run.losses,
    ties: run.ties,
    totalTurns: run.totalTurns,
  };
}

function finalizeBenchMarkSuiteProfileAggregate(aggregate = {}) {
  const totalGamesCompleted = Number(aggregate.totalGamesCompleted || 0);
  const wins = Number(aggregate.wins || 0);
  const totalTurns = Number(aggregate.totalTurns || 0);
  return {
    completedRuns: Number(aggregate.completedRuns || 0),
    totalGamesCompleted,
    wins,
    losses: Number(aggregate.losses || 0),
    ties: Number(aggregate.ties || 0),
    totalTurns,
    winRate: totalGamesCompleted > 0 ? Math.round((wins / totalGamesCompleted) * 1000) / 10 : 0,
    averageTurns: totalGamesCompleted > 0 ? Math.round((totalTurns / totalGamesCompleted) * 10) / 10 : 0,
  };
}

function sortBenchMarkSuiteProfileRuns(runs = []) {
  return [...runs].sort((a, b) => {
    const dateDiff = getBenchMarkHistoryDateMs(b.generatedAt) - getBenchMarkHistoryDateMs(a.generatedAt);
    if (dateDiff) return dateDiff;
    return String(getBenchMarkSuiteProfileRunKey(b)).localeCompare(String(getBenchMarkSuiteProfileRunKey(a)), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

function capBenchMarkSuiteProfileRecentRuns(runs = []) {
  const capped = [];
  let battles = 0;
  for (const run of sortBenchMarkSuiteProfileRuns(runs)) {
    const games = Math.max(0, Number(run.totalGamesCompleted || 0));
    if (capped.length >= BENCHMARK_PROFILE_RECENT_RUN_LIMIT) break;
    if (battles > 0 && games > 0 && battles + games > BENCHMARK_PROFILE_BATTLE_LIMIT) break;
    capped.push(run);
    battles += games;
  }
  return capped;
}

function mergeBenchMarkSuiteProfileRetention(previousReport = null, nextReport = {}, teamHash = null) {
  const safeNext = nextReport && typeof nextReport === 'object' ? nextReport : {};
  const previous = previousReport && typeof previousReport === 'object' ? previousReport : null;
  const currentRun = buildBenchMarkSuiteProfileRunSummary(safeNext);
  const currentRunKey = getBenchMarkSuiteProfileRunKey(currentRun);
  const previousRetention = previous?.profileRetention && typeof previous.profileRetention === 'object'
    ? previous.profileRetention
    : {};
  const previousRuns = Array.isArray(previousRetention.recentRuns)
    ? previousRetention.recentRuns.filter((run) => run && typeof run === 'object')
    : [];
  const alreadyCounted = currentRunKey && previousRuns.some((run) => getBenchMarkSuiteProfileRunKey(run) === currentRunKey);
  const aggregateBase = buildBenchMarkSuiteProfileAggregateFromReport(previous);
  const aggregate = alreadyCounted
    ? aggregateBase
    : {
      completedRuns: Number(aggregateBase.completedRuns || 0) + (currentRun.totalGamesCompleted > 0 ? 1 : 0),
      totalGamesCompleted: Number(aggregateBase.totalGamesCompleted || 0) + Number(currentRun.totalGamesCompleted || 0),
      wins: Number(aggregateBase.wins || 0) + Number(currentRun.wins || 0),
      losses: Number(aggregateBase.losses || 0) + Number(currentRun.losses || 0),
      ties: Number(aggregateBase.ties || 0) + Number(currentRun.ties || 0),
      totalTurns: Number(aggregateBase.totalTurns || 0) + Number(currentRun.totalTurns || 0),
    };
  const mergedRuns = alreadyCounted
    ? previousRuns
    : [currentRun, ...previousRuns];
  const recentRuns = capBenchMarkSuiteProfileRecentRuns(mergedRuns);
  const finalizedAggregate = finalizeBenchMarkSuiteProfileAggregate(aggregate);
  const compactSummary = safeNext.compactSummary && typeof safeNext.compactSummary === 'object'
    ? {
      ...safeNext.compactSummary,
      wins: finalizedAggregate.wins,
      losses: finalizedAggregate.losses,
      ties: finalizedAggregate.ties,
      winRate: finalizedAggregate.winRate,
      averageTurns: finalizedAggregate.averageTurns,
      totalGamesCompleted: finalizedAggregate.totalGamesCompleted,
      totalTurns: finalizedAggregate.totalTurns,
      profileCompletedRuns: finalizedAggregate.completedRuns,
      profileRecentRunsStored: recentRuns.length,
    }
    : safeNext.compactSummary;

  return {
    ...safeNext,
    compactSummary,
    wins: finalizedAggregate.wins,
    losses: finalizedAggregate.losses,
    ties: finalizedAggregate.ties,
    winRate: finalizedAggregate.winRate,
    averageTurns: finalizedAggregate.averageTurns,
    totalGamesCompleted: finalizedAggregate.totalGamesCompleted,
    totalTurns: finalizedAggregate.totalTurns,
    teamHash: cleanText(safeNext.teamHash || teamHash),
    profileRetention: {
      teamHash: cleanText(safeNext.teamHash || teamHash),
      maxRecentRuns: BENCHMARK_PROFILE_RECENT_RUN_LIMIT,
      maxBattlesCounted: BENCHMARK_PROFILE_BATTLE_LIMIT,
      aggregate: finalizedAggregate,
      recentRuns,
      recentRunsStored: recentRuns.length,
      rolledIntoAggregate: Math.max(0, Number(finalizedAggregate.completedRuns || 0) - recentRuns.length),
      updatedAt: new Date().toISOString(),
    },
  };
}

function sanitizeBenchMarkSuiteHistoryReport(row = {}) {
  const report = row?.report && typeof row.report === 'object' ? row.report : null;
  if (!report) return row;
  const sanitizedReport = { ...report };
  if (sanitizedReport.matchArchive && typeof sanitizedReport.matchArchive === 'object') {
    sanitizedReport.matchArchive = {
      ready: false,
      historyProfileOnly: true,
      sourceCount: 0,
      renderedCount: 0,
      files: [],
      sources: [],
    };
  }
  if (sanitizedReport.leadPairSweep && typeof sanitizedReport.leadPairSweep === 'object') {
    sanitizedReport.leadPairSweep = {
      ...sanitizedReport.leadPairSweep,
      results: Array.isArray(sanitizedReport.leadPairSweep.results)
        ? sanitizedReport.leadPairSweep.results.map((result) => {
          if (!result || typeof result !== 'object') return result;
          const { replayRefs, replayArtifacts, ...summaryOnly } = result;
          return summaryOnly;
        })
        : sanitizedReport.leadPairSweep.results,
      replayArtifactsReady: false,
      replayArtifactsCount: 0,
      replayArtifactSource: null,
      historyProfileOnly: true,
    };
  }
  return {
    ...row,
    report: sanitizedReport,
  };
}

function stripBenchMarkLatestRunArchiveFromReport(report = {}) {
  if (!report || typeof report !== 'object') return report;
  const strippedReport = {
    ...report,
    matchArchive: {
      ready: false,
      latestRunOnly: true,
      archiveClearedOnLoad: true,
      sourceCount: 0,
      renderedCount: 0,
      files: [],
      sources: [],
    },
  };

  if (strippedReport.leadPairSweep && typeof strippedReport.leadPairSweep === 'object') {
    strippedReport.leadPairSweep = {
      ...strippedReport.leadPairSweep,
      results: Array.isArray(strippedReport.leadPairSweep.results)
        ? strippedReport.leadPairSweep.results.map((result) => {
          if (!result || typeof result !== 'object') return result;
          const { replayRefs, replayArtifacts, ...summaryOnly } = result;
          return summaryOnly;
        })
        : strippedReport.leadPairSweep.results,
      replayArtifactsReady: false,
      replayArtifactsCount: 0,
      replayArtifactSource: null,
      archiveClearedOnLoad: true,
    };
  }

  return strippedReport;
}

async function clearBenchMarkLoadedTeamRuntimeState(userId, teamExport) {
  const latestSuiteReportState = await getBenchMarkLastSuiteReport(userId, teamExport);
  const preservedPaperReport = latestSuiteReportState?.report
    ? stripBenchMarkLatestRunArchiveFromReport(latestSuiteReportState.report)
    : null;
  const { reportType } = await resolveBenchMarkSuiteReportContext(userId, teamExport);

  await clearBenchMarkAnalysisState(userId);

  if (preservedPaperReport) {
    await saveBenchmarkLatestReport(
      userId,
      reportType,
      preservedPaperReport,
      null,
    );
  }
}

async function setBenchMarkLastSuiteReport(userId, report, benchmarkStateOrTeamExport = null) {
  const jobState = await getBenchMarkSuiteJobState(userId);
  const { teamHash, reportType } = await resolveBenchMarkSuiteReportContext(
    userId,
    benchmarkStateOrTeamExport || jobState?.request,
  );
  const previousReportState = report
    ? await getBenchmarkLatestReport(userId, reportType)
    : null;
  const previousReport = previousReportState?.report && typeof previousReportState.report === 'object'
    ? previousReportState.report
    : null;

  const reportToSave = report
    ? mergeBenchMarkSuiteProfileRetention(previousReport, {
      ...report,
      teamHash: cleanText(report.teamHash || teamHash),
    }, teamHash)
    : null;
  if (report) {
    const validation = validateBenchmarkSuitePromotion(report);
    if (!validation.ok) {
      clearBenchMarkMenuCaches(userId);
      return {
        report: null,
        discarded: true,
        validationErrors: validation.errors,
        job_id: jobState?.job_id || null,
      };
    }
  }
  const saved = await saveBenchmarkLatestReport(
    userId,
    reportType,
    reportToSave,
    jobState?.job_id || null,
  );
  clearBenchMarkMenuCaches(userId);
  return saved;
}

function buildBenchMarkStableReportId({ userId, reportState = null, report = null, jobState = null } = {}) {
  const safeUserId = cleanText(userId);
  const workerJobId = cleanText(
    reportState?.job_id
    || reportState?.worker_job_id
    || reportState?.workerJobId
    || jobState?.job_id
    || jobState?.worker_job_id
    || jobState?.workerJobId
    || report?.workerJobId
    || report?.worker_job_id
    || report?.jobId
    || report?.job_id
    || report?.savedReport?.workerJobId
    || report?.savedReport?.worker_job_id,
  );
  if (!safeUserId || !workerJobId) return workerJobId;

  const generatedAt = cleanText(
    report?.generatedAt
    || report?.savedReport?.generatedAt
    || reportState?.updated_at
    || reportState?.updatedAt
    || jobState?.completed_at
    || jobState?.completedAt
    || jobState?.updated_at
    || jobState?.updatedAt,
  );
  if (!generatedAt) return workerJobId;

  const hash = crypto
    .createHash('sha256')
    .update([safeUserId, 'run-benchmark-suite', workerJobId, generatedAt].map(cleanText).join('|'), 'utf8')
    .digest('hex');
  return `report_${hash.slice(0, 24)}`;
}

function getBenchMarkSuiteReportId({ userId = null, reportState = null, report = null, jobState = null } = {}) {
  return cleanText(
    reportState?.report_id
    || reportState?.reportId
    || report?.savedReport?.reportId
    || report?.reportId
    || report?.report_id
    || jobState?.report_id
    || jobState?.reportId
    || jobState?.report?.savedReport?.reportId
    || jobState?.report?.reportId
    || jobState?.report?.report_id
    || buildBenchMarkStableReportId({ userId, reportState, report, jobState }),
  );
}

function buildBenchMarkSuiteViewComponents(sharedRowProps = {}) {
  return [buildBenchMarkSuiteReportTabRow({
    ownerId: sharedRowProps.ownerId,
    selectedReportTab: sharedRowProps.selectedReportTab,
    hasPaperReportReady: sharedRowProps.hasPaperReportReady,
    hasMatchArchiveReady: sharedRowProps.hasMatchArchiveReady,
  })];
}
async function listBenchMarkJobHistory(userId, jobType = null, limit = 10, options = {}) {
  return listBenchmarkJobHistoryForUser(userId, jobType, limit, options);
}

async function clearBenchMarkAnalysisState(userId) {
  await setBenchMarkJobState(userId, {
    job_id: null,
    status: 'idle',
    submitted_at: null,
    started_at: null,
    completed_at: null,
    error: null,
    progress: null,
    request: null,
    format_id: null,
    benchmark_mode: null,
    selection_summary: null,
  });
  await setBenchMarkLastReport(userId, null);
  await setBenchMarkMatchupJobState(userId, {
    job_id: null,
    status: 'idle',
    submitted_at: null,
    started_at: null,
    completed_at: null,
    error: null,
    progress: null,
    request: null,
    format_id: null,
    benchmark_mode: null,
    selection_summary: null,
  });
  await setBenchMarkLastMatchupEval(userId, null);
  await setBenchMarkSuiteJobState(userId, {
    job_id: null,
    status: 'idle',
    submitted_at: null,
    started_at: null,
    completed_at: null,
    error: null,
    progress: null,
    request: null,
    format_id: null,
    benchmark_mode: null,
    selection_summary: null,
  });
  await setBenchMarkLastSuiteReport(userId, null);
}

function truncateBenchMarkStatusText(value, maxLength = 120) {
  const text = cleanText(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}


function isBenchMarkTechnicalNotice(notice) {
  const text = cleanText(notice).toLowerCase();
  if (!text) return false;
  return (
    text.includes('benchmark worker')
    || text.includes('worker request')
    || text.includes('request timed out')
    || text.includes('payload')
    || text.includes('statuscode')
    || text.includes('status code')
    || text.includes('broken pipe')
    || text.includes('traceback')
    || text.includes('errno')
    || text.includes('debug')
    || text.includes('/jobs/')
    || text.includes('/ready')
  );
}

function shouldShowBenchMarkFooterNotice() {
  return false;
}

function buildBenchMarkInlineNotice(notice) {
  const text = cleanText(notice);
  if (!text || isBenchMarkTechnicalNotice(text)) return null;
  return text;
}

function isBenchMarkSafeModeProgress(progress = {}) {
  if (progress.safeModeActive === true) return true;
  const cpuState = String(progress.cpuState || '').toLowerCase();
  return [
    'safe-mode',
    'medium',
    'high',
    'critical',
    'cpu-cooldown',
    'ramp-hold',
    'dist-auto-heal',
  ].includes(cpuState);
}

function getFiniteBenchMarkNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getBenchMarkProgressMetrics(jobState = {}, progress = {}) {
  const progressMetrics = progress?.metrics && typeof progress.metrics === 'object'
    ? progress.metrics
    : {};
  const jobMetrics = jobState?.metrics && typeof jobState.metrics === 'object'
    ? jobState.metrics
    : {};
  return Object.keys(progressMetrics).length ? progressMetrics : jobMetrics;
}

function formatBenchMarkSimWorkerLine(jobState = {}, progress = {}) {
  const metrics = getBenchMarkProgressMetrics(jobState, progress);
  const throughput = metrics?.throughput && typeof metrics.throughput === 'object'
    ? metrics.throughput
    : {};
  const persistentWorker = throughput?.persistentWorker && typeof throughput.persistentWorker === 'object'
    ? throughput.persistentWorker
    : {};
  const persistentLastBattle = throughput?.persistentWorkerPoolLastBattle && typeof throughput.persistentWorkerPoolLastBattle === 'object'
    ? throughput.persistentWorkerPoolLastBattle
    : {};

  const checkedOut = getFiniteBenchMarkNumber(
    progress.actualSimWorkersCheckedOut,
    progress.persistentCheckedOut,
    persistentWorker.actualSimWorkersCheckedOut,
    persistentWorker.checkedOut,
    persistentLastBattle.checkedOut,
  );
  const ready = getFiniteBenchMarkNumber(
    progress.actualSimWorkersReady,
    progress.persistentReady,
    persistentWorker.actualSimWorkersReady,
    persistentWorker.ready,
    persistentLastBattle.ready,
  );

  const parts = [];
  if (checkedOut !== null) parts.push(`${Math.max(0, Math.floor(checkedOut))} checked out`);
  if (ready !== null) parts.push(`${Math.max(0, Math.floor(ready))} ready`);
  return parts.length ? `Sim workers ${parts.join(' • ')}` : null;
}

function formatBenchMarkProgressState(progress = {}, slotState = {}) {
  const phase = String(progress.phase || '').toLowerCase();
  const step = cleanText(progress.currentStep).toLowerCase();
  const leadPairStatus = String(progress.leadPairSweepStatus || '').toLowerCase();
  const leadPairActive = phase === 'lead-pair-sweep'
    || (progress.leadPairSweep === true && leadPairStatus && leadPairStatus !== 'completed');

  if (leadPairActive) return 'Lead-pair sweep running';
  if (phase.includes('finalizing') || /finalizing|validating|validation|report/.test(step)) {
    return 'Finalizing report and validation';
  }
  if (progress.waitingForWorkers === true || Number(progress.queueSpot) > 0) {
    return 'Waiting for battle workers';
  }
  if (phase === 'queued') return 'Preparing main run';
  if (/^preparing\s/.test(step)) return null;

  const assignedSlots = getFiniteBenchMarkNumber(slotState.assignedSlots);
  const totalSlots = getFiniteBenchMarkNumber(slotState.totalSlots);
  const processedGames = getFiniteBenchMarkNumber(progress.processedGames, progress.completedGames) || 0;
  const percent = getFiniteBenchMarkNumber(progress.percent) || 0;
  const completedStep = /^completed\s/i.test(cleanText(progress.currentStep));
  if (
    assignedSlots !== null
    && totalSlots !== null
    && totalSlots > 0
    && assignedSlots > 0
    && assignedSlots < totalSlots
    && processedGames > 0
    && (completedStep || percent >= 15)
  ) {
    return 'Draining wave';
  }
  if ((assignedSlots !== null && assignedSlots > 0) || processedGames > 0) {
    return 'Main wave running';
  }
  return null;
}

function formatBenchMarkSuiteProgressDetail(jobState = {}) {
  const status = String(jobState?.status || 'idle').toLowerCase();
  if (!['queued', 'running', 'cancelling'].includes(status)) return null;

  const progress = jobState?.progress || {};
  const parts = [];
  const phaseState = formatBenchMarkProgressState(progress);

  if (phaseState === 'Finalizing report and validation') {
    return 'Main simulation complete • State: Finalizing report and validation';
  }

  if (cleanText(progress.progressBar)) {
    parts.push(cleanText(progress.progressBar));
  }

  const processedOpponents = Number(progress.processedOpponents);
  const totalOpponents = Number(progress.totalOpponents);
  if (
    Number.isFinite(processedOpponents)
    && Number.isFinite(totalOpponents)
    && totalOpponents > 0
  ) {
    parts.push(`Opponents ${processedOpponents}/${totalOpponents}`);
  }

  const completedBattles = Number(progress.processedGames ?? progress.completedGames);
  if (Number.isFinite(completedBattles) && completedBattles >= 0) {
    parts.push(`Battles ${completedBattles} completed`);
  }

  const recordWins = Number(progress.battleWins ?? progress.recordWins);
  const recordLosses = Number(progress.battleLosses ?? progress.recordLosses);
  const recordTies = Number(progress.battleTies ?? progress.recordTies);
  if (
    Number.isFinite(recordWins)
    && Number.isFinite(recordLosses)
    && Number.isFinite(recordTies)
  ) {
    parts.push(`Record ${recordWins}W - ${recordLosses}L - ${recordTies}T`);
  }

  const assignedWorkers = Number(progress.assignedWorkers);
  const totalWorkers = Number(progress.totalWorkers);
  const safetyWorkerCap = Number(progress.safetyWorkerCap);
  let displayAssignedWorkers = null;
  let displayTotalWorkers = null;
  if (Number.isFinite(assignedWorkers) && Number.isFinite(totalWorkers) && totalWorkers > 0) {
    displayAssignedWorkers = assignedWorkers;
    if (Number.isFinite(safetyWorkerCap) && safetyWorkerCap > 0) {
      displayAssignedWorkers = Math.min(displayAssignedWorkers, safetyWorkerCap);
    }
    displayAssignedWorkers = Math.max(0, Math.min(displayAssignedWorkers, totalWorkers));
    displayTotalWorkers = totalWorkers;
    parts.push(`Slots ${displayAssignedWorkers}/${displayTotalWorkers} active`);
    const simWorkerLine = formatBenchMarkSimWorkerLine(jobState, progress);
    if (simWorkerLine) parts.push(simWorkerLine);
  }

  const queueSpot = Number(progress.queueSpot);
  if (Number.isFinite(queueSpot) && queueSpot > 0) {
    parts.push(`Waiting for battle workers`);
    parts.push(`Queue Spot ${queueSpot}`);
  }

  if (isBenchMarkSafeModeProgress(progress)) {
    parts.push('Safe Mode Active');
  }

  const stateLine = formatBenchMarkProgressState(progress, {
    assignedSlots: displayAssignedWorkers,
    totalSlots: displayTotalWorkers,
  });
  if (stateLine) {
    parts.push(`State: ${stateLine}`);
  } else if (cleanText(progress.currentOpponent)) {
    parts.push(`Opponent ${truncateBenchMarkStatusText(progress.currentOpponent, 70)}`);
  } else if (cleanText(progress.currentStep)) {
    parts.push(truncateBenchMarkStatusText(progress.currentStep, 90));
  }

  return parts.length ? parts.join(' • ') : null;
}


function formatBenchMarkQueueStatus(jobState = {}) {
  const status = String(jobState?.status || 'idle').toLowerCase();
  const progress = jobState?.progress || {};
  const percent = Number.isFinite(Number(progress.percent)) ? ` • ${Number(progress.percent)}%` : '';

  if (status === 'queued') return `Queued ⏳${percent}`;
  if (status === 'running') return `Running 🧪${percent}`;
  if (status === 'completed') return 'Completed ✅';
  if (status === 'cancelling') return `Stopping 🛑${percent}`;
  if (status === 'cancelled') return 'Stopped 🛑';
  if (status === 'failed') return `Failed ❌${jobState?.error ? ` • ${truncateBenchMarkStatusText(jobState.error, 80)}` : ''}`;
  return 'Idle';
}

function buildBenchMarkSuiteNotice(status = {}) {
  const state = String(status?.status || '').toLowerCase();
  const progress = status?.progress || {};
  const percent = Number.isFinite(Number(progress.percent)) ? `${Number(progress.percent)}%` : null;
  const step = cleanText(progress.currentStep) ? truncateBenchMarkStatusText(progress.currentStep, 120) : null;

  if (state === 'queued') {
    return ['Matchup report queued.', percent, step].filter(Boolean).join(' • ');
  }
  if (state === 'running') {
    return ['Matchup report running.', percent, step].filter(Boolean).join(' • ');
  }
  if (state === 'completed') {
    return 'Matchup report completed. Last result is ready to view.';
  }
  if (state === 'cancelling') {
    return ['Stopping benchmark suite.', percent, games, step].filter(Boolean).join(' • ');
  }
  if (state === 'cancelled') {
    return 'Matchup report stopped.';
  }
  if (state === 'failed') {
    return status?.error || 'Matchup report request failed.';
  }
  return 'Matchup report status updated.';
}

function isBenchMarkWorkerTimeoutError(error) {
  const message = cleanText(error?.message || error || '').toLowerCase();
  return message.includes('timed out') || message.includes('timeout');
}

async function safelyEditBenchMarkReply(interaction, payload) {
  try {
    await interaction.editReply(payload);
    return true;
  } catch (error) {
    return false;
  }
}

async function persistBenchMarkSuiteStatus(userId, currentJobState = {}, status = {}) {
  const suiteReport = buildPromotableBenchMarkSuiteReport(status);

  return setBenchMarkSuiteJobState(userId, {
    job_id: status?.jobId || currentJobState?.job_id || null,
    status: status?.status || currentJobState?.status || 'queued',
    submitted_at: status?.submittedAt || currentJobState?.submitted_at || null,
    started_at: status?.startedAt || currentJobState?.started_at || null,
    completed_at: status?.completedAt || currentJobState?.completed_at || null,
    error: status?.error || null,
    progress: status?.progress || currentJobState?.progress || null,
    request: currentJobState?.request || null,
    format_id: status?.formatId || currentJobState?.format_id || null,
    benchmark_mode: status?.benchmarkMode || currentJobState?.benchmark_mode || null,
    selection_summary: status?.selectionSummary || currentJobState?.selection_summary || null,
    report: suiteReport?.report || undefined,
  });
}

function buildPromotableBenchMarkSuiteReport(status = {}) {
  if (status?.status !== 'completed' || !status?.report) {
    return null;
  }
  const validation = validateBenchmarkSuitePromotion(status.report);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      report: null,
    };
  }
  const report = {
    ...status.report,
    compactSummary: formatBenchmarkSuiteSummary(status.report),
  };
  return {
    ok: true,
    errors: [],
    report,
  };
}

function buildBenchMarkSuiteDiscardNotice(validation = {}) {
  const reasons = Array.isArray(validation?.errors) && validation.errors.length
    ? validation.errors.join(', ')
    : 'final validation did not pass';
  return `Simulation finished, but Professor Aegis discarded the staged report because final validation failed (${reasons}). Your previous completed Simulation Report was kept.`;
}

async function showCompletedBenchMarkSuite(interaction, report) {
  const benchmarkState = await getBenchMarkTeamState(interaction.user.id);
  const jobState = await getBenchMarkJobState(interaction.user.id);
  const matchupJobState = await getBenchMarkMatchupJobState(interaction.user.id);
  const suiteJobState = await getBenchMarkSuiteJobState(interaction.user.id);
  const warmupState = await getBenchMarkWarmupState();

  await safelyEditBenchMarkReply(interaction, {
    embeds: [
      buildBenchMarkSuiteEmbed({
        username: interaction.member?.displayName || interaction.user.username,
        report,
      }),
    ],
    components: buildBenchMarkSuiteViewComponents({
      ownerId: interaction.user.id,
      hasSubmittedTeam: Boolean(cleanText(benchmarkState?.team_export)),
      hasLastReport: Boolean((await getBenchMarkLastReport(interaction.user.id))?.report),
      hasActiveJob: ['queued', 'running'].includes(String(jobState?.status || '').toLowerCase()),
      hasLastMatchupEval: Boolean((await getBenchMarkLastMatchupEval(interaction.user.id))?.report),
      hasActiveMatchupJob: ['queued', 'running'].includes(String(matchupJobState?.status || '').toLowerCase()),
      hasLastSuiteReport: Boolean(report),
      hasActiveSuiteJob: ['queued', 'running'].includes(String(suiteJobState?.status || '').toLowerCase()),
      hasMatchArchiveReady: hasSavedMatchArchive(report),
      hasPaperReportReady: hasSavedPaperReport(report),
      showMatchArchiveButton: true,
      showPaperReportButton: true,
      benchmarkWarmupActive: isBenchMarkWarmupActive(warmupState),
      selectedReportTab: 'overview',
    }),
  });
}

async function buildBenchMarkSuiteLoadingRowProps(interaction, overrides = {}) {
  const benchmarkState = await getBenchMarkTeamState(interaction.user.id);
  const reportTeamPreviewLines = cleanText(benchmarkState?.team_export).split('\n').filter(Boolean);
  const reportTeamPreviewText = reportTeamPreviewLines.length
    ? `${reportTeamPreviewLines[0]?.slice(0, 80) || 'Team on file'}${reportTeamPreviewLines.length > 1 ? ` • ${reportTeamPreviewLines.length} lines saved` : ''}`
    : 'Team on file';

  return {
    ownerId: interaction.user.id,
    hasSubmittedTeam: Boolean(cleanText(benchmarkState?.team_export)),
    teamPreviewText: reportTeamPreviewText,
    ...overrides,
  };
}

async function openCompletedBenchMarkSuiteReport(interaction, {
  jobId,
  currentJobState = {},
  status = {},
  sharedRowProps = {},
} = {}) {
  const loadingRowProps = await buildBenchMarkSuiteLoadingRowProps(interaction, {
    ...sharedRowProps,
    hasLastSuiteReport: true,
    hasActiveSuiteJob: false,
    hasMatchArchiveReady: false,
  });

  await showLastMatchupReportLoadProgress(
    interaction,
    loadingRowProps,
    { percent: 84, step: 'Matchup report finished. Loading the completed results...' },
  );

  let completedStatus = status;
  if (!completedStatus?.report && jobId) {
    await showLastMatchupReportLoadProgress(
      interaction,
      loadingRowProps,
      { percent: 92, step: 'Fetching completed report data from the benchmark worker...' },
    );
    try {
      completedStatus = await getBenchmarkJobStatus(jobId, { includeReport: true });
    } catch (error) {
      await safelyEditBenchMarkReply(
        interaction,
        await buildBenchMarkPayload(
          interaction,
          'Simulation finished, but loading the completed report took longer than expected. Use Simulation Report to retry.',
        ),
      );
      return false;
    }
  }

  if (completedStatus?.status === 'completed' && completedStatus?.report) {
    const suiteReportValidation = buildPromotableBenchMarkSuiteReport(completedStatus);
    if (!suiteReportValidation?.ok) {
      await persistBenchMarkSuiteStatus(interaction.user.id, currentJobState, {
        ...completedStatus,
        report: null,
      });
      clearBenchMarkMenuPayloadCache(interaction.user.id);
      await safelyEditBenchMarkReply(
        interaction,
        await buildBenchMarkPayload(interaction, buildBenchMarkSuiteDiscardNotice(suiteReportValidation)),
      );
      return false;
    }
    const suiteReport = suiteReportValidation.report;
    await persistBenchMarkSuiteStatus(interaction.user.id, currentJobState, {
      ...completedStatus,
      report: suiteReport,
    });
    const savedReportState = await setBenchMarkLastSuiteReport(interaction.user.id, suiteReport);
    clearBenchMarkMenuPayloadCache(interaction.user.id);

    await showLastMatchupReportLoadProgress(
      interaction,
      loadingRowProps,
      { percent: 98, step: 'Rendering the completed matchup report...' },
    );
    await showCompletedBenchMarkSuite(interaction, suiteReport);
    return true;
  }

  await safelyEditBenchMarkReply(
    interaction,
    await buildBenchMarkPayload(
      interaction,
      'Simulation finished, but the completed report data is not ready yet. Use Simulation Report to retry.',
    ),
  );
  return false;
}

async function startBenchMarkSuitePoller(interaction, jobId) {
  const key = `${interaction.user.id}:${jobId}`;
  if (!jobId || benchmarkSuitePollers.has(key)) {
    return benchmarkSuitePollers.get(key) || null;
  }

  const runner = (async () => {
    let consecutiveRefreshFailures = 0;

    try {
      for (let attempt = 0; attempt < 180; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1500 : 4000));

        const currentJobState = await getBenchMarkSuiteJobState(interaction.user.id);
        if (String(currentJobState?.job_id || '') !== String(jobId || '')) {
          break;
        }

        let status = null;
        try {
          status = await getBenchmarkJobStatus(jobId, { includeReport: false });
          consecutiveRefreshFailures = 0;
        } catch (error) {
          consecutiveRefreshFailures += 1;
          await safelyEditBenchMarkReply(
            interaction,
            await buildBenchMarkPayload(
              interaction,
              consecutiveRefreshFailures >= 3
                ? 'Live suite refresh paused after repeated worker timeouts. Use Check Simulation to refresh manually.'
                : 'Live suite refresh is taking longer than expected. The suite may still be running in the background.',
            ),
          );
          if (consecutiveRefreshFailures >= 3) {
            break;
          }
          continue;
        }

        const persisted = await persistBenchMarkSuiteStatus(
          interaction.user.id,
          currentJobState,
          status,
        );
        clearBenchMarkMenuPayloadCache(interaction.user.id);

        if (status?.status === 'completed') {
          await openCompletedBenchMarkSuiteReport(interaction, {
            jobId,
            currentJobState,
            status,
          });
          break;
        }

        if (status?.status === 'failed' || status?.status === 'cancelled') {
          await safelyEditBenchMarkReply(
            interaction,
            await buildBenchMarkPayload(interaction, buildBenchMarkSuiteNotice(status)),
          );
          break;
        }

        const ok = await safelyEditBenchMarkReply(
          interaction,
          await buildBenchMarkPayload(interaction, buildBenchMarkSuiteNotice(status)),
        );
        if (!ok) {
          break;
        }

        if (!['queued', 'running', 'cancelling'].includes(String(persisted?.status || '').toLowerCase())) {
          break;
        }
      }
    } finally {
      benchmarkSuitePollers.delete(key);
    }
  })();

  benchmarkSuitePollers.set(key, runner);
  return runner;
}

async function startBenchMarkWarmupUiPoller(interaction) {
  const key = `${interaction.user.id}`;
  const existing = benchmarkWarmupUiPollers.get(key);
  if (existing) {
    existing.interaction = interaction;
    return existing.runner;
  }

  const controller = { interaction, runner: null };

  const runner = (async () => {
    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await sleep(attempt === 0 ? 1500 : 2500);
        const currentInteraction = controller.interaction;
        if (!currentInteraction) break;

        const warmupState = await getBenchMarkWarmupState();
        const active = isBenchMarkWarmupActive(warmupState);

        if (active) {
          const ok = await safelyEditBenchMarkReply(
            currentInteraction,
            await buildBenchMarkPayload(currentInteraction, buildBenchMarkWarmupNotice(warmupState)),
          );
          if (!ok) continue;
          continue;
        }

        let completionNotice = null;
        const finalStatus = String(warmupState?.status || '').toLowerCase();
        if (finalStatus === 'completed') {
          completionNotice = '✅ Professor Aegis startup warm-up finished. You can run BenchMark tools now.';
        } else if (finalStatus === 'failed') {
          completionNotice = '⚠️ Startup warm-up timed out. You can run the BenchMark tool you were trying now.';
        }

        if (completionNotice) {
          await safelyEditBenchMarkReply(
            currentInteraction,
            await buildBenchMarkPayload(currentInteraction, completionNotice),
          );
        }
        break;
      }
    } finally {
      benchmarkWarmupUiPollers.delete(key);
    }
  })();

  controller.runner = runner;
  benchmarkWarmupUiPollers.set(key, controller);
  return runner;
}

async function buildMainMenuPayload(interaction) {
  const startedAt = Date.now();
  const cached = getCachedMainMenuPayload(interaction);
  if (cached) {
    logMenuTiming('buildMainMenuPayload cached', startedAt);
    return cached;
  }
  const [leagueState, player] = await Promise.all([
    getLeagueState(),
    ensurePlayerExists(
      interaction.user.id,
      interaction.member?.displayName || interaction.user.username,
    ),
  ]);
  const registrationOpen = !leagueState.league_active;
  const targetSeasonNumber = resolveRegistrationSeasonNumber(leagueState);
  const [isRegisteredForCurrentSeason, battleOverrideEnabled] = await Promise.all([
    hasSeasonTeamForSeason(
      interaction.user.id,
      targetSeasonNumber,
    ),
    getBattleTestMode(),
  ]);
  const battleAccessOpen = battleOverrideEnabled || isBattleWindowOpenNow();

  const payload = {
    embeds: [
      buildPrivateMainMenuEmbed({
        username: player.username,
        leagueActive: leagueState.league_active,
        seasonNumber: leagueState.season_number,
        registrationOpen,
        registrationSeasonNumber: targetSeasonNumber,
        isRegisteredForCurrentSeason,
        firstGameDayText: buildDiscordTimestamp(leagueState.first_game_day_at, 'F'),
        playoffStartText: buildDiscordTimestamp(leagueState.playoff_start_at, 'F'),
        regulationText: formatRegulationText(leagueState),
        battleAccessText: battleAccessOpen
          ? battleOverrideEnabled
            ? 'Open by Battle Override'
            : 'Open right now'
          : 'Closed until Saturday 12:00 AM ET',
      }),
    ],
    components: [
      buildPrivateMainMenuRow({
        ownerId: interaction.user.id,
        isAdminUser: isBotAdmin(interaction),
      }),
    ],
  };
  logMenuTiming('buildMainMenuPayload', startedAt);
  return setCachedMainMenuPayload(interaction, payload);
}

function buildMainMenuShellPayload(interaction, notice = null) {
  return {
    embeds: [
      buildPrivateMainMenuShellEmbed({
        username: interaction.member?.displayName || interaction.user.username,
        notice,
      }),
    ],
    components: [
      buildPrivateMainMenuRow({
        ownerId: interaction.user.id,
        isAdminUser: isBotAdmin(interaction),
      }),
    ],
  };
}

const ACADEMY_SECTION_SHELLS = {
  menu_registrations: {
    path: 'academy.section.registrations',
    label: 'Registrations',
    emoji: '📝',
  },
  menu_profile: {
    path: 'academy.section.profile',
    label: 'Profile',
    emoji: '👤',
  },
  menu_teams: {
    path: 'academy.section.teams',
    label: 'Teams',
    emoji: '🧾',
  },
  menu_league: {
    path: 'academy.section.league',
    label: 'League',
    emoji: '🏆',
  },
  menu_battle: {
    path: 'academy.section.battle',
    label: 'Battle',
    emoji: '⚔️',
  },
  menu_admin: {
    path: 'academy.section.admin',
    label: 'Admin',
    emoji: '🛠️',
  },
};

function buildAcademySectionShellPayload(interaction, section = {}) {
  return {
    embeds: [
      buildPrivateSectionShellEmbed({
        username: interaction.member?.displayName || interaction.user.username,
        sectionLabel: section.label || 'Academy Records',
        sectionEmoji: section.emoji || '📚',
      }),
    ],
    components: [
      buildPrivateMainMenuRow({
        ownerId: interaction.user.id,
        isAdminUser: isBotAdmin(interaction),
      }),
    ],
  };
}

function renderMainMenuShellThenHydrate(interaction, options = {}) {
  return renderMenuShellThenHydrate(interaction, {
    path: options.path || 'academy.open',
    hydrationKey: `academy:${interaction.user.id}`,
    ackMode: options.ackMode || 'auto',
    shellPayload: () => buildMainMenuShellPayload(interaction, options.notice || null),
    hydratePayload: () => buildMainMenuPayload(interaction),
  });
}

function renderAcademySectionShellThenHydrate(interaction, value, hydratePayload) {
  const section = ACADEMY_SECTION_SHELLS[value] || {};
  return renderMenuShellThenHydrate(interaction, {
    path: section.path || `academy.section.${value || 'unknown'}`,
    hydrationKey: `academy:${interaction.user.id}`,
    ackMode: 'deferUpdate',
    shellPayload: () => buildAcademySectionShellPayload(interaction, section),
    hydratePayload,
  });
}

async function buildRegistrationsPayload(interaction, notice = null) {
  const leagueState = await getLeagueState();
  const registrationOpen = !leagueState.league_active;
  const targetSeasonNumber = resolveRegistrationSeasonNumber(leagueState);
  const seasonTeam = await getSeasonTeamForSeason(interaction.user.id, targetSeasonNumber);

  const payload = {
    embeds: [
      withOptionalFooter(
        buildRegistrationsMenuEmbed({
          username: interaction.member?.displayName || interaction.user.username,
          registrationOpen,
          targetSeasonNumber,
          hasSubmittedTeam: Boolean(seasonTeam),
          teamName: seasonTeam?.team_name || null,
          updatedAtText: seasonTeam?.updated_at || null,
        }),
        notice,
      ),
    ],
    components: [
      buildRegistrationsMenuRow({
        ownerId: interaction.user.id,
        registrationOpen,
        hasSubmittedTeam: Boolean(seasonTeam),
      }),
    ],
  };
}

async function buildProfilePayload(interaction) {
  const player = await getPlayerStats(interaction.user.id);
  return {
    embeds: [buildProfileMenuEmbed({ username: player.username, stats: player })],
    components: [buildProfileMenuRow({ ownerId: interaction.user.id })],
  };
}

async function buildTeamsPayload(interaction) {
  return {
    embeds: [buildTeamsMenuEmbed({ username: interaction.member?.displayName || interaction.user.username })],
    components: [buildTeamsMenuRow({ ownerId: interaction.user.id })],
  };
}

async function buildLeaguePayload(interaction) {
  const leagueState = await getLeagueState();
  return {
    embeds: [
      buildLeagueMenuEmbed({
        seasonNumber: leagueState.season_number,
        regulationText: formatRegulationText(leagueState),
        firstGameDayText: buildDiscordTimestamp(leagueState.first_game_day_at, 'F'),
        playoffStartText: buildDiscordTimestamp(leagueState.playoff_start_at, 'F'),
      }),
    ],
    components: [buildLeagueMenuRow({ ownerId: interaction.user.id })],
  };
}

async function getBattleDeskStatus(interaction) {
  const battleOverrideEnabled = await getBattleTestMode();
  const unresolved = await getLatestUnresolvedBattleForUser(interaction.user.id);
  const battleWindowText = battleOverrideEnabled
    ? 'Open by Battle Override'
    : isBattleWindowOpenNow()
      ? 'Open now (Saturday battle window)'
      : 'Closed until Saturday 12:00 AM ET';

  return {
    battleOverrideEnabled,
    unresolved,
    battleWindowText,
  };
}

async function buildBattlePayload(interaction, notice = null) {
  const startedAt = Date.now();
  const { battleOverrideEnabled, unresolved, battleWindowText } = await getBattleDeskStatus(interaction);
  const unresolvedText = unresolved
    ? `${unresolved.status.toUpperCase()} • ${unresolved.challenger_username} vs ${unresolved.opponent_username}`
    : 'No unresolved battle';

  const payload = {
    embeds: [
      withOptionalFooter(
        buildBattleMenuEmbed({
          battleWindowText,
          battleOverrideEnabled,
          unresolvedBattleText: unresolvedText,
        }),
        notice,
      ),
    ],
    components: [
      buildBattleMenuRow({
        ownerId: interaction.user.id,
        hasUnresolvedBattle: Boolean(unresolved),
      }),
    ],
  };
  logMenuTiming('buildBattlePayload', startedAt);
  return payload;
}

function getBenchMarkShellConfig(userId, configOverride = null) {
  if (configOverride) return normalizeBenchMarkSuiteConfig(configOverride);
  const settingsSnapshot = getCachedBenchMarkSuiteSettingsSnapshot(userId);
  if (settingsSnapshot?.config) return normalizeBenchMarkSuiteConfig(settingsSnapshot.config);
  const menuState = getCachedBenchMarkMenuState(userId);
  if (menuState?.suiteConfig) return normalizeBenchMarkSuiteConfig(menuState.suiteConfig);
  return normalizeBenchMarkSuiteConfig(BENCHMARK_SUITE_DEFAULT_CONFIG);
}

function buildBenchMarkMenuShellPayload(interaction, notice = null) {
  const menuState = getCachedBenchMarkMenuState(interaction.user.id);
  const benchmarkState = menuState?.benchmarkState || null;
  const suiteJobState = menuState?.suiteJobState || null;
  const suiteConfig = getBenchMarkShellConfig(interaction.user.id, menuState?.suiteConfig);
  const hasSubmittedTeam = Boolean(cleanText(benchmarkState?.team_export));
  const previewLines = hasSubmittedTeam
    ? cleanText(benchmarkState.team_export).split('\n').filter(Boolean)
    : [];
  const teamPreviewText = hasSubmittedTeam
    ? `${previewLines[0]?.slice(0, 80) || 'Team on file'}${previewLines.length > 1 ? ` • ${previewLines.length} lines saved` : ''}`
    : 'Loading saved team status...';
  const hasActiveSuiteJob = isActiveBenchMarkJobState(suiteJobState);
  const suiteStatusText = hasActiveSuiteJob
    ? formatBenchMarkQueueStatus(suiteJobState)
    : 'Loading saved state...';

  return {
    content: '',
    embeds: [
      buildBenchMarkMenuShellEmbed({
        teamPreviewText,
        suiteConfigText: formatBenchMarkSuiteConfigText(suiteConfig),
        suiteStatusText,
        notice,
      }),
    ],
    components: [buildBenchMarkMenuShellRow({ ownerId: interaction.user.id })],
    files: [],
  };
}

function renderBenchMarkMenuShellThenHydrate(interaction, options = {}) {
  return renderMenuShellThenHydrate(interaction, {
    path: options.path || 'benchmark.open',
    hydrationKey: `benchmark:${interaction.user.id}`,
    ackMode: options.ackMode || 'auto',
    shellPayload: () => buildBenchMarkMenuShellPayload(interaction, options.notice || null),
    hydratePayload: () => buildBenchMarkPayload(interaction, options.notice || null),
  });
}

function buildBenchMarkSuiteConfigShellPayload(interaction, notice = null, options = {}) {
  const config = getBenchMarkShellConfig(interaction.user.id, options.config);
  return {
    content: '',
    embeds: [
      buildBenchMarkSuiteConfigShellEmbed({
        config,
        notice,
      }),
    ],
    components: [
      buildBenchMarkSuiteConfigRow({
        ownerId: interaction.user.id,
        currentFormatId: config.format_id,
      }),
    ],
    files: [],
  };
}

function buildBenchMarkSuiteModeShellPayload(interaction, notice = null, options = {}) {
  const config = getBenchMarkShellConfig(interaction.user.id, options.config);
  return {
    content: '',
    embeds: [buildBenchMarkSuiteConfigShellEmbed({ config, notice: notice || 'Opening Opponent Pool options...' })],
    components: [buildBenchMarkSuiteModeRow({ ownerId: interaction.user.id, currentMode: config.mode, benchmarkModes: [] })],
    files: [],
  };
}

function buildBenchMarkSuiteFormatShellPayload(interaction, notice = null, options = {}) {
  const config = getBenchMarkShellConfig(interaction.user.id, options.config);
  return {
    content: '',
    embeds: [buildBenchMarkSuiteConfigShellEmbed({ config, notice: notice || 'Opening Simulation Format options...' })],
    components: [buildBenchMarkSuiteFormatRow({ ownerId: interaction.user.id, currentFormatId: config.format_id })],
    files: [],
  };
}

function buildBenchMarkSuiteBattleBudgetShellPayload(interaction, notice = null, options = {}) {
  const config = getBenchMarkShellConfig(interaction.user.id, options.config);
  return {
    content: '',
    embeds: [buildBenchMarkSuiteConfigShellEmbed({ config, notice: notice || 'Opening Battle Budget options...' })],
    components: [buildBenchMarkSuiteBattleBudgetRow({ ownerId: interaction.user.id, currentBattleBudget: config.battle_budget })],
    files: [],
  };
}

function buildBenchMarkSuiteGamesShellPayload(interaction, notice = null, options = {}) {
  const config = getBenchMarkShellConfig(interaction.user.id, options.config);
  return {
    content: '',
    embeds: [buildBenchMarkSuiteConfigShellEmbed({ config, notice: notice || 'Opening Series Length options...' })],
    components: [buildBenchMarkSuiteGamesPerOpponentRow({ ownerId: interaction.user.id, currentGamesPerOpponent: config.games_per_opponent })],
    files: [],
  };
}

function renderBenchMarkSuiteConfigShellThenHydrate(interaction, options = {}) {
  return renderMenuShellThenHydrate(interaction, {
    path: options.path || 'benchmark.settings',
    hydrationKey: `benchmark:${interaction.user.id}`,
    ackMode: options.ackMode || 'auto',
    shellPayload: () => buildBenchMarkSuiteConfigShellPayload(interaction, options.notice || null, options),
    hydratePayload: () => buildBenchMarkSuiteConfigPayload(interaction, options.notice || null, options.snapshotOverrides || {}),
  });
}

function renderBenchMarkSuiteSubmenuShellThenHydrate(interaction, options = {}) {
  return renderMenuShellThenHydrate(interaction, {
    path: options.path || 'benchmark.settings.submenu',
    hydrationKey: `benchmark:${interaction.user.id}`,
    ackMode: options.ackMode || 'auto',
    shellPayload: options.shellPayload,
    hydratePayload: options.hydratePayload,
  });
}

function scheduleBenchMarkWarmupPollerIfActive(interaction) {
  void getBenchMarkWarmupState()
    .then((warmupState) => {
      if (isBenchMarkWarmupActive(warmupState)) {
        void startBenchMarkWarmupUiPoller(interaction);
      }
    })
    .catch(() => null);
}

async function buildBenchMarkPayload(interaction, notice = null) {
  const startedAt = Date.now();
  try {
  const cacheable = !notice;
  if (cacheable) {
    const cached = getCachedBenchMarkMenuPayload(interaction.user.id);
    if (cached) {
      logMenuTiming('buildBenchMarkPayload cached', startedAt);
      return cached;
    }
  }
  const menuSnapshot = getCachedBenchMarkMenuSnapshot(interaction.user.id);

  const menuState = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
  const {
    benchmarkState,
    jobState,
    matchupJobState,
    suiteJobState,
    warmupState,
    suiteConfig,
    lastReportState,
    lastMatchupEvalState,
    lastSuiteReportState,
  } = menuState;
  let benchmarkWarmupActive = isBenchMarkWarmupActive(warmupState);
  const startupReadiness = menuSnapshot?.startupReadiness || null;
  const hasSubmittedTeam = Boolean(cleanText(benchmarkState?.team_export));
  const hasLastReport = Boolean(lastReportState?.has_report || lastReportState?.report_id);
  const hasLastMatchupEval = Boolean(lastMatchupEvalState?.has_report || lastMatchupEvalState?.report_id);
  const hasLastSuiteReport = Boolean(lastSuiteReportState?.has_report || lastSuiteReportState?.report_id);
  const hasActiveJob = ['queued', 'running'].includes(String(jobState?.status || '').toLowerCase());
  const hasActiveMatchupJob = ['queued', 'running'].includes(String(matchupJobState?.status || '').toLowerCase());
  const hasActiveSuiteJob = ['queued', 'running'].includes(String(suiteJobState?.status || '').toLowerCase());
  const previewLines = hasSubmittedTeam
    ? cleanText(benchmarkState.team_export).split('\n').filter(Boolean)
    : [];
  const teamPreviewText = hasSubmittedTeam
    ? `${previewLines[0]?.slice(0, 80) || 'Team on file'}${previewLines.length > 1 ? ` • ${previewLines.length} lines saved` : ''}`
    : 'No team submitted';

  if (
    hasSubmittedTeam
    && !hasActiveSuiteJob
    && !hasActiveJob
    && !hasActiveMatchupJob
    && isBenchMarkStartupReadinessGateActive(startupReadiness)
  ) {
    benchmarkWarmupActive = true;
  }

  let readinessText = 'Awaiting team submission';
  if (benchmarkWarmupActive) {
    readinessText = startupReadiness
      ? cleanText(startupReadiness.statusText || 'Professor Aegis is finishing startup readiness')
      : 'Professor Aegis is finishing startup warm-up';
  } else if (hasSubmittedTeam) {
    const activeCount = [hasActiveJob, hasActiveMatchupJob, hasActiveSuiteJob].filter(Boolean).length;
    const savedCount = [hasLastReport, hasLastMatchupEval, hasLastSuiteReport].filter(Boolean).length;
    if (activeCount > 1) {
      readinessText = 'Multiple Battle Simulator tasks are in progress';
    } else if (hasActiveSuiteJob) {
      readinessText = 'Simulation in progress';
    } else if (hasActiveMatchupJob) {
      readinessText = 'Matchup eval in progress';
    } else if (hasActiveJob) {
      readinessText = 'Weakness report in progress';
    } else if (savedCount > 1) {
      readinessText = 'Saved Battle Simulator reports are available';
    } else if (hasLastSuiteReport) {
      readinessText = 'Simulation report available';
    } else if (hasLastMatchupEval) {
      readinessText = 'Last matchup eval available';
    } else if (hasLastReport) {
      readinessText = 'Last weakness report available';
    } else {
      readinessText = 'Ready to run';
    }
  }

  const footerNotice = shouldShowBenchMarkFooterNotice(notice) ? cleanText(notice) : null;
  const inlineNotice = buildBenchMarkInlineNotice(notice);
  const leadPairProgressBlock = buildBenchMarkSuiteLeadPairProgressBlock(suiteJobState?.progress || {});
  const suiteDetailText = [
    leadPairProgressBlock ? null : formatBenchMarkSuiteProgressDetail(suiteJobState),
    inlineNotice,
  ].filter(Boolean).join(' • ') || null;
  const hasHistoryProfiles = Boolean(menuSnapshot?.hasHistoryProfiles || hasLastSuiteReport || !menuSnapshot);
  const startupReadinessDetailText = startupReadiness && isBenchMarkStartupReadinessGateActive(startupReadiness)
    ? formatBenchMarkStartupReadinessNotice(startupReadiness)
    : null;
  if (cacheable && !hasActiveJob && !hasActiveMatchupJob && !hasActiveSuiteJob) {
    scheduleBenchMarkMenuSnapshotRefresh(interaction.user.id);
  }

  const payload = {
    embeds: [
      withOptionalFooter(
        buildBenchMarkMenuEmbed({
          queueStatusText: formatBenchMarkQueueStatus(jobState),
          matchupStatusText: formatBenchMarkQueueStatus(matchupJobState),
          suiteStatusText: formatBenchMarkQueueStatus(suiteJobState),
          suiteDetailText,
          liveProgressBlocks: leadPairProgressBlock ? [leadPairProgressBlock] : [],
          warmupStatusText: benchmarkWarmupActive ? (startupReadinessDetailText ? 'Startup cache warming ⏳' : formatBenchMarkWarmupStatusText(warmupState)) : null,
          warmupDetailText: benchmarkWarmupActive ? (startupReadinessDetailText || formatBenchMarkWarmupDetailText(warmupState)) : null,
          suiteConfigText: formatBenchMarkSuiteConfigText(suiteConfig),
          readinessText,
          hasSubmittedTeam,
          teamPreviewText,
        }),
        footerNotice,
      ),
    ],
    components: buildBenchMarkMenuComponents({
        ownerId: interaction.user.id,
        hasSubmittedTeam,
        hasLastReport,
        hasActiveJob,
        hasLastMatchupEval,
        hasActiveMatchupJob,
        hasLastSuiteReport,
        hasActiveSuiteJob,
        hasMatchArchiveReady: false,
        benchmarkWarmupActive,
        hasHistoryProfiles,
      }),
  };

  if (cacheable && !hasActiveJob && !hasActiveMatchupJob && !hasActiveSuiteJob && !benchmarkWarmupActive) {
    setCachedBenchMarkMenuPayload(interaction.user.id, payload);
  }

  const finalPayload = isValidDiscordMessagePayload(payload)
    ? payload
    : buildBenchMarkFallbackPayload(interaction, 'Battle Simulator menu data was incomplete. Please try again.');
  logMenuTiming('buildBenchMarkPayload', startedAt);
  return finalPayload;
  } catch (error) {
    console.error('[BenchMark Menu] Payload build failed:', error);
    const fallbackPayload = buildBenchMarkFallbackPayload(
      interaction,
      notice || 'Battle Simulator menu data is still loading. Please try the menu again.',
    );
    logMenuTiming('buildBenchMarkPayload fallback', startedAt);
    return fallbackPayload;
  }
}

function getBenchMarkSuiteCapabilitiesCacheKey(formatId) {
  return normalizeBenchMarkSuiteFormatId(formatId);
}

function getBenchMarkSuiteCapabilitiesCacheTtlMs() {
  return Number.isFinite(BENCHMARK_SUITE_CAPABILITIES_CACHE_TTL_MS) && BENCHMARK_SUITE_CAPABILITIES_CACHE_TTL_MS > 0
    ? BENCHMARK_SUITE_CAPABILITIES_CACHE_TTL_MS
    : 300000;
}

function buildFallbackBenchMarkSuiteBenchmarkModes(formatId) {
  const normalizedFormatId = normalizeBenchMarkSuiteFormatId(formatId);
  return BENCHMARK_SUITE_MODE_OPTIONS.map((mode) => {
    const targetOpponentCount = getBenchMarkSuiteTargetCount(mode);
    return {
      mode,
      label: humanizeBenchMarkSuiteMode(mode),
      formatId: normalizedFormatId,
      targetOpponentCount,
      availableOpponents: targetOpponentCount,
      recommendedSizes: targetOpponentCount ? [targetOpponentCount] : [],
    };
  });
}

function getCachedBenchMarkSuiteCapabilities(formatId, { allowExpired = false } = {}) {
  const key = getBenchMarkSuiteCapabilitiesCacheKey(formatId);
  const entry = benchmarkSuiteCapabilitiesCache.get(key);
  if (!entry) return null;
  const expired = (Date.now() - Number(entry.createdAt || 0)) > getBenchMarkSuiteCapabilitiesCacheTtlMs();
  if (expired && !allowExpired) return null;
  return {
    ...entry,
    expired,
  };
}

function cacheBenchMarkSuiteCapabilities(formatId, capabilities = {}) {
  const benchmarkModes = Array.isArray(capabilities?.benchmarkModes) ? capabilities.benchmarkModes : [];
  if (!benchmarkModes.length) return capabilities;
  benchmarkSuiteCapabilitiesCache.set(getBenchMarkSuiteCapabilitiesCacheKey(formatId), {
    createdAt: Date.now(),
    capabilities: {
      ...capabilities,
      benchmarkModes,
    },
    benchmarkModes,
  });
  return capabilities;
}

function getCachedBenchMarkSuiteBenchmarkModes(formatId, { allowExpired = false } = {}) {
  const entry = getCachedBenchMarkSuiteCapabilities(formatId, { allowExpired });
  const benchmarkModes = Array.isArray(entry?.benchmarkModes) ? entry.benchmarkModes : [];
  return benchmarkModes.length ? benchmarkModes : null;
}

function scheduleBenchMarkSuiteCapabilitiesRefresh(formatId) {
  const key = getBenchMarkSuiteCapabilitiesCacheKey(formatId);
  if (benchmarkSuiteCapabilitiesRefreshes.has(key)) return;
  const refresh = getBenchMarkWorkerCapabilities(key)
    .then((capabilities) => cacheBenchMarkSuiteCapabilities(key, capabilities))
    .catch(() => null)
    .finally(() => {
      benchmarkSuiteCapabilitiesRefreshes.delete(key);
    });
  benchmarkSuiteCapabilitiesRefreshes.set(key, refresh);
}

function getBenchMarkSuiteBenchmarkModes(formatId) {
  const freshModes = getCachedBenchMarkSuiteBenchmarkModes(formatId);
  if (freshModes) return freshModes;

  const staleModes = getCachedBenchMarkSuiteBenchmarkModes(formatId, { allowExpired: true });
  scheduleBenchMarkSuiteCapabilitiesRefresh(formatId);
  return staleModes || buildFallbackBenchMarkSuiteBenchmarkModes(formatId);
}

function getBenchMarkSuiteSettingsSnapshotCacheTtlMs(snapshot = null) {
  const ttl = Number.isFinite(BENCHMARK_SUITE_SETTINGS_SNAPSHOT_CACHE_TTL_MS) && BENCHMARK_SUITE_SETTINGS_SNAPSHOT_CACHE_TTL_MS > 0
    ? BENCHMARK_SUITE_SETTINGS_SNAPSHOT_CACHE_TTL_MS
    : 5000;
  const status = String(snapshot?.suiteJobState?.status || '').toLowerCase();
  return ['queued', 'running', 'cancelling', 'submitting'].includes(status)
    ? Math.min(ttl, 1000)
    : ttl;
}

function sanitizeBenchMarkSuiteSettingsJobState(state = {}) {
  if (!state || typeof state !== 'object') {
    return {
      job_id: null,
      status: 'idle',
      submitted_at: null,
      started_at: null,
      completed_at: null,
      error: null,
      format_id: null,
      benchmark_mode: null,
      updated_at: null,
    };
  }
  return {
    job_id: state.job_id || null,
    status: state.status || 'idle',
    submitted_at: state.submitted_at || null,
    started_at: state.started_at || null,
    completed_at: state.completed_at || null,
    error: state.error || null,
    format_id: state.format_id || null,
    benchmark_mode: state.benchmark_mode || null,
    updated_at: state.updated_at || null,
  };
}

function normalizeBenchMarkSuiteSettingsSnapshot(snapshot = {}) {
  return {
    config: normalizeBenchMarkSuiteConfig(snapshot.config || BENCHMARK_SUITE_DEFAULT_CONFIG),
    warmupState: {
      ...buildDefaultBenchMarkWarmupState(),
      ...(snapshot.warmupState || {}),
    },
    benchmarkState: {
      team_export: snapshot.benchmarkState?.team_export || null,
      updated_at: snapshot.benchmarkState?.updated_at || null,
    },
    suiteJobState: sanitizeBenchMarkSuiteSettingsJobState(snapshot.suiteJobState),
  };
}

function getCachedBenchMarkSuiteSettingsSnapshot(userId) {
  const key = String(userId || '');
  const entry = benchmarkSuiteSettingsSnapshotCache.get(key);
  if (!entry) return null;
  const snapshot = normalizeBenchMarkSuiteSettingsSnapshot(entry.snapshot);
  if ((Date.now() - Number(entry.createdAt || 0)) > getBenchMarkSuiteSettingsSnapshotCacheTtlMs(snapshot)) {
    benchmarkSuiteSettingsSnapshotCache.delete(key);
    return null;
  }
  return snapshot;
}

function setCachedBenchMarkSuiteSettingsSnapshot(userId, snapshot = {}) {
  const key = String(userId || '');
  if (!key) return normalizeBenchMarkSuiteSettingsSnapshot(snapshot);
  const normalizedSnapshot = normalizeBenchMarkSuiteSettingsSnapshot(snapshot);
  benchmarkSuiteSettingsSnapshotCache.set(key, {
    createdAt: Date.now(),
    snapshot: normalizedSnapshot,
  });
  return normalizedSnapshot;
}

function hasBenchMarkSuiteSettingsOverride(overrides = {}, key) {
  return Object.prototype.hasOwnProperty.call(overrides || {}, key);
}

function mergeBenchMarkSuiteSettingsSnapshot(snapshot = {}, overrides = {}) {
  return normalizeBenchMarkSuiteSettingsSnapshot({
    ...snapshot,
    ...(hasBenchMarkSuiteSettingsOverride(overrides, 'config') ? { config: overrides.config } : {}),
    ...(hasBenchMarkSuiteSettingsOverride(overrides, 'warmupState') ? { warmupState: overrides.warmupState } : {}),
    ...(hasBenchMarkSuiteSettingsOverride(overrides, 'benchmarkState') ? { benchmarkState: overrides.benchmarkState } : {}),
    ...(hasBenchMarkSuiteSettingsOverride(overrides, 'suiteJobState') ? { suiteJobState: overrides.suiteJobState } : {}),
  });
}

async function getBenchMarkSuiteSettingsSnapshot(userId, overrides = {}) {
  const cached = getCachedBenchMarkSuiteSettingsSnapshot(userId);
  if (cached) {
    const merged = mergeBenchMarkSuiteSettingsSnapshot(cached, overrides);
    if (Object.keys(overrides || {}).length) {
      setCachedBenchMarkSuiteSettingsSnapshot(userId, merged);
    }
    return merged;
  }

  const [config, warmupState, benchmarkState, suiteJobState] = await Promise.all([
    hasBenchMarkSuiteSettingsOverride(overrides, 'config')
      ? Promise.resolve(normalizeBenchMarkSuiteConfig(overrides.config))
      : getBenchMarkSuiteConfig(userId),
    hasBenchMarkSuiteSettingsOverride(overrides, 'warmupState')
      ? Promise.resolve(overrides.warmupState)
      : getBenchMarkWarmupState(),
    hasBenchMarkSuiteSettingsOverride(overrides, 'benchmarkState')
      ? Promise.resolve(overrides.benchmarkState)
      : getBenchMarkTeamState(userId),
    hasBenchMarkSuiteSettingsOverride(overrides, 'suiteJobState')
      ? Promise.resolve(overrides.suiteJobState)
      : getBenchMarkSuiteJobState(userId),
  ]);

  return setCachedBenchMarkSuiteSettingsSnapshot(userId, {
    config,
    warmupState,
    benchmarkState,
    suiteJobState,
  });
}

async function getBenchMarkSuiteSettingsConfig(userId, configOverride = null) {
  if (configOverride) return normalizeBenchMarkSuiteConfig(configOverride);
  const cached = getCachedBenchMarkSuiteSettingsSnapshot(userId);
  if (cached?.config) return cached.config;
  return getBenchMarkSuiteConfig(userId);
}

async function buildBenchMarkSuiteConfigPayload(interaction, notice = null, snapshotOverrides = {}) {
  const startedAt = Date.now();
  const {
    config,
    warmupState,
    benchmarkState,
    suiteJobState,
  } = await getBenchMarkSuiteSettingsSnapshot(interaction.user.id, snapshotOverrides);
  const benchmarkWarmupActive = isBenchMarkWarmupActive(warmupState);
  const hasSubmittedTeam = Boolean(cleanText(benchmarkState?.team_export));
  const hasActiveSuiteJob = ['queued', 'running'].includes(String(suiteJobState?.status || '').toLowerCase());
  const benchmarkModes = getBenchMarkSuiteBenchmarkModes(config.format_id);

  const payload = {
    embeds: [
      withOptionalFooter(
        buildBenchMarkSuiteConfigEmbed({
          username: interaction.member?.displayName || interaction.user.username,
          config,
          benchmarkModes,
          benchmarkWarmupActive,
          hasSubmittedTeam,
          hasActiveSuiteJob,
        }),
        shouldShowBenchMarkFooterNotice(notice) ? cleanText(notice) : null,
      ),
    ],
    components: [
      buildBenchMarkSuiteConfigRow({
        ownerId: interaction.user.id,
        currentFormatId: config.format_id,
        benchmarkWarmupActive,
        hasSubmittedTeam,
        hasActiveSuiteJob,
      }),
    ],
  };
  logMenuTiming('buildBenchMarkSuiteConfigPayload', startedAt);
  return payload;
}

async function buildBenchMarkSuiteModePayload(interaction, notice = null, options = {}) {
  const config = await getBenchMarkSuiteSettingsConfig(interaction.user.id, options.config);
  const benchmarkModes = getBenchMarkSuiteBenchmarkModes(config.format_id);
  return {
    embeds: [
      withOptionalFooter(
        buildBenchMarkSuiteConfigEmbed({
          username: interaction.member?.displayName || interaction.user.username,
          config,
          benchmarkModes,
        }),
        shouldShowBenchMarkFooterNotice(notice) ? cleanText(notice) : null,
      ),
    ],
    components: [buildBenchMarkSuiteModeRow({ ownerId: interaction.user.id, currentMode: config.mode, benchmarkModes })],
  };
}

async function buildBenchMarkSuiteFormatPayload(interaction, notice = null, options = {}) {
  const config = await getBenchMarkSuiteSettingsConfig(interaction.user.id, options.config);
  const benchmarkModes = getBenchMarkSuiteBenchmarkModes(config.format_id);
  return {
    embeds: [
      withOptionalFooter(
        buildBenchMarkSuiteConfigEmbed({
          username: interaction.member?.displayName || interaction.user.username,
          config,
          benchmarkModes,
        }),
        shouldShowBenchMarkFooterNotice(notice) ? cleanText(notice) : null,
      ),
    ],
    components: [buildBenchMarkSuiteFormatRow({ ownerId: interaction.user.id, currentFormatId: config.format_id })],
  };
}

async function buildBenchMarkSuiteBattleBudgetPayload(interaction, notice = null, options = {}) {
  const config = await getBenchMarkSuiteSettingsConfig(interaction.user.id, options.config);
  const benchmarkModes = getBenchMarkSuiteBenchmarkModes(config.format_id);
  return {
    embeds: [
      withOptionalFooter(
        buildBenchMarkSuiteConfigEmbed({
          username: interaction.member?.displayName || interaction.user.username,
          config,
          benchmarkModes,
        }),
        shouldShowBenchMarkFooterNotice(notice) ? cleanText(notice) : null,
      ),
    ],
    components: [buildBenchMarkSuiteBattleBudgetRow({ ownerId: interaction.user.id, currentBattleBudget: config.battle_budget })],
  };
}

async function buildBenchMarkSuiteGamesPayload(interaction, notice = null, options = {}) {
  const config = await getBenchMarkSuiteSettingsConfig(interaction.user.id, options.config);
  if (isBenchMarkSuiteChampionFormat(config.format_id)) {
    const nextConfig = await setBenchMarkSuiteConfig(interaction.user.id, { games_per_opponent: 1 }, config);
    return buildBenchMarkSuiteConfigPayload(interaction, notice || 'Champions simulations are BO1 only.', { config: nextConfig });
  }
  const benchmarkModes = getBenchMarkSuiteBenchmarkModes(config.format_id);
  return {
    embeds: [
      withOptionalFooter(
        buildBenchMarkSuiteConfigEmbed({
          username: interaction.member?.displayName || interaction.user.username,
          config,
          benchmarkModes,
        }),
        shouldShowBenchMarkFooterNotice(notice) ? cleanText(notice) : null,
      ),
    ],
    components: [buildBenchMarkSuiteGamesPerOpponentRow({ ownerId: interaction.user.id, currentGamesPerOpponent: config.games_per_opponent })],
  };
}

async function buildAdminPayload(interaction, notice = null) {
  const leagueState = await getLeagueState();
  const battleOverrideEnabled = await getBattleTestMode();

  return {
    embeds: [
      withOptionalFooter(
        buildAdminPanelEmbed({
          seasonNumber: leagueState.season_number,
          battleOverrideEnabled,
          battleRoomCategoryId: leagueState.battle_room_category_id,
        }),
        notice,
      ),
    ],
    components: [buildAdminPanelRow({ ownerId: interaction.user.id })],
  };
}

async function buildLeagueControlPayload(interaction, notice = null) {
  const leagueState = await getLeagueState();
  const battleOverrideEnabled = await getBattleTestMode();
  const scoring = buildBattleScoringConfig(leagueState);

  return {
    embeds: [
      withOptionalFooter(
        buildLeagueControlEmbed({
          seasonNumber: leagueState.season_number,
          leagueActive: leagueState.league_active,
          battleOverrideEnabled,
          regulationText: formatRegulationText(leagueState),
          playoffMinimumMatches: leagueState.playoff_minimum_matches,
          battleRoomCategoryId: leagueState.battle_room_category_id,
          scoringText: `${scoring.gameWinPoints} per game win • ${scoring.sweepBonusPoints} sweep bonus • Bo${scoring.bestOf}`,
        }),
        notice,
      ),
    ],
    components: [buildLeagueControlRow({ ownerId: interaction.user.id, battleOverrideEnabled })],
  };
}

async function getAcademyPlayers() {
  const members = await listAcademyMembers(250);
  const players = [];
  for (const member of members) {
    const player = await getPlayerById(member.user_id);
    if (player) players.push(player);
  }
  return players.sort((a, b) => String(a.username).localeCompare(String(b.username)));
}

async function getRegisteredOpponents(requesterUserId) {
  const members = await getAcademyPlayers();
  return members.filter(
    (player) => player.user_id !== requesterUserId && Number(player.registered || 0) === 1,
  );
}

async function getRoomJumpText(battle) {
  if (!battle?.battle_room_channel_id) return 'No private battle room exists yet.';
  return `Your current room is <#${battle.battle_room_channel_id}>.`;
}

async function createBattleRoomChannel(interaction, battle) {
  const guild = interaction.guild;
  const leagueState = await getLeagueState();

  if (!leagueState.battle_room_category_id) {
    throw new Error('Battle room category is not set in League Control.');
  }

  const category =
    guild.channels.cache.get(leagueState.battle_room_category_id) ||
    (await guild.channels.fetch(leagueState.battle_room_category_id).catch(() => null));

  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error('The configured battle room category is invalid or missing.');
  }

  const name = `battle-${sanitizeRoomSlug(battle.challenger_username)}-vs-${sanitizeRoomSlug(battle.opponent_username)}`.slice(0, 95);

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: battle.challenger_user_id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
        deny: [PermissionsBitField.Flags.SendMessages],
      },
      {
        id: battle.opponent_user_id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
        deny: [PermissionsBitField.Flags.SendMessages],
      },
      ...ADMIN_ROLE_IDS.map((roleId) => ({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
        ],
      })),
    ],
  });
}

function buildGameResultEmbed({ battle, game, winnerUserId, notice }) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`🏁 Professor Aegis • Game ${game.game_number} Result`)
    .setDescription(
      [
        `**Winner:** <@${winnerUserId}>`,
        `**Series Score:** ${battle.challenger_username} ${Number(battle.challenger_score || 0)} • ${Number(battle.opponent_score || 0)} ${battle.opponent_username}`,
        notice || null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
}

function battleTranscriptPreview(currentGame, latestPreviewText) {
  if (latestPreviewText) return latestPreviewText;
  const raw = cleanText(currentGame?.battle_log_text);
  if (!raw) return null;
  const lines = raw.split('\n').slice(-18);
  return lines.join('\n');
}

async function sendBattleRoomMessage({ battleId, notice = null, latestPreviewText = null }) {
  const battle = await getBattleById(battleId);
  if (!battle?.battle_room_channel_id) return null;

  const channel = await client.channels.fetch(battle.battle_room_channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;

  const currentGame = await getCurrentBattleGame(battle.id);

  const message = await channel.send({
    content:
      battle.status === 'pending'
        ? `<@${battle.challenger_user_id}> <@${battle.opponent_user_id}>`
        : null,
    embeds: [
      buildBattleRoomEmbed({
        battle,
        currentGame,
        roomMention: `<#${channel.id}>`,
        notice,
        latestTranscript: battleTranscriptPreview(currentGame, latestPreviewText),
      }),
    ],
    components: [buildBattleRoomSharedRow(battle.id)],
    allowedMentions: { users: [battle.challenger_user_id, battle.opponent_user_id] },
  });

  await setBattleRoomInfo(battle.id, channel.id, message.id);
  return message;
}

async function editBattleRoomCurrentMessage({ battleId, notice = null, latestPreviewText = null }) {
  const battle = await getBattleById(battleId);
  if (!battle?.battle_room_channel_id || !battle?.battle_room_message_id) return null;

  const channel = await client.channels.fetch(battle.battle_room_channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;

  const currentGame = await getCurrentBattleGame(battle.id);
  const message = await channel.messages.fetch(battle.battle_room_message_id).catch(() => null);

  if (!message) {
    return sendBattleRoomMessage({ battleId, notice, latestPreviewText });
  }

  await message
    .edit({
      embeds: [
        buildBattleRoomEmbed({
          battle,
          currentGame,
          roomMention: `<#${channel.id}>`,
          notice,
          latestTranscript: battleTranscriptPreview(currentGame, latestPreviewText),
        }),
      ],
      components: [buildBattleRoomSharedRow(battle.id)],
    })
    .catch(() => null);

  return message;
}

function scheduleBattleRoomDeletion(channel, ms, finalText) {
  setTimeout(async () => {
    if (!channel) return;
    if (finalText) {
      await channel.send({ content: finalText }).catch(() => null);
    }
    await channel.delete().catch(() => null);
  }, ms);
}

async function buildBattleControlPayload(interaction, battleInput, notice = null) {
  const battle =
    typeof battleInput === 'object'
      ? battleInput
      : await getBattleById(Number(battleInput || 0));

  if (!battle) {
    return { content: 'That battle could not be found.', embeds: [], components: [] };
  }

  const currentGame = await getCurrentBattleGame(battle.id);
  const previousGameNumber = Math.max(1, Number(battle.current_game_number || 1) - 1);
  const archiveGame = await getBattleGameByNumber(
    battle.id,
    battle.status === 'completed'
      ? Number(battle.current_game_number || 1)
      : previousGameNumber,
  );

  return {
    embeds: [
      buildBattleControlPanelEmbed({
        battle,
        currentGame,
        archiveGame,
        viewerUserId: interaction.user.id,
        isAdmin: isBotAdmin(interaction),
        notice,
      }),
    ],
    components: buildBattleControlPanelRows({
      ownerId: interaction.user.id,
      battle,
      currentGame,
      archiveGame,
      isAdmin: isBotAdmin(interaction),
    }),
  };
}

async function resolveSpectatorWinnerUserId(battle, payload) {
  const winnerId = toShowdownId(payload?.winnerShowdownName);
  const challengerRoomId = toShowdownId(payload?.challengerShowdownName);
  const opponentRoomId = toShowdownId(payload?.opponentShowdownName);

  if (!battle || !winnerId) return null;
  if (challengerRoomId && winnerId === challengerRoomId) return battle.challenger_user_id;
  if (opponentRoomId && winnerId === opponentRoomId) return battle.opponent_user_id;

  const [challengerPlayer, opponentPlayer] = await Promise.all([
    getPlayerById(battle.challenger_user_id).catch(() => null),
    getPlayerById(battle.opponent_user_id).catch(() => null),
  ]);

  if (toShowdownId(challengerPlayer?.showdown_name) === winnerId) {
    return battle.challenger_user_id;
  }

  if (toShowdownId(opponentPlayer?.showdown_name) === winnerId) {
    return battle.opponent_user_id;
  }

  return null;
}

async function handleSpectatorCompletion({ battleId, game, payload }) {
  const battle = await getBattleById(battleId);
  const winnerUserId = await resolveSpectatorWinnerUserId(battle, payload);

  if (!winnerUserId) {
    await setBattleGameSpectatorState(game.id, {
      spectatorStatus: 'mismatch',
      disconnected: true,
      connectionError:
        'Battle finished, but the winner could not be mapped to one of the registered trainers in this series.',
      battleLogText: payload.battleLogText || null,
      replayUrl: payload.replayUrl || null,
      challengerShowdownName: payload.challengerShowdownName || null,
      opponentShowdownName: payload.opponentShowdownName || null,
    });

    await editBattleRoomCurrentMessage({
      battleId,
      notice:
        `Game ${game.game_number} ended, but the winner could not be mapped to one of the two trainers in this series.`,
      latestPreviewText: payload.previewText || null,
    });
    return;
  }

  const scoringConfig = buildBattleScoringConfig(await getLeagueState());

  const result = await completeBattleGameFromSpectator({
    battleId,
    gameId: game.id,
    winnerUserId,
    winnerShowdownName: payload.winnerShowdownName || null,
    challengerShowdownName: payload.challengerShowdownName || null,
    opponentShowdownName: payload.opponentShowdownName || null,
    detectedFormat: payload.detectedFormat || null,
    battleLogText: payload.battleLogText || null,
    replayUrl: payload.replayUrl || null,
    showdownRoomId: payload.roomId || game.showdown_room_id,
    showdownLinkUrl: payload.showdownLinkUrl || game.showdown_link_url,
    scoringConfig,
  });

  if (result.alreadyCompleted) {
    await editBattleRoomCurrentMessage({
      battleId,
      notice: `Game ${game.game_number} was already recorded. Duplicate completion was ignored.`,
      latestPreviewText: payload.previewText || null,
    });
    return;
  }

  const updatedBattle = result.battle;
  const channel = await client.channels
    .fetch(updatedBattle.battle_room_channel_id)
    .catch(() => null);

  const winnerScore =
    winnerUserId === updatedBattle.challenger_user_id
      ? Number(updatedBattle.challenger_score || 0)
      : Number(updatedBattle.opponent_score || 0);

  const loserScore =
    winnerUserId === updatedBattle.challenger_user_id
      ? Number(updatedBattle.opponent_score || 0)
      : Number(updatedBattle.challenger_score || 0);

  const resultNotice = `Winner: <@${winnerUserId}> • +${scoringConfig.gameWinPoints} points${
    updatedBattle.status === 'completed' && loserScore === 0 && scoringConfig.sweepBonusPoints > 0
      ? ` • Sweep bonus +${scoringConfig.sweepBonusPoints}`
      : ''
  }`;

  await editBattleRoomCurrentMessage({
    battleId,
    notice: `Game ${game.game_number} complete. ${resultNotice}`,
    latestPreviewText: payload.previewText || null,
  });

  if (channel && channel.isTextBased()) {
    await channel
      .send({
        embeds: [
          buildGameResultEmbed({
            battle: updatedBattle,
            game,
            winnerUserId,
            notice: resultNotice,
          }),
        ],
      })
      .catch(() => null);
  }

  if (updatedBattle.status === 'completed') {
    if (channel) {
      scheduleBattleRoomDeletion(
        channel,
        60000,
        'Series complete. This room will close in 1 minute.',
      );
    }
    return;
  }

  await sendBattleRoomMessage({
    battleId,
    notice:
      `Game ${updatedBattle.current_game_number} is now open. The designated submitter must attach the next live Showdown link from personal controls.`,
  });
}

async function beginSpectatorWatch(battleId, game) {
  const battle = await getBattleById(battleId);
  if (!battle || !game?.showdown_room_id || !game?.showdown_link_url) {
    throw new Error('Professor Aegis is missing the live battle room details for this game.');
  }

  return startSpectatorSession({
    battleId,
    gameId: game.id,
    showdownLinkUrl: game.showdown_link_url,
    roomId: game.showdown_room_id,
    onConnected: async () => {
      await setBattleGameSpectatorState(game.id, {
        spectatorStatus: 'watching',
        connected: true,
      });

      await editBattleRoomCurrentMessage({
        battleId,
        notice:
          `Spectator connected to Game ${game.game_number}. Professor Aegis is now watching live.`,
      });
    },
    onUpdate: async (payload) => {
      await setBattleGameSpectatorState(game.id, {
        spectatorStatus: 'watching',
        detectedFormat: payload.detectedFormat || null,
        challengerShowdownName: payload.challengerShowdownName || null,
        opponentShowdownName: payload.opponentShowdownName || null,
        battleLogText: payload.battleLogText || null,
        replayUrl: payload.replayUrl || null,
      });

      if (payload.previewChanged) {
        await editBattleRoomCurrentMessage({
          battleId,
          latestPreviewText: payload.previewText || null,
        });
      }
    },
    onCompleted: async (payload) => {
      await handleSpectatorCompletion({ battleId, game, payload });
    },
    onError: async (payload) => {
      await setBattleGameSpectatorState(game.id, {
        spectatorStatus: 'error',
        connectionError: payload.error || 'The spectator connection failed.',
        disconnected: true,
        battleLogText: payload.battleLogText || null,
      });

      await editBattleRoomCurrentMessage({
        battleId,
        notice: payload.error || 'The spectator connection failed.',
      });
    },
  });
}

async function openBattleControlPanel(interaction, battle, notice = null) {
  const payload = await buildBattleControlPayload(interaction, battle, notice);
  if (interaction.replied || interaction.deferred) {
    await interaction
      .followUp({ ...payload, flags: MessageFlags.Ephemeral })
      .catch(() => null);
    return;
  }
  await interaction
    .reply({ ...payload, flags: MessageFlags.Ephemeral })
    .catch(() => null);
}

async function handlePostMenuCommand(interaction) {
  if (!isBotAdmin(interaction)) {
    await replyNotAuthorized(interaction, 'Only academy staff may use this command.');
    return;
  }

  await interaction.reply({
    embeds: [buildPublicMenuEmbed()],
    components: [buildPublicMenuRow()],
  });
}

async function handleStartSeasonCommand(interaction) {
  if (!isBotAdmin(interaction)) {
    await replyNotAuthorized(interaction, 'Only academy staff may use this command.');
    return;
  }

  const leagueState = await startLeagueSeason(new Date());
  await resetSeasonStatsForAllPlayers();
  await syncRegisteredStateForSeason(leagueState.season_number);
  queueSeasonStartedAnnouncement(client, await buildSeasonAnnouncementData(leagueState));

  await interaction.reply({
    content: `Season #${leagueState.season_number} started. First game day: ${buildDiscordTimestamp(leagueState.first_game_day_at, 'F')}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleEndSeasonCommand(interaction) {
  if (!isBotAdmin(interaction)) {
    await replyNotAuthorized(interaction, 'Only academy staff may use this command.');
    return;
  }

  const leagueState = await endLeagueSeason(new Date());
  queueSeasonEndedAnnouncement(client, await buildSeasonAnnouncementData(leagueState));

  await interaction.reply({
    content: `Season #${leagueState.season_number} ended.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleOpenTerminal(interaction) {
  await renderMainMenuShellThenHydrate(interaction, {
    path: 'academy.open',
    ackMode: 'deferReply',
  });
  return true;
}

async function handlePublicTerminalSelect(interaction) {
  const choice = interaction.values?.[0];
  if (choice !== 'open_terminal') return false;

  await renderMainMenuShellThenHydrate(interaction, {
    path: 'academy.public-open',
    ackMode: 'deferReply',
  });

  return true;
}

async function handleRunBenchMarkSuite(interaction, options = {}) {
  const benchmarkState = options.benchmarkState || await getBenchMarkTeamState(interaction.user.id);
  const suiteJobState = options.suiteJobState || await getBenchMarkSuiteJobState(interaction.user.id);
  const warmupState = options.warmupState || await getBenchMarkWarmupState();
  const benchmarkWarmupActive = options.benchmarkWarmupActive !== undefined
    ? Boolean(options.benchmarkWarmupActive)
    : isBenchMarkWarmupActive(warmupState);
  const hasSubmittedTeam = options.hasSubmittedTeam !== undefined
    ? Boolean(options.hasSubmittedTeam)
    : Boolean(cleanText(benchmarkState?.team_export));
  const hasActiveSuiteJob = options.hasActiveSuiteJob !== undefined
    ? Boolean(options.hasActiveSuiteJob)
    : ['queued', 'running'].includes(String(suiteJobState?.status || '').toLowerCase());

  if (benchmarkWarmupActive) {
    await interaction.editReply(
      await buildBenchMarkPayload(interaction, buildBenchMarkWarmupNotice(warmupState)),
    );
    return true;
  }

  if (hasActiveSuiteJob && suiteJobState?.job_id) {
    await interaction.editReply(
      await buildBenchMarkPayload(interaction, 'A benchmark suite is already active. Stop it or check its status first.'),
    );
    return true;
  }

  if (!hasSubmittedTeam) {
    await interaction.editReply(
      await buildBenchMarkPayload(interaction, 'Submit a BenchMark team export first.'),
    );
    return true;
  }

  let currentJobState = suiteJobState;

  try {
    const readiness = await getBenchMarkWorkerReadiness();
    if (!readiness?.ready) {
      const detailText = cleanText(readiness?.detailText || readiness?.statusText || 'BenchMark execution path is not ready yet.');
      await interaction.editReply(
        await buildBenchMarkPayload(
          interaction,
          `BenchMark is still starting up. ${detailText} Try again after the worker says ready.`,
        ),
      );
      return true;
    }

    const savedConfig = await getBenchMarkSuiteConfig(interaction.user.id);
    const requestConfig = {
      mode: savedConfig.mode,
      sample_size: savedConfig.sample_size,
      battle_budget: savedConfig.battle_budget,
      format_id: savedConfig.format_id,
      team_hash: buildBenchMarkSuiteTeamHash(benchmarkState.team_export),
    };
    requestConfig.games_per_opponent = normalizeBenchMarkSuiteGamesPerOpponent(
      savedConfig.games_per_opponent,
      requestConfig.format_id,
    );
    const requestTargetOpponentCount = getBenchMarkSuiteTargetCount(requestConfig.mode);
    const requestInitialOpponentCount = getBenchMarkSuiteInitialOpponentCount(requestConfig.mode, requestConfig.sample_size);
    const requestFixedPoolMode = isBenchMarkSuiteFixedPoolMode(requestConfig.mode);
    const requestSweepMode = isBenchMarkSuiteSweepMode(requestConfig.mode);
    const requestSweepModeLabel = getBenchMarkSuiteSweepModeLabel(requestConfig.mode);
    const requestSelectionSummarySeed = getBenchMarkSuiteSelectionSummarySeed(requestConfig);
    const requestAllocatedGamesPerOpponent = getBenchMarkSuiteAllocatedGamesPerOpponent(
      requestInitialOpponentCount,
      requestConfig.battle_budget,
    );
    const requestExpectedTotalGames = getBenchMarkSuiteExpectedTotalGames(
      requestInitialOpponentCount,
      requestConfig.battle_budget,
    );

    if (requestConfig.format_id !== BENCHMARK_SUITE_CHAMPIONS_FORMAT_ID) {
      await setBenchMarkSuiteConfig(interaction.user.id, { format_id: BENCHMARK_SUITE_CHAMPIONS_FORMAT_ID });
      await interaction.editReply(
        await buildBenchMarkSuiteConfigPayload(
          interaction,
          'Standard is coming later. Champions is the only runnable Battle Simulator format right now.',
        ),
      );
      return true;
    }

    currentJobState = await setBenchMarkSuiteJobState(interaction.user.id, {
      job_id: null,
      status: 'queued',
      submitted_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      error: null,
      progress: {
        phase: 'submitting',
        percent: 0,
        progressBar: '[--------------------] 0%',
        currentStep: `Submitting ${humanizeBenchMarkSuiteMode(requestConfig.mode)} to worker`,
        processedGames: 0,
        totalGames: requestExpectedTotalGames,
        processedOpponents: 0,
        totalOpponents: requestInitialOpponentCount || 0,
        remainingOpponents: requestInitialOpponentCount || null,
        failedOpponents: 0,
        battleBudget: requestConfig.battle_budget,
        battlesPerMatchup: requestConfig.battle_budget,
        allocatedGamesPerOpponent: requestAllocatedGamesPerOpponent,
        expectedTotalGames: requestExpectedTotalGames,
        sweepMode: requestSweepMode,
        sweepModeLabel: requestSweepModeLabel,
        sampleSizeIgnored: requestFixedPoolMode,
        excludesUserTeams: requestSweepMode,
        currentOpponent: null,
      },
      request: requestConfig,
      format_id: requestConfig.format_id,
      benchmark_mode: requestConfig.mode,
      selection_summary: requestSelectionSummarySeed,
    });

    await interaction.editReply(
      await buildBenchMarkPayload(
        interaction,
        `Submitting benchmark suite with ${formatBenchMarkSuiteConfigText(requestConfig)}...`,
      ),
    );

    const suiteTeamExport = convertChampionsSpTeamExportForShowdown(
      benchmarkState.team_export,
      requestConfig.format_id,
    );

    const queued = await submitBenchmarkSuiteJob({
      userId: interaction.user.id,
      teamExport: suiteTeamExport,
      teamHash: requestConfig.team_hash,
      mode: requestConfig.mode,
      sampleSize: getBenchMarkSuiteRequestedSampleSize(requestConfig.mode, requestConfig.sample_size),
      battleBudget: requestConfig.battle_budget,
      gamesPerOpponent: requestConfig.games_per_opponent,
      formatId: requestConfig.format_id,
    });

    const selectionSummary = queued.selectionSummary || {
      requestedSampleSize: getBenchMarkSuiteRequestedSampleSize(requestConfig.mode, requestConfig.sample_size),
      selectionSeed: null,
      availableOpponents: null,
      targetOpponentCount: requestTargetOpponentCount,
      sampleSizeIgnored: requestFixedPoolMode,
      battleBudget: requestConfig.battle_budget,
      battlesPerMatchup: requestConfig.battle_budget,
      battleBudgetAllocationRule: 'championslab-min-one-per-opponent-floor-budget',
      allocatedGamesPerOpponent: requestAllocatedGamesPerOpponent,
      expectedTotalGames: requestExpectedTotalGames,
      sweepMode: requestSweepMode,
      sweepModeLabel: requestSweepModeLabel,
      excludesUserTeams: requestSweepMode,
    };

    const requestedSampleSize = getBenchMarkSuiteRequestedSampleSize(requestConfig.mode, requestConfig.sample_size);
    const selectedCount = Number.isFinite(Number(selectionSummary?.selectedCount))
      ? Number(selectionSummary.selectedCount)
      : (Number.isFinite(Number(queued?.selectedOpponents)) ? Number(queued.selectedOpponents) : null);
    const availableOpponents = Number.isFinite(Number(selectionSummary?.availableOpponents))
      ? Number(selectionSummary.availableOpponents)
      : null;
    const effectiveOpponents = requestFixedPoolMode
      ? (selectedCount ?? availableOpponents)
      : (selectedCount ?? (availableOpponents !== null ? Math.min(requestedSampleSize || 0, availableOpponents) : requestedSampleSize));

    const derivedProgress = {
      ...(currentJobState?.progress || {}),
      ...(queued.progress || {}),
    };

    if (effectiveOpponents !== null) {
      const effectiveAllocatedGamesPerOpponent = Number.isFinite(Number(selectionSummary?.allocatedGamesPerOpponent))
        ? Number(selectionSummary.allocatedGamesPerOpponent)
        : getBenchMarkSuiteAllocatedGamesPerOpponent(effectiveOpponents, requestConfig.battle_budget);
      const effectiveTotalGames = Number.isFinite(Number(selectionSummary?.expectedTotalGames))
        ? Number(selectionSummary.expectedTotalGames)
        : getBenchMarkSuiteExpectedTotalGames(effectiveOpponents, requestConfig.battle_budget);
      derivedProgress.totalOpponents = effectiveOpponents;
      derivedProgress.totalGames = effectiveTotalGames;
      derivedProgress.remainingOpponents = effectiveOpponents;
      derivedProgress.failedOpponents = 0;
      derivedProgress.battleBudget = requestConfig.battle_budget;
      derivedProgress.battlesPerMatchup = requestConfig.battle_budget;
      derivedProgress.allocatedGamesPerOpponent = effectiveAllocatedGamesPerOpponent;
      derivedProgress.expectedTotalGames = effectiveTotalGames;
    }

    if (requestFixedPoolMode) {
      derivedProgress.sampleSizeIgnored = true;
      derivedProgress.sweepMode = requestSweepMode;
      derivedProgress.sweepModeLabel = requestSweepModeLabel;
      derivedProgress.excludesUserTeams = requestSweepMode;
      derivedProgress.currentStep = effectiveOpponents
        ? `Queued ${humanizeBenchMarkSuiteMode(requestConfig.mode)}: ${effectiveOpponents} tournament teams`
        : `Queued ${humanizeBenchMarkSuiteMode(requestConfig.mode)}: resolving tournament pool`;
    }

    currentJobState = await setBenchMarkSuiteJobState(interaction.user.id, {
      job_id: queued.jobId || null,
      status: queued.status || 'queued',
      submitted_at: queued.submittedAt || new Date().toISOString(),
      started_at: null,
      completed_at: null,
      error: null,
      progress: derivedProgress,
      request: requestConfig,
      format_id: queued.formatId || requestConfig.format_id,
      benchmark_mode: queued.benchmarkMode || requestConfig.mode,
      selection_summary: selectionSummary,
    });

    const cappedNotice = (requestedSampleSize !== null && effectiveOpponents !== null && effectiveOpponents < requestedSampleSize)
      ? ` ⚠️ Requested ${requestedSampleSize} opponents, but only ${effectiveOpponents} are available in ${humanizeBenchMarkSuiteMode(requestConfig.mode)} right now, so the suite was capped automatically.`
      : '';

    await interaction.editReply(
      await buildBenchMarkPayload(
        interaction,
        `Matchup report queued with ${formatBenchMarkSuiteConfigText({ ...requestConfig, sample_size: effectiveOpponents ?? requestConfig.sample_size })}. Live progress will update here automatically.${cappedNotice}`,
      ),
    );

    if (currentJobState?.job_id) {
      void startBenchMarkSuitePoller(interaction, currentJobState.job_id);
    }
  } catch (error) {
    const fallbackJobId = currentJobState?.job_id || null;
    const fallbackNotice = error?.message || 'Matchup report request failed.';

    if (isBenchMarkWorkerTimeoutError(error)) {
      await setBenchMarkSuiteJobState(interaction.user.id, {
        job_id: fallbackJobId,
        status: fallbackJobId ? 'queued' : 'idle',
        error: null,
        progress: currentJobState?.progress || null,
        request: currentJobState?.request || null,
        format_id: currentJobState?.format_id || null,
        benchmark_mode: currentJobState?.benchmark_mode || null,
        selection_summary: currentJobState?.selection_summary || null,
      });
      await interaction.editReply(
        await buildBenchMarkPayload(
          interaction,
          fallbackJobId
            ? '⚠️ Suite submission took longer than expected to confirm, but the job may still be running. Use Check Matchup Report if this panel stops updating.'
            : '⚠️ Suite submission took longer than expected to confirm. Give it a few seconds, then run the BenchMark tool you were trying again or use Check Matchup Report to verify whether it queued.',
        ),
      );
    } else {
      await setBenchMarkSuiteJobState(interaction.user.id, {
        job_id: fallbackJobId,
        status: fallbackJobId ? 'queued' : 'failed',
        error: fallbackJobId ? null : fallbackNotice,
        progress: currentJobState?.progress || null,
        request: currentJobState?.request || null,
        format_id: currentJobState?.format_id || null,
        benchmark_mode: currentJobState?.benchmark_mode || null,
        selection_summary: currentJobState?.selection_summary || null,
      });
      await interaction.editReply(
        await buildBenchMarkPayload(
          interaction,
          fallbackJobId
            ? '⚠️ The suite was submitted, but the confirmation path glitched. Use Check Matchup Report to refresh it.'
            : `⚠️ ${fallbackNotice}`,
        ),
      );
    }
  }

  return true;
}

async function handleScopedStringSelect(interaction) {
  const ownerCheck = await ensureScopedOwnership(interaction);
  if (!ownerCheck.ok) return true;

  const { base, parts } = ownerCheck.parsed;
  const value = interaction.values?.[0];

  if (base === 'main_menu_select') {
    if (value === 'menu_registrations') {
      await renderAcademySectionShellThenHydrate(interaction, value, () => buildRegistrationsPayload(interaction));
      return true;
    }
    if (value === 'menu_profile') {
      await renderAcademySectionShellThenHydrate(interaction, value, () => buildProfilePayload(interaction));
      return true;
    }
    if (value === 'menu_teams') {
      await renderAcademySectionShellThenHydrate(interaction, value, () => buildTeamsPayload(interaction));
      return true;
    }
    if (value === 'menu_league') {
      await renderAcademySectionShellThenHydrate(interaction, value, () => buildLeaguePayload(interaction));
      return true;
    }
    if (value === 'menu_battle') {
      await renderAcademySectionShellThenHydrate(interaction, value, () => buildBattlePayload(interaction));
      return true;
    }
    if (value === 'menu_benchmark') {
      await renderBenchMarkMenuShellThenHydrate(interaction, {
        path: 'benchmark.open',
        ackMode: 'deferUpdate',
      });
      scheduleBenchMarkWarmupPollerIfActive(interaction);
      return true;
    }
    if (value === 'menu_admin') {
      if (!isBotAdmin(interaction)) {
        await replyNotAuthorized(interaction, 'Only academy staff may use admin controls.');
        return true;
      }
      await renderAcademySectionShellThenHydrate(interaction, value, () => buildAdminPayload(interaction));
      return true;
    }
  }

  if (base === 'registrations_select') {
    const leagueState = await getLeagueState();
    const targetSeasonNumber = resolveRegistrationSeasonNumber(leagueState);
    const existing = await getSeasonTeamForSeason(interaction.user.id, targetSeasonNumber);

    if (value === 'registration_create' || value === 'registration_edit') {
      if (leagueState.league_active) {
        await replyNotAuthorized(
          interaction,
          'Registrations are locked once the season has started.',
        );
        return true;
      }

      await interaction.showModal(
        buildRegistrationTeamModal({
          ownerId: interaction.user.id,
          seasonNumber: targetSeasonNumber,
          existingTeam: existing
            ? {
                ...existing,
                showdown_name: (await getPlayerById(interaction.user.id))?.showdown_name || '',
              }
            : null,
        }),
      );
      return true;
    }

    if (value === 'registration_view') {
      if (!existing) {
        await replyNotAuthorized(interaction, 'No submitted team is on file yet.');
        return true;
      }

      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle(`📝 Professor Aegis • ${existing.team_name}`)
            .setDescription(
              [
                `**Season:** #${existing.season_number}`,
                `**Showdown Name:** ${(await getPlayerById(interaction.user.id))?.showdown_name || 'Not set'}`,
                '',
                formatTeamCodeBlock(existing.team_export),
              ].join('\n'),
            ),
        ],
        components: [
          buildRegistrationsMenuRow({
            ownerId: interaction.user.id,
            registrationOpen: !leagueState.league_active,
            hasSubmittedTeam: true,
          }),
        ],
      });
      return true;
    }

    if (value === 'registration_delete') {
      if (leagueState.league_active) {
        await replyNotAuthorized(
          interaction,
          'Registrations are locked once the season has started.',
        );
        return true;
      }

      await deleteSeasonTeamForSeason(interaction.user.id, targetSeasonNumber);
      await syncRegisteredStateForSeason(targetSeasonNumber);
      await interaction.update(
        await buildRegistrationsPayload(interaction, 'Registration removed.'),
      );
      return true;
    }

    if (value === 'back_main') {
      await interaction.update(await buildMainMenuPayload(interaction));
      return true;
    }
  }

  if (base === 'profile_select') {
    if (value === 'profile_self') {
      await interaction.update({
        embeds: [buildProfileEmbed({ player: await getPlayerStats(interaction.user.id), heading: 'My Profile' })],
        components: [buildProfileMenuRow({ ownerId: interaction.user.id })],
      });
      return true;
    }

    if (value === 'profile_other') {
      const players = (await getAcademyPlayers()).filter(
        (player) => player.user_id !== interaction.user.id,
      );

      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔎 Professor Aegis • Select a Trainer')
            .setDescription('Choose a trainer below to open their profile.'),
        ],
        components: [
          buildTrainerSelectRow({
            ownerId: interaction.user.id,
            base: 'profile_trainer_select',
            placeholder: 'Choose a trainer profile.',
            players,
          }),
        ],
      });
      return true;
    }

    if (value === 'back_main') {
      await interaction.update(await buildMainMenuPayload(interaction));
      return true;
    }
  }

  if (base === 'profile_trainer_select') {
    if (value === 'back') {
      await interaction.update(await buildProfilePayload(interaction));
      return true;
    }

    const player = await getPlayerById(value);
    if (!player) {
      await replyNotAuthorized(interaction, 'That trainer profile could not be found.');
      return true;
    }

    await interaction.update({
      embeds: [buildProfileEmbed({ player, heading: `${player.username}'s Profile` })],
      components: [buildProfileMenuRow({ ownerId: interaction.user.id })],
    });
    return true;
  }

  if (base === 'teams_select') {
    if (value === 'teams_self') {
      const seasons = await listTeamSeasonsForUser(interaction.user.id);
      if (!seasons.length) {
        await interaction.update({
          embeds: [
            buildNoTeamsEmbed({
              username: interaction.member?.displayName || interaction.user.username,
            }),
          ],
          components: [buildTeamsMenuRow({ ownerId: interaction.user.id })],
        });
        return true;
      }

      await interaction.update({
        embeds: [
          buildViewTrainerTeamsEmbed({
            username: interaction.member?.displayName || interaction.user.username,
            seasons,
          }),
        ],
        components: [
          buildTeamSeasonSelectRow({
            ownerId: interaction.user.id,
            trainerUserId: interaction.user.id,
            seasons,
          }),
        ],
      });
      return true;
    }

    if (value === 'teams_other') {
      const players = (await getAcademyPlayers()).filter(
        (player) => player.user_id !== interaction.user.id,
      );

      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle('🔎 Professor Aegis • Select a Trainer')
            .setDescription('Choose a trainer below to browse their season teams.'),
        ],
        components: [
          buildTrainerSelectRow({
            ownerId: interaction.user.id,
            base: 'teams_trainer_select',
            placeholder: 'Choose a trainer team archive.',
            players,
          }),
        ],
      });
      return true;
    }

    if (value === 'back_main') {
      await interaction.update(await buildMainMenuPayload(interaction));
      return true;
    }
  }

  if (base === 'teams_trainer_select') {
    if (value === 'back') {
      await interaction.update(await buildTeamsPayload(interaction));
      return true;
    }

    const player = await getPlayerById(value);
    const seasons = await listTeamSeasonsForUser(value);

    if (!player || !seasons.length) {
      await interaction.update({
        embeds: [buildNoTeamsEmbed({ username: player?.username || 'Unknown Trainer' })],
        components: [buildTeamsMenuRow({ ownerId: interaction.user.id })],
      });
      return true;
    }

    await interaction.update({
      embeds: [buildViewTrainerTeamsEmbed({ username: player.username, seasons })],
      components: [
        buildTeamSeasonSelectRow({
          ownerId: interaction.user.id,
          trainerUserId: value,
          seasons,
        }),
      ],
    });
    return true;
  }

  if (base === 'team_season_select') {
    const trainerUserId = parts[0];

    if (value === 'back') {
      await interaction.update(await buildTeamsPayload(interaction));
      return true;
    }

    const seasonTeam = await getSeasonTeamForSeason(trainerUserId, Number(value));
    const player = await getPlayerById(trainerUserId);
    const seasons = await listTeamSeasonsForUser(trainerUserId);

    if (!seasonTeam || !player) {
      await replyNotAuthorized(interaction, 'That season team could not be found.');
      return true;
    }

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`🧾 Professor Aegis • ${player.username}'s Season #${seasonTeam.season_number} Team`)
      .setDescription(
        [
          `**Team Name:** ${seasonTeam.team_name}`,
          `**Updated:** ${seasonTeam.updated_at}`,
          '',
          formatTeamCodeBlock(seasonTeam.team_export),
        ].join('\n'),
      );

    await interaction.update({
      embeds: [embed],
      components: [
        buildTeamSeasonSelectRow({
          ownerId: interaction.user.id,
          trainerUserId,
          seasons,
        }),
      ],
    });
    return true;
  }

  if (base === 'league_select') {
    if (value === 'leaderboard') {
      await interaction.update({
        embeds: [buildLeaderboardEmbed(await getTopPlayers(25))],
        components: [buildLeagueMenuRow({ ownerId: interaction.user.id })],
      });
      return true;
    }

    if (value === 'my_record') {
      await interaction.update({
        embeds: [buildMyLeagueEmbed({ player: await getPlayerStats(interaction.user.id) })],
        components: [buildLeagueMenuRow({ ownerId: interaction.user.id })],
      });
      return true;
    }

    if (value === 'league_other') {
      const players = (await getAcademyPlayers()).filter(
        (player) => player.user_id !== interaction.user.id,
      );

      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('🔎 Professor Aegis • Select a Trainer')
            .setDescription('Choose a trainer below to inspect their league record.'),
        ],
        components: [
          buildTrainerSelectRow({
            ownerId: interaction.user.id,
            base: 'league_trainer_select',
            placeholder: 'Choose a trainer league record.',
            players,
          }),
        ],
      });
      return true;
    }

    if (value === 'back_main') {
      await interaction.update(await buildMainMenuPayload(interaction));
      return true;
    }
  }

  if (base === 'league_trainer_select') {
    if (value === 'back') {
      await interaction.update(await buildLeaguePayload(interaction));
      return true;
    }

    const player = await getPlayerById(value);
    if (!player) {
      await replyNotAuthorized(interaction, 'That trainer record could not be found.');
      return true;
    }

    await interaction.update({
      embeds: [buildTrainerLeagueEmbed({ player, heading: `${player.username}'s League Record` })],
      components: [buildLeagueMenuRow({ ownerId: interaction.user.id })],
    });
    return true;
  }

  if (base === 'battle_select') {
    if (value === 'open_challengers') {
      const { battleOverrideEnabled } = await getBattleDeskStatus(interaction);

      if (!battleOverrideEnabled && !isBattleWindowOpenNow()) {
        await replyNotAuthorized(
          interaction,
          'Battle access is closed outside the Saturday battle window unless Battle Override is enabled.',
        );
        return true;
      }

      const players = await getRegisteredOpponents(interaction.user.id);
      await interaction.update({
        embeds: [buildBattleOpenChallengersEmbed(players)],
        components: [buildBattleOpponentSelectRow({ ownerId: interaction.user.id, players })],
      });
      return true;
    }

    if (value === 'open_current_room') {
      const unresolved = await getLatestUnresolvedBattleForUser(interaction.user.id);
      const notice = unresolved
        ? await getRoomJumpText(unresolved)
        : 'No unresolved battle room exists right now.';

      await interaction.update(await buildBattlePayload(interaction, notice));
      return true;
    }

    if (value === 'back_main') {
      await interaction.update(await buildMainMenuPayload(interaction));
      return true;
    }
  }

  if (base === 'battle_opponent_select') {
    if (value === 'back') {
      await interaction.update(await buildBattlePayload(interaction));
      return true;
    }

    const leagueState = await getLeagueState();
    const battleOverrideEnabled = await getBattleTestMode();

    const battleWindowKey = battleOverrideEnabled
      ? `override-${Date.now()}`
      : getBattleWindowKey(new Date());

    try {
      const challenger = await getPlayerById(interaction.user.id);
      const opponent = await getPlayerById(value);

      const battle = await createBattleChallenge({
        seasonNumber: resolveRegistrationSeasonNumber(leagueState),
        battleWindowKey,
        challengerUserId: interaction.user.id,
        challengerUsername:
          challenger?.username || interaction.member?.displayName || interaction.user.username,
        opponentUserId: value,
        opponentUsername: opponent?.username || 'Unknown Trainer',
      });

      const room = await createBattleRoomChannel(interaction, battle);
      await setBattleRoomInfo(battle.id, room.id, null);

      await sendBattleRoomMessage({
        battleId: battle.id,
        notice:
          `Challenge issued. Defender, open personal controls from the dropdown below to accept or decline.`,
      });

      await interaction.update(
        await buildBattlePayload(
          interaction,
          `Challenge sent. Private room created: <#${room.id}>.`,
        ),
      );
      return true;
    } catch (error) {
      await interaction.update(
        await buildBattlePayload(
          interaction,
          error.message || 'Professor Aegis could not create that battle room.',
        ),
      );
      return true;
    }
  }

  if (base === 'benchmark_select') {
    if (value === 'submit_team') {
      const benchmarkState = await resolveWithTimeoutOrNull(
        getBenchMarkTeamState(interaction.user.id),
        BENCHMARK_MODAL_PREFILL_TIMEOUT_MS,
        'submit-team modal prefill',
      );
      await interaction.showModal(
        buildBenchMarkTeamModal({
          ownerId: interaction.user.id,
          existingTeamExport: benchmarkState?.team_export || '',
        }),
      );
      return true;
    }

    if (value === 'back_main') {
      await renderMainMenuShellThenHydrate(interaction, {
        path: 'benchmark.back-main',
        ackMode: 'deferUpdate',
      });
      return true;
    }

    if (value === 'configure_benchmark_suite') {
      await renderMenuShellThenHydrate(interaction, {
        path: 'benchmark.settings',
        hydrationKey: `benchmark:${interaction.user.id}`,
        ackMode: 'deferUpdate',
        shellPayload: () => buildBenchMarkSuiteConfigShellPayload(interaction, 'Opening Battle Simulator settings...'),
        hydratePayload: async () => {
          const { benchmarkState, warmupState } = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
          if (isBenchMarkWarmupActive(warmupState)) {
            return buildBenchMarkPayload(interaction, buildBenchMarkWarmupNotice(warmupState));
          }
          if (!cleanText(benchmarkState?.team_export)) {
            return buildBenchMarkPayload(interaction, 'Submit a BenchMark team export first.');
          }
          return buildBenchMarkSuiteConfigPayload(interaction);
        },
      });
      return true;
    }

    if (value === 'instant_mode_shell') {
      await renderMenuShellThenHydrate(interaction, {
        path: 'benchmark.instant-preview',
        hydrationKey: `benchmark:${interaction.user.id}`,
        ackMode: 'deferUpdate',
        shellPayload: () => ({
          content: '',
          embeds: [
            buildBenchMarkInstantModeShellEmbed({
              username: interaction.member?.displayName || interaction.user.username,
              notice: 'Opening Instant Mode Preview...',
            }),
          ],
          components: [buildBenchMarkInstantModeShellRow({ ownerId: interaction.user.id })],
          files: [],
        }),
        hydratePayload: async () => {
          const { benchmarkState } = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
          if (!cleanText(benchmarkState?.team_export)) {
            return buildBenchMarkPayload(interaction, 'Submit a Battle Simulator team export before opening Instant Mode Preview.');
          }
          return {
            content: '',
            embeds: [
              buildBenchMarkInstantModeShellEmbed({
                username: interaction.member?.displayName || interaction.user.username,
              }),
            ],
            components: [buildBenchMarkInstantModeShellRow({ ownerId: interaction.user.id })],
            files: [],
          };
        },
      });
      return true;
    }

    if (value === 'view_last_benchmark_suite') {
      await renderMenuShellThenHydrate(interaction, {
        path: 'benchmark.report.latest.open',
        hydrationKey: `benchmark:${interaction.user.id}:latest-report`,
        ackMode: 'deferUpdate',
        shellPayload: () => buildBenchMarkSuiteReportShellPayload(interaction, {
          reportTab: 'overview',
          notice: 'Opening the latest Simulation Report...',
        }),
        hydratePayload: () => buildLatestBenchMarkSuiteReportPayload(interaction, 'overview'),
      });
      return true;
    }

    if (value === 'simulation_history' || value === 'simulation_history_placeholder') {
      await interaction.deferUpdate();
      const { benchmarkState, lastSuiteReportState } = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
      const isHistoryAvailable = await hasBenchMarkPreviousSuiteHistory(
        interaction.user.id,
        lastSuiteReportState,
        benchmarkState,
      );
      if (!isHistoryAvailable) {
        await interaction.editReply(await buildBenchMarkPayload(interaction, BENCHMARK_HISTORY_EMPTY_NOTICE));
        return true;
      }

      await renderMenuShellThenHydrate(interaction, {
        path: 'benchmark.history.open',
        hydrationKey: `benchmark:${interaction.user.id}:history`,
        ackMode: 'none',
        shellPayload: () => buildBenchMarkHistoryShellPayload(interaction, 'Opening previous Simulation Reports...'),
        hydratePayload: () => buildBenchMarkHistoryMenuPayload(interaction),
      });
      return true;
    }

    if (value === 'load_team') {
      return showBenchMarkLoadTeamSelector(interaction);
    }

    await interaction.deferUpdate();

    const {
      benchmarkState,
      jobState,
      matchupJobState,
      suiteJobState,
      lastReportState,
      lastMatchupEvalState,
      warmupState,
      lastSuiteReportState,
    } = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
    const hasSubmittedTeam = Boolean(cleanText(benchmarkState?.team_export));
    const hasLastReport = Boolean(lastReportState?.has_report || lastReportState?.report_id);
    const hasLastMatchupEval = Boolean(lastMatchupEvalState?.has_report || lastMatchupEvalState?.report_id);
    const hasLastSuiteReport = Boolean(lastSuiteReportState?.has_report || lastSuiteReportState?.report_id);
    const hasActiveJob = ['queued', 'running'].includes(String(jobState?.status || '').toLowerCase());
    const hasActiveMatchupJob = ['queued', 'running'].includes(String(matchupJobState?.status || '').toLowerCase());
    const hasActiveSuiteJob = ['queued', 'running'].includes(String(suiteJobState?.status || '').toLowerCase());
    const benchmarkWarmupActive = isBenchMarkWarmupActive(warmupState);
    const menuSnapshot = getCachedBenchMarkMenuSnapshot(interaction.user.id);
    const hasHistoryProfiles = Boolean(menuSnapshot?.hasHistoryProfiles || hasLastSuiteReport || !menuSnapshot);
    if (!hasActiveJob && !hasActiveMatchupJob && !hasActiveSuiteJob) {
      scheduleBenchMarkMenuSnapshotRefresh(interaction.user.id);
    }

    const sharedRowProps = {
      ownerId: interaction.user.id,
      hasSubmittedTeam,
      hasLastReport,
      hasActiveJob,
      hasLastMatchupEval,
      hasActiveMatchupJob,
      hasLastSuiteReport,
      hasActiveSuiteJob,
      hasMatchArchiveReady: hasActiveSuiteJob ? false : Boolean(lastSuiteReportState?.has_match_archive),
      benchmarkWarmupActive,
      hasHistoryProfiles,
    };

    if (value === 'benchmark_warmup_wait') {
      await interaction.editReply(
        await buildBenchMarkPayload(interaction, buildBenchMarkWarmupNotice(warmupState)),
      );
      if (benchmarkWarmupActive) {
        void startBenchMarkWarmupUiPoller(interaction);
      }
      return true;
    }

    if (value === 'view_team') {
      if (!hasSubmittedTeam) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, 'No Battle Simulator team is on file yet.'),
        );
        return true;
      }

      const suiteConfig = await getBenchMarkSuiteConfig(interaction.user.id);
      const displayTeamExport = buildBenchMarkSubmittedTeamDisplayExport(
        benchmarkState.team_export,
        suiteConfig.format_id,
      );
      const submittedTeamExportRow = buildBenchMarkSubmittedTeamExportRow({
        ownerId: interaction.user.id,
        hasSubmittedTeam,
        hasHistoryProfiles,
      });

      await interaction.editReply({
        embeds: [
          buildBenchMarkSubmittedTeamEmbed({
            username: interaction.member?.displayName || interaction.user.username,
            teamExport: displayTeamExport,
            updatedAtText: benchmarkState.updated_at,
          }),
        ],
        components: [
          ...buildBenchMarkMenuComponents({
            ...sharedRowProps,
            hasMatchArchiveReady: false,
          }),
          submittedTeamExportRow,
        ].filter(Boolean),
      });
      return true;
    }

    if (value === 'run_report') {
      if (benchmarkWarmupActive) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, buildBenchMarkWarmupNotice(warmupState)),
        );
        return true;
      }

      if (!hasSubmittedTeam) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, 'Submit a BenchMark team export first.'),
        );
        return true;
      }

      try {
        let currentJobState = jobState;
        let status = null;

        if (hasActiveJob && currentJobState?.job_id) {
          status = await getWeaknessReportJobStatus(currentJobState.job_id);
        } else {
          const queued = await submitWeaknessReportJob({
            userId: interaction.user.id,
            teamExport: benchmarkState.team_export,
          });

          currentJobState = await setBenchMarkJobState(interaction.user.id, {
            job_id: queued.jobId || null,
            status: queued.status || 'queued',
            submitted_at: queued.submittedAt || new Date().toISOString(),
            started_at: null,
            completed_at: null,
            error: null,
          });

          await new Promise((resolve) => setTimeout(resolve, 1200));
          status = await getWeaknessReportJobStatus(currentJobState.job_id);
        }

        await setBenchMarkJobState(interaction.user.id, {
          job_id: status?.jobId || currentJobState?.job_id || null,
          status: status?.status || currentJobState?.status || 'queued',
          submitted_at: status?.submittedAt || currentJobState?.submitted_at || null,
          started_at: status?.startedAt || currentJobState?.started_at || null,
          completed_at: status?.completedAt || currentJobState?.completed_at || null,
          error: status?.error || null,
        });

        if (status?.status === 'completed' && status?.report) {
          await setBenchMarkLastReport(interaction.user.id, status.report);
          await interaction.editReply({
            embeds: [
              buildBenchMarkReportEmbed({
                username: interaction.member?.displayName || interaction.user.username,
                report: status.report,
              }),
            ],
            components: [
              buildBenchMarkMenuRow({
                ...sharedRowProps,
                hasLastReport: true,
                hasActiveJob: false,
              }),
            ],
          });
          return true;
        }

        const waitingText = status?.status === 'running'
          ? 'BenchMark is still reading your team and building the weakness report.'
          : 'BenchMark queued your weakness report. Check again in a moment.';

        await interaction.editReply(await buildBenchMarkPayload(interaction, waitingText));
      } catch (error) {
        await setBenchMarkJobState(interaction.user.id, {
          status: 'failed',
          error: error?.message || 'BenchMark worker request failed.',
        });
        await interaction.editReply(
          await buildBenchMarkPayload(
            interaction,
            error?.message || 'BenchMark worker request failed.',
          ),
        );
      }
      return true;
    }

    if (value === 'run_matchup_eval') {
      if (benchmarkWarmupActive) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, buildBenchMarkWarmupNotice(warmupState)),
        );
        return true;
      }

      if (!hasSubmittedTeam) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, 'Submit a BenchMark team export first.'),
        );
        return true;
      }

      try {
        let currentJobState = matchupJobState;
        let status = null;

        if (hasActiveMatchupJob && currentJobState?.job_id) {
          status = await getWeaknessReportJobStatus(currentJobState.job_id);
        } else {
          const queued = await submitMatchupEvalJob({
            userId: interaction.user.id,
            teamExport: benchmarkState.team_export,
            templateKeys: [],
            battleCount: 20,
          });

          currentJobState = await setBenchMarkMatchupJobState(interaction.user.id, {
            job_id: queued.jobId || null,
            status: queued.status || 'queued',
            submitted_at: queued.submittedAt || new Date().toISOString(),
            started_at: null,
            completed_at: null,
            error: null,
          });

          await new Promise((resolve) => setTimeout(resolve, 1200));
          status = await getWeaknessReportJobStatus(currentJobState.job_id);
        }

        await setBenchMarkMatchupJobState(interaction.user.id, {
          job_id: status?.jobId || currentJobState?.job_id || null,
          status: status?.status || currentJobState?.status || 'queued',
          submitted_at: status?.submittedAt || currentJobState?.submitted_at || null,
          started_at: status?.startedAt || currentJobState?.started_at || null,
          completed_at: status?.completedAt || currentJobState?.completed_at || null,
          error: status?.error || null,
        });

        if (status?.status === 'completed' && status?.report) {
          await setBenchMarkLastMatchupEval(interaction.user.id, status.report);
          await interaction.editReply({
            embeds: [
              buildBenchMarkMatchupEvalEmbed({
                username: interaction.member?.displayName || interaction.user.username,
                report: status.report,
              }),
            ],
            components: [
              buildBenchMarkMenuRow({
                ...sharedRowProps,
                hasLastMatchupEval: true,
                hasActiveMatchupJob: false,
              }),
            ],
          });
          return true;
        }

        const waitingText = status?.status === 'running'
          ? 'BenchMark is planning archetype matchup tests for your team.'
          : 'BenchMark queued your matchup eval. Check again in a moment.';

        await interaction.editReply(await buildBenchMarkPayload(interaction, waitingText));
      } catch (error) {
        await setBenchMarkMatchupJobState(interaction.user.id, {
          status: 'failed',
          error: error?.message || 'BenchMark matchup-eval request failed.',
        });
        await interaction.editReply(
          await buildBenchMarkPayload(
            interaction,
            error?.message || 'BenchMark matchup-eval request failed.',
          ),
        );
      }
      return true;
    }


    if (value === 'check_benchmark_suite') {
      if (benchmarkWarmupActive) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, buildBenchMarkWarmupNotice(warmupState)),
        );
        return true;
      }

      if (!suiteJobState?.job_id) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, 'No benchmark suite job is currently on file.'),
        );
        return true;
      }

      try {
        const status = await getBenchmarkJobStatus(suiteJobState.job_id, { includeReport: false });
        await persistBenchMarkSuiteStatus(interaction.user.id, suiteJobState, status);
        clearBenchMarkMenuPayloadCache(interaction.user.id);

        if (status?.status === 'completed') {
          await openCompletedBenchMarkSuiteReport(interaction, {
            jobId: suiteJobState.job_id,
            currentJobState: suiteJobState,
            status,
            sharedRowProps,
          });
          return true;
        }

        await interaction.editReply(
          await buildBenchMarkPayload(interaction, buildBenchMarkSuiteNotice(status)),
        );

        if (['queued', 'running', 'cancelling'].includes(String(status?.status || '').toLowerCase()) && suiteJobState?.job_id) {
          void startBenchMarkSuitePoller(interaction, suiteJobState.job_id);
        }
      } catch (error) {
        await interaction.editReply(
          await buildBenchMarkPayload(
            interaction,
            error?.message || 'Matchup report status check failed.',
          ),
        );
      }
      return true;
    }

    if (value === 'stop_benchmark_suite') {
      if (benchmarkWarmupActive) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, buildBenchMarkWarmupNotice(warmupState)),
        );
        return true;
      }

      if (!suiteJobState?.job_id || !hasActiveSuiteJob) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, 'No active benchmark suite is running right now.'),
        );
        return true;
      }

      try {
        await cancelBenchmarkJob(suiteJobState.job_id).catch(() => null);

        await setBenchMarkSuiteJobState(interaction.user.id, {
          job_id: null,
          status: 'cancelled',
          submitted_at: suiteJobState?.submitted_at || null,
          started_at: suiteJobState?.started_at || null,
          completed_at: new Date().toISOString(),
          error: null,
          progress: {
            ...(suiteJobState?.progress || {}),
            phase: 'cancelled',
            currentStep: 'Stopped by user',
          },
          request: suiteJobState?.request || null,
          format_id: suiteJobState?.format_id || null,
          benchmark_mode: suiteJobState?.benchmark_mode || null,
          selection_summary: suiteJobState?.selection_summary || null,
        });

        await interaction.editReply(
          await buildBenchMarkPayload(
            interaction,
            'Simulation stop requested. Run Simulation is available again.',
          ),
        );
      } catch (error) {
        await interaction.editReply(
          await buildBenchMarkPayload(
            interaction,
            error?.message || 'Professor Aegis could not stop that benchmark suite.',
          ),
        );
      }
      return true;
    }

    if (value === 'run_benchmark_suite') {
      return handleRunBenchMarkSuite(interaction, {
        benchmarkState,
        suiteJobState,
        hasActiveSuiteJob,
        hasSubmittedTeam,
        benchmarkWarmupActive,
        warmupState,
      });
    }

    if (value === 'view_last_report') {
      const lastReportFullState = hasLastReport
        ? await getBenchMarkLastReport(interaction.user.id)
        : null;
      if (!lastReportFullState?.report) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, 'No completed BenchMark report is on file yet.'),
        );
        return true;
      }

      await interaction.editReply({
        embeds: [
          buildBenchMarkReportEmbed({
            username: interaction.member?.displayName || interaction.user.username,
            report: lastReportFullState.report,
          }),
        ],
        components: buildBenchMarkMenuComponents(sharedRowProps),
      });
      return true;
    }

    if (value === 'view_last_matchup_eval') {
      const lastMatchupEvalFullState = hasLastMatchupEval
        ? await getBenchMarkLastMatchupEval(interaction.user.id)
        : null;
      if (!lastMatchupEvalFullState?.report) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, 'No completed matchup eval is on file yet.'),
        );
        return true;
      }

      await interaction.editReply({
        embeds: [
          buildBenchMarkMatchupEvalEmbed({
            username: interaction.member?.displayName || interaction.user.username,
            report: lastMatchupEvalFullState.report,
          }),
        ],
        components: buildBenchMarkMenuComponents(sharedRowProps),
      });
      return true;
    }

    if (value === 'download_match_archive') {
      const lastSuiteReportFullState = hasLastSuiteReport
        ? await getBenchMarkLastSuiteReport(interaction.user.id, suiteJobState)
        : null;
      if (!lastSuiteReportFullState?.report || !hasSavedMatchArchive(lastSuiteReportFullState.report)) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, 'No completed Simulation Archive is ready yet.'),
        );
        return true;
      }

      try {
        const archiveTeamPreviewLines = cleanText(benchmarkState?.team_export).split('\n').filter(Boolean);
        const archiveTeamPreviewText = archiveTeamPreviewLines.length
          ? `${archiveTeamPreviewLines[0]?.slice(0, 80) || 'Team on file'}${archiveTeamPreviewLines.length > 1 ? ` • ${archiveTeamPreviewLines.length} lines saved` : ''}`
          : 'Team on file';

        await showArchiveCompileProgress(interaction, {
          ...sharedRowProps,
          teamPreviewText: archiveTeamPreviewText,
        }, { percent: 4, step: 'Opening the archive terminal...' });

        const zipBuffer = await buildMatchArchiveZip(lastSuiteReportFullState.report, {
          userId: interaction.user.id,
          trainerName: interaction.member?.displayName || interaction.user.username,
          serverName: interaction.guild?.name || 'Professor Aegis',
          avatarUrl: interaction.user?.displayAvatarURL?.({ extension: 'png', size: 128, forceStatic: true }) || null,
          onProgress: async (stage) => {
            await showArchiveCompileProgress(interaction, {
              ...sharedRowProps,
              teamPreviewText: archiveTeamPreviewText,
            }, stage);
          },
        });

        if (!zipBuffer) {
          await interaction.editReply(
            await buildBenchMarkPayload(interaction, 'No replay HTML files were available in the last Simulation Report.'),
          );
          return true;
        }

        await sendMatchArchiveZip(interaction, zipBuffer, sharedRowProps, {
          onProgress: async (stage) => {
            await showArchiveCompileProgress(interaction, {
              ...sharedRowProps,
              teamPreviewText: archiveTeamPreviewText,
            }, stage);
          },
        });
      } catch (error) {
        await interaction.editReply(
          await buildBenchMarkPayload(interaction, error?.message || 'Professor Aegis could not build that Simulation Archive.'),
        );
      }
      return true;
    }

    if (value === 'back_main') {
      await interaction.editReply(await buildMainMenuPayload(interaction));
      return true;
    }

    await interaction.editReply(await buildBenchMarkPayload(interaction));
    return true;
  }

  if (base === 'benchmark_suite_history_select') {
    if (value === 'back_benchmark') {
      await renderBenchMarkMenuShellThenHydrate(interaction, {
        path: 'benchmark.history.back',
        ackMode: 'deferUpdate',
      });
      return true;
    }

    const historyReportTabs = new Set(['overview', 'threats', 'leads', 'core']);
    const isHistoryPaperReportDownload = value === 'download_paper_report';
    const isHistoryLoadTeam = value === 'load_team';
    const isHistoryReportTab = historyReportTabs.has(value);
    const selectedHistoryIndex = Number.isInteger(Number(parts?.[0])) ? Number(parts[0]) : -1;
    const historyIndex = (isHistoryPaperReportDownload || isHistoryLoadTeam || isHistoryReportTab)
      ? selectedHistoryIndex
      : getBenchMarkHistoryIndexFromValue(value);
    if (historyIndex < 0) {
      await interaction.deferUpdate();
      await interaction.editReply(await buildBenchMarkPayload(interaction, 'That previous Simulation Report could not be found.'));
      return true;
    }

    if (!isHistoryPaperReportDownload && !isHistoryLoadTeam) {
      const selectedReportTab = isHistoryReportTab ? value : 'overview';
      await renderMenuShellThenHydrate(interaction, {
        path: `benchmark.history.report.${selectedReportTab}`,
        hydrationKey: `benchmark:${interaction.user.id}:history-report`,
        ackMode: 'deferUpdate',
        shellPayload: () => buildBenchMarkSuiteReportShellPayload(interaction, {
          reportTab: selectedReportTab,
          history: true,
          historyIndex,
          notice: 'Opening the selected previous Simulation Report...',
        }),
        hydratePayload: () => buildBenchMarkHistoryReportPayload(interaction, historyIndex, selectedReportTab),
      });
      return true;
    }

    await interaction.deferUpdate();

    const {
      benchmarkState,
      jobState,
      matchupJobState,
      suiteJobState,
      warmupState,
      lastReportState,
      lastMatchupEvalState,
    } = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
    const latestSuiteReportState = await getBenchMarkLastSuiteReport(interaction.user.id, benchmarkState);
    const historyReports = await listBenchMarkPreviousSuiteReports(
      interaction.user.id,
      latestSuiteReportState,
      benchmarkState,
    );
    const historyReport = historyReports[historyIndex] || null;

    if (!historyReport?.report) {
      const payload = await buildBenchMarkPayload(interaction, 'That previous Simulation Report is unavailable now. History keeps the latest plus previous three reports.');
      await interaction.editReply({
        ...payload,
        components: historyReports.length
          ? buildBenchMarkHistoryViewComponents({
            ownerId: interaction.user.id,
            historyReports,
            hasPaperReportReady: false,
          }, historyReports, -1)
          : payload.components,
        files: [],
      });
      return true;
    }

    const hasActiveSuiteJob = ['queued', 'running', 'cancelling'].includes(String(suiteJobState?.status || '').toLowerCase());
    const sharedRowProps = {
      ownerId: interaction.user.id,
      hasSubmittedTeam: Boolean(cleanText(benchmarkState?.team_export)),
      hasLastReport: Boolean(lastReportState?.has_report || lastReportState?.report_id || lastReportState?.report),
      hasActiveJob: ['queued', 'running'].includes(String(jobState?.status || '').toLowerCase()),
      hasLastMatchupEval: Boolean(lastMatchupEvalState?.has_report || lastMatchupEvalState?.report_id || lastMatchupEvalState?.report),
      hasActiveMatchupJob: ['queued', 'running'].includes(String(matchupJobState?.status || '').toLowerCase()),
      hasLastSuiteReport: Boolean(latestSuiteReportState?.report),
      hasActiveSuiteJob,
      hasMatchArchiveReady: false,
      hasPaperReportReady: hasSavedPaperReport(historyReport.report),
      showMatchArchiveButton: false,
      showPaperReportButton: false,
      historyReports,
      historyIndex,
      useHistoryReportDropdown: true,
      useSuiteReportDropdown: false,
      benchmarkWarmupActive: isBenchMarkWarmupActive(warmupState),
      selectedReportTab: isHistoryReportTab ? value : 'overview',
    };

    if (isHistoryLoadTeam) {
      const teamExport = getBenchMarkHistoryTeamExport(historyReport);
      const importValidation = validateBenchMarkTeamImport(teamExport);
      if (!importValidation.ok) {
        await interaction.editReply(await buildBenchMarkPayload(interaction, importValidation.message || 'That previous team could not be loaded.'));
        return true;
      }

      await setBenchMarkTeamState(interaction.user.id, teamExport);
      await clearBenchMarkLoadedTeamRuntimeState(interaction.user.id, teamExport);
      clearBenchMarkMenuPayloadCache(interaction.user.id);
      await interaction.editReply(
        await buildBenchMarkPayload(interaction, 'Previous Battle Simulator team loaded from History. Your submitted team has been updated.'),
      );
      return true;
    }

    if (isHistoryPaperReportDownload) {
      if (!sharedRowProps.hasPaperReportReady) {
        const payload = await buildBenchMarkPayload(interaction, 'That previous Simulation Report has no Paper Report data ready.');
        await interaction.editReply({
          ...payload,
          components: buildBenchMarkHistoryViewComponents(sharedRowProps, historyReports, historyIndex),
          files: [],
        });
        return true;
      }

      try {
        await showPaperReportCompileProgress(interaction, sharedRowProps, {
          percent: 4,
          step: 'Starting the History Paper Report PDF build...',
        });
        const paperReport = await buildPaperReportWithProgress(interaction, historyReport.report, {
          trainerName: interaction.member?.displayName || interaction.user.username,
          serverName: interaction.guild?.name || 'Professor Aegis',
          avatarUrl: interaction.user?.displayAvatarURL?.({ extension: 'png', size: 128, forceStatic: true }) || null,
          filename: 'BattleSimulationHistoryPaperReport',
        }, sharedRowProps);
        await interaction.editReply({
          content: 'History Paper Report ready.',
          files: [{ attachment: paperReport.attachment, name: paperReport.name }],
          embeds: [],
          components: buildBenchMarkHistoryViewComponents(sharedRowProps, historyReports, historyIndex),
        });
      } catch (error) {
        await interaction.editReply(await buildBenchMarkPayload(interaction, error?.message || 'Professor Aegis could not build that History Paper Report.'));
      }
      return true;
    }

    await interaction.editReply({
      embeds: [
        buildBenchMarkSuiteEmbed({
          username: interaction.member?.displayName || interaction.user.username,
          report: historyReport.report,
          reportTab: sharedRowProps.selectedReportTab,
        }),
      ],
      components: buildBenchMarkHistoryViewComponents(sharedRowProps, historyReports, historyIndex),
      files: [],
    });
    return true;
  }

  if (base === 'benchmark_load_team_select') {
    if (value === 'back_benchmark') {
      await renderBenchMarkMenuShellThenHydrate(interaction, {
        path: 'benchmark.load-team.back',
        ackMode: 'deferUpdate',
      });
      return true;
    }

    const loadTeamIndex = getBenchMarkLoadTeamIndexFromValue(value);
    if (loadTeamIndex < 0) {
      await interaction.deferUpdate();
      await interaction.editReply(await buildBenchMarkPayload(interaction, 'That previous Battle Simulator team could not be found.'));
      return true;
    }

    await renderMenuShellThenHydrate(interaction, {
      path: 'benchmark.load-team.select',
      hydrationKey: `benchmark:${interaction.user.id}:load-team-select`,
      ackMode: 'deferUpdate',
      shellPayload: () => buildBenchMarkLoadTeamShellPayload(interaction, 'Loading the selected saved team...'),
      hydratePayload: () => buildBenchMarkLoadTeamSelectionPayload(interaction, loadTeamIndex),
      awaitHydration: true,
    });
    return true;
  }

  if (base === 'benchmark_instant_report_tab') {
    if (value === 'back_benchmark') {
      await renderBenchMarkMenuShellThenHydrate(interaction, {
        path: 'benchmark.instant-report.back',
        ackMode: 'deferUpdate',
      });
      return true;
    }

    const instantReportTabs = new Set(['overview', 'threats', 'leads', 'core']);
    if (!instantReportTabs.has(value)) {
      await interaction.deferUpdate();
      await interaction.editReply(await buildBenchMarkPayload(interaction, 'That Instant Projection tab is not available.'));
      return true;
    }

    await interaction.deferUpdate();
    try {
      const benchmarkState = await getBenchMarkTeamState(interaction.user.id);
      const suiteConfig = await getBenchMarkSuiteConfig(interaction.user.id);
      const projection = tryCreateInstantProjectionResult({
        teamExport: benchmarkState?.team_export,
        settings: {
          formatId: suiteConfig.format_id,
          benchmarkMode: suiteConfig.mode,
          battleBudget: suiteConfig.battle_budget,
        },
      });
      await interaction.editReply({
        content: '',
        embeds: [
          buildBenchMarkInstantProjectionResultEmbed({
            username: interaction.member?.displayName || interaction.user.username,
            result: projection.result,
            error: projection.error,
            reportTab: value,
          }),
        ],
        components: [
          buildBenchMarkInstantProjectionReportTabRow({
            ownerId: interaction.user.id,
            selectedReportTab: value,
          }),
          buildBenchMarkInstantProjectionResultRow({ ownerId: interaction.user.id }),
        ],
        files: [],
      });
    } catch (error) {
      await interaction.editReply({
        content: '',
        embeds: [
          buildBenchMarkInstantProjectionResultEmbed({
            username: interaction.member?.displayName || interaction.user.username,
            error: {
              message: error?.message || 'Instant Projection could not safely produce a one-time result.',
            },
            reportTab: value,
          }),
        ],
        components: [
          buildBenchMarkInstantProjectionReportTabRow({
            ownerId: interaction.user.id,
            selectedReportTab: value,
          }),
          buildBenchMarkInstantProjectionResultRow({ ownerId: interaction.user.id }),
        ],
        files: [],
      });
    }
    return true;
  }

  if (base === 'benchmark_suite_report_tab') {
    if (value === 'back_benchmark') {
      await renderBenchMarkMenuShellThenHydrate(interaction, {
        path: 'benchmark.report.back',
        ackMode: 'deferUpdate',
      });
      return true;
    }

    const suiteReportTabs = new Set(['overview', 'threats', 'leads', 'core']);
    if (suiteReportTabs.has(value)) {
      await renderMenuShellThenHydrate(interaction, {
        path: `benchmark.report.tab.${value}`,
        hydrationKey: `benchmark:${interaction.user.id}:latest-report`,
        ackMode: 'deferUpdate',
        shellPayload: () => buildBenchMarkSuiteReportShellPayload(interaction, {
          reportTab: value,
          notice: `Loading ${value === 'overview' ? 'Overview' : value === 'threats' ? 'Threats' : value === 'core' ? 'Core' : 'Leads'} tab...`,
        }),
        hydratePayload: () => buildLatestBenchMarkSuiteReportPayload(interaction, value),
      });
      return true;
    }

    await interaction.deferUpdate();

    const selectedReportTab = 'overview';
    const {
      benchmarkState,
      jobState,
      matchupJobState,
      suiteJobState,
      warmupState,
      lastReportState,
      lastMatchupEvalState,
    } = await resolveBenchMarkMenuStateSnapshot(interaction.user.id);
    const lastSuiteReportState = await getBenchMarkLastSuiteReport(interaction.user.id, suiteJobState);

    if (!lastSuiteReportState?.report) {
      await interaction.editReply(await buildBenchMarkPayload(interaction, 'No completed Simulation Report is on file yet.'));
      return true;
    }

    const hasActiveSuiteJob = ['queued', 'running', 'cancelling'].includes(String(suiteJobState?.status || '').toLowerCase());
    const sharedRowProps = {
      ownerId: interaction.user.id,
      hasSubmittedTeam: Boolean(cleanText(benchmarkState?.team_export)),
      hasLastReport: Boolean(lastReportState?.has_report || lastReportState?.report_id || lastReportState?.report),
      hasActiveJob: ['queued', 'running'].includes(String(jobState?.status || '').toLowerCase()),
      hasLastMatchupEval: Boolean(lastMatchupEvalState?.has_report || lastMatchupEvalState?.report_id || lastMatchupEvalState?.report),
      hasActiveMatchupJob: ['queued', 'running'].includes(String(matchupJobState?.status || '').toLowerCase()),
      hasLastSuiteReport: true,
      hasActiveSuiteJob,
      hasMatchArchiveReady: !hasActiveSuiteJob && hasSavedMatchArchive(lastSuiteReportState.report),
      hasPaperReportReady: hasSavedPaperReport(lastSuiteReportState.report),
      showMatchArchiveButton: true,
      showPaperReportButton: true,
      useSuiteReportDropdown: true,
      benchmarkWarmupActive: isBenchMarkWarmupActive(warmupState),
      selectedReportTab,
    };

    if (value === 'download_paper_report') {
      if (!sharedRowProps.hasPaperReportReady) {
        await interaction.editReply(await buildBenchMarkPayload(interaction, 'No completed Paper Report is ready yet.'));
        return true;
      }

      try {
        await showPaperReportCompileProgress(interaction, sharedRowProps, {
          percent: 4,
          step: 'Starting the Paper Report PDF build...',
        });
        const paperReport = await buildPaperReportWithProgress(interaction, lastSuiteReportState.report, {
          trainerName: interaction.member?.displayName || interaction.user.username,
          serverName: interaction.guild?.name || 'Professor Aegis',
          avatarUrl: interaction.user?.displayAvatarURL?.({ extension: 'png', size: 128, forceStatic: true }) || null,
          filename: 'BattleSimulationPaperReport',
        }, sharedRowProps);
        await interaction.editReply({
          content: 'Paper Report ready.',
          files: [{ attachment: paperReport.attachment, name: paperReport.name }],
          embeds: [],
          components: buildBenchMarkSuiteViewComponents(sharedRowProps, null),
        });
      } catch (error) {
        await interaction.editReply(await buildBenchMarkPayload(interaction, error?.message || 'Professor Aegis could not build that Paper Report.'));
      }
      return true;
    }

    if (value === 'download_simulation_archive') {
      if (hasActiveSuiteJob) {
        await interaction.editReply(await buildBenchMarkPayload(
          interaction,
          'A Simulation Report is currently running. Wait for it to finish, then open View Last Simulation Report to download the completed Simulation Archive.',
        ));
        return true;
      }
      if (!sharedRowProps.hasMatchArchiveReady) {
        await interaction.editReply(await buildBenchMarkPayload(interaction, 'No completed Simulation Archive is ready yet.'));
        return true;
      }

      try {
        const archiveTeamPreviewLines = cleanText(benchmarkState?.team_export).split('\n').filter(Boolean);
        const archiveTeamPreviewText = archiveTeamPreviewLines.length
          ? `${archiveTeamPreviewLines[0]?.slice(0, 80) || 'Team on file'}${archiveTeamPreviewLines.length > 1 ? ` • ${archiveTeamPreviewLines.length} lines saved` : ''}`
          : 'Team on file';

        await showArchiveCompileProgress(interaction, {
          ...sharedRowProps,
          teamPreviewText: archiveTeamPreviewText,
        }, { percent: 4, step: 'Opening the archive terminal...' });

        const zipBuffer = await buildMatchArchiveZip(lastSuiteReportState.report, {
          userId: interaction.user.id,
          trainerName: interaction.member?.displayName || interaction.user.username,
          serverName: interaction.guild?.name || 'Professor Aegis',
          avatarUrl: interaction.user?.displayAvatarURL?.({ extension: 'png', size: 128, forceStatic: true }) || null,
          onProgress: async (stage) => {
            await showArchiveCompileProgress(interaction, {
              ...sharedRowProps,
              teamPreviewText: archiveTeamPreviewText,
            }, stage);
          },
        });

        if (!zipBuffer) {
          await interaction.editReply(await buildBenchMarkPayload(interaction, 'No replay HTML files were available in the last Simulation Report.'));
          return true;
        }

        await sendMatchArchiveZip(interaction, zipBuffer, sharedRowProps, {
          onProgress: async (stage) => {
            await showArchiveCompileProgress(interaction, {
              ...sharedRowProps,
              teamPreviewText: archiveTeamPreviewText,
            }, stage);
          },
        });
      } catch (error) {
        await interaction.editReply(await buildBenchMarkPayload(interaction, error?.message || 'Professor Aegis could not build that Simulation Archive.'));
      }
      return true;
    }

    await interaction.editReply({
      embeds: [
        buildBenchMarkSuiteEmbed({
          username: interaction.member?.displayName || interaction.user.username,
          report: lastSuiteReportState.report,
          reportTab: selectedReportTab,
        }),
      ],
      components: buildBenchMarkSuiteViewComponents(sharedRowProps),
    });
    return true;
  }

  if (base === 'benchmark_suite_config_select') {
    await interaction.deferUpdate();

    if (value === 'clear_benchmark_data') {
      const [jobState, matchupJobState, suiteJobState] = await Promise.all([
        getBenchMarkJobState(interaction.user.id),
        getBenchMarkMatchupJobState(interaction.user.id),
        getBenchMarkSuiteJobState(interaction.user.id),
      ]);
      if (
        isActiveBenchMarkJobState(jobState)
        || isActiveBenchMarkJobState(matchupJobState)
        || isActiveBenchMarkJobState(suiteJobState)
      ) {
        await interaction.editReply(await buildBenchMarkSuiteConfigPayload(
          interaction,
          'Finish or stop the active simulation before clearing Battle Simulator data.',
        ));
        return true;
      }

      await interaction.editReply({
        embeds: [buildBenchMarkClearDataConfirmEmbed()],
        components: [buildBenchMarkClearDataConfirmRow({ ownerId: interaction.user.id })],
      });
      return true;
    }

    if (value === 'config_mode') {
      await renderBenchMarkSuiteSubmenuShellThenHydrate(interaction, {
        path: 'benchmark.settings.mode',
        shellPayload: () => buildBenchMarkSuiteModeShellPayload(interaction),
        hydratePayload: () => buildBenchMarkSuiteModePayload(interaction),
      });
      return true;
    }

    if (value === 'config_format') {
      await renderBenchMarkSuiteSubmenuShellThenHydrate(interaction, {
        path: 'benchmark.settings.format',
        shellPayload: () => buildBenchMarkSuiteFormatShellPayload(interaction),
        hydratePayload: () => buildBenchMarkSuiteFormatPayload(interaction),
      });
      return true;
    }

    if (value === 'config_battle_budget' || value === 'config_sample_size') {
      await renderBenchMarkSuiteSubmenuShellThenHydrate(interaction, {
        path: 'benchmark.settings.battle-budget',
        shellPayload: () => buildBenchMarkSuiteBattleBudgetShellPayload(interaction),
        hydratePayload: () => buildBenchMarkSuiteBattleBudgetPayload(interaction),
      });
      return true;
    }

    if (value === 'config_games_per_opponent') {
      await renderBenchMarkSuiteSubmenuShellThenHydrate(interaction, {
        path: 'benchmark.settings.games',
        shellPayload: () => buildBenchMarkSuiteGamesShellPayload(interaction),
        hydratePayload: () => buildBenchMarkSuiteGamesPayload(interaction),
      });
      return true;
    }

    if (value === 'back_benchmark') {
      await renderBenchMarkMenuShellThenHydrate(interaction, {
        path: 'benchmark.settings.back',
        ackMode: 'none',
      });
      return true;
    }
  }

  if (base === 'benchmark_suite_mode_select') {
    await interaction.deferUpdate();

    if (value === 'back_config') {
      await renderBenchMarkSuiteConfigShellThenHydrate(interaction, {
        path: 'benchmark.settings.mode.back',
        ackMode: 'none',
      });
      return true;
    }

    await safelyEditMenuReply(
      interaction,
      buildBenchMarkSuiteConfigShellPayload(interaction, `Updating Opponent Pool to ${humanizeBenchMarkSuiteMode(value)}...`),
      buildMenuTimingLabel('shell', 'benchmark.settings.mode.update'),
    );
    const currentConfig = await getBenchMarkSuiteSettingsConfig(interaction.user.id);
    const nextConfig = await setBenchMarkSuiteConfig(interaction.user.id, { mode: value }, currentConfig);
    await interaction.editReply(
      await buildBenchMarkSuiteConfigPayload(
        interaction,
        `Opponent Pool set to ${humanizeBenchMarkSuiteMode(value)}.`,
        { config: nextConfig },
      ),
    );
    return true;
  }

  if (base === 'benchmark_suite_format_select') {
    await interaction.deferUpdate();

    if (value === 'back_config') {
      await renderBenchMarkSuiteConfigShellThenHydrate(interaction, {
        path: 'benchmark.settings.format.back',
        ackMode: 'none',
      });
      return true;
    }

    if (value === BENCHMARK_SUITE_STANDARD_FORMAT_ID) {
      await safelyEditMenuReply(
        interaction,
        buildBenchMarkSuiteConfigShellPayload(interaction, 'Checking format availability...'),
        buildMenuTimingLabel('shell', 'benchmark.settings.format.standard'),
      );
      await interaction.editReply(
        await buildBenchMarkSuiteConfigPayload(
          interaction,
          'Standard is coming later. Champions remains the runnable Battle Simulator format for now.',
        ),
      );
      return true;
    }

    await safelyEditMenuReply(
      interaction,
      buildBenchMarkSuiteConfigShellPayload(interaction, `Updating format to ${humanizeBenchMarkSuiteFormat(value)}...`),
      buildMenuTimingLabel('shell', 'benchmark.settings.format.update'),
    );
    const currentConfig = await getBenchMarkSuiteSettingsConfig(interaction.user.id);
    const currentSettingsSnapshot = await getBenchMarkSuiteSettingsSnapshot(interaction.user.id, { config: currentConfig });
    const currentSuiteJobState = currentSettingsSnapshot.suiteJobState;
    const hasActiveSuiteJobForFormat = ['queued', 'running', 'cancelling'].includes(
      String(currentSuiteJobState?.status || '').toLowerCase(),
    );
    if (hasActiveSuiteJobForFormat) {
      await interaction.editReply(
        await buildBenchMarkSuiteConfigPayload(
          interaction,
          'Finish or stop the active simulation before changing simulator format.',
        ),
      );
      return true;
    }

    const nextConfig = await setBenchMarkSuiteConfig(interaction.user.id, { format_id: value }, currentConfig);
    if (nextConfig.format_id !== currentConfig.format_id) {
      await setBenchMarkSuiteJobState(interaction.user.id, {
        job_id: null,
        status: 'idle',
        submitted_at: null,
        started_at: null,
        completed_at: null,
        error: null,
        progress: null,
        request: null,
        format_id: nextConfig.format_id,
        benchmark_mode: null,
        selection_summary: null,
      });
      await setBenchMarkLastSuiteReport(interaction.user.id, null);
    }
    await interaction.editReply(
      await buildBenchMarkSuiteConfigPayload(
        interaction,
        `Format set to ${humanizeBenchMarkSuiteFormat(nextConfig.format_id)}.`,
        { config: nextConfig },
      ),
    );
    return true;
  }

  if (base === 'benchmark_suite_battle_budget_select') {
    await interaction.deferUpdate();

    if (value === 'back_config') {
      await renderBenchMarkSuiteConfigShellThenHydrate(interaction, {
        path: 'benchmark.settings.battle-budget.back',
        ackMode: 'none',
      });
      return true;
    }

    const battleBudget = normalizeBenchMarkSuiteBattleBudget(value);
    await safelyEditMenuReply(
      interaction,
      buildBenchMarkSuiteConfigShellPayload(interaction, `Updating Battle Budget to ${battleBudget}...`),
      buildMenuTimingLabel('shell', 'benchmark.settings.battle-budget.update'),
    );
    const currentConfig = await getBenchMarkSuiteSettingsConfig(interaction.user.id);
    const nextConfig = await setBenchMarkSuiteConfig(interaction.user.id, { battle_budget: battleBudget }, currentConfig);
    await interaction.editReply(
      await buildBenchMarkSuiteConfigPayload(
        interaction,
        `Battle Budget set to ${battleBudget}.`,
        { config: nextConfig },
      ),
    );
    return true;
  }

  if (base === 'benchmark_suite_sample_size_select') {
    await interaction.deferUpdate();

    if (value === 'back_config') {
      await renderBenchMarkSuiteConfigShellThenHydrate(interaction, {
        path: 'benchmark.settings.legacy-sample.back',
        ackMode: 'none',
        notice: 'This older menu was replaced by Set Battle Budget. Choose 100, 200, 300, 850, or 1250 there.',
      });
      return true;
    }

    await interaction.editReply(
      await buildBenchMarkSuiteConfigPayload(
        interaction,
        'This older menu was replaced by Set Battle Budget. Choose 100, 200, 300, 850, or 1250 there.',
      ),
    );
    return true;
  }

  if (base === 'benchmark_suite_games_select') {
    await interaction.deferUpdate();

    if (value === 'back_config') {
      await renderBenchMarkSuiteConfigShellThenHydrate(interaction, {
        path: 'benchmark.settings.games.back',
        ackMode: 'none',
      });
      return true;
    }

    await safelyEditMenuReply(
      interaction,
      buildBenchMarkSuiteConfigShellPayload(interaction, `Updating Series Length to BO${Number(value)}...`),
      buildMenuTimingLabel('shell', 'benchmark.settings.games.update'),
    );
    const currentConfig = await getBenchMarkSuiteSettingsConfig(interaction.user.id);
    if (isBenchMarkSuiteChampionFormat(currentConfig.format_id)) {
      const nextConfig = await setBenchMarkSuiteConfig(interaction.user.id, { games_per_opponent: 1 }, currentConfig);
      await interaction.editReply(
        await buildBenchMarkSuiteConfigPayload(
          interaction,
          'Champions simulations are BO1 only.',
          { config: nextConfig },
        ),
      );
      return true;
    }

    const nextConfig = await setBenchMarkSuiteConfig(interaction.user.id, { games_per_opponent: Number(value) }, currentConfig);
    await interaction.editReply(
      await buildBenchMarkSuiteConfigPayload(
        interaction,
        `Series length set to BO${Number(value)}.`,
        { config: nextConfig },
      ),
    );
    return true;
  }

  if (base === 'admin_select') {
    if (!isBotAdmin(interaction)) {
      await replyNotAuthorized(interaction, 'Only academy staff may use admin controls.');
      return true;
    }

    if (value === 'league_control') {
      await interaction.update(await buildLeagueControlPayload(interaction));
      return true;
    }

    if (value === 'back_main') {
      await interaction.update(await buildMainMenuPayload(interaction));
      return true;
    }
  }

  if (base === 'league_control_select') {
    if (!isBotAdmin(interaction)) {
      await replyNotAuthorized(interaction, 'Only academy staff may use league control.');
      return true;
    }

    if (value === 'toggle_override') {
      const next = !(await getBattleTestMode());
      await setBattleTestMode(next);
      await interaction.update(
        await buildLeagueControlPayload(
          interaction,
          `Battle Override ${next ? 'enabled' : 'disabled'}.`,
        ),
      );
      return true;
    }

    if (value === 'cancel_all_battles') {
      await interaction.deferUpdate();

      const unresolved = await cancelAllUnresolvedBattles();
      for (const battle of unresolved) {
        const games = await getBattleGamesForBattle(battle.id);
        for (const game of games) {
          stopSpectatorSession(game.id, 'admin cancel all battles');
        }

        if (battle.battle_room_channel_id) {
          const channel = await client.channels
            .fetch(battle.battle_room_channel_id)
            .catch(() => null);

          if (channel) {
            await channel
              .send({
                content:
                  'All unresolved battles were cancelled by academy staff. This room will close in 1 minute.',
              })
              .catch(() => null);
            scheduleBattleRoomDeletion(channel, 60000, null);
          }
        }
      }

      await interaction.editReply(
        await buildLeagueControlPayload(
          interaction,
          `Cancelled ${unresolved.length} unresolved battle(s).`,
        ),
      );
      return true;
    }

    if (value === 'nuke_database') {
      await interaction.deferUpdate();

      const unresolved = await cancelAllUnresolvedBattles();
      for (const battle of unresolved) {
        const games = await getBattleGamesForBattle(battle.id);
        for (const game of games) {
          stopSpectatorSession(game.id, 'admin nuke database');
        }

        if (battle.battle_room_channel_id) {
          const channel = await client.channels
            .fetch(battle.battle_room_channel_id)
            .catch(() => null);

          if (channel) {
            await channel
              .send({
                content:
                  'The Professor Aegis database was nuked by academy staff. This room will close in 1 minute.',
              })
              .catch(() => null);
            scheduleBattleRoomDeletion(channel, 60000, null);
          }
        }
      }

      await nukeDatabase();
      await setBattleTestMode(false);
      await syncAcademyMembersFromGuild();

      await interaction.editReply(
        await buildLeagueControlPayload(
          interaction,
          'Database nuked. Players, teams, battles, and stored bot state were wiped.',
        ),
      );
      return true;
    }

    if (value === 'set_battle_category') {
      await interaction.update({
        embeds: [buildBattleCategoryEmbed()],
        components: [buildBattleCategorySelectRow({ ownerId: interaction.user.id })],
      });
      return true;
    }

    if (value === 'set_regulation') {
      const leagueState = await getLeagueState();
      await interaction.showModal(
        buildRegulationModal({
          ownerId: interaction.user.id,
          regulationName: leagueState.regulation_name || '',
          regulationUrl: leagueState.regulation_url || '',
        }),
      );
      return true;
    }

    if (value === 'set_playoff_minimum') {
      const leagueState = await getLeagueState();
      await interaction.showModal(
        buildPlayoffMinimumModal({
          ownerId: interaction.user.id,
          currentValue: leagueState.playoff_minimum_matches,
        }),
      );
      return true;
    }

    if (value === 'back_admin') {
      await interaction.update(await buildAdminPayload(interaction));
      return true;
    }
  }

  if (base === 'battle_control_select') {
    const battleId = Number(parts[0] || 0);
    const battle = await getBattleById(battleId);

    if (!battle) {
      await interaction.update({
        content: 'That battle could not be found.',
        embeds: [],
        components: [],
      });
      return true;
    }

    if (value === 'refresh') {
      await interaction.update(await buildBattleControlPayload(interaction, battle));
      return true;
    }

    if (value === 'close') {
      await interaction.update({
        content: 'Professor Aegis control panel closed.',
        embeds: [],
        components: [],
      });
      return true;
    }

    if (value === 'accept') {
      if (interaction.user.id !== battle.opponent_user_id && !isBotAdmin(interaction)) {
        await replyNotAuthorized(
          interaction,
          'Only the challenged trainer may accept this battle.',
        );
        return true;
      }

      try {
        const acceptedBattle = await acceptBattleChallenge(
          battle.id,
          battle.opponent_user_id,
          randomSubmitter(battle),
        );

        await sendBattleRoomMessage({
          battleId: acceptedBattle.id,
          notice:
            `Challenge accepted. ${
              acceptedBattle.designated_submitter_user_id
                ? `<@${acceptedBattle.designated_submitter_user_id}>`
                : 'The selected player'
            } must submit the Game 1 live Showdown link from personal controls.`,
        });

        await interaction.update(
          await buildBattleControlPayload(
            interaction,
            acceptedBattle,
            `Challenge accepted. ${
              acceptedBattle.designated_submitter_user_id
                ? `<@${acceptedBattle.designated_submitter_user_id}>`
                : 'The selected player'
            } is the designated submitter.`,
          ),
        );
      } catch (error) {
        await interaction.update(
          await buildBattleControlPayload(
            interaction,
            battle,
            error.message || 'Professor Aegis could not accept that battle request.',
          ),
        );
      }

      return true;
    }

    if (value === 'decline') {
      if (interaction.user.id !== battle.opponent_user_id && !isBotAdmin(interaction)) {
        await replyNotAuthorized(
          interaction,
          'Only the challenged trainer may decline this battle.',
        );
        return true;
      }

      try {
        await declineBattleChallenge(battle.id, battle.opponent_user_id);
        await editBattleRoomCurrentMessage({
          battleId: battle.id,
          notice: 'Challenge declined.',
        });

        const channel = await client.channels
          .fetch(battle.battle_room_channel_id)
          .catch(() => null);

        if (channel) {
          scheduleBattleRoomDeletion(
            channel,
            60000,
            'Challenge declined. This room will close in 1 minute.',
          );
        }

        await interaction.update(
          await buildBattleControlPayload(
            interaction,
            await getBattleById(battle.id),
            'Challenge declined.',
          ),
        );
      } catch (error) {
        await interaction.update(
          await buildBattleControlPayload(
            interaction,
            battle,
            error.message || 'Professor Aegis could not decline that battle request.',
          ),
        );
      }

      return true;
    }

    if (value === 'cancel') {
      if (interaction.user.id !== battle.challenger_user_id && !isBotAdmin(interaction)) {
        await replyNotAuthorized(
          interaction,
          'Only the challenger may cancel this battle.',
        );
        return true;
      }

      try {
        await cancelBattleChallenge(battle.id, battle.challenger_user_id);
        await editBattleRoomCurrentMessage({
          battleId: battle.id,
          notice: 'Challenge cancelled.',
        });

        const channel = await client.channels
          .fetch(battle.battle_room_channel_id)
          .catch(() => null);

        if (channel) {
          scheduleBattleRoomDeletion(
            channel,
            60000,
            'Challenge cancelled. This room will close in 1 minute.',
          );
        }

        await interaction.update(
          await buildBattleControlPayload(
            interaction,
            await getBattleById(battle.id),
            'Challenge cancelled.',
          ),
        );
      } catch (error) {
        await interaction.update(
          await buildBattleControlPayload(
            interaction,
            battle,
            error.message || 'Professor Aegis could not cancel that battle request.',
          ),
        );
      }

      return true;
    }

    if (value === 'attach_link') {
      if (
        battle.designated_submitter_user_id &&
        interaction.user.id !== battle.designated_submitter_user_id &&
        !isBotAdmin(interaction)
      ) {
        await replyNotAuthorized(
          interaction,
          'Only the designated link submitter may attach the live Showdown link for this set.',
        );
        return true;
      }

      await interaction.showModal(
        buildBattleAttachLinkModal({
          ownerId: interaction.user.id,
          battleId: battle.id,
          gameNumber: Number(battle.current_game_number || 1),
        }),
      );
      return true;
    }

    if (value === 'reconnect') {
      if (
        battle.designated_submitter_user_id &&
        interaction.user.id !== battle.designated_submitter_user_id &&
        !isBotAdmin(interaction)
      ) {
        await replyNotAuthorized(
          interaction,
          `Only <@${battle.designated_submitter_user_id}> may reconnect the spectator for this set.`,
        );
        return true;
      }

      const currentGame = await getCurrentBattleGame(battle.id);
      if (!currentGame?.showdown_link_url || !currentGame?.showdown_room_id) {
        await interaction.update(
          await buildBattleControlPayload(
            interaction,
            battle,
            'No live Showdown link is recorded for the current game yet.',
          ),
        );
        return true;
      }

      try {
        await beginSpectatorWatch(battle.id, currentGame);
        await interaction.update(
          await buildBattleControlPayload(
            interaction,
            battle,
            'Professor Aegis is reconnecting to the live Showdown room now.',
          ),
        );
      } catch (error) {
        await interaction.update(
          await buildBattleControlPayload(
            interaction,
            battle,
            error.message || 'Failed to reconnect the spectator.',
          ),
        );
      }

      return true;
    }

    if (value === 'archive_replay') {
      const targetGame =
        battle.status === 'completed'
          ? await getBattleGameByNumber(
              battle.id,
              Number(battle.current_game_number || 1),
            )
          : await getBattleGameByNumber(
              battle.id,
              Math.max(1, Number(battle.current_game_number || 1) - 1),
            );

      if (!targetGame || targetGame.status !== 'completed') {
        await interaction.update(
          await buildBattleControlPayload(
            interaction,
            battle,
            'No completed game is available for replay archiving yet.',
          ),
        );
        return true;
      }

      await interaction.showModal(
        buildBattleArchiveReplayModal({
          ownerId: interaction.user.id,
          battleId: battle.id,
          gameId: targetGame.id,
          replayUrl: targetGame.replay_url || '',
        }),
      );
      return true;
    }
  }

  return false;
}

async function handleBattleRoomSelect(interaction) {
  if (!interaction.customId.startsWith('battle_room_shared_select__')) return false;

  const battleId = Number(interaction.customId.split('__')[1] || 0);
  const battle =
    (await getBattleById(battleId)) ||
    (await getBattleByRoomChannelId(interaction.channelId));

  if (!battle) {
    await replyNotAuthorized(interaction, 'That battle could not be found.');
    return true;
  }

  const isParticipant =
    [battle.challenger_user_id, battle.opponent_user_id].includes(interaction.user.id) ||
    isBotAdmin(interaction);

  if (!isParticipant) {
    await replyNotAuthorized(
      interaction,
      'Only the trainers in this battle or an admin may use this room.',
    );
    return true;
  }

  const value = interaction.values?.[0];

  if (value === 'refresh_room') {
    await interaction.deferUpdate();
    await editBattleRoomCurrentMessage({ battleId: battle.id });
    return true;
  }

  await openBattleControlPanel(interaction, battle);
  return true;
}

async function handleChannelSelect(interaction) {
  const ownerCheck = await ensureScopedOwnership(interaction);
  if (!ownerCheck.ok) return true;

  const { base } = ownerCheck.parsed;
  if (base !== 'battle_category_select') return false;

  if (!isBotAdmin(interaction)) {
    await replyNotAuthorized(
      interaction,
      'Only academy staff may set the battle room category.',
    );
    return true;
  }

  const categoryId = interaction.values?.[0] || null;
  await setBattleRoomCategory(categoryId);

  await interaction.update(
    await buildLeagueControlPayload(
      interaction,
      `Battle room category set to ${categoryId ? `<#${categoryId}>` : 'Not set'}.`,
    ),
  );

  return true;
}

async function normalizeReplayUrlInput(input) {
  const raw = cleanText(input);
  if (!raw) throw new Error('A replay link is required.');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('That replay link is not a valid URL.');
  }

  if (!String(parsed.hostname || '').toLowerCase().includes('pokemonshowdown.com')) {
    throw new Error('Please paste a Pokémon Showdown replay URL.');
  }

  return raw;
}

async function handleModalSubmit(interaction) {
  const ownerCheck = await ensureScopedOwnership(interaction);
  if (!ownerCheck.ok) return true;

  const { base, parts } = ownerCheck.parsed;

  if (base === 'registration_modal') {
    const seasonNumber = Number(parts[0] || 0);
    const teamName = cleanText(interaction.fields.getTextInputValue('team_name'));
    const showdownName = cleanText(interaction.fields.getTextInputValue('showdown_name'));
    const teamExport = cleanText(interaction.fields.getTextInputValue('team_export'));

    if (!teamName) {
      await interaction.reply({
        content: 'Team name is required.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (!showdownName) {
      await interaction.reply({
        content: 'Showdown name is required.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (!looksLikeTeamExport(teamExport)) {
      await interaction.reply({
        content: 'That does not look like a valid Pokémon Showdown export.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (await isShowdownNameTakenByAnotherUser(showdownName, interaction.user.id)) {
      await interaction.reply({
        content: 'That Showdown name is already claimed by another trainer.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const player = await ensurePlayerExists(
      interaction.user.id,
      interaction.member?.displayName || interaction.user.username,
    );

    await upsertSeasonTeam({
      seasonNumber,
      userId: interaction.user.id,
      username: player.username,
      teamName,
      teamExport,
      showdownName,
    });

    await syncRegisteredStateForSeason(seasonNumber);

    await interaction.reply({
      content: `Season #${seasonNumber} registration saved.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (base === 'benchmark_team_modal') {
    const teamExport = cleanText(interaction.fields.getTextInputValue('benchmark_team_export'));
    const importValidation = validateBenchMarkTeamImport(teamExport);

    if (!importValidation.ok) {
      await interaction.reply({
        content: importValidation.message,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await setBenchMarkTeamState(interaction.user.id, teamExport);
    await clearBenchMarkAnalysisState(interaction.user.id);

    const payload = await buildBenchMarkPayload(
      interaction,
      'BenchMark team export saved. You can continue from this menu now.',
    );

    await interaction.reply({
      ...payload,
      flags: MessageFlags.Ephemeral,
    });

    const warmupState = await getBenchMarkWarmupState();
    if (isBenchMarkWarmupActive(warmupState)) {
      void startBenchMarkWarmupUiPoller(interaction);
    }
    return true;
  }

  if (base === 'regulation_modal') {
    if (!isBotAdmin(interaction)) {
      await replyNotAuthorized(
        interaction,
        'Only academy staff may set regulation info.',
      );
      return true;
    }

    const regulationName = cleanText(interaction.fields.getTextInputValue('regulation_name'));
    const regulationUrl = cleanText(interaction.fields.getTextInputValue('regulation_url'));

    if (!regulationName && !regulationUrl) {
      await clearRegulationInfo();
    } else {
      await setRegulationInfo({ regulationName, regulationUrl });
    }

    await interaction.reply({
      content: 'Regulation info updated.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (base === 'playoff_minimum_modal') {
    if (!isBotAdmin(interaction)) {
      await replyNotAuthorized(
        interaction,
        'Only academy staff may set playoff minimum matches.',
      );
      return true;
    }

    const value = Number(cleanText(interaction.fields.getTextInputValue('playoff_minimum')));
    if (!Number.isInteger(value) || value < 0) {
      await interaction.reply({
        content: 'Playoff minimum must be a non-negative whole number.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await setPlayoffMinimumMatches(value);

    await interaction.reply({
      content: `Playoff minimum matches set to ${value}.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (base === 'battle_attach_link_modal') {
    const battleId = Number(parts[0] || 0);
    const gameNumber = Number(parts[1] || 0);

    const battle =
      (await getBattleById(battleId)) ||
      (await getBattleByRoomChannelId(interaction.channelId));

    if (!battle) {
      await interaction.reply({
        content: 'That battle could not be found.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (
      battle.designated_submitter_user_id &&
      interaction.user.id !== battle.designated_submitter_user_id &&
      !isBotAdmin(interaction)
    ) {
      await interaction.reply({
        content:
          'Only the designated link submitter may attach the live Showdown link for this set.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const parsed = parseShowdownBattleLink(
        interaction.fields.getTextInputValue('battle_link_input'),
      );

      const game = await attachShowdownLinkToGame({
        battleId: battle.id,
        gameNumber,
        showdownLinkUrl: parsed.url,
        showdownRoomId: parsed.roomId,
      });

      await editBattleRoomCurrentMessage({
        battleId: battle.id,
        notice:
          `Live Showdown link attached for Game ${game.game_number}. Professor Aegis is connecting now.`,
      });

      await beginSpectatorWatch(battle.id, game);

      await interaction.editReply({
        content: `Professor Aegis is now spectating Game ${game.game_number}.`,
      });
    } catch (error) {
      await interaction.editReply({
        content:
          error.message || 'Professor Aegis could not start spectating that link.',
      });
    }

    return true;
  }

  if (base === 'battle_archive_replay_modal') {
    const battleId = Number(parts[0] || 0);
    const gameId = Number(parts[1] || 0);

    const battle =
      (await getBattleById(battleId)) ||
      (await getBattleByRoomChannelId(interaction.channelId));
    const game = await getBattleGameById(gameId);

    if (!battle || !game) {
      await interaction.reply({
        content: 'That battle game could not be found.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const isParticipant =
      [battle.challenger_user_id, battle.opponent_user_id].includes(interaction.user.id) ||
      isBotAdmin(interaction);

    if (!isParticipant) {
      await interaction.reply({
        content:
          'Only the trainers in this series or an admin may archive replay links.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    try {
      const replayUrl = await normalizeReplayUrlInput(
        interaction.fields.getTextInputValue('battle_archive_replay_url_input'),
      );

      await setBattleReplayUrlForGame(gameId, replayUrl);
      await editBattleRoomCurrentMessage({
        battleId,
        notice: `Replay link archived for Game ${game.game_number}.`,
      });

      await interaction.reply({
        content: `Replay link archived for Game ${game.game_number}.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({
        content: error.message || 'That replay link could not be archived.',
        flags: MessageFlags.Ephemeral,
      });
    }

    return true;
  }

  return false;
}

client.once(Events.ClientReady, async () => {
  console.log(`Professor Aegis logged in as ${client.user.tag}`);
  await initializeDatabase();

  if (typeof initializePostgresIntegration === 'function') {
    const postgresStatus = await initializePostgresIntegration();
    if (postgresStatus?.connected) {
      console.log(`[PostgreSQL] Connected to ${postgresStatus.database} on ${postgresStatus.host}:${postgresStatus.port} as ${postgresStatus.user}.`);
    } else if (postgresStatus?.enabled) {
      console.warn(`[PostgreSQL] Configured but not connected: ${postgresStatus?.error || 'Unknown PostgreSQL error.'}`);
    } else {
      console.log('[PostgreSQL] Not enabled yet. SQLite remains the active runtime database.');
    }
  } else if (typeof getPostgresRuntimeStatus === 'function') {
    const postgresStatus = getPostgresRuntimeStatus();
    if (postgresStatus?.enabled && !postgresStatus?.connected) {
      console.warn(`[PostgreSQL] Runtime status unavailable: ${postgresStatus?.error || 'PostgreSQL integration helper missing.'}`);
    }
  }

  if (typeof normalizeBenchmarkPersistenceOnStartup === 'function') {
    await normalizeBenchmarkPersistenceOnStartup();
    console.log('BenchMark persistence restored on startup. Saved exports, configs, reports, and history were kept.');
  } else {
    console.warn('BenchMark persistence normalizer is not available in database.js. Skipping benchmark startup normalization.');
  }

  await setBenchMarkWarmupState({
    active: false,
    status: 'idle',
    job_id: null,
    started_at: null,
    completed_at: null,
    error: null,
    progress: null,
  });

  scheduleInitialAcademyMembersSync();

  setInterval(() => {
    syncAcademyMembersFromGuild('recurring interval').catch((error) =>
      console.error('Academy sync interval failed:', error),
    );
  }, ACADEMY_SYNC_INTERVAL_MS);

  setInterval(() => {
    runLeagueReminderCheck().catch((error) =>
      console.error('League reminder interval failed:', error),
    );
  }, 60 * 1000);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'postmenu') {
        await handlePostMenuCommand(interaction);
        return;
      }
      if (interaction.commandName === 'startseason') {
        await handleStartSeasonCommand(interaction);
        return;
      }
      if (interaction.commandName === 'endseason') {
        await handleEndSeasonCommand(interaction);
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'open_academy_terminal') {
        await handleOpenTerminal(interaction);
        return;
      }
      const { base, ownerId, parts } = parseCustomId(interaction.customId);
      if (base === 'benchmark_clear_data_cancel') {
        if (ownerId && ownerId !== interaction.user.id) {
          await interaction.reply({ content: 'That clear-data panel belongs to another trainer.', flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferUpdate();
        await renderBenchMarkSuiteConfigShellThenHydrate(interaction, {
          path: 'benchmark.settings.clear-cancel',
          ackMode: 'none',
          notice: 'Clear cancelled. No data changed.',
        });
        return;
      }

      if (base === 'benchmark_clear_data_confirm') {
        if (ownerId && ownerId !== interaction.user.id) {
          await interaction.reply({ content: 'That clear-data panel belongs to another trainer.', flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferUpdate();
        const [jobState, matchupJobState, suiteJobState] = await Promise.all([
          getBenchMarkJobState(interaction.user.id),
          getBenchMarkMatchupJobState(interaction.user.id),
          getBenchMarkSuiteJobState(interaction.user.id),
        ]);
        if (
          isActiveBenchMarkJobState(jobState)
          || isActiveBenchMarkJobState(matchupJobState)
          || isActiveBenchMarkJobState(suiteJobState)
        ) {
          await interaction.editReply(await buildBenchMarkPayload(
            interaction,
            'Finish or stop the active simulation before clearing Battle Simulator data.',
          ));
          return;
        }

        try {
          await clearBenchmarkUserDataExceptTeam(interaction.user.id);
          clearBenchMarkMenuCaches(interaction.user.id);
          await interaction.editReply(await buildBenchMarkPayload(
            interaction,
            'Battle Simulator data cleared. Submitted team kept.',
          ));
        } catch (error) {
          await interaction.editReply(await buildBenchMarkPayload(
            interaction,
            error?.message || 'Professor Aegis could not clear Battle Simulator data.',
          ));
        }
        return;
      }

      if (base === 'benchmark_instant_run') {
        if (ownerId && ownerId !== interaction.user.id) {
          await interaction.reply({ content: 'That Instant Mode panel belongs to another trainer.', flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferUpdate();
        try {
          const benchmarkState = await getBenchMarkTeamState(interaction.user.id);
          const suiteConfig = await getBenchMarkSuiteConfig(interaction.user.id);
          const projection = tryCreateInstantProjectionResult({
            teamExport: benchmarkState?.team_export,
            settings: {
              formatId: suiteConfig.format_id,
              benchmarkMode: suiteConfig.mode,
              battleBudget: suiteConfig.battle_budget,
            },
          });
          await interaction.editReply({
            content: '',
            embeds: [
              buildBenchMarkInstantProjectionResultEmbed({
                username: interaction.member?.displayName || interaction.user.username,
                result: projection.result,
                error: projection.error,
                reportTab: 'overview',
              }),
            ],
            components: [
              buildBenchMarkInstantProjectionReportTabRow({
                ownerId: interaction.user.id,
                selectedReportTab: 'overview',
              }),
              buildBenchMarkInstantProjectionResultRow({ ownerId: interaction.user.id }),
            ],
            files: [],
          });
        } catch (error) {
          await interaction.editReply({
            content: '',
            embeds: [
              buildBenchMarkInstantProjectionResultEmbed({
                username: interaction.member?.displayName || interaction.user.username,
                error: {
                  message: error?.message || 'Instant Projection could not safely produce a one-time result.',
                },
                reportTab: 'overview',
              }),
            ],
            components: [
              buildBenchMarkInstantProjectionReportTabRow({
                ownerId: interaction.user.id,
                selectedReportTab: 'overview',
              }),
              buildBenchMarkInstantProjectionResultRow({ ownerId: interaction.user.id }),
            ],
            files: [],
          });
        }
        return;
      }

      if (base === 'benchmark_instant_back') {
        if (ownerId && ownerId !== interaction.user.id) {
          await interaction.reply({ content: 'That Instant Mode panel belongs to another trainer.', flags: MessageFlags.Ephemeral });
          return;
        }
        await renderBenchMarkMenuShellThenHydrate(interaction, {
          path: 'benchmark.instant-back',
          ackMode: 'deferUpdate',
        });
        return;
      }

      if (base === 'benchmark_download_paper_report') {
        if (ownerId && ownerId !== interaction.user.id) {
          await interaction.reply({ content: 'That Paper Report button belongs to another trainer.', flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferUpdate();
        const benchmarkState = await getBenchMarkTeamState(interaction.user.id);
        const jobState = await getBenchMarkJobState(interaction.user.id);
        const matchupJobState = await getBenchMarkMatchupJobState(interaction.user.id);
        const suiteJobState = await getBenchMarkSuiteJobState(interaction.user.id);
        const lastSuiteReportState = await getBenchMarkLastSuiteReport(interaction.user.id, benchmarkState);
        const warmupState = await getBenchMarkWarmupState();
        const hasActiveSuiteJob = ['queued', 'running', 'cancelling'].includes(String(suiteJobState?.status || '').toLowerCase());
        const report = lastSuiteReportState?.report;
        const sharedRowProps = {
          ownerId: interaction.user.id,
          hasSubmittedTeam: Boolean(cleanText(benchmarkState?.team_export)),
          hasLastReport: Boolean((await getBenchMarkLastReport(interaction.user.id))?.report),
          hasActiveJob: ['queued', 'running'].includes(String(jobState?.status || '').toLowerCase()),
          hasLastMatchupEval: Boolean((await getBenchMarkLastMatchupEval(interaction.user.id))?.report),
          hasActiveMatchupJob: ['queued', 'running'].includes(String(matchupJobState?.status || '').toLowerCase()),
          hasLastSuiteReport: Boolean(report),
          hasActiveSuiteJob,
          hasMatchArchiveReady: !hasActiveSuiteJob && hasSavedMatchArchive(report),
          hasPaperReportReady: hasSavedPaperReport(report),
          showMatchArchiveButton: true,
          showPaperReportButton: true,
          benchmarkWarmupActive: isBenchMarkWarmupActive(warmupState),
          selectedReportTab: 'overview',
        };

        if (!sharedRowProps.hasPaperReportReady) {
          await interaction.editReply(await buildBenchMarkPayload(interaction, 'No completed Paper Report is ready yet.'));
          return;
        }

        try {
          await showPaperReportCompileProgress(interaction, sharedRowProps, {
            percent: 4,
            step: 'Starting the Paper Report PDF build...',
          });
          const paperReport = await buildPaperReportWithProgress(interaction, report, {
            trainerName: interaction.member?.displayName || interaction.user.username,
            serverName: interaction.guild?.name || 'Professor Aegis',
            avatarUrl: interaction.user?.displayAvatarURL?.({ extension: 'png', size: 128, forceStatic: true }) || null,
            filename: 'BattleSimulationPaperReport',
          }, sharedRowProps);
          await interaction.editReply({
            content: 'Paper Report ready.',
            files: [{ attachment: paperReport.attachment, name: paperReport.name }],
            embeds: [],
            components: buildBenchMarkSuiteViewComponents(sharedRowProps, null),
          });
        } catch (error) {
          await interaction.editReply(await buildBenchMarkPayload(interaction, error?.message || 'Professor Aegis could not build that Paper Report.'));
        }
        return;
      }

      if (base === 'benchmark_download_archive') {
        if (ownerId && ownerId !== interaction.user.id) {
          await interaction.reply({ content: 'That archive button belongs to another trainer.', flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferUpdate();
        const benchmarkState = await getBenchMarkTeamState(interaction.user.id);
        const jobState = await getBenchMarkJobState(interaction.user.id);
        const matchupJobState = await getBenchMarkMatchupJobState(interaction.user.id);
        const suiteJobState = await getBenchMarkSuiteJobState(interaction.user.id);
        const lastSuiteReportState = await getBenchMarkLastSuiteReport(interaction.user.id, benchmarkState);
        const warmupState = await getBenchMarkWarmupState();
        const hasActiveSuiteJob = ['queued', 'running', 'cancelling'].includes(String(suiteJobState?.status || '').toLowerCase());
        const sharedRowProps = {
          ownerId: interaction.user.id,
          hasSubmittedTeam: Boolean(cleanText(benchmarkState?.team_export)),
          hasLastReport: Boolean((await getBenchMarkLastReport(interaction.user.id))?.report),
          hasActiveJob: ['queued', 'running'].includes(String(jobState?.status || '').toLowerCase()),
          hasLastMatchupEval: Boolean((await getBenchMarkLastMatchupEval(interaction.user.id))?.report),
          hasActiveMatchupJob: ['queued', 'running'].includes(String(matchupJobState?.status || '').toLowerCase()),
          hasLastSuiteReport: Boolean(lastSuiteReportState?.report),
          hasActiveSuiteJob,
          hasMatchArchiveReady: !hasActiveSuiteJob && hasSavedMatchArchive(lastSuiteReportState?.report),
          hasPaperReportReady: hasSavedPaperReport(lastSuiteReportState?.report),
          showMatchArchiveButton: true,
          showPaperReportButton: true,
          benchmarkWarmupActive: isBenchMarkWarmupActive(warmupState),
        };
        if (hasActiveSuiteJob) {
          await interaction.editReply(await buildBenchMarkPayload(
            interaction,
            'A Simulation Report is currently running. Wait for it to finish, then open View Last Simulation Report to download the completed Simulation Archive.',
          ));
          return;
        }
        if (!sharedRowProps.hasMatchArchiveReady) {
          await interaction.editReply(await buildBenchMarkPayload(interaction, 'No completed Simulation Archive is ready yet.'));
          return;
        }
        try {
          const archiveTeamPreviewLines = cleanText(benchmarkState?.team_export).split('\n').filter(Boolean);
          const archiveTeamPreviewText = archiveTeamPreviewLines.length
            ? `${archiveTeamPreviewLines[0]?.slice(0, 80) || 'Team on file'}${archiveTeamPreviewLines.length > 1 ? ` • ${archiveTeamPreviewLines.length} lines saved` : ''}`
            : 'Team on file';

          await showArchiveCompileProgress(interaction, {
            ...sharedRowProps,
            teamPreviewText: archiveTeamPreviewText,
          }, { percent: 4, step: 'Opening the archive terminal...' });

          const zipBuffer = await buildMatchArchiveZip(lastSuiteReportState.report, {
            userId: interaction.user.id,
            trainerName: interaction.member?.displayName || interaction.user.username,
            serverName: interaction.guild?.name || 'Professor Aegis',
            avatarUrl: interaction.user?.displayAvatarURL?.({ extension: 'png', size: 128, forceStatic: true }) || null,
            onProgress: async (stage) => {
              await showArchiveCompileProgress(interaction, {
                ...sharedRowProps,
                teamPreviewText: archiveTeamPreviewText,
              }, stage);
            },
          });

          if (!zipBuffer) {
            await interaction.editReply(await buildBenchMarkPayload(interaction, 'No replay HTML files were available in the last Simulation Report.'));
            return;
          }
          await sendMatchArchiveZip(interaction, zipBuffer, sharedRowProps, {
            onProgress: async (stage) => {
              await showArchiveCompileProgress(interaction, {
                ...sharedRowProps,
                teamPreviewText: archiveTeamPreviewText,
              }, stage);
            },
          });
        } catch (error) {
          await interaction.editReply(await buildBenchMarkPayload(interaction, error?.message || 'Professor Aegis could not build that Simulation Archive.'));
        }
        return;
      }
      if (base === 'benchmark_load_team_open') {
        if (ownerId && ownerId !== interaction.user.id) {
          await interaction.reply({ content: 'That Load Team button belongs to another trainer.', flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.deferUpdate();
        await showBenchMarkLoadTeamSelector(interaction);
        return;
      }
      if (base === 'benchmark_submitted_team_export') {
        if (ownerId && ownerId !== interaction.user.id) {
          await interaction.reply({ content: 'That export button belongs to another trainer.', flags: MessageFlags.Ephemeral });
          return;
        }
        const benchmarkState = await getBenchMarkTeamState(interaction.user.id);
        if (!cleanText(benchmarkState?.team_export)) {
          await interaction.reply({ content: 'No BenchMark team is on file yet.', flags: MessageFlags.Ephemeral });
          return;
        }
        await replyBenchMarkSubmittedTeamExport(interaction, benchmarkState.team_export, parts?.[0], {
          components: interaction.message?.components,
        });
        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'public_terminal_select') {
        await handlePublicTerminalSelect(interaction);
        return;
      }
      if (await handleBattleRoomSelect(interaction)) return;
      if (await handleScopedStringSelect(interaction)) return;
    }

    if (interaction.isChannelSelectMenu()) {
      if (await handleChannelSelect(interaction)) return;
    }

    if (interaction.isModalSubmit()) {
      if (await handleModalSubmit(interaction)) return;
    }
  } catch (error) {
    console.error('Interaction handling failed:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: 'Professor Aegis encountered an unexpected error.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => null);
      return;
    }

    if (interaction.deferred) {
      await interaction
        .followUp({
          content: 'Professor Aegis encountered an unexpected error.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => null);
    }
  }
});

async function main() {
  await client.login(process.env.DISCORD_TOKEN);
  startBotDebugServer();
}

main().catch((error) => {
  console.error('Professor Aegis startup failed:', error);
  process.exitCode = 1;
});
