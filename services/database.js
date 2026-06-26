const { createPostgresPool, getPostgresConfigFromEnv } = require('../database/postgres/client');
const crypto = require('crypto');
const db = null;

let postgresPool = null;
let postgresRuntimeStatus = {
  enabled: false,
  connected: false,
  configPresent: false,
  host: null,
  port: null,
  database: null,
  user: null,
  error: null,
  checked_at: null,
};

function hasPostgresEnvConfigured() {
  return Boolean(
    String(process.env.PGHOST || '').trim()
    && String(process.env.PGDATABASE || '').trim()
    && String(process.env.PGUSER || '').trim()
    && process.env.PGPASSWORD !== undefined,
  );
}

function getPostgresRuntimeStatus() {
  return { ...postgresRuntimeStatus };
}

async function initializePostgresIntegration() {
  const config = getPostgresConfigFromEnv();
  const configPresent = hasPostgresEnvConfigured();
  postgresRuntimeStatus = {
    enabled: configPresent,
    connected: false,
    configPresent,
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    error: null,
    checked_at: new Date().toISOString(),
  };

  if (!configPresent) {
    postgresRuntimeStatus.error = 'PostgreSQL env vars are not fully configured yet.';
    return getPostgresRuntimeStatus();
  }

  try {
    if (postgresPool) {
      await postgresPool.end().catch(() => {});
      postgresPool = null;
    }
    postgresPool = createPostgresPool();
    await postgresPool.query('SELECT 1');
    postgresRuntimeStatus.connected = true;
    return getPostgresRuntimeStatus();
  } catch (error) {
    postgresRuntimeStatus.error = error?.message || String(error);
    if (postgresPool) {
      await postgresPool.end().catch(() => {});
      postgresPool = null;
    }
    return getPostgresRuntimeStatus();
  }
}

function getPostgresPool() {
  return postgresPool;
}

const SQLITE_NOOP_RESULT = Object.freeze({ lastID: 0, changes: 0 });

async function runBenchmarkSqlite(sql, params = []) {
  return SQLITE_NOOP_RESULT;
}

async function getBenchmarkSqlite(sql, params = []) {
  return null;
}

async function allBenchmarkSqlite(sql, params = []) {
  return [];
}

async function runNonBenchmarkSqlite(sql, params = []) {
  return SQLITE_NOOP_RESULT;
}

async function getNonBenchmarkSqlite(sql, params = []) {
  return null;
}

async function allNonBenchmarkSqlite(sql, params = []) {
  return [];
}


let benchmarkPostgresReadWarningCache = new Set();

let nonBenchmarkPostgresReadWarningCache = new Set();

function isPostgresNonBenchmarkCutoverEnabled() {
  return String(process.env.POSTGRES_NON_BENCHMARK_CUTOVER || '').trim() === '1';
}

function isPostgresNonBenchmarkReadEnabled() {
  return String(process.env.POSTGRES_NON_BENCHMARK_READS || '').trim() === '1';
}

function isPostgresNonBenchmarkSqliteRetireEnabled() {
  return String(process.env.POSTGRES_NON_BENCHMARK_SQLITE_RETIRE || '').trim() === '1';
}

function shouldRetireNonBenchmarkSqliteRuntime() {
  return true;
}

function canUsePostgresNonBenchmarkReads() {
  return Boolean((isPostgresNonBenchmarkReadEnabled() || isPostgresNonBenchmarkCutoverEnabled() || isPostgresNonBenchmarkSqliteRetireEnabled()) && postgresRuntimeStatus?.connected && postgresPool);
}

function warnNonBenchmarkPostgresReadFallback(key, error) {
  const cacheKey = `${key}:${String(error?.message || error || '').trim()}`;
  if (nonBenchmarkPostgresReadWarningCache.has(cacheKey)) return;
  nonBenchmarkPostgresReadWarningCache.add(cacheKey);
  console.warn(`[PostgreSQL][Non-Benchmark Reads] Falling back to SQLite for ${key}: ${error?.message || error}`);
}

let nonBenchmarkPostgresWriteWarningCache = new Set();

function isPostgresNonBenchmarkWriteEnabled() {
  return String(process.env.POSTGRES_NON_BENCHMARK_WRITES || '').trim() === '1';
}

function canUsePostgresNonBenchmarkWrites() {
  return Boolean((isPostgresNonBenchmarkWriteEnabled() || isPostgresNonBenchmarkCutoverEnabled()) && postgresRuntimeStatus?.connected && postgresPool);
}
function shouldUsePostgresNonBenchmarkWritePrimary() {
  return Boolean(shouldRetireNonBenchmarkSqliteRuntime() && canUsePostgresNonBenchmarkWrites());
}


function warnNonBenchmarkPostgresWriteFallback(key, error) {
  const cacheKey = `${key}:${String(error?.message || error || '').trim()}`;
  if (nonBenchmarkPostgresWriteWarningCache.has(cacheKey)) return;
  nonBenchmarkPostgresWriteWarningCache.add(cacheKey);
  console.warn(`[PostgreSQL][Non-Benchmark Writes] SQLite write kept as primary. PostgreSQL write failed for ${key}: ${error?.message || error}`);
}


function isPostgresBenchmarkReadEnabled() {
  return String(process.env.POSTGRES_BENCHMARK_READS || '').trim() === '1';
}

function canUsePostgresBenchmarkReads() {
  return Boolean(isPostgresBenchmarkReadEnabled() && postgresRuntimeStatus?.connected && postgresPool);
}


function isPostgresBenchmarkWriteEnabled() {
  return String(process.env.POSTGRES_BENCHMARK_WRITES || '').trim() === '1';
}

function canUsePostgresBenchmarkWrites() {
  return Boolean((isPostgresBenchmarkWriteEnabled() || isPostgresBenchmarkCutoverEnabled()) && postgresRuntimeStatus?.connected && postgresPool);
}
function shouldUsePostgresBenchmarkWritePrimary() {
  return Boolean(shouldRetireBenchmarkSqliteRuntime() && canUsePostgresBenchmarkWrites());
}


function isPostgresBenchmarkCutoverEnabled() {
  return String(process.env.POSTGRES_BENCHMARK_CUTOVER || '').trim() === '1';
}

function canUsePostgresBenchmarkCutover() {
  return Boolean(isPostgresBenchmarkCutoverEnabled() && postgresRuntimeStatus?.connected && postgresPool);
}

function isPostgresBenchmarkSqliteRetireEnabled() {
  return String(process.env.POSTGRES_BENCHMARK_SQLITE_RETIRE || '').trim() === '1';
}

function shouldRetireBenchmarkSqliteRuntime() {
  return true;
}

function isAnyPostgresBenchmarkModeEnabled() {
  return Boolean(
    (isPostgresBenchmarkReadEnabled() || isPostgresBenchmarkWriteEnabled() || isPostgresBenchmarkCutoverEnabled())
    && postgresRuntimeStatus?.connected
    && postgresPool,
  );
}

let benchmarkPostgresWriteWarningCache = new Set();

function warnBenchmarkPostgresWriteFallback(key, error) {
  const cacheKey = `${key}:${String(error?.message || error || '').trim()}`;
  if (benchmarkPostgresWriteWarningCache.has(cacheKey)) return;
  benchmarkPostgresWriteWarningCache.add(cacheKey);
  console.warn(`[PostgreSQL][Benchmark Writes] SQLite write kept as primary. PostgreSQL write failed for ${key}: ${error?.message || error}`);
}

async function mirrorBenchmarkTeamStatePostgres(userId, payload) {
  await postgresPool.query(
    `
      INSERT INTO benchmark_teams (user_id, team_export, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE SET
        team_export = EXCLUDED.team_export,
        updated_at = EXCLUDED.updated_at
    `,
    [userId, payload.team_export, payload.updated_at],
  );
}

async function mirrorBenchmarkLatestJobStatePostgres(userId, jobType, next, now) {
  await postgresPool.query(
    `
      INSERT INTO benchmark_job_state_latest (
        user_id, job_type, worker_job_id, status, submitted_at, started_at, completed_at, error,
        progress_json, request_json, format_id, benchmark_mode, selection_summary_json, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13::jsonb, $14)
      ON CONFLICT (user_id, job_type) DO UPDATE SET
        worker_job_id = EXCLUDED.worker_job_id,
        status = EXCLUDED.status,
        submitted_at = EXCLUDED.submitted_at,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at,
        error = EXCLUDED.error,
        progress_json = EXCLUDED.progress_json,
        request_json = EXCLUDED.request_json,
        format_id = EXCLUDED.format_id,
        benchmark_mode = EXCLUDED.benchmark_mode,
        selection_summary_json = EXCLUDED.selection_summary_json,
        updated_at = EXCLUDED.updated_at
    `,
    [
      userId,
      jobType,
      next.job_id,
      next.status,
      next.submitted_at,
      next.started_at,
      next.completed_at,
      next.error,
      JSON.stringify(next.progress),
      JSON.stringify(next.request),
      next.format_id,
      next.benchmark_mode,
      JSON.stringify(next.selection_summary),
      now,
    ],
  );
}

async function mirrorBenchmarkJobHistoryPostgres(userId, jobType, next, report, now) {
  if (!next.job_id) return;
  await postgresPool.query(
    `
      INSERT INTO benchmark_job_history (
        user_id, job_type, worker_job_id, status, submitted_at, started_at, completed_at, error,
        progress_json, request_json, report_id, report_json, format_id, benchmark_mode, selection_summary_json,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, $13, $14, $15::jsonb, $16, $17)
      ON CONFLICT (worker_job_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        job_type = EXCLUDED.job_type,
        status = EXCLUDED.status,
        submitted_at = EXCLUDED.submitted_at,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at,
        error = EXCLUDED.error,
        progress_json = EXCLUDED.progress_json,
        request_json = EXCLUDED.request_json,
        report_id = COALESCE(EXCLUDED.report_id, benchmark_job_history.report_id),
        report_json = COALESCE(EXCLUDED.report_json, benchmark_job_history.report_json),
        format_id = EXCLUDED.format_id,
        benchmark_mode = EXCLUDED.benchmark_mode,
        selection_summary_json = EXCLUDED.selection_summary_json,
        updated_at = EXCLUDED.updated_at
    `,
    [
      userId,
      jobType,
      next.job_id,
      next.status,
      next.submitted_at,
      next.started_at,
      next.completed_at,
      next.error,
      JSON.stringify(next.progress),
      JSON.stringify(next.request),
      report?.savedReport?.reportId || report?.reportId || null,
      report === undefined ? null : JSON.stringify(report),
      next.format_id,
      next.benchmark_mode,
      JSON.stringify(next.selection_summary),
      now,
      now,
    ],
  );
}

async function mirrorBenchmarkLatestReportPostgres(userId, reportType, payload) {
  await postgresPool.query(
    `
      INSERT INTO benchmark_reports_latest (user_id, report_type, worker_job_id, report_id, report_json, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      ON CONFLICT (user_id, report_type) DO UPDATE SET
        worker_job_id = EXCLUDED.worker_job_id,
        report_id = EXCLUDED.report_id,
        report_json = EXCLUDED.report_json,
        updated_at = EXCLUDED.updated_at
    `,
    [userId, reportType, payload.job_id, payload.report_id, JSON.stringify(payload.report), payload.updated_at],
  );

  if (payload.job_id) {
    await postgresPool.query(
      `
        UPDATE benchmark_job_history
        SET report_id = $1, report_json = $2::jsonb, updated_at = $3
        WHERE worker_job_id = $4
      `,
      [payload.report_id, JSON.stringify(payload.report), payload.updated_at, payload.job_id],
    );
  }
}

let strategyMemoryPostgresEnsured = false;
let strategyCoachPostgresEnsured = false;
let benchmarkLimitlessPostgresEnsured = false;

function normalizeStrategyMemoryText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function stableStrategyMemoryId(prefix, parts, length = 24) {
  const hash = sha256Hex(parts.map((part) => normalizeStrategyMemoryText(part)).join('|'));
  return `${prefix}_${hash.slice(0, length)}`;
}

function normalizeLimitlessText(value) {
  return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function nullableLimitlessText(value) {
  const text = normalizeLimitlessText(value);
  return text || null;
}

function limitlessJsonParam(value) {
  return JSON.stringify(value ?? null);
}

function limitlessIntegerOrNull(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function limitlessBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return false;
}

function firstLimitlessValue(source, keys, defaultValue = null) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return defaultValue;
}

function stableBenchmarkLimitlessId(prefix, parts, length = 24) {
  const hash = sha256Hex(parts.map((part) => normalizeLimitlessText(part)).join('|'));
  return `${prefix}_${hash.slice(0, length)}`;
}

function buildBenchmarkLimitlessSyncRunRecord(input = {}) {
  const now = new Date().toISOString();
  const source = nullableLimitlessText(firstLimitlessValue(input, ['source'])) || 'limitless';
  const game = nullableLimitlessText(firstLimitlessValue(input, ['game'])) || 'vgc';
  const formatId = nullableLimitlessText(firstLimitlessValue(input, ['formatId', 'format_id'])) || 'unknown';
  const startedAt = nullableLimitlessText(firstLimitlessValue(input, ['startedAt', 'started_at'])) || now;
  const syncVersion = nullableLimitlessText(firstLimitlessValue(input, ['syncVersion', 'sync_version'])) || 'limitless-weekly-v1';
  const syncRunId = nullableLimitlessText(firstLimitlessValue(input, ['syncRunId', 'sync_run_id']))
    || stableBenchmarkLimitlessId('limitless_sync', [source, game, formatId, startedAt, syncVersion]);

  return {
    syncRunId,
    source,
    game,
    formatId,
    status: nullableLimitlessText(firstLimitlessValue(input, ['status'])) || 'started',
    startedAt,
    completedAt: nullableLimitlessText(firstLimitlessValue(input, ['completedAt', 'completed_at'])),
    tournamentCount: limitlessIntegerOrNull(firstLimitlessValue(input, ['tournamentCount', 'tournament_count'])),
    teamCount: limitlessIntegerOrNull(firstLimitlessValue(input, ['teamCount', 'team_count'])),
    error: nullableLimitlessText(firstLimitlessValue(input, ['error'])),
    requestSummary: firstLimitlessValue(input, ['requestSummary', 'request_summary_json', 'rateLimitSummary', 'rate_limit_summary'], null),
    syncVersion,
  };
}

function buildBenchmarkLimitlessTournamentRecord(input = {}) {
  const now = new Date().toISOString();
  const sourceTournamentId = nullableLimitlessText(firstLimitlessValue(input, ['tournamentId', 'tournament_id', 'id']));
  const game = nullableLimitlessText(firstLimitlessValue(input, ['game'])) || 'vgc';
  const formatId = nullableLimitlessText(firstLimitlessValue(input, ['formatId', 'format_id'])) || 'unknown';
  const name = nullableLimitlessText(firstLimitlessValue(input, ['name', 'tournamentName', 'tournament_name']));
  const tournamentStartDate = nullableLimitlessText(firstLimitlessValue(input, ['tournamentStartDate', 'tournament_start_date', 'date', 'startDate']));
  const tournamentId = sourceTournamentId
    || stableBenchmarkLimitlessId('limitless_tournament', [game, formatId, name, tournamentStartDate]);

  return {
    tournamentId,
    game,
    formatId,
    name,
    tournamentStartDate,
    tournamentEndDate: nullableLimitlessText(firstLimitlessValue(input, ['tournamentEndDate', 'tournament_end_date', 'endDate'])),
    players: limitlessIntegerOrNull(firstLimitlessValue(input, ['players', 'playerCount', 'player_count'])),
    organizer: nullableLimitlessText(firstLimitlessValue(input, ['organizer'])),
    decklistsPublic: limitlessBoolean(firstLimitlessValue(input, ['decklistsPublic', 'decklists_public'])),
    online: limitlessBoolean(firstLimitlessValue(input, ['online', 'isOnline', 'is_online'])),
    phase: nullableLimitlessText(firstLimitlessValue(input, ['phase'])),
    mode: nullableLimitlessText(firstLimitlessValue(input, ['mode'])),
    sourceUrl: nullableLimitlessText(firstLimitlessValue(input, ['sourceUrl', 'source_url', 'url'])),
    raw: firstLimitlessValue(input, ['raw', 'rawJson', 'raw_json'], null),
    lastSyncRunId: nullableLimitlessText(firstLimitlessValue(input, ['lastSyncRunId', 'last_sync_run_id', 'syncRunId', 'sync_run_id'])),
    firstSeenAt: nullableLimitlessText(firstLimitlessValue(input, ['firstSeenAt', 'first_seen_at'])) || now,
    lastSeenAt: nullableLimitlessText(firstLimitlessValue(input, ['lastSeenAt', 'last_seen_at'])) || now,
    updatedAt: nullableLimitlessText(firstLimitlessValue(input, ['updatedAt', 'updated_at'])) || now,
  };
}

function buildBenchmarkLimitlessTeamlistRecord(input = {}) {
  const now = new Date().toISOString();
  const tournamentId = nullableLimitlessText(firstLimitlessValue(input, ['tournamentId', 'tournament_id']));
  const playerId = nullableLimitlessText(firstLimitlessValue(input, ['playerId', 'player_id']));
  const playerName = nullableLimitlessText(firstLimitlessValue(input, ['playerName', 'player_name', 'name']));
  const normalizedTeamExport = nullableLimitlessText(firstLimitlessValue(input, ['normalizedTeamExport', 'normalized_team_export', 'teamExport', 'team_export']));
  const teamHash = nullableLimitlessText(firstLimitlessValue(input, ['teamHash', 'team_hash']))
    || (normalizedTeamExport ? sha256Hex(normalizedTeamExport) : null);
  const opponentFingerprint = nullableLimitlessText(firstLimitlessValue(input, ['opponentFingerprint', 'opponent_fingerprint', 'fingerprint']))
    || teamHash;
  const stableSourceOpponentId = nullableLimitlessText(firstLimitlessValue(input, ['sourceOpponentId', 'source_opponent_id']))
    || stableBenchmarkLimitlessId('limitless_opp', [tournamentId, playerId, playerName, teamHash]);

  return {
    sourceOpponentId: stableSourceOpponentId,
    tournamentId,
    game: nullableLimitlessText(firstLimitlessValue(input, ['game'])) || 'vgc',
    formatId: nullableLimitlessText(firstLimitlessValue(input, ['formatId', 'format_id'])) || 'unknown',
    playerId,
    playerName,
    playerCountry: nullableLimitlessText(firstLimitlessValue(input, ['playerCountry', 'player_country', 'country'])),
    placing: limitlessIntegerOrNull(firstLimitlessValue(input, ['placing', 'place'])),
    recordText: nullableLimitlessText(firstLimitlessValue(input, ['recordText', 'record_text', 'record'])),
    dropped: limitlessBoolean(firstLimitlessValue(input, ['dropped', 'drop'])),
    rawTeamlist: firstLimitlessValue(input, ['rawTeamlist', 'raw_teamlist_json', 'rawTeamlistJson'], null),
    normalizedTeamExport,
    teamHash,
    opponentFingerprint,
    archetypeKey: nullableLimitlessText(firstLimitlessValue(input, ['archetypeKey', 'archetype_key', 'archetype'])),
    templateKey: nullableLimitlessText(firstLimitlessValue(input, ['templateKey', 'template_key'])),
    featured: limitlessBoolean(firstLimitlessValue(input, ['featured', 'isFeatured', 'is_featured'])),
    topCut: limitlessBoolean(firstLimitlessValue(input, ['topCut', 'top_cut'])),
    sourceTier: nullableLimitlessText(firstLimitlessValue(input, ['sourceTier', 'source_tier'])) || 'limitless',
    sourceUrl: nullableLimitlessText(firstLimitlessValue(input, ['sourceUrl', 'source_url', 'url'])),
    lastSyncRunId: nullableLimitlessText(firstLimitlessValue(input, ['lastSyncRunId', 'last_sync_run_id', 'syncRunId', 'sync_run_id'])),
    firstSeenAt: nullableLimitlessText(firstLimitlessValue(input, ['firstSeenAt', 'first_seen_at'])) || now,
    lastSeenAt: nullableLimitlessText(firstLimitlessValue(input, ['lastSeenAt', 'last_seen_at'])) || now,
    updatedAt: nullableLimitlessText(firstLimitlessValue(input, ['updatedAt', 'updated_at'])) || now,
  };
}

function buildBenchmarkOpponentPoolSnapshotRecord(input = {}) {
  const now = new Date().toISOString();
  const syncRunId = nullableLimitlessText(firstLimitlessValue(input, ['syncRunId', 'sync_run_id']));
  const formatId = nullableLimitlessText(firstLimitlessValue(input, ['formatId', 'format_id'])) || 'unknown';
  const poolKey = nullableLimitlessText(firstLimitlessValue(input, ['poolKey', 'pool_key'])) || 'default';
  const createdAt = nullableLimitlessText(firstLimitlessValue(input, ['createdAt', 'created_at'])) || now;
  const opponentIds = firstLimitlessValue(input, ['opponentIds', 'opponent_ids_json', 'opponent_ids'], []);
  const poolSnapshotId = nullableLimitlessText(firstLimitlessValue(input, ['poolSnapshotId', 'pool_snapshot_id']))
    || stableBenchmarkLimitlessId('limitless_pool', [syncRunId, formatId, poolKey, createdAt]);

  return {
    poolSnapshotId,
    syncRunId,
    formatId,
    poolKey,
    label: nullableLimitlessText(firstLimitlessValue(input, ['label', 'poolLabel', 'pool_label'])),
    criteria: firstLimitlessValue(input, ['criteria', 'criteria_json'], null),
    opponentCount: limitlessIntegerOrNull(firstLimitlessValue(input, ['opponentCount', 'opponent_count'])) || (Array.isArray(opponentIds) ? opponentIds.length : 0),
    opponentIds,
    isActive: limitlessBoolean(firstLimitlessValue(input, ['isActive', 'is_active', 'active'])),
    createdAt,
  };
}

async function ensureBenchmarkLimitlessPostgresTables() {
  if (benchmarkLimitlessPostgresEnsured || !postgresPool) return;
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS benchmark_limitless_sync_runs (
      sync_run_id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'limitless',
      game TEXT NOT NULL DEFAULT 'vgc',
      format_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      started_at TEXT NOT NULL,
      completed_at TEXT DEFAULT NULL,
      tournament_count INTEGER DEFAULT NULL,
      team_count INTEGER DEFAULT NULL,
      error TEXT DEFAULT NULL,
      request_summary_json JSONB DEFAULT NULL,
      sync_version TEXT NOT NULL DEFAULT 'limitless-weekly-v1'
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS benchmark_limitless_tournaments (
      tournament_id TEXT PRIMARY KEY,
      game TEXT NOT NULL DEFAULT 'vgc',
      format_id TEXT NOT NULL,
      name TEXT DEFAULT NULL,
      tournament_start_date TEXT DEFAULT NULL,
      tournament_end_date TEXT DEFAULT NULL,
      players INTEGER DEFAULT NULL,
      organizer TEXT DEFAULT NULL,
      decklists_public BOOLEAN NOT NULL DEFAULT FALSE,
      online BOOLEAN NOT NULL DEFAULT FALSE,
      phase TEXT DEFAULT NULL,
      mode TEXT DEFAULT NULL,
      source_url TEXT DEFAULT NULL,
      raw_json JSONB DEFAULT NULL,
      last_sync_run_id TEXT DEFAULT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS benchmark_limitless_teamlists (
      source_opponent_id TEXT PRIMARY KEY,
      tournament_id TEXT DEFAULT NULL,
      game TEXT NOT NULL DEFAULT 'vgc',
      format_id TEXT NOT NULL,
      player_id TEXT DEFAULT NULL,
      player_name TEXT DEFAULT NULL,
      player_country TEXT DEFAULT NULL,
      "placing" INTEGER DEFAULT NULL,
      record_text TEXT DEFAULT NULL,
      dropped BOOLEAN NOT NULL DEFAULT FALSE,
      raw_teamlist_json JSONB DEFAULT NULL,
      normalized_team_export TEXT DEFAULT NULL,
      team_hash TEXT DEFAULT NULL,
      opponent_fingerprint TEXT DEFAULT NULL,
      archetype_key TEXT DEFAULT NULL,
      template_key TEXT DEFAULT NULL,
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      top_cut BOOLEAN NOT NULL DEFAULT FALSE,
      source_tier TEXT DEFAULT NULL,
      source_url TEXT DEFAULT NULL,
      last_sync_run_id TEXT DEFAULT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS benchmark_opponent_pool_snapshots (
      pool_snapshot_id TEXT PRIMARY KEY,
      sync_run_id TEXT DEFAULT NULL,
      format_id TEXT NOT NULL,
      pool_key TEXT NOT NULL,
      label TEXT DEFAULT NULL,
      criteria_json JSONB DEFAULT NULL,
      opponent_count INTEGER NOT NULL DEFAULT 0,
      opponent_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL
    )
  `);
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_limitless_sync_runs_format_started ON benchmark_limitless_sync_runs (format_id, started_at DESC)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_limitless_sync_runs_status_started ON benchmark_limitless_sync_runs (status, started_at DESC)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_limitless_tournaments_format_date ON benchmark_limitless_tournaments (format_id, tournament_start_date DESC)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_limitless_tournaments_seen ON benchmark_limitless_tournaments (last_seen_at DESC)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_limitless_teamlists_format_fingerprint ON benchmark_limitless_teamlists (format_id, opponent_fingerprint)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_limitless_teamlists_tournament_placing ON benchmark_limitless_teamlists (tournament_id, "placing")');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_limitless_teamlists_source_tier ON benchmark_limitless_teamlists (source_tier, "placing")');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_limitless_teamlists_seen ON benchmark_limitless_teamlists (last_seen_at DESC)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_limitless_pool_snapshots_format_key_created ON benchmark_opponent_pool_snapshots (format_id, pool_key, created_at DESC)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_limitless_pool_snapshots_sync_run ON benchmark_opponent_pool_snapshots (sync_run_id)');
  await postgresPool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_limitless_pool_snapshots_active ON benchmark_opponent_pool_snapshots (format_id, pool_key) WHERE is_active = TRUE');
  benchmarkLimitlessPostgresEnsured = true;
}

async function ensureBenchmarkLimitlessStorage() {
  await ensureBenchmarkLimitlessPostgresTables();
  return {
    postgres_available: Boolean(postgresPool),
    ensured: Boolean(benchmarkLimitlessPostgresEnsured),
  };
}

async function saveBenchmarkLimitlessSyncRun(input = {}) {
  const record = buildBenchmarkLimitlessSyncRunRecord(input);
  await ensureBenchmarkLimitlessPostgresTables();
  await postgresPool.query(
    `
      INSERT INTO benchmark_limitless_sync_runs (
        sync_run_id, source, game, format_id, status, started_at, completed_at,
        tournament_count, team_count, error, request_summary_json, sync_version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
      ON CONFLICT (sync_run_id) DO UPDATE SET
        status = EXCLUDED.status,
        completed_at = EXCLUDED.completed_at,
        tournament_count = EXCLUDED.tournament_count,
        team_count = EXCLUDED.team_count,
        error = EXCLUDED.error,
        request_summary_json = EXCLUDED.request_summary_json,
        sync_version = EXCLUDED.sync_version
    `,
    [
      record.syncRunId,
      record.source,
      record.game,
      record.formatId,
      record.status,
      record.startedAt,
      record.completedAt,
      record.tournamentCount,
      record.teamCount,
      record.error,
      limitlessJsonParam(record.requestSummary),
      record.syncVersion,
    ],
  );
  return record;
}

async function saveBenchmarkLimitlessTournament(input = {}) {
  const record = buildBenchmarkLimitlessTournamentRecord(input);
  await ensureBenchmarkLimitlessPostgresTables();
  await postgresPool.query(
    `
      INSERT INTO benchmark_limitless_tournaments (
        tournament_id, game, format_id, name, tournament_start_date, tournament_end_date,
        players, organizer, decklists_public, online, phase, mode, source_url, raw_json,
        last_sync_run_id, first_seen_at, last_seen_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18)
      ON CONFLICT (tournament_id) DO UPDATE SET
        game = EXCLUDED.game,
        format_id = EXCLUDED.format_id,
        name = EXCLUDED.name,
        tournament_start_date = EXCLUDED.tournament_start_date,
        tournament_end_date = EXCLUDED.tournament_end_date,
        players = EXCLUDED.players,
        organizer = EXCLUDED.organizer,
        decklists_public = EXCLUDED.decklists_public,
        online = EXCLUDED.online,
        phase = EXCLUDED.phase,
        mode = EXCLUDED.mode,
        source_url = EXCLUDED.source_url,
        raw_json = EXCLUDED.raw_json,
        last_sync_run_id = EXCLUDED.last_sync_run_id,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = EXCLUDED.updated_at
    `,
    [
      record.tournamentId,
      record.game,
      record.formatId,
      record.name,
      record.tournamentStartDate,
      record.tournamentEndDate,
      record.players,
      record.organizer,
      record.decklistsPublic,
      record.online,
      record.phase,
      record.mode,
      record.sourceUrl,
      limitlessJsonParam(record.raw),
      record.lastSyncRunId,
      record.firstSeenAt,
      record.lastSeenAt,
      record.updatedAt,
    ],
  );
  return record;
}

async function saveBenchmarkLimitlessTeamlist(input = {}) {
  const record = buildBenchmarkLimitlessTeamlistRecord(input);
  await ensureBenchmarkLimitlessPostgresTables();
  await postgresPool.query(
    `
      INSERT INTO benchmark_limitless_teamlists (
        source_opponent_id, tournament_id, game, format_id, player_id, player_name, player_country,
        "placing", record_text, dropped, raw_teamlist_json, normalized_team_export, team_hash,
        opponent_fingerprint, archetype_key, template_key, featured, top_cut, source_tier,
        source_url, last_sync_run_id, first_seen_at, last_seen_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
      ON CONFLICT (source_opponent_id) DO UPDATE SET
        tournament_id = EXCLUDED.tournament_id,
        game = EXCLUDED.game,
        format_id = EXCLUDED.format_id,
        player_id = EXCLUDED.player_id,
        player_name = EXCLUDED.player_name,
        player_country = EXCLUDED.player_country,
        "placing" = EXCLUDED."placing",
        record_text = EXCLUDED.record_text,
        dropped = EXCLUDED.dropped,
        raw_teamlist_json = EXCLUDED.raw_teamlist_json,
        normalized_team_export = EXCLUDED.normalized_team_export,
        team_hash = EXCLUDED.team_hash,
        opponent_fingerprint = EXCLUDED.opponent_fingerprint,
        archetype_key = EXCLUDED.archetype_key,
        template_key = EXCLUDED.template_key,
        featured = EXCLUDED.featured,
        top_cut = EXCLUDED.top_cut,
        source_tier = EXCLUDED.source_tier,
        source_url = EXCLUDED.source_url,
        last_sync_run_id = EXCLUDED.last_sync_run_id,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = EXCLUDED.updated_at
    `,
    [
      record.sourceOpponentId,
      record.tournamentId,
      record.game,
      record.formatId,
      record.playerId,
      record.playerName,
      record.playerCountry,
      record.placing,
      record.recordText,
      record.dropped,
      limitlessJsonParam(record.rawTeamlist),
      record.normalizedTeamExport,
      record.teamHash,
      record.opponentFingerprint,
      record.archetypeKey,
      record.templateKey,
      record.featured,
      record.topCut,
      record.sourceTier,
      record.sourceUrl,
      record.lastSyncRunId,
      record.firstSeenAt,
      record.lastSeenAt,
      record.updatedAt,
    ],
  );
  return record;
}

async function saveBenchmarkOpponentPoolSnapshot(input = {}) {
  const record = buildBenchmarkOpponentPoolSnapshotRecord(input);
  await ensureBenchmarkLimitlessPostgresTables();
  const client = await postgresPool.connect();
  try {
    await client.query('BEGIN');
    if (record.isActive) {
      await client.query(
        'UPDATE benchmark_opponent_pool_snapshots SET is_active = FALSE WHERE format_id = $1 AND pool_key = $2 AND is_active = TRUE',
        [record.formatId, record.poolKey],
      );
    }
    await client.query(
      `
        INSERT INTO benchmark_opponent_pool_snapshots (
          pool_snapshot_id, sync_run_id, format_id, pool_key, label, criteria_json,
          opponent_count, opponent_ids_json, is_active, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10)
        ON CONFLICT (pool_snapshot_id) DO UPDATE SET
          sync_run_id = EXCLUDED.sync_run_id,
          label = EXCLUDED.label,
          criteria_json = EXCLUDED.criteria_json,
          opponent_count = EXCLUDED.opponent_count,
          opponent_ids_json = EXCLUDED.opponent_ids_json,
          is_active = EXCLUDED.is_active
      `,
      [
        record.poolSnapshotId,
        record.syncRunId,
        record.formatId,
        record.poolKey,
        record.label,
        limitlessJsonParam(record.criteria),
        record.opponentCount,
        limitlessJsonParam(record.opponentIds),
        record.isActive,
        record.createdAt,
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return record;
}

async function getActiveBenchmarkOpponentPoolSnapshot(input = {}) {
  const formatId = nullableLimitlessText(firstLimitlessValue(input, ['formatId', 'format_id']));
  const poolKey = nullableLimitlessText(firstLimitlessValue(input, ['poolKey', 'pool_key']));
  if (!formatId) return null;
  await ensureBenchmarkLimitlessPostgresTables();
  const params = poolKey ? [formatId, poolKey] : [formatId];
  const where = poolKey
    ? 'format_id = $1 AND pool_key = $2 AND is_active = TRUE'
    : 'format_id = $1 AND is_active = TRUE';
  const { rows } = await postgresPool.query(
    `
      SELECT *
      FROM benchmark_opponent_pool_snapshots
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT 1
    `,
    params,
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    poolSnapshotId: row.pool_snapshot_id,
    syncRunId: row.sync_run_id || null,
    formatId: row.format_id,
    poolKey: row.pool_key,
    label: row.label || null,
    criteria: parseJsonOrDefault(row.criteria_json, null),
    opponentCount: limitlessIntegerOrNull(row.opponent_count) || 0,
    opponentIds: parseJsonOrDefault(row.opponent_ids_json, []),
    isActive: row.is_active === true,
    createdAt: row.created_at,
  };
}

function mapBenchmarkLimitlessTeamlistRow(row = {}) {
  return {
    sourceOpponentId: row.source_opponent_id,
    tournamentId: row.tournament_id || null,
    game: row.game || 'vgc',
    formatId: row.format_id || null,
    playerId: row.player_id || null,
    playerName: row.player_name || null,
    playerCountry: row.player_country || null,
    placing: limitlessIntegerOrNull(row.placing),
    recordText: row.record_text || null,
    dropped: row.dropped === true,
    rawTeamlist: parseJsonOrDefault(row.raw_teamlist_json, null),
    normalizedTeamExport: row.normalized_team_export || null,
    teamHash: row.team_hash || null,
    opponentFingerprint: row.opponent_fingerprint || null,
    archetypeKey: row.archetype_key || null,
    templateKey: row.template_key || null,
    featured: row.featured === true,
    topCut: row.top_cut === true,
    sourceTier: row.source_tier || null,
    sourceUrl: row.source_url || null,
    lastSyncRunId: row.last_sync_run_id || null,
    firstSeenAt: row.first_seen_at || null,
    lastSeenAt: row.last_seen_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function getActiveBenchmarkLimitlessOpponentPool(input = {}) {
  const formatId = nullableLimitlessText(firstLimitlessValue(input, ['formatId', 'format_id']));
  const poolKey = nullableLimitlessText(firstLimitlessValue(input, ['poolKey', 'pool_key'])) || 'default';
  if (!formatId || !postgresPool) {
    return {
      source: 'aegis-limitless-active-opponent-pool',
      snapshot: null,
      opponents: [],
    };
  }

  const snapshotResult = await postgresPool.query(
    `
      SELECT *
      FROM benchmark_opponent_pool_snapshots
      WHERE format_id = $1 AND pool_key = $2 AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [formatId, poolKey],
  );
  const snapshotRow = snapshotResult.rows?.[0];
  if (!snapshotRow) {
    return {
      source: 'aegis-limitless-active-opponent-pool',
      snapshot: null,
      opponents: [],
    };
  }

  const opponentIds = parseJsonOrDefault(snapshotRow.opponent_ids_json, [])
    .map((value) => nullableLimitlessText(value))
    .filter(Boolean);
  if (!opponentIds.length) {
    return {
      source: 'aegis-limitless-active-opponent-pool',
      snapshot: {
        poolSnapshotId: snapshotRow.pool_snapshot_id,
        syncRunId: snapshotRow.sync_run_id || null,
        formatId: snapshotRow.format_id,
        poolKey: snapshotRow.pool_key,
        label: snapshotRow.label || null,
        criteria: parseJsonOrDefault(snapshotRow.criteria_json, null),
        opponentCount: limitlessIntegerOrNull(snapshotRow.opponent_count) || 0,
        opponentIds,
        isActive: snapshotRow.is_active === true,
        createdAt: snapshotRow.created_at,
      },
      opponents: [],
    };
  }

  const teamlistResult = await postgresPool.query(
    `
      SELECT *
      FROM benchmark_limitless_teamlists
      WHERE source_opponent_id = ANY($1::text[])
      ORDER BY array_position($1::text[], source_opponent_id)
    `,
    [opponentIds],
  );

  return {
    source: 'aegis-limitless-active-opponent-pool',
    snapshot: {
      poolSnapshotId: snapshotRow.pool_snapshot_id,
      syncRunId: snapshotRow.sync_run_id || null,
      formatId: snapshotRow.format_id,
      poolKey: snapshotRow.pool_key,
      label: snapshotRow.label || null,
      criteria: parseJsonOrDefault(snapshotRow.criteria_json, null),
      opponentCount: limitlessIntegerOrNull(snapshotRow.opponent_count) || opponentIds.length,
      opponentIds,
      isActive: snapshotRow.is_active === true,
      createdAt: snapshotRow.created_at,
    },
    opponents: (teamlistResult.rows || []).map(mapBenchmarkLimitlessTeamlistRow),
  };
}

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch (error) {
    return 0;
  }
}

function buildReplayId(formatId, archetype, gameNumber, opponentRegistryId = null) {
  const slug = (value, fallback) => {
    const cleaned = normalizeStrategyMemoryText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return cleaned || fallback;
  };
  const prefix = Number(opponentRegistryId) > 0 ? `${Number(opponentRegistryId)}-` : '';
  return `${slug(formatId, 'matchup-report')}-${prefix}${slug(archetype, 'opponent')}-game-${Math.max(Number.parseInt(gameNumber, 10) || 1, 1)}`;
}

function normalizeStrategyMemoryResult(value, winner = null) {
  const normalized = normalizeStrategyMemoryText(value).toLowerCase();
  if (['win', 'loss', 'tie'].includes(normalized)) return normalized;
  const winnerText = normalizeStrategyMemoryText(winner).toLowerCase();
  if (winnerText === 'professor aegis user' || winnerText === 'you' || winnerText === 'p1') return 'win';
  if (winnerText === 'benchmark opponent' || winnerText === 'opponent' || winnerText === 'p2') return 'loss';
  return winnerText ? 'tie' : 'unknown';
}

function computeStrategyMemoryConfidence(report = {}) {
  const gamesCompleted = Number.parseInt(report?.totalGamesCompleted, 10) || 0;
  const opponentsCompleted = Number.parseInt(report?.opponentsCompleted, 10) || 0;
  const winRate = Number(report?.winRate);
  const rows = Array.isArray(report?.resultsByOpponent) ? report.resultsByOpponent : [];
  const rates = rows.map((row) => Number(row?.winRate)).filter((value) => Number.isFinite(value));
  const winRateSpread = rates.length ? Math.max(...rates) - Math.min(...rates) : null;
  let confidenceLabel = 'low';
  if (gamesCompleted >= 30 || (opponentsCompleted >= 10 && gamesCompleted >= 10)) {
    confidenceLabel = 'high';
  } else if (gamesCompleted >= 6 || opponentsCompleted >= 3) {
    confidenceLabel = 'medium';
  }
  return {
    confidenceLabel,
    inputs: {
      gamesCompleted,
      opponentsCompleted,
      winRate: Number.isFinite(winRate) ? winRate : null,
      winRateSpread,
    },
  };
}

function buildStrategyMemoryProofTurns(source = {}) {
  const coach = source?.coachPayload || source?.coach_payload || source?.proofTurns || null;
  if (!coach || typeof coach !== 'object') {
    return { proofTurns: [], evidenceRows: [] };
  }

  const evidenceRows = [];
  const addEvidence = (turn, evidenceType, label, summary, sourceData = {}) => {
    const turnNumber = Number.parseInt(turn, 10);
    if (!Number.isFinite(turnNumber) || turnNumber <= 0) return;
    evidenceRows.push({
      turnNumber,
      evidenceType,
      label: normalizeStrategyMemoryText(label || evidenceType),
      summary: normalizeStrategyMemoryText(summary || label || evidenceType),
      tags: Array.isArray(sourceData?.tags) ? sourceData.tags : [],
      source: sourceData,
    });
  };

  for (const marker of Array.isArray(coach.criticalTurns) ? coach.criticalTurns : []) {
    addEvidence(marker?.turn, 'critical-turn', marker?.label || marker?.kind, marker?.label || marker?.note, marker);
  }
  if (coach.criticalTurn) {
    addEvidence(coach.criticalTurn, 'critical-turn', 'Critical turn', coach.criticalNote, {
      turn: coach.criticalTurn,
      label: coach.criticalNote,
    });
  }
  for (const turn of Array.isArray(coach.pivotTurns) ? coach.pivotTurns : []) {
    addEvidence(turn, 'pivot-turn', 'Pivot turn', 'A switch or pivot move changed board position.', { turn });
  }
  for (const item of Array.isArray(coach.turnTags) ? coach.turnTags : []) {
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    if (!tags.length) continue;
    addEvidence(item?.turn, 'turn-tags', tags.join(', '), tags.join(', '), item);
  }
  for (const item of Array.isArray(coach.turnCoaching) ? coach.turnCoaching : []) {
    addEvidence(
      item?.turn,
      'turn-coaching',
      item?.whatHappened || 'Turn coaching',
      item?.whyItMattered || item?.nextAdjustment || item?.whatHappened,
      item,
    );
  }

  const turnEventCounts = coach?.advancedNotes?.turnEventCounts || {};
  for (const [turn, count] of Object.entries(turnEventCounts)) {
    if (Number.parseInt(count, 10) > 0) {
      addEvidence(turn, 'turn-event-count', 'Turn event count', `${count} notable replay events captured.`, { turn, count });
    }
  }

  const proofByTurn = new Map();
  for (const row of evidenceRows) {
    const bucket = proofByTurn.get(row.turnNumber) || {
      turn: row.turnNumber,
      types: [],
      tags: [],
      summaries: [],
    };
    if (!bucket.types.includes(row.evidenceType)) bucket.types.push(row.evidenceType);
    for (const tag of row.tags || []) {
      if (!bucket.tags.includes(tag)) bucket.tags.push(tag);
    }
    if (row.summary && !bucket.summaries.includes(row.summary)) bucket.summaries.push(row.summary);
    proofByTurn.set(row.turnNumber, bucket);
  }

  return {
    proofTurns: Array.from(proofByTurn.values()).sort((a, b) => a.turn - b.turn),
    evidenceRows,
  };
}

function buildStrategyMemoryFactsFromReport({
  userId,
  reportType = 'run-benchmark-suite',
  report = {},
  workerJobId = null,
  reportId = null,
  updatedAt = null,
} = {}) {
  const safeReport = report && typeof report === 'object' ? report : {};
  const now = updatedAt || new Date().toISOString();
  const generatedAt = safeReport.generatedAt || safeReport.savedReport?.generatedAt || now;
  const resolvedReportId = reportId
    || safeReport?.savedReport?.reportId
    || safeReport?.reportId
    || stableStrategyMemoryId('report', [userId, reportType, workerJobId, generatedAt]);
  const formatId = normalizeStrategyMemoryText(safeReport.formatId || safeReport.savedReport?.formatId);
  const benchmarkMode = normalizeStrategyMemoryText(safeReport.benchmarkMode || safeReport.selectionSummary?.mode);
  const playerTeamExport = normalizeStrategyMemoryText(
    safeReport.playerTeamExport
      || safeReport.userTeamExport
      || safeReport.teamExport
      || safeReport.request?.teamExport
      || safeReport.request?.team_export,
  );
  const teamHash = sha256Hex(playerTeamExport);
  const teamVersionId = stableStrategyMemoryId('team', [userId, formatId, teamHash]);
  const archive = safeReport.matchArchive && typeof safeReport.matchArchive === 'object' ? safeReport.matchArchive : {};
  const sources = Array.isArray(archive.sources) ? archive.sources : [];
  const files = Array.isArray(archive.files) ? archive.files : [];
  const confidence = computeStrategyMemoryConfidence(safeReport);
  const reportJsonHash = sha256Hex(JSON.stringify(safeReport));

  let battleLogOriginalBytesTotal = 0;
  let battleLogStoredBytesTotal = 0;
  let battleLogPrunedCount = 0;
  let battleTurnsTotal = 0;

  const battles = [];
  const evidenceRows = [];
  sources.forEach((rawSource, index) => {
    const source = rawSource && typeof rawSource === 'object' ? rawSource : {};
    const gameNumber = Math.max(Number.parseInt(source.gameNumber, 10) || (index + 1), 1);
    const opponentRegistryId = Number.parseInt(source.opponentRegistryId, 10) || 0;
    const archetype = normalizeStrategyMemoryText(source.archetype || source.opponentName || 'Opponent');
    const opponentName = normalizeStrategyMemoryText(source.opponentName || archetype);
    const battleId = stableStrategyMemoryId('battle', [resolvedReportId, opponentRegistryId, archetype, gameNumber]);
    const battleLogData = normalizeStrategyMemoryText(source.battleLogData);
    const battleLogBytes = battleLogData ? Buffer.byteLength(battleLogData, 'utf8') : 0;
    const battleLogOriginalBytes = Number.parseInt(source.battleLogDataOriginalBytes, 10) || battleLogBytes;
    const battleLogPruned = Boolean(source.battleLogDataPruned);
    const { proofTurns, evidenceRows: sourceEvidenceRows } = buildStrategyMemoryProofTurns(source);
    const replayId = normalizeStrategyMemoryText(source.replayId || buildReplayId(formatId, archetype, gameNumber, opponentRegistryId));
    const result = normalizeStrategyMemoryResult(source.result || source.verdict, source.winner);
    const playerTeamHash = source.playerTeamExport ? sha256Hex(normalizeStrategyMemoryText(source.playerTeamExport)) : teamHash;
    const opponentTeamHash = source.opponentTeamExport ? sha256Hex(normalizeStrategyMemoryText(source.opponentTeamExport)) : null;
    const battleStorageMetrics = {
      battleLogBytes,
      battleLogOriginalBytes,
      battleLogPruned,
      hasCoachPayload: Boolean(source.coachPayload || source.coach_payload || source.proofTurns),
    };

    battleLogStoredBytesTotal += battleLogBytes;
    battleLogOriginalBytesTotal += battleLogOriginalBytes;
    if (battleLogPruned) battleLogPrunedCount += 1;
    battleTurnsTotal += Number.parseInt(source.turns, 10) || 0;

    battles.push({
      battleId,
      reportId: resolvedReportId,
      userId,
      teamVersionId,
      formatId,
      opponentRegistryId,
      archetype,
      opponentName,
      gameNumber,
      result,
      winner: normalizeStrategyMemoryText(source.winner),
      turns: Number.parseInt(source.turns, 10) || null,
      seriesResult: normalizeStrategyMemoryResult(source.seriesResult, null),
      replayId,
      archiveRelativePath: normalizeStrategyMemoryText(source.relativePath),
      battleLogPruned,
      battleLogBytes,
      battleLogOriginalBytes,
      playerTeamHash,
      opponentTeamHash,
      proofTurns,
      storageMetrics: battleStorageMetrics,
      createdAt: generatedAt,
      updatedAt: now,
    });

    sourceEvidenceRows.forEach((row, rowIndex) => {
      evidenceRows.push({
        evidenceId: stableStrategyMemoryId('evidence', [battleId, row.evidenceType, row.turnNumber, rowIndex]),
        battleId,
        reportId: resolvedReportId,
        userId,
        turnNumber: row.turnNumber,
        evidenceType: row.evidenceType,
        label: row.label,
        summary: row.summary,
        tags: row.tags,
        source: row.source,
        createdAt: generatedAt,
        updatedAt: now,
      });
    });
  });

  const storageMetrics = {
    reportJsonBytes: jsonByteLength(safeReport),
    archiveSourceCount: sources.length,
    generatedReplayCount: files.length,
    battleLogStoredBytesTotal,
    battleLogOriginalBytesTotal,
    battleLogPrunedCount,
    failedOrTempCount: Number.parseInt(safeReport.totalGamesFailed, 10) || 0,
  };

  return {
    teamVersion: {
      teamVersionId,
      userId,
      formatId,
      teamHash,
      firstSeenAt: generatedAt,
      lastSeenAt: now,
    },
    report: {
      reportId: resolvedReportId,
      userId,
      reportType,
      workerJobId: workerJobId || null,
      teamVersionId,
      teamHash,
      formatId,
      benchmarkMode,
      generatedAt,
      updatedAt: now,
      totalGamesCompleted: Number.parseInt(safeReport.totalGamesCompleted, 10) || sources.length || 0,
      totalTurns: Number.parseInt(safeReport.totalTurns, 10) || battleTurnsTotal || 0,
      averageTurns: Number(safeReport.averageTurns) || 0,
      winRate: Number(safeReport.winRate) || 0,
      confidenceLabel: confidence.confidenceLabel,
      confidenceInputs: confidence.inputs,
      selectionSummary: safeReport.selectionSummary || null,
      storageMetrics,
      promptVersion: '',
      modelTier: '',
      modelUsed: '',
      reportJsonHash,
    },
    battles,
    evidenceRows,
  };
}

async function ensureStrategyMemoryPostgresTables() {
  if (strategyMemoryPostgresEnsured || !postgresPool) return;
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS strategy_memory_team_versions (
      team_version_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      format_id TEXT DEFAULT NULL,
      team_hash TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      report_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, format_id, team_hash)
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS strategy_memory_reports (
      report_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      worker_job_id TEXT DEFAULT NULL,
      team_version_id TEXT DEFAULT NULL,
      team_hash TEXT DEFAULT NULL,
      format_id TEXT DEFAULT NULL,
      benchmark_mode TEXT DEFAULT NULL,
      generated_at TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL,
      total_games_completed INTEGER NOT NULL DEFAULT 0,
      total_turns INTEGER NOT NULL DEFAULT 0,
      average_turns DOUBLE PRECISION NOT NULL DEFAULT 0,
      win_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
      confidence_label TEXT DEFAULT NULL,
      confidence_inputs_json JSONB DEFAULT NULL,
      selection_summary_json JSONB DEFAULT NULL,
      storage_metrics_json JSONB DEFAULT NULL,
      prompt_version TEXT DEFAULT '',
      model_tier TEXT DEFAULT '',
      model_used TEXT DEFAULT '',
      report_json_sha256 TEXT DEFAULT NULL
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS strategy_memory_battles (
      battle_id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_version_id TEXT DEFAULT NULL,
      format_id TEXT DEFAULT NULL,
      opponent_registry_id INTEGER NOT NULL DEFAULT 0,
      archetype TEXT DEFAULT NULL,
      opponent_name TEXT DEFAULT NULL,
      game_number INTEGER NOT NULL DEFAULT 1,
      result TEXT DEFAULT NULL,
      winner TEXT DEFAULT NULL,
      turns INTEGER DEFAULT NULL,
      series_result TEXT DEFAULT NULL,
      replay_id TEXT DEFAULT NULL,
      archive_relative_path TEXT DEFAULT NULL,
      battle_log_pruned BOOLEAN NOT NULL DEFAULT FALSE,
      battle_log_bytes INTEGER NOT NULL DEFAULT 0,
      battle_log_original_bytes INTEGER NOT NULL DEFAULT 0,
      player_team_hash TEXT DEFAULT NULL,
      opponent_team_hash TEXT DEFAULT NULL,
      proof_turns_json JSONB DEFAULT NULL,
      storage_metrics_json JSONB DEFAULT NULL,
      created_at TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS strategy_memory_turn_evidence (
      evidence_id TEXT PRIMARY KEY,
      battle_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      turn_number INTEGER NOT NULL,
      evidence_type TEXT NOT NULL,
      label TEXT DEFAULT NULL,
      summary TEXT DEFAULT NULL,
      tags_json JSONB DEFAULT NULL,
      source_json JSONB DEFAULT NULL,
      created_at TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_strategy_memory_reports_user_updated ON strategy_memory_reports (user_id, updated_at DESC)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_strategy_memory_reports_team ON strategy_memory_reports (team_version_id, updated_at DESC)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_strategy_memory_battles_report ON strategy_memory_battles (report_id, game_number)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_strategy_memory_battles_opponent ON strategy_memory_battles (opponent_registry_id, archetype)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_strategy_memory_turn_evidence_battle ON strategy_memory_turn_evidence (battle_id, turn_number)');
  strategyMemoryPostgresEnsured = true;
}

async function mirrorStrategyMemoryPostgres(facts) {
  if (!facts?.report?.reportId) return null;
  await ensureStrategyMemoryPostgresTables();
  const team = facts.teamVersion;
  const report = facts.report;
  await postgresPool.query(
    `
      INSERT INTO strategy_memory_team_versions (
        team_version_id, user_id, format_id, team_hash, first_seen_at, last_seen_at, report_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, 1)
      ON CONFLICT (team_version_id) DO UPDATE SET
        last_seen_at = EXCLUDED.last_seen_at
    `,
    [team.teamVersionId, team.userId, team.formatId, team.teamHash, team.firstSeenAt, team.lastSeenAt],
  );
  await postgresPool.query(
    `
      INSERT INTO strategy_memory_reports (
        report_id, user_id, report_type, worker_job_id, team_version_id, team_hash, format_id, benchmark_mode,
        generated_at, updated_at, total_games_completed, total_turns, average_turns, win_rate,
        confidence_label, confidence_inputs_json, selection_summary_json, storage_metrics_json,
        prompt_version, model_tier, model_used, report_json_sha256
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20, $21, $22)
      ON CONFLICT (report_id) DO UPDATE SET
        worker_job_id = EXCLUDED.worker_job_id,
        team_version_id = EXCLUDED.team_version_id,
        team_hash = EXCLUDED.team_hash,
        format_id = EXCLUDED.format_id,
        benchmark_mode = EXCLUDED.benchmark_mode,
        generated_at = EXCLUDED.generated_at,
        updated_at = EXCLUDED.updated_at,
        total_games_completed = EXCLUDED.total_games_completed,
        total_turns = EXCLUDED.total_turns,
        average_turns = EXCLUDED.average_turns,
        win_rate = EXCLUDED.win_rate,
        confidence_label = EXCLUDED.confidence_label,
        confidence_inputs_json = EXCLUDED.confidence_inputs_json,
        selection_summary_json = EXCLUDED.selection_summary_json,
        storage_metrics_json = EXCLUDED.storage_metrics_json,
        prompt_version = EXCLUDED.prompt_version,
        model_tier = EXCLUDED.model_tier,
        model_used = EXCLUDED.model_used,
        report_json_sha256 = EXCLUDED.report_json_sha256
    `,
    [
      report.reportId,
      report.userId,
      report.reportType,
      report.workerJobId,
      report.teamVersionId,
      report.teamHash,
      report.formatId,
      report.benchmarkMode,
      report.generatedAt,
      report.updatedAt,
      report.totalGamesCompleted,
      report.totalTurns,
      report.averageTurns,
      report.winRate,
      report.confidenceLabel,
      JSON.stringify(report.confidenceInputs),
      JSON.stringify(report.selectionSummary),
      JSON.stringify(report.storageMetrics),
      report.promptVersion,
      report.modelTier,
      report.modelUsed,
      report.reportJsonHash,
    ],
  );

  for (const battle of facts.battles || []) {
    await postgresPool.query(
      `
        INSERT INTO strategy_memory_battles (
          battle_id, report_id, user_id, team_version_id, format_id, opponent_registry_id, archetype,
          opponent_name, game_number, result, winner, turns, series_result, replay_id, archive_relative_path,
          battle_log_pruned, battle_log_bytes, battle_log_original_bytes, player_team_hash, opponent_team_hash,
          proof_turns_json, storage_metrics_json, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22::jsonb, $23, $24)
        ON CONFLICT (battle_id) DO UPDATE SET
          result = EXCLUDED.result,
          winner = EXCLUDED.winner,
          turns = EXCLUDED.turns,
          series_result = EXCLUDED.series_result,
          replay_id = EXCLUDED.replay_id,
          archive_relative_path = EXCLUDED.archive_relative_path,
          battle_log_pruned = EXCLUDED.battle_log_pruned,
          battle_log_bytes = EXCLUDED.battle_log_bytes,
          battle_log_original_bytes = EXCLUDED.battle_log_original_bytes,
          player_team_hash = EXCLUDED.player_team_hash,
          opponent_team_hash = EXCLUDED.opponent_team_hash,
          proof_turns_json = EXCLUDED.proof_turns_json,
          storage_metrics_json = EXCLUDED.storage_metrics_json,
          updated_at = EXCLUDED.updated_at
      `,
      [
        battle.battleId,
        battle.reportId,
        battle.userId,
        battle.teamVersionId,
        battle.formatId,
        battle.opponentRegistryId,
        battle.archetype,
        battle.opponentName,
        battle.gameNumber,
        battle.result,
        battle.winner,
        battle.turns,
        battle.seriesResult,
        battle.replayId,
        battle.archiveRelativePath,
        battle.battleLogPruned,
        battle.battleLogBytes,
        battle.battleLogOriginalBytes,
        battle.playerTeamHash,
        battle.opponentTeamHash,
        JSON.stringify(battle.proofTurns),
        JSON.stringify(battle.storageMetrics),
        battle.createdAt,
        battle.updatedAt,
      ],
    );
  }

  for (const row of facts.evidenceRows || []) {
    await postgresPool.query(
      `
        INSERT INTO strategy_memory_turn_evidence (
          evidence_id, battle_id, report_id, user_id, turn_number, evidence_type, label,
          summary, tags_json, source_json, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
        ON CONFLICT (evidence_id) DO UPDATE SET
          label = EXCLUDED.label,
          summary = EXCLUDED.summary,
          tags_json = EXCLUDED.tags_json,
          source_json = EXCLUDED.source_json,
          updated_at = EXCLUDED.updated_at
      `,
      [
        row.evidenceId,
        row.battleId,
        row.reportId,
        row.userId,
        row.turnNumber,
        row.evidenceType,
        row.label,
        row.summary,
        JSON.stringify(row.tags),
        JSON.stringify(row.source),
        row.createdAt,
        row.updatedAt,
      ],
    );
  }
  return facts;
}

async function saveStrategyMemorySqlite(facts) {
  if (!facts?.report?.reportId) return null;
  const team = facts.teamVersion;
  const report = facts.report;
  await runBenchmarkSqlite(
    `
      INSERT INTO strategy_memory_team_versions (
        team_version_id, user_id, format_id, team_hash, first_seen_at, last_seen_at, report_count
      )
      VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(team_version_id) DO UPDATE SET
        last_seen_at = excluded.last_seen_at
    `,
    [team.teamVersionId, team.userId, team.formatId, team.teamHash, team.firstSeenAt, team.lastSeenAt],
  );
  await runBenchmarkSqlite(
    `
      INSERT INTO strategy_memory_reports (
        report_id, user_id, report_type, worker_job_id, team_version_id, team_hash, format_id, benchmark_mode,
        generated_at, updated_at, total_games_completed, total_turns, average_turns, win_rate,
        confidence_label, confidence_inputs_json, selection_summary_json, storage_metrics_json,
        prompt_version, model_tier, model_used, report_json_sha256
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_id) DO UPDATE SET
        worker_job_id = excluded.worker_job_id,
        team_version_id = excluded.team_version_id,
        team_hash = excluded.team_hash,
        format_id = excluded.format_id,
        benchmark_mode = excluded.benchmark_mode,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at,
        total_games_completed = excluded.total_games_completed,
        total_turns = excluded.total_turns,
        average_turns = excluded.average_turns,
        win_rate = excluded.win_rate,
        confidence_label = excluded.confidence_label,
        confidence_inputs_json = excluded.confidence_inputs_json,
        selection_summary_json = excluded.selection_summary_json,
        storage_metrics_json = excluded.storage_metrics_json,
        prompt_version = excluded.prompt_version,
        model_tier = excluded.model_tier,
        model_used = excluded.model_used,
        report_json_sha256 = excluded.report_json_sha256
    `,
    [
      report.reportId,
      report.userId,
      report.reportType,
      report.workerJobId,
      report.teamVersionId,
      report.teamHash,
      report.formatId,
      report.benchmarkMode,
      report.generatedAt,
      report.updatedAt,
      report.totalGamesCompleted,
      report.totalTurns,
      report.averageTurns,
      report.winRate,
      report.confidenceLabel,
      JSON.stringify(report.confidenceInputs),
      JSON.stringify(report.selectionSummary),
      JSON.stringify(report.storageMetrics),
      report.promptVersion,
      report.modelTier,
      report.modelUsed,
      report.reportJsonHash,
    ],
  );
  for (const battle of facts.battles || []) {
    await runBenchmarkSqlite(
      `
        INSERT INTO strategy_memory_battles (
          battle_id, report_id, user_id, team_version_id, format_id, opponent_registry_id, archetype,
          opponent_name, game_number, result, winner, turns, series_result, replay_id, archive_relative_path,
          battle_log_pruned, battle_log_bytes, battle_log_original_bytes, player_team_hash, opponent_team_hash,
          proof_turns_json, storage_metrics_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(battle_id) DO UPDATE SET
          result = excluded.result,
          winner = excluded.winner,
          turns = excluded.turns,
          series_result = excluded.series_result,
          replay_id = excluded.replay_id,
          archive_relative_path = excluded.archive_relative_path,
          battle_log_pruned = excluded.battle_log_pruned,
          battle_log_bytes = excluded.battle_log_bytes,
          battle_log_original_bytes = excluded.battle_log_original_bytes,
          player_team_hash = excluded.player_team_hash,
          opponent_team_hash = excluded.opponent_team_hash,
          proof_turns_json = excluded.proof_turns_json,
          storage_metrics_json = excluded.storage_metrics_json,
          updated_at = excluded.updated_at
      `,
      [
        battle.battleId,
        battle.reportId,
        battle.userId,
        battle.teamVersionId,
        battle.formatId,
        battle.opponentRegistryId,
        battle.archetype,
        battle.opponentName,
        battle.gameNumber,
        battle.result,
        battle.winner,
        battle.turns,
        battle.seriesResult,
        battle.replayId,
        battle.archiveRelativePath,
        battle.battleLogPruned ? 1 : 0,
        battle.battleLogBytes,
        battle.battleLogOriginalBytes,
        battle.playerTeamHash,
        battle.opponentTeamHash,
        JSON.stringify(battle.proofTurns),
        JSON.stringify(battle.storageMetrics),
        battle.createdAt,
        battle.updatedAt,
      ],
    );
  }
  for (const row of facts.evidenceRows || []) {
    await runBenchmarkSqlite(
      `
        INSERT INTO strategy_memory_turn_evidence (
          evidence_id, battle_id, report_id, user_id, turn_number, evidence_type, label,
          summary, tags_json, source_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(evidence_id) DO UPDATE SET
          label = excluded.label,
          summary = excluded.summary,
          tags_json = excluded.tags_json,
          source_json = excluded.source_json,
          updated_at = excluded.updated_at
      `,
      [
        row.evidenceId,
        row.battleId,
        row.reportId,
        row.userId,
        row.turnNumber,
        row.evidenceType,
        row.label,
        row.summary,
        JSON.stringify(row.tags),
        JSON.stringify(row.source),
        row.createdAt,
        row.updatedAt,
      ],
    );
  }
  return facts;
}

async function saveStrategyMemoryFromBenchmarkReport(userId, reportType, report, workerJobId = null, reportId = null, updatedAt = null) {
  if (reportType !== 'run-benchmark-suite' || !report || typeof report !== 'object') return null;
  const facts = buildStrategyMemoryFactsFromReport({
    userId,
    reportType,
    report,
    workerJobId,
    reportId,
    updatedAt,
  });

  if (!shouldRetireBenchmarkSqliteRuntime()) {
    await saveStrategyMemorySqlite(facts);
  }

  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkWrites()) {
    await mirrorStrategyMemoryPostgres(facts);
  }

  return facts;
}

const STRATEGY_COACH_DEFAULT_PROMPT_VERSION = 'strategy-coach-v1';
const STRATEGY_COACH_MODEL_BY_TIER = Object.freeze({
  'fast-live': 'llama3.2:1b',
  background: 'llama3.2',
  'deep-offline': 'llama3.2:1b',
});
const STRATEGY_COACH_STATUSES = new Set(['queued', 'running', 'done', 'failed', 'deferred', 'canceled']);
const STRATEGY_COACH_ACTIVE_STATUSES = new Set(['queued', 'running', 'deferred']);

function normalizeStrategyCoachNoteStyle(value) {
  const normalized = normalizeStrategyMemoryText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'standard';
}

function normalizeStrategyCoachModelTier(value) {
  const normalized = normalizeStrategyMemoryText(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(STRATEGY_COACH_MODEL_BY_TIER, normalized)
    ? normalized
    : 'background';
}

function normalizeStrategyCoachStatus(value, fallback = 'queued') {
  const normalized = normalizeStrategyMemoryText(value).toLowerCase();
  return STRATEGY_COACH_STATUSES.has(normalized) ? normalized : fallback;
}

function resolveStrategyCoachModel(modelTier, requestedModel = null) {
  const requested = normalizeStrategyMemoryText(requestedModel);
  if (requested) return requested;
  return STRATEGY_COACH_MODEL_BY_TIER[normalizeStrategyCoachModelTier(modelTier)];
}

function buildStrategyCoachJobRecord(input = {}, now = new Date().toISOString()) {
  const reportId = normalizeStrategyMemoryText(input.reportId || input.report_id);
  if (!reportId) throw new Error('Strategy Coach job requires reportId.');
  const userId = normalizeStrategyMemoryText(input.userId || input.user_id);
  if (!userId) throw new Error('Strategy Coach job requires userId.');
  const noteStyle = normalizeStrategyCoachNoteStyle(input.noteStyle || input.note_style);
  const promptVersion = normalizeStrategyMemoryText(input.promptVersion || input.prompt_version || STRATEGY_COACH_DEFAULT_PROMPT_VERSION);
  const modelTier = normalizeStrategyCoachModelTier(input.modelTier || input.model_tier);
  const jobId = normalizeStrategyMemoryText(input.jobId || input.job_id)
    || stableStrategyMemoryId('coach_job', [reportId, noteStyle, promptVersion]);
  const status = normalizeStrategyCoachStatus(input.status);
  return {
    jobId,
    guildId: normalizeStrategyMemoryText(input.guildId || input.guild_id) || null,
    userId,
    reportId,
    teamHash: normalizeStrategyMemoryText(input.teamHash || input.team_hash) || null,
    teamVersionId: normalizeStrategyMemoryText(input.teamVersionId || input.team_version_id) || null,
    formatId: normalizeStrategyMemoryText(input.formatId || input.format_id || input.regulation) || null,
    noteStyle,
    modelTier,
    modelRequested: resolveStrategyCoachModel(modelTier, input.modelRequested || input.model_requested),
    modelUsed: normalizeStrategyMemoryText(input.modelUsed || input.model_used) || null,
    status,
    queuePositionSnapshot: Number.isInteger(Number(input.queuePositionSnapshot ?? input.queue_position_snapshot))
      ? Number(input.queuePositionSnapshot ?? input.queue_position_snapshot)
      : null,
    queueSizeSnapshot: Number.isInteger(Number(input.queueSizeSnapshot ?? input.queue_size_snapshot))
      ? Number(input.queueSizeSnapshot ?? input.queue_size_snapshot)
      : null,
    etaAt: normalizeStrategyMemoryText(input.etaAt || input.eta_at) || null,
    createdAt: normalizeStrategyMemoryText(input.createdAt || input.created_at) || now,
    startedAt: normalizeStrategyMemoryText(input.startedAt || input.started_at) || (status === 'running' ? now : null),
    finishedAt: normalizeStrategyMemoryText(input.finishedAt || input.finished_at) || (['done', 'failed', 'canceled'].includes(status) ? now : null),
    updatedAt: normalizeStrategyMemoryText(input.updatedAt || input.updated_at) || now,
    attemptCount: Number.isInteger(Number(input.attemptCount ?? input.attempt_count)) ? Number(input.attemptCount ?? input.attempt_count) : 0,
    timeoutAt: normalizeStrategyMemoryText(input.timeoutAt || input.timeout_at) || null,
    errorSummary: normalizeStrategyMemoryText(input.errorSummary || input.error_summary) || null,
    promptVersion,
    routeReason: normalizeStrategyMemoryText(input.routeReason || input.route_reason) || null,
    deferredReason: normalizeStrategyMemoryText(input.deferredReason || input.deferred_reason) || null,
    cooldownUntil: normalizeStrategyMemoryText(input.cooldownUntil || input.cooldown_until) || null,
  };
}

function buildStrategyCoachNotesRecord(input = {}, now = new Date().toISOString()) {
  const reportId = normalizeStrategyMemoryText(input.reportId || input.report_id);
  if (!reportId) throw new Error('Strategy Coach notes require reportId.');
  const userId = normalizeStrategyMemoryText(input.userId || input.user_id);
  if (!userId) throw new Error('Strategy Coach notes require userId.');
  const noteStyle = normalizeStrategyCoachNoteStyle(input.noteStyle || input.note_style);
  const promptVersion = normalizeStrategyMemoryText(input.promptVersion || input.prompt_version || STRATEGY_COACH_DEFAULT_PROMPT_VERSION);
  const modelTier = normalizeStrategyCoachModelTier(input.modelTier || input.model_tier);
  const noteId = normalizeStrategyMemoryText(input.noteId || input.note_id)
    || stableStrategyMemoryId('coach_note', [reportId, noteStyle, promptVersion]);
  return {
    noteId,
    jobId: normalizeStrategyMemoryText(input.jobId || input.job_id) || null,
    reportId,
    userId,
    teamHash: normalizeStrategyMemoryText(input.teamHash || input.team_hash) || null,
    noteStyle,
    summary: normalizeStrategyMemoryText(input.summary),
    leadAdvice: normalizeStrategyMemoryText(input.leadAdvice || input.lead_advice),
    dangerPoints: Array.isArray(input.dangerPoints) ? input.dangerPoints : (input.danger_points_json || input.dangerPointsJson || []),
    discoveredLines: Array.isArray(input.discoveredLines) ? input.discoveredLines : (input.discovered_lines_json || input.discoveredLinesJson || []),
    evidence: input.evidenceJson || input.evidence_json || input.evidence || [],
    confidenceLabel: normalizeStrategyMemoryText(input.confidenceLabel || input.confidence_label) || null,
    modelTier,
    modelUsed: normalizeStrategyMemoryText(input.modelUsed || input.model_used) || resolveStrategyCoachModel(modelTier),
    promptVersion,
    createdAt: normalizeStrategyMemoryText(input.createdAt || input.created_at) || now,
    updatedAt: normalizeStrategyMemoryText(input.updatedAt || input.updated_at) || now,
  };
}

function strategyCoachJobParams(job) {
  return [
    job.jobId,
    job.guildId,
    job.userId,
    job.reportId,
    job.teamHash,
    job.teamVersionId,
    job.formatId,
    job.noteStyle,
    job.modelTier,
    job.modelRequested,
    job.modelUsed,
    job.status,
    job.queuePositionSnapshot,
    job.queueSizeSnapshot,
    job.etaAt,
    job.createdAt,
    job.startedAt,
    job.finishedAt,
    job.updatedAt,
    job.attemptCount,
    job.timeoutAt,
    job.errorSummary,
    job.promptVersion,
    job.routeReason,
    job.deferredReason,
    job.cooldownUntil,
  ];
}

function strategyCoachNotesParams(notes) {
  return [
    notes.noteId,
    notes.jobId,
    notes.reportId,
    notes.userId,
    notes.teamHash,
    notes.noteStyle,
    notes.summary,
    notes.leadAdvice,
    JSON.stringify(notes.dangerPoints),
    JSON.stringify(notes.discoveredLines),
    JSON.stringify(notes.evidence),
    notes.confidenceLabel,
    notes.modelTier,
    notes.modelUsed,
    notes.promptVersion,
    notes.createdAt,
    notes.updatedAt,
  ];
}

function normalizeStrategyCoachJobRow(row = null) {
  if (!row) return null;
  return {
    jobId: row.job_id || row.jobId || null,
    guildId: row.guild_id || row.guildId || null,
    userId: row.user_id || row.userId || null,
    reportId: row.report_id || row.reportId || null,
    teamHash: row.team_hash || row.teamHash || null,
    teamVersionId: row.team_version_id || row.teamVersionId || null,
    formatId: row.format_id || row.formatId || null,
    noteStyle: row.note_style || row.noteStyle || 'standard',
    modelTier: row.model_tier || row.modelTier || 'background',
    modelRequested: row.model_requested || row.modelRequested || null,
    modelUsed: row.model_used || row.modelUsed || null,
    status: normalizeStrategyCoachStatus(row.status),
    queuePositionSnapshot: row.queue_position_snapshot ?? row.queuePositionSnapshot ?? null,
    queueSizeSnapshot: row.queue_size_snapshot ?? row.queueSizeSnapshot ?? null,
    etaAt: row.eta_at || row.etaAt || null,
    createdAt: row.created_at || row.createdAt || null,
    startedAt: row.started_at || row.startedAt || null,
    finishedAt: row.finished_at || row.finishedAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    attemptCount: Number.parseInt(row.attempt_count ?? row.attemptCount, 10) || 0,
    timeoutAt: row.timeout_at || row.timeoutAt || null,
    errorSummary: row.error_summary || row.errorSummary || null,
    promptVersion: row.prompt_version || row.promptVersion || STRATEGY_COACH_DEFAULT_PROMPT_VERSION,
    routeReason: row.route_reason || row.routeReason || null,
    deferredReason: row.deferred_reason || row.deferredReason || null,
    cooldownUntil: row.cooldown_until || row.cooldownUntil || null,
  };
}

function normalizeStrategyCoachNotesRow(row = null) {
  if (!row) return null;
  return {
    noteId: row.note_id || row.noteId || null,
    jobId: row.job_id || row.jobId || null,
    reportId: row.report_id || row.reportId || null,
    userId: row.user_id || row.userId || null,
    teamHash: row.team_hash || row.teamHash || null,
    noteStyle: row.note_style || row.noteStyle || 'standard',
    summary: row.summary || '',
    leadAdvice: row.lead_advice || row.leadAdvice || '',
    dangerPoints: parseJsonOrDefault(row.danger_points_json ?? row.dangerPoints, []),
    discoveredLines: parseJsonOrDefault(row.discovered_lines_json ?? row.discoveredLines, []),
    evidence: parseJsonOrDefault(row.evidence_json ?? row.evidence, []),
    confidenceLabel: row.confidence_label || row.confidenceLabel || null,
    modelTier: row.model_tier || row.modelTier || 'background',
    modelUsed: row.model_used || row.modelUsed || null,
    promptVersion: row.prompt_version || row.promptVersion || STRATEGY_COACH_DEFAULT_PROMPT_VERSION,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function compareStrategyCoachQueueRows(a, b) {
  const aCreated = normalizeStrategyMemoryText(a?.createdAt || a?.created_at);
  const bCreated = normalizeStrategyMemoryText(b?.createdAt || b?.created_at);
  if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;
  const aId = normalizeStrategyMemoryText(a?.jobId || a?.job_id);
  const bId = normalizeStrategyMemoryText(b?.jobId || b?.job_id);
  return aId.localeCompare(bId);
}

function computeStrategyCoachQueueSnapshot(rows = [], targetJobId = null) {
  const activeRows = (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeStrategyCoachJobRow(row))
    .filter((row) => row && STRATEGY_COACH_ACTIVE_STATUSES.has(row.status))
    .sort(compareStrategyCoachQueueRows);
  const target = normalizeStrategyMemoryText(targetJobId);
  const index = target ? activeRows.findIndex((row) => row.jobId === target) : -1;
  return {
    queueSize: activeRows.length,
    queuePosition: index >= 0 ? index + 1 : null,
    activeJobIds: activeRows.map((row) => row.jobId),
    counts: activeRows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, { queued: 0, running: 0, deferred: 0 }),
  };
}

async function ensureStrategyCoachSqliteTables() {
  await runBenchmarkSqlite(`
    CREATE TABLE IF NOT EXISTS strategy_coach_jobs (
      job_id TEXT PRIMARY KEY,
      guild_id TEXT DEFAULT NULL,
      user_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      team_hash TEXT DEFAULT NULL,
      team_version_id TEXT DEFAULT NULL,
      format_id TEXT DEFAULT NULL,
      note_style TEXT NOT NULL DEFAULT 'standard',
      model_tier TEXT NOT NULL DEFAULT 'background',
      model_requested TEXT DEFAULT NULL,
      model_used TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      queue_position_snapshot INTEGER DEFAULT NULL,
      queue_size_snapshot INTEGER DEFAULT NULL,
      eta_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT DEFAULT NULL,
      finished_at TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      timeout_at TEXT DEFAULT NULL,
      error_summary TEXT DEFAULT NULL,
      prompt_version TEXT NOT NULL DEFAULT 'strategy-coach-v1',
      route_reason TEXT DEFAULT NULL,
      deferred_reason TEXT DEFAULT NULL,
      cooldown_until TEXT DEFAULT NULL,
      UNIQUE(report_id, note_style, prompt_version)
    )
  `);
  await runBenchmarkSqlite(`
    CREATE TABLE IF NOT EXISTS strategy_coach_notes (
      note_id TEXT PRIMARY KEY,
      job_id TEXT DEFAULT NULL,
      report_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_hash TEXT DEFAULT NULL,
      note_style TEXT NOT NULL DEFAULT 'standard',
      summary TEXT DEFAULT '',
      lead_advice TEXT DEFAULT '',
      danger_points_json TEXT DEFAULT NULL,
      discovered_lines_json TEXT DEFAULT NULL,
      evidence_json TEXT DEFAULT NULL,
      confidence_label TEXT DEFAULT NULL,
      model_tier TEXT NOT NULL DEFAULT 'background',
      model_used TEXT DEFAULT NULL,
      prompt_version TEXT NOT NULL DEFAULT 'strategy-coach-v1',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(report_id, note_style, prompt_version)
    )
  `);
}

async function ensureStrategyCoachSqliteIndexes() {
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_strategy_coach_jobs_status_created ON strategy_coach_jobs (status, created_at, job_id)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_strategy_coach_jobs_user_report ON strategy_coach_jobs (user_id, report_id)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_strategy_coach_jobs_report_style ON strategy_coach_jobs (report_id, note_style, prompt_version)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_strategy_coach_notes_report_style ON strategy_coach_notes (report_id, note_style, prompt_version)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_strategy_coach_notes_user_created ON strategy_coach_notes (user_id, created_at DESC)');
}

async function ensureStrategyCoachPostgresTables() {
  if (strategyCoachPostgresEnsured || !postgresPool) return;
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS strategy_coach_jobs (
      job_id TEXT PRIMARY KEY,
      guild_id TEXT DEFAULT NULL,
      user_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      team_hash TEXT DEFAULT NULL,
      team_version_id TEXT DEFAULT NULL,
      format_id TEXT DEFAULT NULL,
      note_style TEXT NOT NULL DEFAULT 'standard',
      model_tier TEXT NOT NULL DEFAULT 'background',
      model_requested TEXT DEFAULT NULL,
      model_used TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      queue_position_snapshot INTEGER DEFAULT NULL,
      queue_size_snapshot INTEGER DEFAULT NULL,
      eta_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT DEFAULT NULL,
      finished_at TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      timeout_at TEXT DEFAULT NULL,
      error_summary TEXT DEFAULT NULL,
      prompt_version TEXT NOT NULL DEFAULT 'strategy-coach-v1',
      route_reason TEXT DEFAULT NULL,
      deferred_reason TEXT DEFAULT NULL,
      cooldown_until TEXT DEFAULT NULL,
      UNIQUE(report_id, note_style, prompt_version)
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS strategy_coach_notes (
      note_id TEXT PRIMARY KEY,
      job_id TEXT DEFAULT NULL,
      report_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_hash TEXT DEFAULT NULL,
      note_style TEXT NOT NULL DEFAULT 'standard',
      summary TEXT DEFAULT '',
      lead_advice TEXT DEFAULT '',
      danger_points_json JSONB DEFAULT NULL,
      discovered_lines_json JSONB DEFAULT NULL,
      evidence_json JSONB DEFAULT NULL,
      confidence_label TEXT DEFAULT NULL,
      model_tier TEXT NOT NULL DEFAULT 'background',
      model_used TEXT DEFAULT NULL,
      prompt_version TEXT NOT NULL DEFAULT 'strategy-coach-v1',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(report_id, note_style, prompt_version)
    )
  `);
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_strategy_coach_jobs_status_created ON strategy_coach_jobs (status, created_at, job_id)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_strategy_coach_jobs_user_report ON strategy_coach_jobs (user_id, report_id)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_strategy_coach_jobs_report_style ON strategy_coach_jobs (report_id, note_style, prompt_version)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_strategy_coach_notes_report_style ON strategy_coach_notes (report_id, note_style, prompt_version)');
  await postgresPool.query('CREATE INDEX IF NOT EXISTS idx_strategy_coach_notes_user_created ON strategy_coach_notes (user_id, created_at DESC)');
  strategyCoachPostgresEnsured = true;
}

async function ensureStrategyCoachTables() {
  if (!shouldRetireBenchmarkSqliteRuntime()) {
    await ensureStrategyCoachSqliteTables();
    await ensureStrategyCoachSqliteIndexes();
  }
  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkWrites()) {
    await ensureStrategyCoachPostgresTables();
  }
}

async function upsertStrategyCoachJobSqlite(job) {
  await runBenchmarkSqlite(
    `
      INSERT INTO strategy_coach_jobs (
        job_id, guild_id, user_id, report_id, team_hash, team_version_id, format_id, note_style,
        model_tier, model_requested, model_used, status, queue_position_snapshot, queue_size_snapshot,
        eta_at, created_at, started_at, finished_at, updated_at, attempt_count, timeout_at, error_summary,
        prompt_version, route_reason, deferred_reason, cooldown_until
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        guild_id = excluded.guild_id,
        user_id = excluded.user_id,
        report_id = excluded.report_id,
        team_hash = excluded.team_hash,
        team_version_id = excluded.team_version_id,
        format_id = excluded.format_id,
        note_style = excluded.note_style,
        model_tier = excluded.model_tier,
        model_requested = excluded.model_requested,
        model_used = excluded.model_used,
        status = excluded.status,
        queue_position_snapshot = excluded.queue_position_snapshot,
        queue_size_snapshot = excluded.queue_size_snapshot,
        eta_at = excluded.eta_at,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        updated_at = excluded.updated_at,
        attempt_count = excluded.attempt_count,
        timeout_at = excluded.timeout_at,
        error_summary = excluded.error_summary,
        prompt_version = excluded.prompt_version,
        route_reason = excluded.route_reason,
        deferred_reason = excluded.deferred_reason,
        cooldown_until = excluded.cooldown_until
    `,
    strategyCoachJobParams(job),
  );
}

async function upsertStrategyCoachJobPostgres(job) {
  await ensureStrategyCoachPostgresTables();
  await postgresPool.query(
    `
      INSERT INTO strategy_coach_jobs (
        job_id, guild_id, user_id, report_id, team_hash, team_version_id, format_id, note_style,
        model_tier, model_requested, model_used, status, queue_position_snapshot, queue_size_snapshot,
        eta_at, created_at, started_at, finished_at, updated_at, attempt_count, timeout_at, error_summary,
        prompt_version, route_reason, deferred_reason, cooldown_until
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      ON CONFLICT (job_id) DO UPDATE SET
        guild_id = EXCLUDED.guild_id,
        user_id = EXCLUDED.user_id,
        report_id = EXCLUDED.report_id,
        team_hash = EXCLUDED.team_hash,
        team_version_id = EXCLUDED.team_version_id,
        format_id = EXCLUDED.format_id,
        note_style = EXCLUDED.note_style,
        model_tier = EXCLUDED.model_tier,
        model_requested = EXCLUDED.model_requested,
        model_used = EXCLUDED.model_used,
        status = EXCLUDED.status,
        queue_position_snapshot = EXCLUDED.queue_position_snapshot,
        queue_size_snapshot = EXCLUDED.queue_size_snapshot,
        eta_at = EXCLUDED.eta_at,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        updated_at = EXCLUDED.updated_at,
        attempt_count = EXCLUDED.attempt_count,
        timeout_at = EXCLUDED.timeout_at,
        error_summary = EXCLUDED.error_summary,
        prompt_version = EXCLUDED.prompt_version,
        route_reason = EXCLUDED.route_reason,
        deferred_reason = EXCLUDED.deferred_reason,
        cooldown_until = EXCLUDED.cooldown_until
    `,
    strategyCoachJobParams(job),
  );
}

async function createStrategyCoachJob(input = {}) {
  const job = buildStrategyCoachJobRecord(input);
  await ensureStrategyCoachTables();
  if (!shouldRetireBenchmarkSqliteRuntime()) await upsertStrategyCoachJobSqlite(job);
  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkWrites()) await upsertStrategyCoachJobPostgres(job);
  return job;
}

async function getStrategyCoachJob(jobId) {
  const safeJobId = normalizeStrategyMemoryText(jobId);
  if (!safeJobId) return null;
  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkReads() || canUsePostgresBenchmarkWrites()) {
    await ensureStrategyCoachPostgresTables();
    const result = await postgresPool.query('SELECT * FROM strategy_coach_jobs WHERE job_id = $1 LIMIT 1', [safeJobId]);
    return normalizeStrategyCoachJobRow(result?.rows?.[0] || null);
  }
  if (!shouldRetireBenchmarkSqliteRuntime()) {
    const row = await getBenchmarkSqlite('SELECT * FROM strategy_coach_jobs WHERE job_id = ? LIMIT 1', [safeJobId]);
    return normalizeStrategyCoachJobRow(row);
  }
  return null;
}

async function getLatestStrategyCoachJobForReport({ reportId, noteStyle = 'standard', promptVersion = null, userId = null } = {}) {
  const safeReportId = normalizeStrategyMemoryText(reportId);
  if (!safeReportId) return null;
  const safeNoteStyle = normalizeStrategyCoachNoteStyle(noteStyle);
  const safePromptVersion = promptVersion ? normalizeStrategyMemoryText(promptVersion) : null;
  const safeUserId = userId ? normalizeStrategyMemoryText(userId) : null;
  const params = [safeReportId, safeNoteStyle];
  let where = 'report_id = $1 AND note_style = $2';
  if (safePromptVersion) {
    params.push(safePromptVersion);
    where += ` AND prompt_version = $${params.length}`;
  }
  if (safeUserId) {
    params.push(safeUserId);
    where += ` AND user_id = $${params.length}`;
  }

  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkReads() || canUsePostgresBenchmarkWrites()) {
    await ensureStrategyCoachPostgresTables();
    const result = await postgresPool.query(
      `SELECT * FROM strategy_coach_jobs WHERE ${where} ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      params,
    );
    return normalizeStrategyCoachJobRow(result?.rows?.[0] || null);
  }

  if (!shouldRetireBenchmarkSqliteRuntime()) {
    const sqliteParams = [safeReportId, safeNoteStyle];
    let sqliteWhere = 'report_id = ? AND note_style = ?';
    if (safePromptVersion) {
      sqliteParams.push(safePromptVersion);
      sqliteWhere += ' AND prompt_version = ?';
    }
    if (safeUserId) {
      sqliteParams.push(safeUserId);
      sqliteWhere += ' AND user_id = ?';
    }
    const row = await getBenchmarkSqlite(
      `SELECT * FROM strategy_coach_jobs WHERE ${sqliteWhere} ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
      sqliteParams,
    );
    return normalizeStrategyCoachJobRow(row);
  }

  return null;
}

async function listQueuedStrategyCoachJobs({ includeRunning = true, limit = 50 } = {}) {
  const statuses = includeRunning ? ['queued', 'deferred', 'running'] : ['queued', 'deferred'];
  const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 50;
  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkReads() || canUsePostgresBenchmarkWrites()) {
    await ensureStrategyCoachPostgresTables();
    const result = await postgresPool.query(
      'SELECT * FROM strategy_coach_jobs WHERE status = ANY($1) ORDER BY created_at ASC, job_id ASC LIMIT $2',
      [statuses, safeLimit],
    );
    return (result?.rows || []).map(normalizeStrategyCoachJobRow).filter(Boolean);
  }
  if (!shouldRetireBenchmarkSqliteRuntime()) {
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = await allBenchmarkSqlite(
      `SELECT * FROM strategy_coach_jobs WHERE status IN (${placeholders}) ORDER BY created_at ASC, job_id ASC LIMIT ?`,
      [...statuses, safeLimit],
    );
    return rows.map(normalizeStrategyCoachJobRow).filter(Boolean);
  }
  return [];
}

async function claimNextStrategyCoachJob({ now = new Date().toISOString() } = {}) {
  await ensureStrategyCoachTables();
  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkWrites()) {
    await ensureStrategyCoachPostgresTables();
    const result = await postgresPool.query(
      `
        UPDATE strategy_coach_jobs
        SET status = 'running',
            started_at = COALESCE(started_at, $1),
            updated_at = $1,
            attempt_count = attempt_count + 1,
            deferred_reason = NULL
        WHERE job_id = (
          SELECT job_id
          FROM strategy_coach_jobs
          WHERE status IN ('queued', 'deferred')
            AND (cooldown_until IS NULL OR cooldown_until <= $1)
            AND (timeout_at IS NULL OR timeout_at > $1)
          ORDER BY created_at ASC, job_id ASC
          LIMIT 1
        )
        RETURNING *
      `,
      [now],
    );
    return normalizeStrategyCoachJobRow(result?.rows?.[0] || null);
  }

  if (!shouldRetireBenchmarkSqliteRuntime()) {
    const rows = await allBenchmarkSqlite(
      `
        SELECT * FROM strategy_coach_jobs
        WHERE status IN ('queued', 'deferred')
          AND (cooldown_until IS NULL OR cooldown_until <= ?)
          AND (timeout_at IS NULL OR timeout_at > ?)
        ORDER BY created_at ASC, job_id ASC
        LIMIT 1
      `,
      [now, now],
    );
    const job = normalizeStrategyCoachJobRow(rows?.[0] || null);
    if (!job) return null;
    await runBenchmarkSqlite(
      `
        UPDATE strategy_coach_jobs
        SET status = 'running',
            started_at = COALESCE(started_at, ?),
            updated_at = ?,
            attempt_count = attempt_count + 1,
            deferred_reason = NULL
        WHERE job_id = ?
      `,
      [now, now, job.jobId],
    );
    return getStrategyCoachJob(job.jobId);
  }
  return null;
}

async function updateStrategyCoachJobStatus(jobId, status, updates = {}) {
  const safeJobId = normalizeStrategyMemoryText(jobId);
  if (!safeJobId) return null;
  const safeStatus = normalizeStrategyCoachStatus(status);
  const now = normalizeStrategyMemoryText(updates.updatedAt || updates.updated_at) || new Date().toISOString();
  const startedAt = normalizeStrategyMemoryText(updates.startedAt || updates.started_at) || (safeStatus === 'running' ? now : null);
  const finishedAt = normalizeStrategyMemoryText(updates.finishedAt || updates.finished_at) || (['done', 'failed', 'canceled'].includes(safeStatus) ? now : null);
  const params = [
    safeStatus,
    updates.queuePositionSnapshot ?? updates.queue_position_snapshot ?? null,
    updates.queueSizeSnapshot ?? updates.queue_size_snapshot ?? null,
    normalizeStrategyMemoryText(updates.etaAt || updates.eta_at) || null,
    startedAt,
    finishedAt,
    now,
    Number.isInteger(Number(updates.attemptCount ?? updates.attempt_count)) ? Number(updates.attemptCount ?? updates.attempt_count) : null,
    normalizeStrategyMemoryText(updates.timeoutAt || updates.timeout_at) || null,
    normalizeStrategyMemoryText(updates.errorSummary || updates.error_summary) || null,
    normalizeStrategyMemoryText(updates.modelUsed || updates.model_used) || null,
    normalizeStrategyMemoryText(updates.routeReason || updates.route_reason) || null,
    normalizeStrategyMemoryText(updates.deferredReason || updates.deferred_reason) || null,
    normalizeStrategyMemoryText(updates.cooldownUntil || updates.cooldown_until) || null,
    safeJobId,
  ];

  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkWrites()) {
    await ensureStrategyCoachPostgresTables();
    await postgresPool.query(
      `
        UPDATE strategy_coach_jobs
        SET status = $1,
            queue_position_snapshot = COALESCE($2, queue_position_snapshot),
            queue_size_snapshot = COALESCE($3, queue_size_snapshot),
            eta_at = COALESCE($4, eta_at),
            started_at = COALESCE($5, started_at),
            finished_at = COALESCE($6, finished_at),
            updated_at = $7,
            attempt_count = COALESCE($8, attempt_count),
            timeout_at = COALESCE($9, timeout_at),
            error_summary = COALESCE($10, error_summary),
            model_used = COALESCE($11, model_used),
            route_reason = COALESCE($12, route_reason),
            deferred_reason = COALESCE($13, deferred_reason),
            cooldown_until = COALESCE($14, cooldown_until)
        WHERE job_id = $15
      `,
      params,
    );
  } else if (!shouldRetireBenchmarkSqliteRuntime()) {
    await runBenchmarkSqlite(
      `
        UPDATE strategy_coach_jobs
        SET status = ?,
            queue_position_snapshot = COALESCE(?, queue_position_snapshot),
            queue_size_snapshot = COALESCE(?, queue_size_snapshot),
            eta_at = COALESCE(?, eta_at),
            started_at = COALESCE(?, started_at),
            finished_at = COALESCE(?, finished_at),
            updated_at = ?,
            attempt_count = COALESCE(?, attempt_count),
            timeout_at = COALESCE(?, timeout_at),
            error_summary = COALESCE(?, error_summary),
            model_used = COALESCE(?, model_used),
            route_reason = COALESCE(?, route_reason),
            deferred_reason = COALESCE(?, deferred_reason),
            cooldown_until = COALESCE(?, cooldown_until)
        WHERE job_id = ?
      `,
      params,
    );
  }
  return getStrategyCoachJob(safeJobId);
}

async function saveStrategyCoachNotes(input = {}) {
  const notes = buildStrategyCoachNotesRecord(input);
  await ensureStrategyCoachTables();
  if (!shouldRetireBenchmarkSqliteRuntime()) {
    await runBenchmarkSqlite(
      `
        INSERT INTO strategy_coach_notes (
          note_id, job_id, report_id, user_id, team_hash, note_style, summary, lead_advice,
          danger_points_json, discovered_lines_json, evidence_json, confidence_label,
          model_tier, model_used, prompt_version, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(note_id) DO UPDATE SET
          job_id = excluded.job_id,
          user_id = excluded.user_id,
          team_hash = excluded.team_hash,
          summary = excluded.summary,
          lead_advice = excluded.lead_advice,
          danger_points_json = excluded.danger_points_json,
          discovered_lines_json = excluded.discovered_lines_json,
          evidence_json = excluded.evidence_json,
          confidence_label = excluded.confidence_label,
          model_tier = excluded.model_tier,
          model_used = excluded.model_used,
          updated_at = excluded.updated_at
      `,
      strategyCoachNotesParams(notes),
    );
  }
  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkWrites()) {
    await ensureStrategyCoachPostgresTables();
    await postgresPool.query(
      `
        INSERT INTO strategy_coach_notes (
          note_id, job_id, report_id, user_id, team_hash, note_style, summary, lead_advice,
          danger_points_json, discovered_lines_json, evidence_json, confidence_label,
          model_tier, model_used, prompt_version, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (note_id) DO UPDATE SET
          job_id = EXCLUDED.job_id,
          user_id = EXCLUDED.user_id,
          team_hash = EXCLUDED.team_hash,
          summary = EXCLUDED.summary,
          lead_advice = EXCLUDED.lead_advice,
          danger_points_json = EXCLUDED.danger_points_json,
          discovered_lines_json = EXCLUDED.discovered_lines_json,
          evidence_json = EXCLUDED.evidence_json,
          confidence_label = EXCLUDED.confidence_label,
          model_tier = EXCLUDED.model_tier,
          model_used = EXCLUDED.model_used,
          updated_at = EXCLUDED.updated_at
      `,
      strategyCoachNotesParams(notes),
    );
  }
  return notes;
}

async function getStrategyCoachNotes({ reportId, noteStyle = 'standard', promptVersion = STRATEGY_COACH_DEFAULT_PROMPT_VERSION, userId = null } = {}) {
  const safeReportId = normalizeStrategyMemoryText(reportId);
  if (!safeReportId) return null;
  const safeNoteStyle = normalizeStrategyCoachNoteStyle(noteStyle);
  const safePromptVersion = normalizeStrategyMemoryText(promptVersion || STRATEGY_COACH_DEFAULT_PROMPT_VERSION);
  const safeUserId = userId ? normalizeStrategyMemoryText(userId) : null;

  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkReads() || canUsePostgresBenchmarkWrites()) {
    await ensureStrategyCoachPostgresTables();
    const params = [safeReportId, safeNoteStyle, safePromptVersion];
    let where = 'report_id = $1 AND note_style = $2 AND prompt_version = $3';
    if (safeUserId) {
      params.push(safeUserId);
      where += ` AND user_id = $${params.length}`;
    }
    const result = await postgresPool.query(
      `SELECT * FROM strategy_coach_notes WHERE ${where} ORDER BY updated_at DESC LIMIT 1`,
      params,
    );
    return normalizeStrategyCoachNotesRow(result?.rows?.[0] || null);
  }

  if (!shouldRetireBenchmarkSqliteRuntime()) {
    const params = [safeReportId, safeNoteStyle, safePromptVersion];
    let where = 'report_id = ? AND note_style = ? AND prompt_version = ?';
    if (safeUserId) {
      params.push(safeUserId);
      where += ' AND user_id = ?';
    }
    const row = await getBenchmarkSqlite(
      `SELECT * FROM strategy_coach_notes WHERE ${where} ORDER BY updated_at DESC LIMIT 1`,
      params,
    );
    return normalizeStrategyCoachNotesRow(row);
  }
  return null;
}

function buildStrategyCoachProofJobMetadata(job = null) {
  if (!job) return null;
  return {
    jobId: job.jobId || null,
    reportId: job.reportId || null,
    userId: job.userId || null,
    noteStyle: job.noteStyle || null,
    promptVersion: job.promptVersion || null,
    modelTier: job.modelTier || null,
    modelRequested: job.modelRequested || null,
    modelUsed: job.modelUsed || null,
    status: job.status || null,
    queuePositionSnapshot: job.queuePositionSnapshot ?? null,
    queueSizeSnapshot: job.queueSizeSnapshot ?? null,
    etaAt: job.etaAt || null,
    createdAt: job.createdAt || null,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    updatedAt: job.updatedAt || null,
    timeoutAt: job.timeoutAt || null,
    routeReason: job.routeReason || null,
    deferredReason: job.deferredReason || null,
  };
}

function buildStrategyCoachProofNoteMetadata(notes = null) {
  if (!notes) return null;
  return {
    noteId: notes.noteId || null,
    jobId: notes.jobId || null,
    reportId: notes.reportId || null,
    userId: notes.userId || null,
    noteStyle: notes.noteStyle || null,
    promptVersion: notes.promptVersion || null,
    modelTier: notes.modelTier || null,
    modelUsed: notes.modelUsed || null,
    confidenceLabel: notes.confidenceLabel || null,
    createdAt: notes.createdAt || null,
    updatedAt: notes.updatedAt || null,
  };
}

async function getStrategyCoachPersistenceProof({ reportId, userId = null } = {}) {
  const safeReportId = normalizeStrategyMemoryText(reportId);
  const safeUserId = userId ? normalizeStrategyMemoryText(userId) : null;
  if (!safeReportId) {
    return {
      ok: false,
      error: 'reportId is required',
      reportId: null,
      userId: safeUserId || null,
    };
  }

  const readTrack = async ({ noteStyle, promptVersion }) => {
    const [job, notes] = await Promise.all([
      getLatestStrategyCoachJobForReport({
        reportId: safeReportId,
        noteStyle,
        promptVersion,
        userId: safeUserId,
      }),
      getStrategyCoachNotes({
        reportId: safeReportId,
        noteStyle,
        promptVersion,
        userId: safeUserId,
      }),
    ]);

    return {
      job: buildStrategyCoachProofJobMetadata(job),
      notes: buildStrategyCoachProofNoteMetadata(notes),
    };
  };

  try {
    const [standard, deep] = await Promise.all([
      readTrack({
        noteStyle: 'standard',
        promptVersion: STRATEGY_COACH_DEFAULT_PROMPT_VERSION,
      }),
      readTrack({
        noteStyle: 'deep',
        promptVersion: 'strategy-coach-deep-v1',
      }),
    ]);

    const standardJobId = standard.job?.jobId || null;
    const deepJobId = deep.job?.jobId || null;
    const standardNoteId = standard.notes?.noteId || null;
    const deepNoteId = deep.notes?.noteId || null;

    return {
      ok: true,
      reportId: safeReportId,
      userId: safeUserId || null,
      generatedAt: new Date().toISOString(),
      standardJobFound: Boolean(standard.job),
      standardNotesFound: Boolean(standard.notes),
      deepJobFound: Boolean(deep.job),
      deepNotesFound: Boolean(deep.notes),
      separateJobIds: Boolean(standardJobId && deepJobId && standardJobId !== deepJobId),
      separateNoteIds: Boolean(standardNoteId && deepNoteId && standardNoteId !== deepNoteId),
      standard,
      deep,
    };
  } catch (error) {
    return {
      ok: false,
      reportId: safeReportId,
      userId: safeUserId || null,
      error: normalizeStrategyMemoryText(error?.message || error) || 'Strategy Coach persistence proof failed',
    };
  }
}

function warnBenchmarkPostgresReadFallback(key, error) {
  const cacheKey = `${key}:${String(error?.message || error || '').trim()}`;
  if (benchmarkPostgresReadWarningCache.has(cacheKey)) return;
  benchmarkPostgresReadWarningCache.add(cacheKey);
  console.warn(`[PostgreSQL][Benchmark Reads] Falling back to SQLite for ${key}: ${error?.message || error}`);
}

async function getBenchmarkTeamStatePostgres(userId) {
  const result = await postgresPool.query(
    'SELECT user_id, team_export, updated_at FROM benchmark_teams WHERE user_id = $1 LIMIT 1',
    [userId],
  );
  const row = result?.rows?.[0] || null;
  if (!row) return null;
  return {
    team_export: row.team_export || null,
    updated_at: row.updated_at || null,
  };
}

async function getBenchmarkLatestJobStatePostgres(userId, jobType) {
  const result = await postgresPool.query(
    'SELECT * FROM benchmark_job_state_latest WHERE user_id = $1 AND job_type = $2 LIMIT 1',
    [userId, jobType],
  );
  return normalizeBenchmarkJobState(result?.rows?.[0] || null);
}

async function getBenchmarkLatestReportPostgres(userId, reportType) {
  const result = await postgresPool.query(
    'SELECT worker_job_id, report_id, report_json, updated_at FROM benchmark_reports_latest WHERE user_id = $1 AND report_type = $2 LIMIT 1',
    [userId, reportType],
  );
  const row = result?.rows?.[0] || null;
  if (!row) return null;
  return {
    report: parseJsonOrDefault(row.report_json, null),
    updated_at: row.updated_at || null,
    job_id: row.worker_job_id || null,
    report_id: row.report_id || null,
  };
}

async function getBenchmarkLatestReportMetaPostgres(userId, reportType) {
  const result = await postgresPool.query(
    `
      SELECT
        worker_job_id,
        report_id,
        updated_at,
        (report_json IS NOT NULL) AS has_report,
        (
          report_json IS NOT NULL
          AND report_json ? 'matchArchive'
          AND (
            COALESCE(report_json #>> '{matchArchive,ready}', 'false') = 'true'
            OR CASE
              WHEN jsonb_typeof(report_json #> '{matchArchive,sources}') = 'array'
              THEN jsonb_array_length(report_json #> '{matchArchive,sources}')
              ELSE 0
            END > 0
            OR CASE
              WHEN jsonb_typeof(report_json #> '{matchArchive,files}') = 'array'
              THEN jsonb_array_length(report_json #> '{matchArchive,files}')
              ELSE 0
            END > 0
          )
        ) AS has_match_archive
      FROM benchmark_reports_latest
      WHERE user_id = $1 AND report_type = $2
      LIMIT 1
    `,
    [userId, reportType],
  );
  const row = result?.rows?.[0] || null;
  if (!row) return null;
  return {
    has_report: Boolean(row.has_report),
    has_match_archive: Boolean(row.has_match_archive),
    updated_at: row.updated_at || null,
    job_id: row.worker_job_id || null,
    report_id: row.report_id || null,
  };
}

function normalizeBenchmarkJobHistoryListOptions(options = {}) {
  return {
    includeReport: options?.includeReport !== false,
  };
}

function buildLightBenchmarkHistoryReport(row = {}) {
  if (!row?.has_report) return null;
  const compactSummary = parseJsonOrDefault(row.compact_summary_json, null);
  const summary = parseJsonOrDefault(row.summary_json, null);
  const savedReport = parseJsonOrDefault(row.saved_report_json, null);
  const report = {
    generatedAt: row.report_generated_at || row.report_generated_at_alt || null,
    generated_at: row.report_generated_at_alt || row.report_generated_at || null,
    reportId: row.report_id || null,
    report_id: row.report_id || null,
    teamHash: row.report_team_hash || row.report_team_hash_alt || null,
    team_hash: row.report_team_hash_alt || row.report_team_hash || null,
    finalArchetypeLabel: row.report_final_archetype_label || null,
    teamArchetype: row.report_team_archetype || null,
    team_archetype: row.report_team_archetype_alt || row.report_team_archetype || null,
    primaryArchetype: row.report_primary_archetype || null,
    primary_archetype: row.report_primary_archetype_alt || row.report_primary_archetype || null,
    archetype: row.report_archetype || null,
    userTeamExport: row.report_user_team_export || null,
    playerTeamExport: row.report_player_team_export || null,
    teamExport: row.report_team_export || null,
    compactSummary: compactSummary || undefined,
    summary: summary || undefined,
    savedReport: savedReport || undefined,
  };
  return Object.fromEntries(Object.entries(report).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function mapBenchmarkJobHistoryRow(row = {}, options = {}) {
  const { includeReport } = normalizeBenchmarkJobHistoryListOptions(options);
  return {
    id: row.id,
    user_id: row.user_id,
    job_type: row.job_type,
    job_id: row.worker_job_id || null,
    status: row.status || 'idle',
    submitted_at: row.submitted_at || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    error: row.error || null,
    progress: parseJsonOrDefault(row.progress_json, null),
    request: parseJsonOrDefault(row.request_json, null),
    report: includeReport ? parseJsonOrDefault(row.report_json, null) : buildLightBenchmarkHistoryReport(row),
    format_id: row.format_id || null,
    benchmark_mode: row.benchmark_mode || null,
    selection_summary: parseJsonOrDefault(row.selection_summary_json, null),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function listBenchmarkJobHistoryForUserPostgres(userId, jobType = null, limit = 10, options = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
  const { includeReport } = normalizeBenchmarkJobHistoryListOptions(options);
  const selectFields = includeReport
    ? '*'
    : `
        id,
        user_id,
        job_type,
        worker_job_id,
        status,
        submitted_at,
        started_at,
        completed_at,
        error,
        progress_json,
        request_json,
        report_id,
        format_id,
        benchmark_mode,
        selection_summary_json,
        created_at,
        updated_at,
        (report_json IS NOT NULL) AS has_report,
        report_json->>'generatedAt' AS report_generated_at,
        report_json->>'generated_at' AS report_generated_at_alt,
        report_json->>'teamHash' AS report_team_hash,
        report_json->>'team_hash' AS report_team_hash_alt,
        report_json->>'finalArchetypeLabel' AS report_final_archetype_label,
        report_json->>'teamArchetype' AS report_team_archetype,
        report_json->>'team_archetype' AS report_team_archetype_alt,
        report_json->>'primaryArchetype' AS report_primary_archetype,
        report_json->>'primary_archetype' AS report_primary_archetype_alt,
        report_json->>'archetype' AS report_archetype,
        report_json->>'userTeamExport' AS report_user_team_export,
        report_json->>'playerTeamExport' AS report_player_team_export,
        report_json->>'teamExport' AS report_team_export,
        report_json #> '{compactSummary}' AS compact_summary_json,
        report_json #> '{summary}' AS summary_json,
        report_json #> '{savedReport}' AS saved_report_json
      `;
  const result = jobType
    ? await postgresPool.query(
        `SELECT ${selectFields} FROM benchmark_job_history WHERE user_id = $1 AND job_type = $2 ORDER BY updated_at DESC, id DESC LIMIT $3`,
        [userId, jobType, safeLimit],
      )
    : await postgresPool.query(
        `SELECT ${selectFields} FROM benchmark_job_history WHERE user_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2`,
        [userId, safeLimit],
      );

  return (result?.rows || []).map((row) => mapBenchmarkJobHistoryRow(row, { includeReport }));
}


async function getStateValueJSONPostgres(key, defaultValue) {
  const result = await postgresPool.query('SELECT state_value_json, state_value_text FROM bot_state WHERE state_key = $1 LIMIT 1', [key]);
  const row = result?.rows?.[0] || null;
  return mapPostgresBotStateValue(row, defaultValue);
}

async function getPlayerByIdPostgres(userId) {
  const result = await postgresPool.query('SELECT * FROM players WHERE user_id = $1 LIMIT 1', [userId]);
  return mapPostgresPlayerRow(result?.rows?.[0] || null);
}

async function getTopPlayersPostgres(limit = 10) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
  const result = await postgresPool.query('SELECT * FROM players ORDER BY updated_at DESC NULLS LAST LIMIT $1', [Math.max(safeLimit * 5, safeLimit)]);
  return (result?.rows || [])
    .map(mapPostgresPlayerRow)
    .filter((row) => Number(row?.registered || 0) === 1)
    .sort((a, b) => (Number(b.season_league_points || 0) - Number(a.season_league_points || 0)) || (Number(b.season_wins || 0) - Number(a.season_wins || 0)) || String(a.username || '').localeCompare(String(b.username || '')))
    .slice(0, safeLimit);
}

async function getTopPlayersForPlayoffsPostgres(limit = 10, minimumMatches = 0) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
  const safeMinimum = Number.isInteger(minimumMatches) && minimumMatches >= 0 ? minimumMatches : 0;
  return (await getTopPlayersPostgres(Math.max(safeLimit * 5, safeLimit)))
    .filter((row) => (Number(row.season_wins || 0) + Number(row.season_losses || 0) + Number(row.season_ties || 0)) >= safeMinimum)
    .map((row) => ({
      ...row,
      season_win_rate: (Number(row.season_wins || 0) + Number(row.season_losses || 0) + Number(row.season_ties || 0)) > 0
        ? Number(row.season_wins || 0) / (Number(row.season_wins || 0) + Number(row.season_losses || 0) + Number(row.season_ties || 0))
        : 0,
    }))
    .sort((a, b) => (Number(b.season_league_points || 0) - Number(a.season_league_points || 0)) || (Number(b.season_wins || 0) - Number(a.season_wins || 0)) || String(a.username || '').localeCompare(String(b.username || '')))
    .slice(0, safeLimit);
}

async function listAcademyMembersPostgres(limit = 25, excludeUserId = null) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 25;
  const result = await postgresPool.query('SELECT * FROM players ORDER BY updated_at DESC NULLS LAST LIMIT $1', [Math.max(safeLimit * 5, safeLimit)]);
  return (result?.rows || [])
    .map(mapPostgresPlayerRow)
    .filter((row) => Number(row?.is_academy_member || 0) === 1 && (!excludeUserId || row.user_id !== excludeUserId))
    .sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')))
    .slice(0, safeLimit);
}

async function hasSeasonTeamForSeasonPostgres(userId, seasonNumber) {
  const result = await postgresPool.query(
    'SELECT 1 FROM season_teams WHERE user_id = $1 AND season_number = $2 LIMIT 1',
    [userId, seasonNumber],
  );
  return Boolean(result?.rows?.[0]);
}

async function isShowdownNameTakenByAnotherUserPostgres(showdownName, excludeUserId = null) {
  const normalized = toShowdownId(showdownName);
  if (!normalized) return false;
  const result = await postgresPool.query('SELECT * FROM players');
  return (result?.rows || []).map(mapPostgresPlayerRow).some((row) => row && row.showdown_name_normalized === normalized && (!excludeUserId || row.user_id !== excludeUserId));
}

async function getSeasonTeamForSeasonPostgres(userId, seasonNumber) {
  const result = await postgresPool.query(
    'SELECT * FROM season_teams WHERE user_id = $1 AND season_number = $2 LIMIT 1',
    [userId, seasonNumber],
  );
  return mapPostgresSeasonTeamRow(result?.rows?.[0] || null);
}

async function listTeamSeasonsForUserPostgres(userId) {
  const result = await postgresPool.query(
    'SELECT * FROM season_teams WHERE user_id = $1 ORDER BY season_number DESC',
    [userId],
  );
  return (result?.rows || []).map(mapPostgresSeasonTeamRow).map((row) => ({ season_number: row.season_number, team_name: row.team_name, updated_at: row.updated_at }));
}

async function getBattleByIdPostgres(battleId) {
  const result = await postgresPool.query('SELECT * FROM battle_matches WHERE match_id = $1 LIMIT 1', [String(battleId)]);
  return mapPostgresBattleMatchRow(result?.rows?.[0] || null);
}

async function getBattleByRoomChannelIdPostgres(channelId) {
  const result = await postgresPool.query('SELECT * FROM battle_matches WHERE room_id = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1', [channelId]);
  return mapPostgresBattleMatchRow(result?.rows?.[0] || null);
}

async function getLatestUnresolvedBattleForUserPostgres(userId) {
  const result = await postgresPool.query(
    `SELECT * FROM battle_matches WHERE status IN ('pending','active') AND (player_one_user_id = $1 OR player_two_user_id = $1) ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    [userId],
  );
  return mapPostgresBattleMatchRow(result?.rows?.[0] || null);
}

async function getPendingIncomingChallengeForUserPostgres(userId) {
  const result = await postgresPool.query(`SELECT * FROM battle_matches WHERE status = 'pending' AND player_two_user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]);
  return mapPostgresBattleMatchRow(result?.rows?.[0] || null);
}

async function getPendingOutgoingChallengeForUserPostgres(userId) {
  const result = await postgresPool.query(`SELECT * FROM battle_matches WHERE status = 'pending' AND player_one_user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]);
  return mapPostgresBattleMatchRow(result?.rows?.[0] || null);
}

async function getActiveBattleForUserPostgres(userId) {
  const result = await postgresPool.query(`SELECT * FROM battle_matches WHERE status = 'active' AND (player_one_user_id = $1 OR player_two_user_id = $1) ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1`, [userId]);
  return mapPostgresBattleMatchRow(result?.rows?.[0] || null);
}

async function getFacedOpponentIdsForWindowPostgres(userId, seasonNumber, battleWindowKey) {
  const result = await postgresPool.query(
    `SELECT * FROM battle_matches WHERE season_number = $1 AND status IN ('pending','active','completed') ORDER BY updated_at DESC NULLS LAST`,
    [seasonNumber],
  );
  const ids = new Set();
  for (const rawRow of (result?.rows || [])) {
    const row = mapPostgresBattleMatchRow(rawRow);
    if (!row || row.battle_window_key !== battleWindowKey) continue;
    if (row.challenger_user_id !== userId && row.opponent_user_id !== userId) continue;
    ids.add(row.challenger_user_id === userId ? row.opponent_user_id : row.challenger_user_id);
  }
  return ids;
}

async function getBattleGamesForBattlePostgres(battleId) {
  const result = await postgresPool.query('SELECT * FROM battle_games WHERE match_id = $1 ORDER BY game_number ASC', [String(battleId)]);
  return (result?.rows || []).map(mapPostgresBattleGameRow);
}

async function getBattleGameByIdPostgres(gameId) {
  const result = await postgresPool.query('SELECT * FROM battle_games WHERE game_id = $1 LIMIT 1', [String(gameId)]);
  return mapPostgresBattleGameRow(result?.rows?.[0] || null);
}

async function getBattleGameByNumberPostgres(battleId, gameNumber) {
  const result = await postgresPool.query('SELECT * FROM battle_games WHERE match_id = $1 AND game_number = $2 LIMIT 1', [String(battleId), gameNumber]);
  return mapPostgresBattleGameRow(result?.rows?.[0] || null);
}

function toShowdownId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildDefaultPlayer(userId = null, username = null) {
  return {
    user_id: userId,
    username: username || 'Unknown Trainer',
    registered: 0,
    is_academy_member: 0,
    academy_last_synced_at: null,
    showdown_name: null,
    showdown_name_normalized: null,

    season_wins: 0,
    season_losses: 0,
    season_ties: 0,
    season_current_streak: 0,
    season_best_streak: 0,
    season_league_points: 0,

    career_wins: 0,
    career_losses: 0,
    career_ties: 0,
    career_highest_streak: 0,
    career_total_league_points: 0,

    best_team_name: null,
    best_team_wins: 0,
    best_team_losses: 0,
    best_team_ties: 0,
    best_team_importable: null,
  };
}

function normalizePlayerRow(existingRow = null, userId = null, username = null) {
  return {
    ...buildDefaultPlayer(userId, username),
    ...(existingRow || {}),
    user_id: userId || existingRow?.user_id || null,
    username: username || existingRow?.username || 'Unknown Trainer',
  };
}

async function mirrorBotStatePostgres(key, value) {
  const parsed = parseJsonOrDefault(value, null);
  await postgresPool.query(
    `
      INSERT INTO bot_state (state_key, state_value_json, state_value_text, updated_at)
      VALUES ($1, $2::jsonb, $3, NOW())
      ON CONFLICT (state_key) DO UPDATE SET
        state_value_json = EXCLUDED.state_value_json,
        state_value_text = EXCLUDED.state_value_text,
        updated_at = EXCLUDED.updated_at
    `,
    [key, JSON.stringify(parsed), parsed ? null : String(value || '')],
  );
}

async function mirrorPlayerPostgres(record) {
  const safe = normalizePlayerRow(record, record?.user_id, record?.username);
  const payload = {
    username: safe.username,
    registered: Number(safe.registered || 0),
    seasonWins: Number(safe.season_wins || 0),
    seasonLosses: Number(safe.season_losses || 0),
    seasonTies: Number(safe.season_ties || 0),
    seasonCurrentStreak: Number(safe.season_current_streak || 0),
    seasonBestStreak: Number(safe.season_best_streak || 0),
    seasonLeaguePoints: Number(safe.season_league_points || 0),
    careerWins: Number(safe.career_wins || 0),
    careerLosses: Number(safe.career_losses || 0),
    careerTies: Number(safe.career_ties || 0),
    careerHighestStreak: Number(safe.career_highest_streak || 0),
    careerTotalLeaguePoints: Number(safe.career_total_league_points || 0),
    bestTeamName: safe.best_team_name || null,
    bestTeamWins: Number(safe.best_team_wins || 0),
    bestTeamLosses: Number(safe.best_team_losses || 0),
    bestTeamTies: Number(safe.best_team_ties || 0),
    bestTeamImportable: safe.best_team_importable || null,
    isAcademyMember: Number(safe.is_academy_member || 0),
    academyLastSyncedAt: safe.academy_last_synced_at || null,
    showdownName: safe.showdown_name || null,
    showdownNameNormalized: safe.showdown_name_normalized || null,
  };
  await postgresPool.query(
    `
      INSERT INTO players (user_id, display_name, trainer_name, registered_at, updated_at, payload)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        trainer_name = EXCLUDED.trainer_name,
        registered_at = EXCLUDED.registered_at,
        updated_at = EXCLUDED.updated_at,
        payload = EXCLUDED.payload
    `,
    [
      safe.user_id,
      safe.username || null,
      safe.showdown_name || safe.username || null,
      Number(safe.registered || 0) ? new Date().toISOString() : null,
      new Date().toISOString(),
      JSON.stringify(payload),
    ],
  );
}

async function syncPlayerByIdPostgres(userId) {
  const row = await getNonBenchmarkSqlite('SELECT * FROM players WHERE user_id = ?', [userId]);
  if (!row) return;
  await mirrorPlayerPostgres(row);
}

async function syncAllPlayersPostgres() {
  const rows = await allNonBenchmarkSqlite('SELECT * FROM players');
  for (const row of rows) {
    await mirrorPlayerPostgres(row);
  }
}

async function mirrorSeasonTeamPostgres(row) {
  if (!row) return;
  const payload = {
    legacyId: Number(row.id || 0),
    username: row.username || null,
  };
  await postgresPool.query(
    `
      INSERT INTO season_teams (user_id, season_number, team_name, format_id, team_export, created_at, updated_at, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (user_id, season_number) DO UPDATE SET
        team_name = EXCLUDED.team_name,
        format_id = EXCLUDED.format_id,
        team_export = EXCLUDED.team_export,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        payload = EXCLUDED.payload
    `,
    [row.user_id, Number(row.season_number || 0), row.team_name || null, null, row.team_export || null, row.created_at || null, row.updated_at || null, JSON.stringify(payload)],
  );
}

async function syncSeasonTeamPostgres(userId, seasonNumber) {
  const row = await getNonBenchmarkSqlite('SELECT * FROM season_teams WHERE user_id = ? AND season_number = ?', [userId, seasonNumber]);
  if (!row) {
    await postgresPool.query('DELETE FROM season_teams WHERE user_id = $1 AND season_number = $2', [userId, seasonNumber]);
    return;
  }
  await mirrorSeasonTeamPostgres(row);
}

async function mirrorBattleMatchPostgres(row) {
  if (!row) return;
  const payload = {
    challengerUsername: row.challenger_username || null,
    opponentUsername: row.opponent_username || null,
    challengerTeamName: row.challenger_team_name || null,
    challengerTeamExport: row.challenger_team_export || null,
    opponentTeamName: row.opponent_team_name || null,
    opponentTeamExport: row.opponent_team_export || null,
    loserUserId: row.loser_user_id || null,
    acceptedAt: row.accepted_at || null,
    designatedSubmitterUserId: row.designated_submitter_user_id || null,
    publicChannelId: row.public_channel_id || null,
    publicMessageId: row.public_message_id || null,
    format: row.format || null,
    bestOf: Number(row.best_of || 3),
    currentGameNumber: Number(row.current_game_number || 1),
    battleRoomChannelId: row.battle_room_channel_id || null,
    battleRoomMessageId: row.battle_room_message_id || null,
    challengerScore: Number(row.challenger_score || 0),
    opponentScore: Number(row.opponent_score || 0),
    legacyId: Number(row.id || 0),
  };
  await postgresPool.query(
    `
      INSERT INTO battle_matches (match_id, guild_id, season_number, player_one_user_id, player_two_user_id, status, winner_user_id, room_id, series_type, created_at, updated_at, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      ON CONFLICT (match_id) DO UPDATE SET
        guild_id = EXCLUDED.guild_id,
        season_number = EXCLUDED.season_number,
        player_one_user_id = EXCLUDED.player_one_user_id,
        player_two_user_id = EXCLUDED.player_two_user_id,
        status = EXCLUDED.status,
        winner_user_id = EXCLUDED.winner_user_id,
        room_id = EXCLUDED.room_id,
        series_type = EXCLUDED.series_type,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        payload = EXCLUDED.payload
    `,
    [String(row.id), null, Number(row.season_number || 0), row.challenger_user_id, row.opponent_user_id, row.status || 'pending', row.winner_user_id || null, row.battle_room_channel_id || null, `bo${Number(row.best_of || 3)}`, row.created_at || null, row.updated_at || null, JSON.stringify(payload)],
  );
}

async function syncBattleByIdPostgres(battleId) {
  const row = await getNonBenchmarkSqlite('SELECT * FROM battle_matches WHERE id = ?', [battleId]);
  if (!row) {
    await postgresPool.query('DELETE FROM battle_matches WHERE match_id = $1', [String(battleId)]);
    return;
  }
  await mirrorBattleMatchPostgres(row);
}

async function mirrorBattleGamePostgres(row) {
  if (!row) return;
  const payload = {
    legacyId: Number(row.id || 0),
    showdownLinkUrl: row.showdown_link_url || null,
    detectedFormat: row.detected_format || null,
    spectatorStatus: row.spectator_status || null,
    spectatorConnectedAt: row.spectator_connected_at || null,
    spectatorDisconnectedAt: row.spectator_disconnected_at || null,
    challengerShowdownName: row.challenger_showdown_name || null,
    opponentShowdownName: row.opponent_showdown_name || null,
    winnerShowdownName: row.winner_showdown_name || null,
    battleLogText: row.battle_log_text || null,
    connectionError: row.connection_error || null,
  };
  await postgresPool.query(
    `
      INSERT INTO battle_games (game_id, match_id, game_number, room_id, status, winner_user_id, replay_url, created_at, updated_at, payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      ON CONFLICT (game_id) DO UPDATE SET
        match_id = EXCLUDED.match_id,
        game_number = EXCLUDED.game_number,
        room_id = EXCLUDED.room_id,
        status = EXCLUDED.status,
        winner_user_id = EXCLUDED.winner_user_id,
        replay_url = EXCLUDED.replay_url,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        payload = EXCLUDED.payload
    `,
    [String(row.id), String(row.battle_id), Number(row.game_number || 0), row.showdown_room_id || null, row.status || 'awaiting_link', row.winner_user_id || null, row.replay_url || null, row.created_at || null, row.updated_at || null, JSON.stringify(payload)],
  );
}

async function syncBattleGameByIdPostgres(gameId) {
  const row = await getNonBenchmarkSqlite('SELECT * FROM battle_games WHERE id = ?', [gameId]);
  if (!row) {
    await postgresPool.query('DELETE FROM battle_games WHERE game_id = $1', [String(gameId)]);
    return;
  }
  await syncBattleByIdPostgres(row.battle_id);
  await mirrorBattleGamePostgres(row);
}

async function listPlayersPostgresRows() {
  const result = await postgresPool.query('SELECT * FROM players');
  return Array.isArray(result.rows) ? result.rows.map((row) => mapPostgresPlayerRow(row)).filter(Boolean) : [];
}

async function listSeasonTeamsPostgresRows(seasonNumber = null) {
  const params = [];
  let sql = 'SELECT * FROM season_teams';
  if (seasonNumber !== null && seasonNumber !== undefined) {
    params.push(Number(seasonNumber || 0));
    sql += ' WHERE season_number = $1';
  }
  const result = await postgresPool.query(sql, params);
  return Array.isArray(result.rows) ? result.rows.map((row) => mapPostgresSeasonTeamRow(row)).filter(Boolean) : [];
}

async function listUnresolvedBattlesPostgresRows(seasonNumber = null) {
  const params = [];
  let sql = "SELECT * FROM battle_matches WHERE status IN ('pending', 'active')";
  if (seasonNumber !== null && seasonNumber !== undefined) {
    params.push(Number(seasonNumber || 0));
    sql += ' AND season_number = $1';
  }
  sql += ' ORDER BY updated_at DESC, match_id DESC';
  const result = await postgresPool.query(sql, params);
  return Array.isArray(result.rows) ? result.rows.map((row) => mapPostgresBattleMatchRow(row)).filter(Boolean) : [];
}

async function allocatePostgresBattleMatchId() {
  const result = await postgresPool.query("SELECT COALESCE(MAX(match_id::bigint), 0) + 1 AS next_id FROM battle_matches WHERE match_id ~ '^[0-9]+$'");
  return Number(result.rows?.[0]?.next_id || 1);
}

async function allocatePostgresBattleGameId() {
  const result = await postgresPool.query("SELECT COALESCE(MAX(game_id::bigint), 0) + 1 AS next_id FROM battle_games WHERE game_id ~ '^[0-9]+$'");
  return Number(result.rows?.[0]?.next_id || 1);
}

async function updateBattleMatchPostgresPrimary(battleId, patch = {}) {
  const existing = await getBattleByIdPostgres(battleId);
  if (!existing) throw new Error(`Battle ${battleId} was not found in PostgreSQL.`);
  const next = { ...existing, ...patch, id: Number(battleId), updated_at: patch.updated_at || new Date().toISOString() };
  await mirrorBattleMatchPostgres(next);
  return getBattleByIdPostgres(battleId);
}

async function updateBattleGamePostgresPrimary(gameId, patch = {}) {
  const existing = await getBattleGameByIdPostgres(gameId);
  if (!existing) throw new Error(`Battle game ${gameId} was not found in PostgreSQL.`);
  const next = { ...existing, ...patch, id: Number(gameId), updated_at: patch.updated_at || new Date().toISOString() };
  await mirrorBattleGamePostgres(next);
  return getBattleGameByIdPostgres(gameId);
}

async function getStateValueJSON(key, defaultValue) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const row = await getStateValueJSONPostgres(key, defaultValue);
      if (row !== defaultValue || shouldRetireNonBenchmarkSqliteRuntime()) return row;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback(`bot_state:${key}`, error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return defaultValue;
  const row = await getNonBenchmarkSqlite('SELECT value FROM bot_state WHERE key = ?', [key]);
  if (!row?.value) return defaultValue;
  try {
    return JSON.parse(row.value);
  } catch (error) {
    console.error(`Failed to parse bot_state key "${key}":`, error);
    return defaultValue;
  }
}

async function setStateValueJSON(key, value) {
  if (!shouldUsePostgresNonBenchmarkWritePrimary()) {
    await runNonBenchmarkSqlite(
      `INSERT INTO bot_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  }
  if (canUsePostgresNonBenchmarkWrites() || shouldRetireNonBenchmarkSqliteRuntime()) {
    try {
      await mirrorBotStatePostgres(key, value);
    } catch (error) {
      warnNonBenchmarkPostgresWriteFallback(`bot_state:${key}`, error);
    }
  }
  return value;
}


function mapPostgresBotStateValue(row, defaultValue) {
  if (!row) return defaultValue;
  if (row.state_value_json !== undefined && row.state_value_json !== null) {
    return parseJsonOrDefault(row.state_value_json, defaultValue);
  }
  if (row.state_value_text !== undefined && row.state_value_text !== null) {
    return parseJsonOrDefault(row.state_value_text, defaultValue);
  }
  return defaultValue;
}

function mapPostgresPlayerRow(row) {
  if (!row) return null;
  const payload = parseJsonOrDefault(row.payload, {}) || {};
  const registeredAt = row.registered_at || null;
  const registered = payload.registered !== undefined
    ? Number(payload.registered || 0)
    : (registeredAt ? 1 : 0);
  return {
    user_id: row.user_id,
    username: payload.username || row.display_name || 'Unknown Trainer',
    registered,
    is_academy_member: payload.isAcademyMember !== undefined ? Number(payload.isAcademyMember || 0) : 0,
    academy_last_synced_at: payload.academyLastSyncedAt || null,
    showdown_name: payload.showdownName || row.trainer_name || null,
    showdown_name_normalized: payload.showdownNameNormalized || null,
    season_wins: Number(payload.seasonWins || 0),
    season_losses: Number(payload.seasonLosses || 0),
    season_ties: Number(payload.seasonTies || 0),
    season_current_streak: Number(payload.seasonCurrentStreak || 0),
    season_best_streak: Number(payload.seasonBestStreak || 0),
    season_league_points: Number(payload.seasonLeaguePoints || 0),
    career_wins: Number(payload.careerWins || 0),
    career_losses: Number(payload.careerLosses || 0),
    career_ties: Number(payload.careerTies || 0),
    career_highest_streak: Number(payload.careerHighestStreak || 0),
    career_total_league_points: Number(payload.careerTotalLeaguePoints || 0),
    best_team_name: payload.bestTeamName || null,
    best_team_wins: Number(payload.bestTeamWins || 0),
    best_team_losses: Number(payload.bestTeamLosses || 0),
    best_team_ties: Number(payload.bestTeamTies || 0),
    best_team_importable: payload.bestTeamImportable || null,
  };
}

function mapPostgresSeasonTeamRow(row) {
  if (!row) return null;
  const payload = parseJsonOrDefault(row.payload, {}) || {};
  return {
    id: Number(payload.legacyId || 0) || null,
    season_number: Number(row.season_number || 0),
    user_id: row.user_id,
    username: payload.username || null,
    team_name: row.team_name || null,
    team_export: row.team_export || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function mapPostgresBattleMatchRow(row) {
  if (!row) return null;
  const payload = parseJsonOrDefault(row.payload, {}) || {};
  const bestOf = Number(String(row.series_type || '').replace(/[^0-9]/g, '') || payload.bestOf || 3);
  return {
    id: Number(payload.legacyId || row.match_id || 0) || null,
    season_number: Number(row.season_number || 0),
    battle_window_key: payload.battleWindowKey || null,
    challenger_user_id: row.player_one_user_id || null,
    challenger_username: payload.challengerUsername || null,
    challenger_team_name: payload.challengerTeamName || null,
    challenger_team_export: payload.challengerTeamExport || null,
    opponent_user_id: row.player_two_user_id || null,
    opponent_username: payload.opponentUsername || null,
    opponent_team_name: payload.opponentTeamName || null,
    opponent_team_export: payload.opponentTeamExport || null,
    status: row.status || 'pending',
    winner_user_id: row.winner_user_id || null,
    loser_user_id: payload.loserUserId || null,
    accepted_at: payload.acceptedAt || null,
    designated_submitter_user_id: payload.designatedSubmitterUserId || null,
    public_channel_id: payload.publicChannelId || null,
    public_message_id: payload.publicMessageId || null,
    format: payload.format || null,
    best_of: bestOf,
    current_game_number: Number(payload.currentGameNumber || 1),
    battle_room_channel_id: payload.battleRoomChannelId || row.room_id || null,
    battle_room_message_id: payload.battleRoomMessageId || null,
    challenger_score: Number(payload.challengerScore || 0),
    opponent_score: Number(payload.opponentScore || 0),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    completed_at: payload.completedAt || null,
  };
}

function mapPostgresBattleGameRow(row) {
  if (!row) return null;
  const payload = parseJsonOrDefault(row.payload, {}) || {};
  return {
    id: Number(payload.legacyId || row.game_id || 0) || null,
    battle_id: Number(row.match_id || 0) || null,
    game_number: Number(row.game_number || 0),
    status: row.status || 'awaiting_link',
    showdown_room_id: row.room_id || null,
    showdown_link_url: payload.showdownLinkUrl || null,
    replay_url: row.replay_url || null,
    detected_format: payload.detectedFormat || null,
    spectator_status: payload.spectatorStatus || null,
    spectator_connected_at: payload.spectatorConnectedAt || null,
    spectator_disconnected_at: payload.spectatorDisconnectedAt || null,
    challenger_showdown_name: payload.challengerShowdownName || null,
    opponent_showdown_name: payload.opponentShowdownName || null,
    winner_user_id: row.winner_user_id || null,
    winner_showdown_name: payload.winnerShowdownName || null,
    battle_log_text: payload.battleLogText || null,
    connection_error: payload.connectionError || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    completed_at: payload.completedAt || null,
  };
}

function parseJsonOrDefault(rawValue, defaultValue = null) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return defaultValue;
  if (typeof rawValue === 'object') return rawValue;
  if (typeof rawValue !== 'string') return rawValue;
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    return defaultValue;
  }
}

function buildDefaultBenchmarkTeamState() {
  return {
    team_export: null,
    updated_at: null,
  };
}

function buildDefaultBenchmarkJobState() {
  return {
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
  };
}

function buildDefaultBenchmarkReportState() {
  return {
    report: null,
    updated_at: null,
    job_id: null,
  };
}

function buildDefaultBenchmarkReportMetaState() {
  return {
    has_report: false,
    has_match_archive: false,
    updated_at: null,
    job_id: null,
    report_id: null,
  };
}

function normalizeBenchmarkJobState(row = null) {
  const defaults = buildDefaultBenchmarkJobState();
  if (!row) return defaults;
  return {
    ...defaults,
    job_id: row.worker_job_id || row.job_id || null,
    status: row.status || defaults.status,
    submitted_at: row.submitted_at || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    error: row.error || null,
    progress: parseJsonOrDefault(row.progress_json, null),
    request: parseJsonOrDefault(row.request_json, null),
    format_id: row.format_id || null,
    benchmark_mode: row.benchmark_mode || null,
    selection_summary: parseJsonOrDefault(row.selection_summary_json, null),
  };
}

async function ensureBenchmarkTables() {
  await runBenchmarkSqlite(`
    CREATE TABLE IF NOT EXISTS benchmark_teams (
      user_id TEXT PRIMARY KEY,
      team_export TEXT DEFAULT NULL,
      updated_at TEXT DEFAULT NULL
    )
  `);

  await runBenchmarkSqlite(`
    CREATE TABLE IF NOT EXISTS benchmark_job_state_latest (
      user_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      worker_job_id TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      submitted_at TEXT DEFAULT NULL,
      started_at TEXT DEFAULT NULL,
      completed_at TEXT DEFAULT NULL,
      error TEXT DEFAULT NULL,
      progress_json TEXT DEFAULT NULL,
      request_json TEXT DEFAULT NULL,
      format_id TEXT DEFAULT NULL,
      benchmark_mode TEXT DEFAULT NULL,
      selection_summary_json TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, job_type)
    )
  `);

  await runBenchmarkSqlite(`
    CREATE TABLE IF NOT EXISTS benchmark_job_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      worker_job_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'queued',
      submitted_at TEXT DEFAULT NULL,
      started_at TEXT DEFAULT NULL,
      completed_at TEXT DEFAULT NULL,
      error TEXT DEFAULT NULL,
      progress_json TEXT DEFAULT NULL,
      request_json TEXT DEFAULT NULL,
      report_json TEXT DEFAULT NULL,
      format_id TEXT DEFAULT NULL,
      benchmark_mode TEXT DEFAULT NULL,
      selection_summary_json TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await runBenchmarkSqlite(`
    CREATE TABLE IF NOT EXISTS benchmark_reports_latest (
      user_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      worker_job_id TEXT DEFAULT NULL,
      report_json TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, report_type)
    )
  `);

  await runBenchmarkSqlite(`
    CREATE TABLE IF NOT EXISTS strategy_memory_team_versions (
      team_version_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      format_id TEXT DEFAULT NULL,
      team_hash TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      report_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, format_id, team_hash)
    )
  `);

  await runBenchmarkSqlite(`
    CREATE TABLE IF NOT EXISTS strategy_memory_reports (
      report_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      worker_job_id TEXT DEFAULT NULL,
      team_version_id TEXT DEFAULT NULL,
      team_hash TEXT DEFAULT NULL,
      format_id TEXT DEFAULT NULL,
      benchmark_mode TEXT DEFAULT NULL,
      generated_at TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL,
      total_games_completed INTEGER NOT NULL DEFAULT 0,
      total_turns INTEGER NOT NULL DEFAULT 0,
      average_turns REAL NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      confidence_label TEXT DEFAULT NULL,
      confidence_inputs_json TEXT DEFAULT NULL,
      selection_summary_json TEXT DEFAULT NULL,
      storage_metrics_json TEXT DEFAULT NULL,
      prompt_version TEXT DEFAULT '',
      model_tier TEXT DEFAULT '',
      model_used TEXT DEFAULT '',
      report_json_sha256 TEXT DEFAULT NULL
    )
  `);

  await runBenchmarkSqlite(`
    CREATE TABLE IF NOT EXISTS strategy_memory_battles (
      battle_id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_version_id TEXT DEFAULT NULL,
      format_id TEXT DEFAULT NULL,
      opponent_registry_id INTEGER NOT NULL DEFAULT 0,
      archetype TEXT DEFAULT NULL,
      opponent_name TEXT DEFAULT NULL,
      game_number INTEGER NOT NULL DEFAULT 1,
      result TEXT DEFAULT NULL,
      winner TEXT DEFAULT NULL,
      turns INTEGER DEFAULT NULL,
      series_result TEXT DEFAULT NULL,
      replay_id TEXT DEFAULT NULL,
      archive_relative_path TEXT DEFAULT NULL,
      battle_log_pruned INTEGER NOT NULL DEFAULT 0,
      battle_log_bytes INTEGER NOT NULL DEFAULT 0,
      battle_log_original_bytes INTEGER NOT NULL DEFAULT 0,
      player_team_hash TEXT DEFAULT NULL,
      opponent_team_hash TEXT DEFAULT NULL,
      proof_turns_json TEXT DEFAULT NULL,
      storage_metrics_json TEXT DEFAULT NULL,
      created_at TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await runBenchmarkSqlite(`
    CREATE TABLE IF NOT EXISTS strategy_memory_turn_evidence (
      evidence_id TEXT PRIMARY KEY,
      battle_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      turn_number INTEGER NOT NULL,
      evidence_type TEXT NOT NULL,
      label TEXT DEFAULT NULL,
      summary TEXT DEFAULT NULL,
      tags_json TEXT DEFAULT NULL,
      source_json TEXT DEFAULT NULL,
      created_at TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await ensureStrategyCoachSqliteTables();
}

async function ensureBenchmarkReportColumns() {
  return;
}

async function ensureBenchmarkIndexes() {
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_benchmark_job_state_latest_user ON benchmark_job_state_latest (user_id, job_type)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_benchmark_job_history_user_type_updated ON benchmark_job_history (user_id, job_type, updated_at DESC)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_benchmark_job_history_status ON benchmark_job_history (status, updated_at DESC)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_benchmark_job_history_report_id ON benchmark_job_history (user_id, report_id)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_benchmark_reports_latest_user_type ON benchmark_reports_latest (user_id, report_type)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_benchmark_reports_latest_report_id ON benchmark_reports_latest (user_id, report_id)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_strategy_memory_reports_user_updated ON strategy_memory_reports (user_id, updated_at DESC)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_strategy_memory_reports_team ON strategy_memory_reports (team_version_id, updated_at DESC)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_strategy_memory_battles_report ON strategy_memory_battles (report_id, game_number)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_strategy_memory_battles_opponent ON strategy_memory_battles (opponent_registry_id, archetype)');
  await runBenchmarkSqlite('CREATE INDEX IF NOT EXISTS idx_strategy_memory_turn_evidence_battle ON strategy_memory_turn_evidence (battle_id, turn_number)');
  await ensureStrategyCoachSqliteIndexes();
}

async function getBenchmarkTeamState(userId) {
  if (shouldRetireBenchmarkSqliteRuntime()) {
    const pgState = await getBenchmarkTeamStatePostgres(userId);
    return pgState || buildDefaultBenchmarkTeamState();
  }

  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkReads()) {
    try {
      const pgState = await getBenchmarkTeamStatePostgres(userId);
      if (pgState) return pgState;
    } catch (error) {
      warnBenchmarkPostgresReadFallback('benchmark_teams', error);
    }
  }

  const row = await getBenchmarkSqlite(
    'SELECT user_id, team_export, updated_at FROM benchmark_teams WHERE user_id = ?',
    [userId],
  );
  if (!row) return buildDefaultBenchmarkTeamState();
  return {
    team_export: row.team_export || null,
    updated_at: row.updated_at || null,
  };
}

async function setBenchmarkTeamState(userId, teamExport) {
  const payload = {
    team_export: String(teamExport || '').replace(/\r\n/g, '\n').trim() || null,
    updated_at: new Date().toISOString(),
  };

  if (!shouldUsePostgresBenchmarkWritePrimary()) {
    await runBenchmarkSqlite(
      `
        INSERT INTO benchmark_teams (user_id, team_export, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          team_export = excluded.team_export,
          updated_at = excluded.updated_at
      `,
      [userId, payload.team_export, payload.updated_at],
    );
  }

  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkWrites()) {
    try {
      await mirrorBenchmarkTeamStatePostgres(userId, payload);
    } catch (error) {
      warnBenchmarkPostgresWriteFallback('benchmark_teams', error);
    }
  }

  return payload;
}

async function getBenchmarkLatestJobState(userId, jobType) {
  if (shouldRetireBenchmarkSqliteRuntime()) {
    const pgState = await getBenchmarkLatestJobStatePostgres(userId, jobType);
    return (pgState && (pgState.job_id || pgState.status !== 'idle' || pgState.updated_at)) ? pgState : buildDefaultBenchmarkJobState();
  }

  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkReads()) {
    try {
      const pgState = await getBenchmarkLatestJobStatePostgres(userId, jobType);
      if (pgState && (pgState.job_id || pgState.status !== 'idle' || pgState.updated_at)) return pgState;
    } catch (error) {
      warnBenchmarkPostgresReadFallback('benchmark_job_state_latest', error);
    }
  }

  const row = await getBenchmarkSqlite(
    'SELECT * FROM benchmark_job_state_latest WHERE user_id = ? AND job_type = ?',
    [userId, jobType],
  );
  return normalizeBenchmarkJobState(row);
}

async function upsertBenchmarkJobState({
  userId,
  jobType,
  workerJobId = undefined,
  status = undefined,
  submittedAt = undefined,
  startedAt = undefined,
  completedAt = undefined,
  error = undefined,
  progress = undefined,
  request = undefined,
  report = undefined,
  formatId = undefined,
  benchmarkMode = undefined,
  selectionSummary = undefined,
} = {}) {
  if (!userId) throw new Error('upsertBenchmarkJobState requires userId.');
  if (!jobType) throw new Error('upsertBenchmarkJobState requires jobType.');

  const current = await getBenchmarkLatestJobState(userId, jobType);
  const now = new Date().toISOString();

  const next = {
    job_id: workerJobId !== undefined ? (workerJobId || null) : current.job_id,
    status: status !== undefined ? (status || 'idle') : current.status,
    submitted_at: submittedAt !== undefined ? (submittedAt || null) : current.submitted_at,
    started_at: startedAt !== undefined ? (startedAt || null) : current.started_at,
    completed_at: completedAt !== undefined ? (completedAt || null) : current.completed_at,
    error: error !== undefined ? (error || null) : current.error,
    progress: progress !== undefined ? progress : current.progress,
    request: request !== undefined ? request : current.request,
    format_id: formatId !== undefined ? (formatId || null) : current.format_id,
    benchmark_mode: benchmarkMode !== undefined ? (benchmarkMode || null) : current.benchmark_mode,
    selection_summary: selectionSummary !== undefined ? selectionSummary : current.selection_summary,
  };

  if (!shouldRetireBenchmarkSqliteRuntime()) {
    await runBenchmarkSqlite(
      `
      INSERT INTO benchmark_job_state_latest (
        user_id, job_type, worker_job_id, status, submitted_at, started_at, completed_at, error,
        progress_json, request_json, format_id, benchmark_mode, selection_summary_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, job_type) DO UPDATE SET
        worker_job_id = excluded.worker_job_id,
        status = excluded.status,
        submitted_at = excluded.submitted_at,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        error = excluded.error,
        progress_json = excluded.progress_json,
        request_json = excluded.request_json,
        format_id = excluded.format_id,
        benchmark_mode = excluded.benchmark_mode,
        selection_summary_json = excluded.selection_summary_json,
        updated_at = excluded.updated_at
    `,
    [
      userId,
      jobType,
      next.job_id,
      next.status,
      next.submitted_at,
      next.started_at,
      next.completed_at,
      next.error,
      JSON.stringify(next.progress),
      JSON.stringify(next.request),
      next.format_id,
      next.benchmark_mode,
      JSON.stringify(next.selection_summary),
      now,
    ],
    );
  }

  if (!shouldRetireBenchmarkSqliteRuntime() && next.job_id) {
    await runBenchmarkSqlite(
      `
        INSERT INTO benchmark_job_history (
          user_id, job_type, worker_job_id, status, submitted_at, started_at, completed_at, error,
          progress_json, request_json, report_id, report_json, format_id, benchmark_mode, selection_summary_json,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(worker_job_id) DO UPDATE SET
          user_id = excluded.user_id,
          job_type = excluded.job_type,
          status = excluded.status,
          submitted_at = excluded.submitted_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          error = excluded.error,
          progress_json = excluded.progress_json,
          request_json = excluded.request_json,
          report_id = COALESCE(excluded.report_id, benchmark_job_history.report_id),
          report_json = COALESCE(excluded.report_json, benchmark_job_history.report_json),
          format_id = excluded.format_id,
          benchmark_mode = excluded.benchmark_mode,
          selection_summary_json = excluded.selection_summary_json,
          updated_at = excluded.updated_at
      `,
      [
        userId,
        jobType,
        next.job_id,
        next.status,
        next.submitted_at,
        next.started_at,
        next.completed_at,
        next.error,
        JSON.stringify(next.progress),
        JSON.stringify(next.request),
        report?.savedReport?.reportId || report?.reportId || null,
        report === undefined ? null : JSON.stringify(report),
        next.format_id,
        next.benchmark_mode,
        JSON.stringify(next.selection_summary),
        now,
        now,
      ],
      );
    }

  if (canUsePostgresBenchmarkCutover()) {
    try {
      await mirrorBenchmarkLatestJobStatePostgres(userId, jobType, next, now);
      await mirrorBenchmarkJobHistoryPostgres(userId, jobType, next, report, now);
    } catch (error) {
      warnBenchmarkPostgresWriteFallback('benchmark_job_state_latest / benchmark_job_history', error);
    }
  } else if (canUsePostgresBenchmarkWrites()) {
    try {
      await mirrorBenchmarkLatestJobStatePostgres(userId, jobType, next, now);
      await mirrorBenchmarkJobHistoryPostgres(userId, jobType, next, report, now);
    } catch (error) {
      warnBenchmarkPostgresWriteFallback('benchmark_job_state_latest / benchmark_job_history', error);
    }
  }

  if (report !== undefined && report !== null) {
    await saveBenchmarkLatestReport(userId, jobType, report, next.job_id);
  }

  return getBenchmarkLatestJobState(userId, jobType);
}

async function saveBenchmarkLatestReport(userId, reportType, report, workerJobId = null) {
  const payload = {
    report: report || null,
    updated_at: new Date().toISOString(),
    job_id: workerJobId || null,
    report_id: report?.savedReport?.reportId || report?.reportId || null,
  };

  if (!shouldRetireBenchmarkSqliteRuntime()) {
    await runBenchmarkSqlite(
      `
      INSERT INTO benchmark_reports_latest (user_id, report_type, worker_job_id, report_id, report_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, report_type) DO UPDATE SET
        worker_job_id = excluded.worker_job_id,
        report_id = excluded.report_id,
        report_json = excluded.report_json,
        updated_at = excluded.updated_at
    `,
    [userId, reportType, payload.job_id, payload.report_id, JSON.stringify(payload.report), payload.updated_at],
    );
  }

  if (!shouldRetireBenchmarkSqliteRuntime() && payload.job_id) {
    await runBenchmarkSqlite(
      `UPDATE benchmark_job_history SET report_id = ?, report_json = ?, updated_at = ? WHERE worker_job_id = ?`,
      [payload.report_id, JSON.stringify(payload.report), payload.updated_at, payload.job_id],
    );
  }

  if (canUsePostgresBenchmarkCutover()) {
    try {
      await mirrorBenchmarkLatestReportPostgres(userId, reportType, payload);
    } catch (error) {
      warnBenchmarkPostgresWriteFallback('benchmark_reports_latest', error);
    }
  } else if (canUsePostgresBenchmarkWrites()) {
    try {
      await mirrorBenchmarkLatestReportPostgres(userId, reportType, payload);
    } catch (error) {
      warnBenchmarkPostgresWriteFallback('benchmark_reports_latest', error);
    }
  }

  if (payload.report) {
    try {
      await saveStrategyMemoryFromBenchmarkReport(
        userId,
        reportType,
        payload.report,
        payload.job_id,
        payload.report_id,
        payload.updated_at,
      );
    } catch (error) {
      warnBenchmarkPostgresWriteFallback('strategy_memory', error);
    }
  }

  return payload;
}

async function getBenchmarkLatestReport(userId, reportType) {
  if (shouldRetireBenchmarkSqliteRuntime()) {
    const pgReport = await getBenchmarkLatestReportPostgres(userId, reportType);
    return pgReport || buildDefaultBenchmarkReportState();
  }

  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkReads()) {
    try {
      const pgReport = await getBenchmarkLatestReportPostgres(userId, reportType);
      if (pgReport) return pgReport;
    } catch (error) {
      warnBenchmarkPostgresReadFallback('benchmark_reports_latest', error);
    }
  }

  const row = await getBenchmarkSqlite(
    'SELECT worker_job_id, report_id, report_json, updated_at FROM benchmark_reports_latest WHERE user_id = ? AND report_type = ?',
    [userId, reportType],
  );

  if (!row) return buildDefaultBenchmarkReportState();

  return {
    report: parseJsonOrDefault(row.report_json, null),
    updated_at: row.updated_at || null,
    job_id: row.worker_job_id || null,
    report_id: row.report_id || null,
  };
}

async function getBenchmarkLatestReportMeta(userId, reportType) {
  if (shouldRetireBenchmarkSqliteRuntime()) {
    const pgMeta = await getBenchmarkLatestReportMetaPostgres(userId, reportType);
    return pgMeta || buildDefaultBenchmarkReportMetaState();
  }

  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkReads()) {
    try {
      const pgMeta = await getBenchmarkLatestReportMetaPostgres(userId, reportType);
      if (pgMeta) return pgMeta;
    } catch (error) {
      warnBenchmarkPostgresReadFallback('benchmark_reports_latest_meta', error);
    }
  }

  const row = await getBenchmarkSqlite(
    `
      SELECT
        worker_job_id,
        report_id,
        updated_at,
        CASE
          WHEN report_json IS NOT NULL AND TRIM(report_json) != '' AND TRIM(report_json) != 'null' THEN 1
          ELSE 0
        END AS has_report,
        CASE
          WHEN report_json IS NOT NULL
            AND TRIM(report_json) != ''
            AND TRIM(report_json) != 'null'
            AND (
              INSTR(report_json, '"matchArchive"') > 0
              OR INSTR(report_json, '"sources"') > 0
              OR INSTR(report_json, '"files"') > 0
            )
          THEN 1
          ELSE 0
        END AS has_match_archive
      FROM benchmark_reports_latest
      WHERE user_id = ? AND report_type = ?
    `,
    [userId, reportType],
  );

  if (!row) return buildDefaultBenchmarkReportMetaState();

  return {
    has_report: Boolean(row.has_report),
    has_match_archive: Boolean(row.has_match_archive),
    updated_at: row.updated_at || null,
    job_id: row.worker_job_id || null,
    report_id: row.report_id || null,
  };
}

async function listBenchmarkJobHistoryForUser(userId, jobType = null, limit = 10, options = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;

  if (shouldRetireBenchmarkSqliteRuntime()) {
    return listBenchmarkJobHistoryForUserPostgres(userId, jobType, safeLimit, options);
  }

  if (canUsePostgresBenchmarkCutover() || canUsePostgresBenchmarkReads()) {
    try {
      const pgRows = await listBenchmarkJobHistoryForUserPostgres(userId, jobType, safeLimit, options);
      if (pgRows.length) return pgRows;
    } catch (error) {
      warnBenchmarkPostgresReadFallback('benchmark_job_history', error);
    }
  }

  const rows = jobType
    ? await allBenchmarkSqlite(
        'SELECT * FROM benchmark_job_history WHERE user_id = ? AND job_type = ? ORDER BY updated_at DESC, id DESC LIMIT ?',
        [userId, jobType, safeLimit],
      )
    : await allBenchmarkSqlite(
        'SELECT * FROM benchmark_job_history WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?',
        [userId, safeLimit],
      );

  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    job_type: row.job_type,
    job_id: row.worker_job_id || null,
    status: row.status || 'idle',
    submitted_at: row.submitted_at || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    error: row.error || null,
    progress: parseJsonOrDefault(row.progress_json, null),
    request: parseJsonOrDefault(row.request_json, null),
    report: parseJsonOrDefault(row.report_json, null),
    format_id: row.format_id || null,
    benchmark_mode: row.benchmark_mode || null,
    selection_summary: parseJsonOrDefault(row.selection_summary_json, null),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }));
}


async function ensurePlayerColumns() {
  return;
}

async function ensureSeasonTeamColumns() {
  return;
}

async function ensureBattleMatchColumns() {
  return;
}

async function ensureIndexes() {
  return;
}

function shouldSkipSqliteInitialization() {
  return true;
}

async function initializeDatabase() {
  console.log('[SQLite] Runtime initialization is permanently disabled. PostgreSQL is the active runtime database.');
}

async function upsertPlayer(record) {
  const safe = normalizePlayerRow(record, record.user_id, record.username);
  if (!shouldUsePostgresNonBenchmarkWritePrimary()) {
    await runNonBenchmarkSqlite(
      `
        INSERT OR REPLACE INTO players (
        user_id, username, registered, is_academy_member, academy_last_synced_at,
        showdown_name, showdown_name_normalized,
        season_wins, season_losses, season_ties, season_current_streak, season_best_streak, season_league_points,
        career_wins, career_losses, career_ties, career_highest_streak, career_total_league_points,
        best_team_name, best_team_wins, best_team_losses, best_team_ties, best_team_importable
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      safe.user_id, safe.username, safe.registered, safe.is_academy_member, safe.academy_last_synced_at,
      safe.showdown_name, safe.showdown_name_normalized,
      safe.season_wins, safe.season_losses, safe.season_ties, safe.season_current_streak, safe.season_best_streak, safe.season_league_points,
      safe.career_wins, safe.career_losses, safe.career_ties, safe.career_highest_streak, safe.career_total_league_points,
      safe.best_team_name, safe.best_team_wins, safe.best_team_losses, safe.best_team_ties, safe.best_team_importable,
    ],
    );
  }
  if (canUsePostgresNonBenchmarkWrites()) {
    try {
      await mirrorPlayerPostgres(safe);
    } catch (error) {
      warnNonBenchmarkPostgresWriteFallback(`players:${safe.user_id}`, error);
    }
  }
  return safe;
}

async function ensurePlayerExists(userId, username) {
  const existing = await getPlayerById(userId);
  return upsertPlayer(normalizePlayerRow(existing, userId, username));
}

async function getPlayerById(userId) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const row = await getPlayerByIdPostgres(userId);
      if (row || shouldRetireNonBenchmarkSqliteRuntime()) return row;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback(`players:getPlayerById:${userId}`, error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return null;
  return getNonBenchmarkSqlite('SELECT * FROM players WHERE user_id = ?', [userId]);
}

async function getPlayerStats(userId) {
  const row = await getPlayerById(userId);
  return row || buildDefaultPlayer(userId, null);
}

async function getTopPlayers(limit = 10) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const rows = await getTopPlayersPostgres(limit);
      if (rows.length || shouldRetireNonBenchmarkSqliteRuntime()) return rows;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('players:getTopPlayers', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return [];
  return allNonBenchmarkSqlite(
    `SELECT user_id, username, season_wins, season_losses, season_ties, season_league_points FROM players WHERE registered = 1 ORDER BY season_league_points DESC, season_wins DESC, username COLLATE NOCASE ASC LIMIT ?`,
    [limit],
  );
}

async function getTopPlayersForPlayoffs(limit = 10, minimumMatches = 0) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
  const safeMinimum = Number.isInteger(minimumMatches) && minimumMatches >= 0 ? minimumMatches : 0;
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const rows = await getTopPlayersForPlayoffsPostgres(safeLimit, safeMinimum);
      if (rows.length || shouldRetireNonBenchmarkSqliteRuntime()) return rows;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('players:getTopPlayersForPlayoffs', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return [];
  return allNonBenchmarkSqlite(
    `
      SELECT
        user_id,
        username,
        season_wins,
        season_losses,
        season_ties,
        season_league_points,
        CASE
          WHEN (season_wins + season_losses + season_ties) > 0
            THEN CAST(season_wins AS REAL) / CAST((season_wins + season_losses + season_ties) AS REAL)
          ELSE 0
        END AS season_win_rate
      FROM players
      WHERE registered = 1
        AND (season_wins + season_losses + season_ties) >= ?
      ORDER BY season_league_points DESC, season_wins DESC, username COLLATE NOCASE ASC
      LIMIT ?
    `,
    [safeMinimum, safeLimit],
  );
}

async function resetSeasonStatsForAllPlayers() {
  if (!shouldUsePostgresNonBenchmarkWritePrimary()) {
    await runNonBenchmarkSqlite(`UPDATE players SET season_wins = 0, season_losses = 0, season_ties = 0, season_current_streak = 0, season_best_streak = 0, season_league_points = 0`);
  }
  if (canUsePostgresNonBenchmarkWrites()) {
    try {
      if (shouldUsePostgresNonBenchmarkWritePrimary()) {
        const rows = await listPlayersPostgresRows();
        for (const row of rows) {
          row.season_wins = 0;
          row.season_losses = 0;
          row.season_ties = 0;
          row.season_current_streak = 0;
          row.season_best_streak = 0;
          row.season_league_points = 0;
          await mirrorPlayerPostgres(row);
        }
      } else {
        await syncAllPlayersPostgres();
      }
    } catch (error) { warnNonBenchmarkPostgresWriteFallback('players:resetSeasonStatsForAllPlayers', error); }
  }
}

async function setAllPlayersRegisteredState(registered) {
  if (!shouldUsePostgresNonBenchmarkWritePrimary()) {
    await runNonBenchmarkSqlite('UPDATE players SET registered = ?', [registered ? 1 : 0]);
  }
  if (canUsePostgresNonBenchmarkWrites()) {
    try {
      if (shouldUsePostgresNonBenchmarkWritePrimary()) {
        const rows = await listPlayersPostgresRows();
        for (const row of rows) {
          row.registered = registered ? 1 : 0;
          await mirrorPlayerPostgres(row);
        }
      } else {
        await syncAllPlayersPostgres();
      }
    } catch (error) { warnNonBenchmarkPostgresWriteFallback('players:setAllPlayersRegisteredState', error); }
  }
}

async function syncRegisteredStateForSeason(seasonNumber) {
  await setAllPlayersRegisteredState(false);
  if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) return;
  if (!shouldUsePostgresNonBenchmarkWritePrimary()) {
    await runNonBenchmarkSqlite(
      `UPDATE players SET registered = 1 WHERE user_id IN (SELECT user_id FROM season_teams WHERE season_number = ?)`,
      [seasonNumber],
    );
  }
  if (canUsePostgresNonBenchmarkWrites()) {
    try {
      if (shouldUsePostgresNonBenchmarkWritePrimary()) {
        const teamRows = await listSeasonTeamsPostgresRows(seasonNumber);
        const ids = new Set(teamRows.map((row) => String(row.user_id || '')).filter(Boolean));
        const players = await listPlayersPostgresRows();
        for (const row of players) {
          row.registered = ids.has(String(row.user_id || '')) ? 1 : 0;
          await mirrorPlayerPostgres(row);
        }
      } else {
        await syncAllPlayersPostgres();
      }
    } catch (error) { warnNonBenchmarkPostgresWriteFallback('players:syncRegisteredStateForSeason', error); }
  }
}

async function syncAcademyMembers(memberRecords = []) {
  const safe = Array.isArray(memberRecords) ? memberRecords.filter((m) => m && m.userId && m.username) : [];
  const syncedAt = new Date().toISOString();
  if (!shouldUsePostgresNonBenchmarkWritePrimary()) {
    await runNonBenchmarkSqlite('UPDATE players SET is_academy_member = 0');
  }
  if (shouldUsePostgresNonBenchmarkWritePrimary() && canUsePostgresNonBenchmarkWrites()) {
    const existingPlayers = await listPlayersPostgresRows();
    for (const row of existingPlayers) {
      row.is_academy_member = 0;
      await mirrorPlayerPostgres(row);
    }
  }
  for (const member of safe) {
    const existing = await getPlayerById(member.userId);
    const record = normalizePlayerRow(existing, member.userId, member.username);
    record.username = member.username;
    record.is_academy_member = 1;
    record.academy_last_synced_at = syncedAt;
    await upsertPlayer(record);
  }
  if (canUsePostgresNonBenchmarkWrites() && !shouldUsePostgresNonBenchmarkWritePrimary()) {
    try { await syncAllPlayersPostgres(); } catch (error) { warnNonBenchmarkPostgresWriteFallback('players:syncAcademyMembers', error); }
  }
  return { syncedAt, syncedCount: safe.length };
}

async function listAcademyMembers(limit = 25, excludeUserId = null) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const rows = await listAcademyMembersPostgres(limit, excludeUserId);
      if (rows.length || shouldRetireNonBenchmarkSqliteRuntime()) return rows;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('players:listAcademyMembers', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return [];
  const params = [];
  let sql = 'SELECT * FROM players WHERE is_academy_member = 1';
  if (excludeUserId) {
    sql += ' AND user_id != ?';
    params.push(excludeUserId);
  }
  sql += ' ORDER BY username COLLATE NOCASE ASC LIMIT ?';
  params.push(limit);
  return allNonBenchmarkSqlite(sql, params);
}

async function hasSeasonTeamForSeason(userId, seasonNumber) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const found = await hasSeasonTeamForSeasonPostgres(userId, seasonNumber);
      if (found || shouldRetireNonBenchmarkSqliteRuntime()) return found;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('season_teams:hasSeasonTeamForSeason', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return false;
  const row = await getNonBenchmarkSqlite('SELECT 1 FROM season_teams WHERE user_id = ? AND season_number = ?', [userId, seasonNumber]);
  return !!row;
}

async function isShowdownNameTakenByAnotherUser(showdownName, excludeUserId = null) {
  const normalized = toShowdownId(showdownName);
  if (!normalized) return false;
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const found = await isShowdownNameTakenByAnotherUserPostgres(normalized, excludeUserId);
      if (found || shouldRetireNonBenchmarkSqliteRuntime()) return found;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('players:isShowdownNameTakenByAnotherUser', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return false;
  const row = await getNonBenchmarkSqlite(
    'SELECT user_id FROM players WHERE showdown_name_normalized = ? AND (? IS NULL OR user_id != ?) LIMIT 1',
    [normalized, excludeUserId, excludeUserId],
  );
  return !!row;
}

async function upsertSeasonTeam({ seasonNumber, userId, username, teamName, teamExport, showdownName = null }) {
  const now = new Date().toISOString();
  const existingRow = await getNonBenchmarkSqlite('SELECT id, created_at FROM season_teams WHERE user_id = ? AND season_number = ?', [userId, seasonNumber]);
  const player = await ensurePlayerExists(userId, username);
  if (showdownName !== null && showdownName !== undefined) {
    player.showdown_name = String(showdownName).trim() || null;
    player.showdown_name_normalized = player.showdown_name ? toShowdownId(player.showdown_name) : null;
    await upsertPlayer(player);
  }
  if (!shouldUsePostgresNonBenchmarkWritePrimary()) {
    await runNonBenchmarkSqlite(
      `
        INSERT INTO season_teams (season_number, user_id, username, team_name, team_export, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(season_number, user_id) DO UPDATE SET
          username = excluded.username,
          team_name = excluded.team_name,
          team_export = excluded.team_export,
          updated_at = excluded.updated_at
      `,
      [seasonNumber, userId, username, teamName, teamExport, existingRow?.created_at || now, now],
    );
  }
  if (canUsePostgresNonBenchmarkWrites()) {
    try {
      if (shouldUsePostgresNonBenchmarkWritePrimary()) {
        await mirrorSeasonTeamPostgres({
          id: existingRow?.id || null,
          season_number: seasonNumber,
          user_id: userId,
          username,
          team_name: teamName,
          team_export: teamExport,
          created_at: existingRow?.created_at || now,
          updated_at: now,
        });
      } else {
        await syncSeasonTeamPostgres(userId, seasonNumber);
      }
    } catch (error) { warnNonBenchmarkPostgresWriteFallback(`season_teams:upsert:${userId}:${seasonNumber}`, error); }
  }
  return getSeasonTeamForSeason(userId, seasonNumber);
}

async function deleteSeasonTeamForSeason(userId, seasonNumber) {
  if (!shouldUsePostgresNonBenchmarkWritePrimary()) {
    await runNonBenchmarkSqlite('DELETE FROM season_teams WHERE user_id = ? AND season_number = ?', [userId, seasonNumber]);
  }
  if (canUsePostgresNonBenchmarkWrites()) {
    try { await postgresPool.query('DELETE FROM season_teams WHERE user_id = $1 AND season_number = $2', [userId, seasonNumber]); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`season_teams:delete:${userId}:${seasonNumber}`, error); }
  }
}

async function getSeasonTeamForSeason(userId, seasonNumber) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const row = await getSeasonTeamForSeasonPostgres(userId, seasonNumber);
      if (row || shouldRetireNonBenchmarkSqliteRuntime()) return row;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('season_teams:getSeasonTeamForSeason', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return null;
  return getNonBenchmarkSqlite('SELECT season_number, user_id, username, team_name, team_export, created_at, updated_at FROM season_teams WHERE user_id = ? AND season_number = ?', [userId, seasonNumber]);
}

async function listTeamSeasonsForUser(userId) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const rows = await listTeamSeasonsForUserPostgres(userId);
      if (rows.length || shouldRetireNonBenchmarkSqliteRuntime()) return rows;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('season_teams:listTeamSeasonsForUser', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return [];
  return allNonBenchmarkSqlite('SELECT season_number, team_name, updated_at FROM season_teams WHERE user_id = ? ORDER BY season_number DESC', [userId]);
}

async function getBattleById(battleId) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const row = await getBattleByIdPostgres(battleId);
      if (row || shouldRetireNonBenchmarkSqliteRuntime()) return row;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('battle_matches:getBattleById', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return null;
  return getNonBenchmarkSqlite('SELECT * FROM battle_matches WHERE id = ?', [battleId]);
}

async function getBattleByRoomChannelId(channelId) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const row = await getBattleByRoomChannelIdPostgres(channelId);
      if (row || shouldRetireNonBenchmarkSqliteRuntime()) return row;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('battle_matches:getBattleByRoomChannelId', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return null;
  return getNonBenchmarkSqlite('SELECT * FROM battle_matches WHERE battle_room_channel_id = ? ORDER BY created_at DESC LIMIT 1', [channelId]);
}

async function getLatestUnresolvedBattleForUser(userId) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const row = await getLatestUnresolvedBattleForUserPostgres(userId);
      if (row || shouldRetireNonBenchmarkSqliteRuntime()) return row;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('battle_matches:getLatestUnresolvedBattleForUser', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return null;
  return getNonBenchmarkSqlite(
    `SELECT * FROM battle_matches WHERE status IN ('pending','active') AND (challenger_user_id = ? OR opponent_user_id = ?) ORDER BY updated_at DESC, id DESC LIMIT 1`,
    [userId, userId],
  );
}

async function getPendingIncomingChallengeForUser(userId) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const row = await getPendingIncomingChallengeForUserPostgres(userId);
      if (row || shouldRetireNonBenchmarkSqliteRuntime()) return row;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('battle_matches:getPendingIncomingChallengeForUser', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return null;
  return getNonBenchmarkSqlite(`SELECT * FROM battle_matches WHERE status = 'pending' AND opponent_user_id = ? ORDER BY created_at DESC LIMIT 1`, [userId]);
}

async function getPendingOutgoingChallengeForUser(userId) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const row = await getPendingOutgoingChallengeForUserPostgres(userId);
      if (row || shouldRetireNonBenchmarkSqliteRuntime()) return row;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('battle_matches:getPendingOutgoingChallengeForUser', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return null;
  return getNonBenchmarkSqlite(`SELECT * FROM battle_matches WHERE status = 'pending' AND challenger_user_id = ? ORDER BY created_at DESC LIMIT 1`, [userId]);
}

async function getActiveBattleForUser(userId) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const row = await getActiveBattleForUserPostgres(userId);
      if (row || shouldRetireNonBenchmarkSqliteRuntime()) return row;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('battle_matches:getActiveBattleForUser', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return null;
  return getNonBenchmarkSqlite(`SELECT * FROM battle_matches WHERE status = 'active' AND (challenger_user_id = ? OR opponent_user_id = ?) ORDER BY accepted_at DESC, updated_at DESC LIMIT 1`, [userId, userId]);
}

async function getFacedOpponentIdsForWindow(userId, seasonNumber, battleWindowKey) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const ids = await getFacedOpponentIdsForWindowPostgres(userId, seasonNumber, battleWindowKey);
      if (ids.size || shouldRetireNonBenchmarkSqliteRuntime()) return ids;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('battle_matches:getFacedOpponentIdsForWindow', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return new Set();
  const rows = await allNonBenchmarkSqlite(
    `SELECT challenger_user_id, opponent_user_id FROM battle_matches WHERE season_number = ? AND battle_window_key = ? AND status IN ('pending','active','completed') AND (challenger_user_id = ? OR opponent_user_id = ?)`,
    [seasonNumber, battleWindowKey, userId, userId],
  );
  const ids = new Set();
  for (const row of rows) {
    ids.add(row.challenger_user_id === userId ? row.opponent_user_id : row.challenger_user_id);
  }
  return ids;
}

async function createBattleChallenge({
  seasonNumber,
  battleWindowKey,
  challengerUserId,
  challengerUsername,
  opponentUserId,
  opponentUsername,
  allowRematch = false,
}) {
  if (challengerUserId === opponentUserId) throw new Error('You cannot challenge yourself.');
  const challengerUnresolved = await getLatestUnresolvedBattleForUser(challengerUserId);
  if (challengerUnresolved) throw new Error('You already have an unresolved battle request or active battle.');
  const opponentUnresolved = await getLatestUnresolvedBattleForUser(opponentUserId);
  if (opponentUnresolved) throw new Error('That trainer already has an unresolved battle request or active battle.');

  if (!allowRematch) {
    const faced = await getFacedOpponentIdsForWindow(challengerUserId, seasonNumber, battleWindowKey);
    if (faced.has(opponentUserId)) {
      throw new Error('You have already faced that trainer during this battle window.');
    }
  }

  const now = new Date().toISOString();
  if (shouldUsePostgresNonBenchmarkWritePrimary()) {
    const nextId = await allocatePostgresBattleMatchId();
    await mirrorBattleMatchPostgres({
      id: nextId,
      season_number: seasonNumber,
      battle_window_key: battleWindowKey,
      challenger_user_id: challengerUserId,
      challenger_username: challengerUsername,
      opponent_user_id: opponentUserId,
      opponent_username: opponentUsername,
      status: 'pending',
      challenger_score: 0,
      opponent_score: 0,
      format: 'gen9vgc2026regg',
      best_of: 3,
      current_game_number: 1,
      created_at: now,
      updated_at: now,
    });
    return getBattleById(nextId);
  }
  const result = await runNonBenchmarkSqlite(
    `INSERT INTO battle_matches (season_number, battle_window_key, challenger_user_id, challenger_username, opponent_user_id, opponent_username, status, challenger_score, opponent_score, format, best_of, current_game_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, 3, 1, ?, ?)`,
    [seasonNumber, battleWindowKey, challengerUserId, challengerUsername, opponentUserId, opponentUsername, 'gen9vgc2026regg', now, now],
  );
  if (canUsePostgresNonBenchmarkWrites()) {
    try { await syncBattleByIdPostgres(result.lastID); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_matches:create:${result.lastID}`, error); }
  }
  return getBattleById(result.lastID);
}

async function setBattleRoomInfo(battleId, channelId, messageId) {
  const now = new Date().toISOString();
  if (shouldUsePostgresNonBenchmarkWritePrimary()) {
    await updateBattleMatchPostgresPrimary(battleId, { battle_room_channel_id: channelId || null, battle_room_message_id: messageId || null, updated_at: now });
    return getBattleById(battleId);
  }
  await runNonBenchmarkSqlite('UPDATE battle_matches SET battle_room_channel_id = ?, battle_room_message_id = ?, updated_at = ? WHERE id = ?', [channelId || null, messageId || null, now, battleId]);
  if (canUsePostgresNonBenchmarkWrites()) {
    try { await syncBattleByIdPostgres(battleId); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_matches:setBattleRoomInfo:${battleId}`, error); }
  }
  return getBattleById(battleId);
}

async function ensureBattleGame(battleOrId, gameNumber = null) {
  const battle = typeof battleOrId === 'object' ? battleOrId : await getBattleById(battleOrId);
  if (!battle) throw new Error('Battle not found.');
  const targetGameNumber = Number(gameNumber || battle.current_game_number || 1);
  let game = await getBattleGameByNumber(battle.id, targetGameNumber);
  if (game) return game;
  const now = new Date().toISOString();
  if (shouldUsePostgresNonBenchmarkWritePrimary()) {
    const nextId = await allocatePostgresBattleGameId();
    await mirrorBattleGamePostgres({
      id: nextId,
      battle_id: battle.id,
      game_number: targetGameNumber,
      status: 'awaiting_link',
      created_at: now,
      updated_at: now,
    });
    return getBattleGameById(nextId);
  }
  const result = await runNonBenchmarkSqlite(`INSERT INTO battle_games (battle_id, game_number, status, created_at, updated_at) VALUES (?, ?, 'awaiting_link', ?, ?)`, [battle.id, targetGameNumber, now, now]);
  if (canUsePostgresNonBenchmarkWrites()) {
    try { await syncBattleGameByIdPostgres(result.lastID); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_games:ensure:${result.lastID}`, error); }
  }
  return getBattleGameById(result.lastID);
}

async function acceptBattleChallenge(battleId, actingUserId, designatedSubmitterUserId = null) {
  const battle = await getBattleById(battleId);
  if (!battle || battle.status !== 'pending') throw new Error('That challenge is no longer pending.');
  if (battle.opponent_user_id !== actingUserId) throw new Error('Only the challenged trainer can accept this battle.');
  const now = new Date().toISOString();
  const submitter = designatedSubmitterUserId || (Math.random() < 0.5 ? battle.challenger_user_id : battle.opponent_user_id);
  if (shouldUsePostgresNonBenchmarkWritePrimary()) {
    await updateBattleMatchPostgresPrimary(battleId, { status: 'active', designated_submitter_user_id: submitter, accepted_at: now, updated_at: now });
  } else {
    await runNonBenchmarkSqlite(
      `UPDATE battle_matches SET status = 'active', designated_submitter_user_id = ?, accepted_at = ?, updated_at = ? WHERE id = ?`,
      [submitter, now, now, battleId],
    );
    if (canUsePostgresNonBenchmarkWrites()) {
      try { await syncBattleByIdPostgres(battleId); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_matches:accept:${battleId}`, error); }
    }
  }
  const updated = await getBattleById(battleId);
  await ensureBattleGame(updated, 1);
  return updated;
}

async function declineBattleChallenge(battleId, actingUserId) {
  const battle = await getBattleById(battleId);
  if (!battle || battle.status !== 'pending') throw new Error('That challenge is no longer pending.');
  if (battle.opponent_user_id !== actingUserId) throw new Error('Only the challenged trainer can decline this battle.');
  const now = new Date().toISOString();
  if (shouldUsePostgresNonBenchmarkWritePrimary()) {
    await updateBattleMatchPostgresPrimary(battleId, { status: 'declined', updated_at: now, completed_at: now });
  } else {
    await runNonBenchmarkSqlite(`UPDATE battle_matches SET status = 'declined', updated_at = ?, completed_at = ? WHERE id = ?`, [now, now, battleId]);
    if (canUsePostgresNonBenchmarkWrites()) {
      try { await syncBattleByIdPostgres(battleId); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_matches:decline:${battleId}`, error); }
    }
  }
  return getBattleById(battleId);
}

async function cancelBattleChallenge(battleId, actingUserId) {
  const battle = await getBattleById(battleId);
  if (!battle || battle.status !== 'pending') throw new Error('That challenge is no longer pending.');
  if (battle.challenger_user_id !== actingUserId) throw new Error('Only the challenger can cancel this battle.');
  const now = new Date().toISOString();
  if (shouldUsePostgresNonBenchmarkWritePrimary()) {
    await updateBattleMatchPostgresPrimary(battleId, { status: 'cancelled', updated_at: now, completed_at: now });
  } else {
    await runNonBenchmarkSqlite(`UPDATE battle_matches SET status = 'cancelled', updated_at = ?, completed_at = ? WHERE id = ?`, [now, now, battleId]);
    if (canUsePostgresNonBenchmarkWrites()) {
      try { await syncBattleByIdPostgres(battleId); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_matches:cancel:${battleId}`, error); }
    }
  }
  return getBattleById(battleId);
}

async function getBattleGamesForBattle(battleId) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const rows = await getBattleGamesForBattlePostgres(battleId);
      if (rows.length || shouldRetireNonBenchmarkSqliteRuntime()) return rows;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('battle_games:getBattleGamesForBattle', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return [];
  return allNonBenchmarkSqlite('SELECT * FROM battle_games WHERE battle_id = ? ORDER BY game_number ASC', [battleId]);
}

async function getBattleGameById(gameId) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const row = await getBattleGameByIdPostgres(gameId);
      if (row || shouldRetireNonBenchmarkSqliteRuntime()) return row;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('battle_games:getBattleGameById', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return null;
  return getNonBenchmarkSqlite('SELECT * FROM battle_games WHERE id = ?', [gameId]);
}

async function getBattleGameByNumber(battleId, gameNumber) {
  if (canUsePostgresNonBenchmarkReads()) {
    try {
      const row = await getBattleGameByNumberPostgres(battleId, gameNumber);
      if (row || shouldRetireNonBenchmarkSqliteRuntime()) return row;
    } catch (error) {
      if (shouldRetireNonBenchmarkSqliteRuntime()) throw error;
      warnNonBenchmarkPostgresReadFallback('battle_games:getBattleGameByNumber', error);
    }
  }
  if (shouldRetireNonBenchmarkSqliteRuntime()) return null;
  return getNonBenchmarkSqlite('SELECT * FROM battle_games WHERE battle_id = ? AND game_number = ?', [battleId, gameNumber]);
}

async function getCurrentBattleGame(battleId) {
  const battle = await getBattleById(battleId);
  if (!battle) return null;
  return getBattleGameByNumber(battleId, Number(battle.current_game_number || 1));
}

async function attachShowdownLinkToGame({ battleId, gameNumber, showdownLinkUrl, showdownRoomId }) {
  const battle = await getBattleById(battleId);
  if (!battle || battle.status !== 'active') throw new Error('Battle is not active.');
  const targetGameNumber = Number(gameNumber || battle.current_game_number || 1);
  const game = await ensureBattleGame(battle, targetGameNumber);
  const now = new Date().toISOString();
  if (shouldUsePostgresNonBenchmarkWritePrimary()) {
    await updateBattleGamePostgresPrimary(game.id, { showdown_link_url: showdownLinkUrl, showdown_room_id: showdownRoomId, status: 'spectating', spectator_status: 'connecting', connection_error: null, updated_at: now, started_at: game.started_at || now });
  } else {
    await runNonBenchmarkSqlite(
      `UPDATE battle_games SET showdown_link_url = ?, showdown_room_id = ?, status = 'spectating', spectator_status = 'connecting', connection_error = NULL, updated_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`,
      [showdownLinkUrl, showdownRoomId, now, now, game.id],
    );
    if (canUsePostgresNonBenchmarkWrites()) {
      try { await syncBattleGameByIdPostgres(game.id); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_games:attachShowdownLink:${game.id}`, error); }
    }
  }
  return getBattleGameById(game.id);
}

async function setBattleGameSpectatorState(gameId, { spectatorStatus = null, connectionError = null, connected = false, disconnected = false, detectedFormat = null, challengerShowdownName = null, opponentShowdownName = null, battleLogText = null, replayUrl = null } = {}) {
  const game = await getBattleGameById(gameId);
  if (!game) throw new Error('Battle game not found.');
  const now = new Date().toISOString();
  if (shouldUsePostgresNonBenchmarkWritePrimary()) {
    await updateBattleGamePostgresPrimary(gameId, {
      spectator_status: spectatorStatus || game.spectator_status,
      connection_error: connectionError,
      spectator_connected_at: connected ? now : game.spectator_connected_at,
      spectator_disconnected_at: disconnected ? now : game.spectator_disconnected_at,
      detected_format: detectedFormat || game.detected_format,
      challenger_showdown_name: challengerShowdownName || game.challenger_showdown_name,
      opponent_showdown_name: opponentShowdownName || game.opponent_showdown_name,
      battle_log_text: battleLogText || game.battle_log_text,
      replay_url: replayUrl || game.replay_url,
      updated_at: now,
    });
  } else {
    await runNonBenchmarkSqlite(
      `UPDATE battle_games SET spectator_status = COALESCE(?, spectator_status), connection_error = ?, spectator_connected_at = CASE WHEN ? = 1 THEN ? ELSE spectator_connected_at END, spectator_disconnected_at = CASE WHEN ? = 1 THEN ? ELSE spectator_disconnected_at END, detected_format = COALESCE(?, detected_format), challenger_showdown_name = COALESCE(?, challenger_showdown_name), opponent_showdown_name = COALESCE(?, opponent_showdown_name), battle_log_text = COALESCE(?, battle_log_text), replay_url = COALESCE(?, replay_url), updated_at = ? WHERE id = ?`,
      [spectatorStatus, connectionError, connected ? 1 : 0, now, disconnected ? 1 : 0, now, detectedFormat, challengerShowdownName, opponentShowdownName, battleLogText, replayUrl, now, gameId],
    );
    if (canUsePostgresNonBenchmarkWrites()) {
      try { await syncBattleGameByIdPostgres(gameId); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_games:setSpectatorState:${gameId}`, error); }
    }
  }
  return getBattleGameById(gameId);
}

function defaultScoringConfig(scoringConfig = {}) {
  return {
    gameWinPoints: Number.isInteger(scoringConfig.gameWinPoints) ? scoringConfig.gameWinPoints : 50,
    sweepBonusPoints: Number.isInteger(scoringConfig.sweepBonusPoints) ? scoringConfig.sweepBonusPoints : 25,
    bestOf: Number.isInteger(scoringConfig.bestOf) ? scoringConfig.bestOf : 3,
  };
}

async function awardVisiblePoints(userId, points) {
  if (!userId || !points) return;
  if (!shouldUsePostgresNonBenchmarkWritePrimary()) {
    await runNonBenchmarkSqlite(
      `UPDATE players SET season_league_points = season_league_points + ?, career_total_league_points = career_total_league_points + ? WHERE user_id = ?`,
      [points, points, userId],
    );
  }
  if (canUsePostgresNonBenchmarkWrites()) {
    try {
      if (shouldUsePostgresNonBenchmarkWritePrimary()) {
        const row = await getPlayerById(userId);
        if (!row) return;
        row.season_league_points = Number(row.season_league_points || 0) + Number(points || 0);
        row.career_total_league_points = Number(row.career_total_league_points || 0) + Number(points || 0);
        await mirrorPlayerPostgres(row);
      } else {
        await syncPlayerByIdPostgres(userId);
      }
    } catch (error) { warnNonBenchmarkPostgresWriteFallback(`players:awardVisiblePoints:${userId}`, error); }
  }
}

async function applyCompletedBattleToPlayers(winnerUserId, loserUserId) {
  const winner = await ensurePlayerExists(winnerUserId, (await getPlayerById(winnerUserId))?.username || 'Unknown Trainer');
  const loser = await ensurePlayerExists(loserUserId, (await getPlayerById(loserUserId))?.username || 'Unknown Trainer');

  const winnerCurrentStreak = Number(winner.season_current_streak || 0) + 1;
  winner.season_wins = Number(winner.season_wins || 0) + 1;
  winner.season_current_streak = winnerCurrentStreak;
  winner.season_best_streak = Math.max(Number(winner.season_best_streak || 0), winnerCurrentStreak);
  winner.career_wins = Number(winner.career_wins || 0) + 1;
  winner.career_highest_streak = Math.max(Number(winner.career_highest_streak || 0), winnerCurrentStreak);

  loser.season_losses = Number(loser.season_losses || 0) + 1;
  loser.season_current_streak = 0;
  loser.career_losses = Number(loser.career_losses || 0) + 1;

  await upsertPlayer(winner);
  await upsertPlayer(loser);
}

async function applyBattleGameResult(battleId, winnerUserId, scoringConfig = {}) {
  const battle = await getBattleById(battleId);
  if (!battle || battle.status !== 'active') throw new Error('Battle is not active.');
  if (![battle.challenger_user_id, battle.opponent_user_id].includes(winnerUserId)) {
    throw new Error('Winner is not part of this battle.');
  }
  const scoring = defaultScoringConfig(scoringConfig);
  const neededWins = Math.max(1, Math.floor(scoring.bestOf / 2) + 1);
  const challengerScore = Number(battle.challenger_score || 0) + (winnerUserId === battle.challenger_user_id ? 1 : 0);
  const opponentScore = Number(battle.opponent_score || 0) + (winnerUserId === battle.opponent_user_id ? 1 : 0);
  const battleCompleted = challengerScore >= neededWins || opponentScore >= neededWins;
  const now = new Date().toISOString();

  await awardVisiblePoints(winnerUserId, scoring.gameWinPoints);

  const finalWinnerUserId = battleCompleted ? winnerUserId : null;
  const nextGameNumber = battleCompleted ? Number(battle.current_game_number || 1) : Number(battle.current_game_number || 1) + 1;

  if (shouldUsePostgresNonBenchmarkWritePrimary()) {
    await updateBattleMatchPostgresPrimary(battleId, { challenger_score: challengerScore, opponent_score: opponentScore, winner_user_id: finalWinnerUserId, status: battleCompleted ? 'completed' : 'active', current_game_number: nextGameNumber, updated_at: now, completed_at: battleCompleted ? now : null });
  } else {
    await runNonBenchmarkSqlite(
      `UPDATE battle_matches SET challenger_score = ?, opponent_score = ?, winner_user_id = ?, status = ?, current_game_number = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
      [challengerScore, opponentScore, finalWinnerUserId, battleCompleted ? 'completed' : 'active', nextGameNumber, now, battleCompleted ? now : null, battleId],
    );
    if (canUsePostgresNonBenchmarkWrites()) {
      try { await syncBattleByIdPostgres(battleId); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_matches:applyBattleGameResult:${battleId}`, error); }
    }
  }

  const updatedBattle = await getBattleById(battleId);
  if (battleCompleted) {
    const loserUserId = winnerUserId === battle.challenger_user_id ? battle.opponent_user_id : battle.challenger_user_id;
    const loserScore = winnerUserId === battle.challenger_user_id ? opponentScore : challengerScore;
    if (loserScore === 0 && scoring.sweepBonusPoints > 0) {
      await awardVisiblePoints(winnerUserId, scoring.sweepBonusPoints);
    }
    await applyCompletedBattleToPlayers(winnerUserId, loserUserId);
  }
  return updatedBattle;
}

async function completeBattleGameFromSpectator({ battleId, gameId = null, gameNumber = null, winnerUserId, winnerShowdownName = null, challengerShowdownName = null, opponentShowdownName = null, detectedFormat = null, battleLogText = null, replayUrl = null, showdownRoomId = null, showdownLinkUrl = null, scoringConfig = null }) {
  const battle = await getBattleById(battleId);
  if (!battle || battle.status !== 'active') throw new Error('Battle is not active.');
  const targetGame = gameId ? await getBattleGameById(gameId) : await ensureBattleGame(battle, gameNumber || battle.current_game_number || 1);
  if (!targetGame) throw new Error('Battle game not found.');
  if (targetGame.status === 'completed') {
    return { battle: await getBattleById(battleId), game: targetGame, alreadyCompleted: true };
  }
  const now = new Date().toISOString();
  if (shouldUsePostgresNonBenchmarkWritePrimary()) {
    await updateBattleGamePostgresPrimary(targetGame.id, {
      status: 'completed',
      winner_user_id: winnerUserId,
      winner_showdown_name: winnerShowdownName || targetGame.winner_showdown_name,
      challenger_showdown_name: challengerShowdownName || targetGame.challenger_showdown_name,
      opponent_showdown_name: opponentShowdownName || targetGame.opponent_showdown_name,
      detected_format: detectedFormat || targetGame.detected_format,
      battle_log_text: battleLogText || targetGame.battle_log_text,
      replay_url: replayUrl || targetGame.replay_url,
      showdown_room_id: showdownRoomId || targetGame.showdown_room_id,
      showdown_link_url: showdownLinkUrl || targetGame.showdown_link_url,
      spectator_status: 'completed',
      spectator_disconnected_at: targetGame.spectator_disconnected_at || now,
      completed_at: now,
      updated_at: now,
    });
  } else {
    await runNonBenchmarkSqlite(
      `UPDATE battle_games SET status = 'completed', winner_user_id = ?, winner_showdown_name = COALESCE(?, winner_showdown_name), challenger_showdown_name = COALESCE(?, challenger_showdown_name), opponent_showdown_name = COALESCE(?, opponent_showdown_name), detected_format = COALESCE(?, detected_format), battle_log_text = COALESCE(?, battle_log_text), replay_url = COALESCE(?, replay_url), showdown_room_id = COALESCE(?, showdown_room_id), showdown_link_url = COALESCE(?, showdown_link_url), spectator_status = 'completed', spectator_disconnected_at = COALESCE(spectator_disconnected_at, ?), completed_at = ?, updated_at = ? WHERE id = ?`,
      [winnerUserId, winnerShowdownName, challengerShowdownName, opponentShowdownName, detectedFormat, battleLogText, replayUrl, showdownRoomId, showdownLinkUrl, now, now, now, targetGame.id],
    );
    if (canUsePostgresNonBenchmarkWrites()) {
      try { await syncBattleGameByIdPostgres(targetGame.id); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_games:completeFromSpectator:${targetGame.id}`, error); }
    }
  }
  const updatedBattle = await applyBattleGameResult(battleId, winnerUserId, scoringConfig || defaultScoringConfig());
  if (updatedBattle.status === 'active') {
    await ensureBattleGame(updatedBattle, updatedBattle.current_game_number || 1);
  }
  return { battle: updatedBattle, game: await getBattleGameById(targetGame.id), alreadyCompleted: false };
}

async function setBattleReplayUrlForGame(gameId, replayUrl) {
  const now = new Date().toISOString();
  if (shouldUsePostgresNonBenchmarkWritePrimary()) {
    await updateBattleGamePostgresPrimary(gameId, { replay_url: replayUrl || null, updated_at: now });
  } else {
    await runNonBenchmarkSqlite('UPDATE battle_games SET replay_url = ?, updated_at = ? WHERE id = ?', [replayUrl || null, now, gameId]);
    if (canUsePostgresNonBenchmarkWrites()) {
      try { await syncBattleGameByIdPostgres(gameId); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_games:setReplayUrl:${gameId}`, error); }
    }
  }
  return getBattleGameById(gameId);
}

async function cleanupUnresolvedBattlesForSeason(seasonNumber) {
  const safeSeasonNumber = Number(seasonNumber || 0);
  if (!Number.isInteger(safeSeasonNumber) || safeSeasonNumber <= 0) return [];
  const unresolvedBattles = shouldRetireNonBenchmarkSqliteRuntime()
    ? await listUnresolvedBattlesPostgresRows(safeSeasonNumber)
    : await allNonBenchmarkSqlite(`SELECT * FROM battle_matches WHERE season_number = ? AND status IN ('pending', 'active') ORDER BY id ASC`, [safeSeasonNumber]);
  if (!unresolvedBattles.length) return [];
  const now = new Date().toISOString();
  if (!shouldUsePostgresNonBenchmarkWritePrimary()) {
    await runNonBenchmarkSqlite(`UPDATE battle_matches SET status = 'cancelled', updated_at = ?, completed_at = COALESCE(completed_at, ?) WHERE season_number = ? AND status IN ('pending', 'active')`, [now, now, safeSeasonNumber]);
  }
  if (canUsePostgresNonBenchmarkWrites()) {
    if (shouldUsePostgresNonBenchmarkWritePrimary()) {
      await postgresPool.query(`UPDATE battle_matches SET status = 'cancelled', updated_at = $1, completed_at = COALESCE(completed_at, $2) WHERE season_number = $3 AND status IN ('pending', 'active')`, [now, now, safeSeasonNumber]);
    } else {
      for (const battle of unresolvedBattles) {
        try { await syncBattleByIdPostgres(battle.id); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_matches:cleanupSeason:${battle.id}`, error); }
      }
    }
  }
  return unresolvedBattles;
}

async function cancelAllUnresolvedBattles() {
  const unresolvedBattles = shouldRetireNonBenchmarkSqliteRuntime()
    ? await listUnresolvedBattlesPostgresRows()
    : await allNonBenchmarkSqlite(`SELECT * FROM battle_matches WHERE status IN ('pending', 'active') ORDER BY updated_at DESC, id DESC`);
  if (!unresolvedBattles.length) return [];
  const now = new Date().toISOString();
  if (!shouldUsePostgresNonBenchmarkWritePrimary()) {
    await runNonBenchmarkSqlite(`UPDATE battle_matches SET status = 'cancelled', completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE status IN ('pending', 'active')`, [now, now]);
  }
  if (canUsePostgresNonBenchmarkWrites()) {
    if (shouldUsePostgresNonBenchmarkWritePrimary()) {
      await postgresPool.query(`UPDATE battle_matches SET status = 'cancelled', completed_at = COALESCE(completed_at, $1), updated_at = $2 WHERE status IN ('pending', 'active')`, [now, now]);
    } else {
      for (const battle of unresolvedBattles) {
        try { await syncBattleByIdPostgres(battle.id); } catch (error) { warnNonBenchmarkPostgresWriteFallback(`battle_matches:cancelAll:${battle.id}`, error); }
      }
    }
  }
  return unresolvedBattles;
}


async function clearBenchmarkToolData() {
  if (!shouldRetireBenchmarkSqliteRuntime()) {
    await runBenchmarkSqlite('DELETE FROM benchmark_reports_latest');
    await runBenchmarkSqlite('DELETE FROM benchmark_job_history');
    await runBenchmarkSqlite('DELETE FROM benchmark_job_state_latest');
    await runBenchmarkSqlite('DELETE FROM benchmark_teams');
    await runNonBenchmarkSqlite("DELETE FROM bot_state WHERE key LIKE 'benchmark_%'");
  }

  if (isAnyPostgresBenchmarkModeEnabled()) {
    try {
      await postgresPool.query('DELETE FROM benchmark_reports_latest');
      await postgresPool.query('DELETE FROM benchmark_job_history');
      await postgresPool.query('DELETE FROM benchmark_job_state_latest');
      await postgresPool.query('DELETE FROM benchmark_teams');
      await postgresPool.query("DELETE FROM bot_state WHERE state_key LIKE 'benchmark_%'");
    } catch (error) {
      warnBenchmarkPostgresWriteFallback('clearBenchmarkToolData', error);
    }
  }
}

async function clearBenchmarkUserDataExceptTeam(userId) {
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) throw new Error('User ID is required to clear Battle Simulator data.');

  const settingsStateKey = `benchmark_suite_config:${safeUserId}`;
  const result = {
    userId: safeUserId,
    preserved: ['benchmark_teams'],
    sqlite: {},
    postgres: {},
  };

  if (!shouldRetireBenchmarkSqliteRuntime()) {
    const sqliteDeletes = [
      ['strategy_coach_notes', 'DELETE FROM strategy_coach_notes WHERE user_id = ?'],
      ['strategy_coach_jobs', 'DELETE FROM strategy_coach_jobs WHERE user_id = ?'],
      ['strategy_memory_turn_evidence', 'DELETE FROM strategy_memory_turn_evidence WHERE user_id = ?'],
      ['strategy_memory_battles', 'DELETE FROM strategy_memory_battles WHERE user_id = ?'],
      ['strategy_memory_reports', 'DELETE FROM strategy_memory_reports WHERE user_id = ?'],
      ['strategy_memory_team_versions', 'DELETE FROM strategy_memory_team_versions WHERE user_id = ?'],
      ['benchmark_reports_latest', 'DELETE FROM benchmark_reports_latest WHERE user_id = ?'],
      ['benchmark_job_history', 'DELETE FROM benchmark_job_history WHERE user_id = ?'],
      ['benchmark_job_state_latest', 'DELETE FROM benchmark_job_state_latest WHERE user_id = ?'],
    ];

    for (const [tableName, sql] of sqliteDeletes) {
      const info = await runBenchmarkSqlite(sql, [safeUserId]);
      result.sqlite[tableName] = Number(info?.changes || 0);
    }

    const stateInfo = await runNonBenchmarkSqlite('DELETE FROM bot_state WHERE key = ?', [settingsStateKey]);
    result.sqlite.bot_state = Number(stateInfo?.changes || 0);
  }

  if (isAnyPostgresBenchmarkModeEnabled()) {
    const client = await postgresPool.connect();
    try {
      await client.query('BEGIN');
      const postgresDeletes = [
        ['strategy_coach_notes', 'DELETE FROM strategy_coach_notes WHERE user_id = $1'],
        ['strategy_coach_jobs', 'DELETE FROM strategy_coach_jobs WHERE user_id = $1'],
        ['strategy_memory_turn_evidence', 'DELETE FROM strategy_memory_turn_evidence WHERE user_id = $1'],
        ['strategy_memory_battles', 'DELETE FROM strategy_memory_battles WHERE user_id = $1'],
        ['strategy_memory_reports', 'DELETE FROM strategy_memory_reports WHERE user_id = $1'],
        ['strategy_memory_team_versions', 'DELETE FROM strategy_memory_team_versions WHERE user_id = $1'],
        ['benchmark_reports_latest', 'DELETE FROM benchmark_reports_latest WHERE user_id = $1'],
        ['benchmark_job_history', 'DELETE FROM benchmark_job_history WHERE user_id = $1'],
        ['benchmark_job_state_latest', 'DELETE FROM benchmark_job_state_latest WHERE user_id = $1'],
      ];

      for (const [tableName, sql] of postgresDeletes) {
        const info = await client.query(sql, [safeUserId]);
        result.postgres[tableName] = Number(info?.rowCount || 0);
      }

      const stateInfo = await client.query('DELETE FROM bot_state WHERE state_key = $1', [settingsStateKey]);
      result.postgres.bot_state = Number(stateInfo?.rowCount || 0);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      warnBenchmarkPostgresWriteFallback('clearBenchmarkUserDataExceptTeam', error);
      throw error;
    } finally {
      client.release();
    }
  } else if (shouldRetireBenchmarkSqliteRuntime()) {
    throw new Error('Battle Simulator storage is not available for the clear-data action.');
  }

  return result;
}

async function normalizeBenchmarkPersistenceOnStartup() {
  const now = new Date().toISOString();
  const restartError = 'Professor Aegis restarted before this benchmark job finished.';

  if (!shouldRetireBenchmarkSqliteRuntime()) {
    await runBenchmarkSqlite(
    `UPDATE benchmark_job_state_latest
     SET status = 'cancelled',
         completed_at = COALESCE(completed_at, ?),
         error = COALESCE(NULLIF(error, ''), ?),
         updated_at = ?
     WHERE status IN ('queued', 'running', 'cancelling', 'submitting')`,
    [now, restartError, now],
  );

  await runBenchmarkSqlite(
    `UPDATE benchmark_job_history
     SET status = 'cancelled',
         completed_at = COALESCE(completed_at, ?),
         error = COALESCE(NULLIF(error, ''), ?),
         updated_at = ?
     WHERE status IN ('queued', 'running', 'cancelling', 'submitting')`,
    [now, restartError, now],
  );
  }

  if (isAnyPostgresBenchmarkModeEnabled()) {
    try {
      await postgresPool.query(
        `UPDATE benchmark_job_state_latest
         SET status = 'cancelled',
             completed_at = COALESCE(completed_at, $1),
             error = COALESCE(NULLIF(error, ''), $2),
             updated_at = $3
         WHERE status IN ('queued', 'running', 'cancelling', 'submitting')`,
        [now, restartError, now],
      );

      await postgresPool.query(
        `UPDATE benchmark_job_history
         SET status = 'cancelled',
             completed_at = COALESCE(completed_at, $1),
             error = COALESCE(NULLIF(error, ''), $2),
             updated_at = $3
         WHERE status IN ('queued', 'running', 'cancelling', 'submitting')`,
        [now, restartError, now],
      );
    } catch (error) {
      warnBenchmarkPostgresWriteFallback('normalizeBenchmarkPersistenceOnStartup', error);
    }
  }

  if (!shouldRetireBenchmarkSqliteRuntime()) {
    await runNonBenchmarkSqlite(
      `INSERT INTO bot_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [
        'benchmark_startup_warmup_state',
        JSON.stringify({
          active: false,
          status: 'idle',
          job_id: null,
          started_at: null,
          completed_at: now,
          error: null,
          progress: null,
        }),
      ],
    );
  }

  if (isAnyPostgresBenchmarkModeEnabled()) {
    try {
      await mirrorBotStatePostgres('benchmark_startup_warmup_state', {
        active: false,
        status: 'idle',
        job_id: null,
        started_at: null,
        completed_at: now,
        error: null,
        progress: null,
      });
    } catch (error) {
      warnBenchmarkPostgresWriteFallback('normalizeBenchmarkPersistenceOnStartup:bot_state', error);
    }
  }

  return { normalizedAt: now };
}

async function nukeDatabase() {
  if (!shouldRetireBenchmarkSqliteRuntime() || !shouldRetireNonBenchmarkSqliteRuntime()) {
    await runNonBenchmarkSqlite('DELETE FROM battle_games');
    await runNonBenchmarkSqlite('DELETE FROM battle_matches');
    await runNonBenchmarkSqlite('DELETE FROM season_teams');
    await runBenchmarkSqlite('DELETE FROM benchmark_reports_latest');
    await runBenchmarkSqlite('DELETE FROM benchmark_job_history');
    await runBenchmarkSqlite('DELETE FROM benchmark_job_state_latest');
    await runBenchmarkSqlite('DELETE FROM benchmark_teams');
    await runNonBenchmarkSqlite('DELETE FROM players');
    await runNonBenchmarkSqlite('DELETE FROM bot_state');
  }

  if (isAnyPostgresBenchmarkModeEnabled()) {
    try {
      await postgresPool.query('DELETE FROM benchmark_reports_latest');
      await postgresPool.query('DELETE FROM benchmark_job_history');
      await postgresPool.query('DELETE FROM benchmark_job_state_latest');
      await postgresPool.query('DELETE FROM benchmark_teams');
    } catch (error) {
      warnBenchmarkPostgresWriteFallback('nukeDatabase benchmark postgres cleanup', error);
    }
  }

  if (canUsePostgresNonBenchmarkWrites()) {
    try {
      await postgresPool.query('DELETE FROM battle_games');
      await postgresPool.query('DELETE FROM battle_matches');
      await postgresPool.query('DELETE FROM season_teams');
      await postgresPool.query('DELETE FROM players');
      await postgresPool.query('DELETE FROM bot_state');
    } catch (error) {
      warnNonBenchmarkPostgresWriteFallback('nukeDatabase non-benchmark postgres cleanup', error);
    }
  }
}

module.exports = {
  db,
  initializeDatabase,
  initializePostgresIntegration,
  getPostgresRuntimeStatus,
  getPostgresPool,
  buildDefaultPlayer,
  getStateValueJSON,
  setStateValueJSON,
  getBenchmarkTeamState,
  setBenchmarkTeamState,
  getBenchmarkLatestJobState,
  upsertBenchmarkJobState,
  getBenchmarkLatestReport,
  getBenchmarkLatestReportMeta,
  saveBenchmarkLatestReport,
  saveStrategyMemoryFromBenchmarkReport,
  buildStrategyMemoryFactsFromReport,
  ensureBenchmarkLimitlessStorage,
  buildBenchmarkLimitlessSyncRunRecord,
  buildBenchmarkLimitlessTournamentRecord,
  buildBenchmarkLimitlessTeamlistRecord,
  buildBenchmarkOpponentPoolSnapshotRecord,
  saveBenchmarkLimitlessSyncRun,
  saveBenchmarkLimitlessTournament,
  saveBenchmarkLimitlessTeamlist,
  saveBenchmarkOpponentPoolSnapshot,
  getActiveBenchmarkOpponentPoolSnapshot,
  getActiveBenchmarkLimitlessOpponentPool,
  ensureStrategyCoachTables,
  buildStrategyCoachJobRecord,
  buildStrategyCoachNotesRecord,
  createStrategyCoachJob,
  getStrategyCoachJob,
  getLatestStrategyCoachJobForReport,
  listQueuedStrategyCoachJobs,
  claimNextStrategyCoachJob,
  updateStrategyCoachJobStatus,
  computeStrategyCoachQueueSnapshot,
  saveStrategyCoachNotes,
  getStrategyCoachNotes,
  getStrategyCoachPersistenceProof,
  listBenchmarkJobHistoryForUser,
  normalizeBenchmarkPersistenceOnStartup,
  clearBenchmarkToolData,
  clearBenchmarkUserDataExceptTeam,
  ensurePlayerExists,
  getPlayerById,
  getTopPlayers,
  getTopPlayersForPlayoffs,
  getPlayerStats,
  resetSeasonStatsForAllPlayers,
  setAllPlayersRegisteredState,
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
  getFacedOpponentIdsForWindow,
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
  cleanupUnresolvedBattlesForSeason,
  cancelAllUnresolvedBattles,
  nukeDatabase,
};
