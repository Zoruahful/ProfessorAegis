'use strict';

const {
  INSTANT_MODE_RESULT_CONTRACT,
  buildInstantModeResultFixture,
} = require('./benchmarkService');

const CHAMPIONS_FORMAT_ID = 'gen9championscustomgame';
const INSTANT_PROJECTION_ENGINE_VERSION = 'instant-projection-service-v1';
const DEFAULT_EXPIRATION_MINUTES = 15;

class InstantProjectionInputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InstantProjectionInputError';
    this.code = 'INSTANT_PROJECTION_INPUT_UNSUPPORTED';
    this.details = details;
  }
}

function cleanText(value) {
  return String(value || '').trim();
}

function toIsoDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback.toISOString();
}

function addMinutesIso(isoDate, minutes) {
  const base = new Date(isoDate);
  const safeBase = Number.isFinite(base.getTime()) ? base : new Date();
  return new Date(safeBase.getTime() + Number(minutes || DEFAULT_EXPIRATION_MINUTES) * 60 * 1000).toISOString();
}

function normalizeSpeciesName(value) {
  return cleanText(value)
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-');
}

function parseTeamExport(teamExport) {
  const lines = String(teamExport || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const pokemon = [];
  for (const line of lines) {
    if (/^(ability|level|tera type|evs|ivs|nature|shiny|gigantamax|happiness)\s*:/i.test(line)) continue;
    if (/^[-\w\s]+$/i.test(line) && !line.includes('@') && pokemon.length > 0) continue;
    const match = line.match(/^(.+?)(?:\s+@\s+(.+))?$/);
    if (!match) continue;
    const species = normalizeSpeciesName(match[1]);
    if (!species || species.startsWith('-') || species.includes(':')) continue;
    if (pokemon.some((entry) => entry.species.toLowerCase() === species.toLowerCase())) continue;
    pokemon.push({
      species,
      item: cleanText(match[2]),
      sourceLine: line,
    });
    if (pokemon.length >= 6) break;
  }

  return {
    lines,
    pokemon,
  };
}

function normalizeInstantProjectionSettings(settings = {}) {
  const formatId = cleanText(settings.formatId || settings.format_id || settings.format || CHAMPIONS_FORMAT_ID)
    .toLowerCase();
  return {
    formatId: formatId || CHAMPIONS_FORMAT_ID,
    benchmarkMode: cleanText(settings.mode || settings.benchmarkMode || 'instant-projection'),
    battleBudget: Number(settings.battleBudget || settings.battle_budget || 0),
  };
}

function validateInstantProjectionInput(input = {}) {
  const teamExport = cleanText(input.teamExport || input.team_export || input.team);
  if (!teamExport) {
    throw new InstantProjectionInputError('Instant Projection requires a submitted team export.', {
      missing: ['teamExport'],
    });
  }

  const parsedTeam = parseTeamExport(teamExport);
  if (parsedTeam.pokemon.length < 6) {
    throw new InstantProjectionInputError('Instant Projection requires a full submitted team of 6 Pokemon.', {
      pokemonParsed: parsedTeam.pokemon.length,
      requiredPokemon: 6,
    });
  }

  const settings = normalizeInstantProjectionSettings(input.settings || input);
  if (settings.formatId !== CHAMPIONS_FORMAT_ID) {
    throw new InstantProjectionInputError('Instant Projection is currently limited to the Champions format.', {
      formatId: settings.formatId,
      supportedFormatId: CHAMPIONS_FORMAT_ID,
    });
  }

  return {
    teamExport,
    parsedTeam,
    settings,
  };
}

function buildTeamPreview(parsedTeam) {
  const pokemon = parsedTeam.pokemon.slice(0, 6);
  return {
    availableCount: pokemon.length,
    selectedCount: 4,
    maxChosenTeamSize: 4,
    pickedTeamSize: 4,
    selectedSlots: [1, 2, 3, 4],
    leads: [1, 2],
    reserves: [3, 4],
    pokemon: pokemon.map((entry, index) => ({
      slot: index + 1,
      species: entry.species,
      item: entry.item || null,
    })),
  };
}

function buildInstantProjectionPaperReportPayload({
  generatedAt,
  expiresAt,
  parsedTeam,
  settings,
  warnings,
  knownLimitations,
  showdownDelta,
}) {
  const teamPreview = parsedTeam.pokemon.map((entry) => (
    entry.item ? `${entry.species} @ ${entry.item}` : entry.species
  ));
  return {
    reportType: 'Instant Projection Report',
    engineMode: 'instant',
    engineVersion: INSTANT_PROJECTION_ENGINE_VERSION,
    canonical: false,
    projectionLabel: 'Instant projection - not canonical Pokemon Showdown',
    generatedAt,
    expiresAt,
    formatId: settings.formatId,
    benchmarkMode: 'instant-projection',
    benchmarkModeLabel: 'Instant Projection',
    winRate: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    totalGamesCompleted: 0,
    averageTurns: 0,
    confidence: {
      label: 'Unvalidated',
      parityStatus: 'unvalidated',
      parityScore: 0,
    },
    warnings,
    knownLimitations,
    showdownDelta,
    compactSummary: {
      reportType: 'Instant Projection Report',
      benchmarkMode: 'instant-projection',
      benchmarkModeLabel: 'Instant Projection',
      formatId: settings.formatId,
      winRate: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      totalGamesCompleted: 0,
      averageTurns: 0,
      confidenceLabel: 'Unvalidated',
      takeaway: 'Instant Projection is a one-time contract result until an approved estimator is wired.',
      sourceFields: {
        summary: 'instant-projection-service-contract',
        archetypeRows: 'instant.archetypeBreakdown',
        opponentRows: 'instant.archetypeBreakdown',
        threatRows: 'instant.threats',
        leadRows: 'instant.leads',
        coreRows: null,
      },
      goodMatchups: [],
      neutralMatchups: [],
      dangerMatchups: [],
      bestLeadPairs: [],
      bestCores: [],
    },
    resultsByTemplate: [],
    pokemonThreats: [],
    teamPreview,
  };
}

function createInstantProjectionResult(input = {}) {
  const validated = validateInstantProjectionInput(input);
  const generatedAt = toIsoDate(input.generatedAt || input.generated_at);
  const expiresAt = toIsoDate(input.expiresAt || input.expires_at, new Date(addMinutesIso(generatedAt, DEFAULT_EXPIRATION_MINUTES)));
  const warnings = [
    'Instant Projection is experimental estimator output, not canonical Pokemon Showdown.',
    'No Instant estimator has been approved for strategic trust yet.',
  ];
  const knownLimitations = [
    'Battle outcomes are not simulated in this backend contract step.',
    'Mechanics coverage is limited to contract validation and bring-6 choose-4 preview shape.',
    'Use canonical Showdown Simulation Mode for trusted battle results.',
  ];
  const showdownDelta = {
    canonicalSource: 'pokemon-showdown',
    status: 'not-compared',
    note: 'This backend contract result has not been compared to canonical Showdown fixtures.',
    mismatches: ['instant-estimator-not-implemented'],
  };
  const mechanicsCoverage = {
    status: 'contract-only',
    covered: ['bring-6 choose-4 team preview'],
    missing: ['battle simulation', 'damage ranges', 'speed order', 'priority moves', 'switching'],
  };
  const paperReportPayload = buildInstantProjectionPaperReportPayload({
    generatedAt,
    expiresAt,
    parsedTeam: validated.parsedTeam,
    settings: validated.settings,
    warnings,
    knownLimitations,
    showdownDelta,
  });

  return {
    ...buildInstantModeResultFixture({
      generatedAt,
      expiresAt,
      engineVersion: INSTANT_PROJECTION_ENGINE_VERSION,
      confidence: {
        label: 'Unvalidated',
        reason: 'Backend contract only; no approved Instant estimator has run.',
      },
      parityStatus: 'unvalidated',
      parityScore: 0,
      mechanicsCoverage,
      knownLimitations,
      showdownDelta,
      warnings,
      paperReportPayload,
    }),
    engineVersion: INSTANT_PROJECTION_ENGINE_VERSION,
    confidence: {
      label: 'Unvalidated',
      reason: 'Backend contract only; no approved Instant estimator has run.',
    },
    mechanicsCoverage,
    knownLimitations,
    showdownDelta,
    warnings,
    winRate: 0,
    archetypeBreakdown: [],
    threats: [],
    leads: [],
    paperReportPayload,
    teamPreview: buildTeamPreview(validated.parsedTeam),
    source: {
      service: 'instant_projection_service',
      contract: 'PRO-359',
      canonicalSimulator: 'Pokemon Showdown',
      canonical: false,
      benchmarkMode: validated.settings.benchmarkMode,
    },
    allowedOutputs: [...INSTANT_MODE_RESULT_CONTRACT.allowedOutputs],
    forbiddenPromotions: [...INSTANT_MODE_RESULT_CONTRACT.forbiddenPromotions],
  };
}

function tryCreateInstantProjectionResult(input = {}) {
  try {
    return {
      ok: true,
      result: createInstantProjectionResult(input),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      result: null,
      error: {
        name: error?.name || 'Error',
        code: error?.code || 'INSTANT_PROJECTION_FAILED_CLOSED',
        message: error?.message || 'Instant Projection failed closed.',
        details: error?.details || {},
      },
    };
  }
}

module.exports = {
  CHAMPIONS_FORMAT_ID,
  INSTANT_PROJECTION_ENGINE_VERSION,
  InstantProjectionInputError,
  buildInstantProjectionPaperReportPayload,
  createInstantProjectionResult,
  parseTeamExport,
  tryCreateInstantProjectionResult,
  validateInstantProjectionInput,
};
