#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  buildInstantModeResultFixture,
} = require('../services/benchmarkService');

const REPO_ROOT = path.resolve(__dirname, '..');
const SHOWDOWN_ROOT = path.join(REPO_ROOT, 'pokemon-showdown');
const CHAMPIONS_FORMAT_ID = 'gen9championscustomgame';

const REQUIRED_FIXTURE_CATEGORIES = Object.freeze([
  'bring-6 choose-4 team preview',
  'selected leads and reserves',
  'speed order',
  'priority moves',
  'Fake Out',
  'Protect',
  'spread moves',
  'Trick Room',
  'Tailwind',
  'weather',
  'terrain',
  'type effectiveness',
  'immunities',
  'switching',
  'redirection',
  'KO targeting',
  'common items',
  'common abilities',
  'damage range sanity',
  'endgame cleanup',
]);

function categoryKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getCanonicalShowdownFormatFacts() {
  const { Dex } = require(path.join(SHOWDOWN_ROOT, 'dist', 'sim', 'dex.js'));
  const format = Dex.formats.get(CHAMPIONS_FORMAT_ID);
  const ruleTable = Dex.formats.getRuleTable(format);
  return {
    source: 'pokemon-showdown',
    formatId: CHAMPIONS_FORMAT_ID,
    exists: Boolean(format?.exists),
    gameType: format?.gameType || null,
    mod: format?.mod || null,
    pickedTeamSize: Number(ruleTable?.pickedTeamSize || 0),
    maxTeamSize: Number(ruleTable?.maxTeamSize || 0),
    minTeamSize: Number(ruleTable?.minTeamSize || 0),
  };
}

function candidateCoverageSet(candidate = {}) {
  const coverage = candidate?.mechanicsCoverage && typeof candidate.mechanicsCoverage === 'object'
    ? candidate.mechanicsCoverage
    : {};
  const covered = new Set();
  for (const value of uniqueStrings(coverage.covered)) {
    covered.add(categoryKey(value));
  }
  const mechanics = candidate?.mechanics && typeof candidate.mechanics === 'object'
    ? candidate.mechanics
    : {};
  for (const [key, value] of Object.entries(mechanics)) {
    if (value === true) covered.add(categoryKey(key));
  }
  return covered;
}

function summarizeMechanicsCoverage(candidate = {}) {
  const coveredSet = candidateCoverageSet(candidate);
  const categories = REQUIRED_FIXTURE_CATEGORIES.map((name) => ({
    name,
    key: categoryKey(name),
    covered: coveredSet.has(categoryKey(name)),
  }));
  const covered = categories.filter((item) => item.covered).map((item) => item.name);
  const missing = categories.filter((item) => !item.covered).map((item) => item.name);
  return {
    status: missing.length ? 'incomplete' : 'complete',
    covered,
    missing,
    categories,
  };
}

function buildFixtureResult(name, category, passed, detail = {}) {
  return {
    name,
    category,
    passed: Boolean(passed),
    ...detail,
  };
}

function validateBringSixChooseFour(candidate = {}, canonicalFacts = {}) {
  const preview = candidate?.teamPreview && typeof candidate.teamPreview === 'object'
    ? candidate.teamPreview
    : {};
  const selectedSlots = Array.isArray(preview.selectedSlots) ? preview.selectedSlots : [];
  const selectedCount = Number(preview.selectedCount ?? selectedSlots.length ?? 0);
  const availableCount = Number(preview.availableCount ?? candidate.availableTeamSize ?? 0);
  const maxChosenTeamSize = Number(preview.maxChosenTeamSize ?? preview.pickedTeamSize ?? 0);
  const canonicalPickedTeamSize = Number(canonicalFacts.pickedTeamSize || 0);
  const passed = canonicalFacts.exists === true
    && canonicalFacts.gameType === 'doubles'
    && canonicalFacts.mod === 'champions'
    && canonicalPickedTeamSize === 4
    && maxChosenTeamSize === 4
    && selectedCount === 4
    && availableCount >= 6
    && selectedCount < availableCount;
  const mismatches = [];
  if (canonicalFacts.exists !== true) mismatches.push('canonical-format-missing');
  if (canonicalFacts.gameType !== 'doubles') mismatches.push('canonical-game-type-not-doubles');
  if (canonicalFacts.mod !== 'champions') mismatches.push('canonical-mod-not-champions');
  if (canonicalPickedTeamSize !== 4) mismatches.push('canonical-picked-team-size-not-4');
  if (maxChosenTeamSize !== 4) mismatches.push('candidate-max-chosen-team-size-not-4');
  if (selectedCount !== 4) mismatches.push('candidate-selected-count-not-4');
  if (availableCount < 6) mismatches.push('candidate-available-team-size-under-6');
  if (selectedCount >= availableCount) mismatches.push('candidate-all-roster-selected');
  return buildFixtureResult(
    'champions-format-bring-six-choose-four',
    'bring-6 choose-4 team preview',
    passed,
    {
      canonical: canonicalFacts,
      candidate: {
        availableCount,
        selectedCount,
        selectedSlots,
        maxChosenTeamSize,
      },
      mismatches,
    },
  );
}

function validateOutputGates(candidate = {}) {
  const checks = {
    canonicalFalse: candidate.canonical === false,
    historyIneligible: candidate.historyEligible === false,
    archiveIneligible: candidate.archiveEligible === false,
    trainingIneligible: candidate.trainingEligible === false,
    confidenceIneligible: candidate.confidenceEligible === false,
    paperReportEligible: candidate.paperReportEligible === true,
    noMatchArchive: !Object.prototype.hasOwnProperty.call(candidate, 'matchArchive'),
    noReplaySources: !Object.prototype.hasOwnProperty.call(candidate, 'replayRefs')
      && !Object.prototype.hasOwnProperty.call(candidate, 'replayArtifacts'),
  };
  const mismatches = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([key]) => key);
  return buildFixtureResult(
    'instant-output-promotion-gates',
    'output gates',
    mismatches.length === 0,
    { checks, mismatches },
  );
}

function validateRequiredContractFields(candidate = {}) {
  const required = [
    'engineMode',
    'engineVersion',
    'canonical',
    'confidence',
    'parityStatus',
    'parityScore',
    'mechanicsCoverage',
    'knownLimitations',
    'showdownDelta',
    'warnings',
    'winRate',
    'archetypeBreakdown',
    'threats',
    'leads',
    'paperReportPayload',
    'generatedAt',
    'expiresAt',
    'historyEligible',
    'archiveEligible',
    'trainingEligible',
    'confidenceEligible',
    'paperReportEligible',
  ];
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(candidate, key));
  return buildFixtureResult(
    'r8-1-required-contract-fields',
    'contract fields',
    missing.length === 0,
    { missing },
  );
}

function validateMechanicsCoverage(candidate = {}) {
  const coverage = summarizeMechanicsCoverage(candidate);
  return buildFixtureResult(
    'required-mechanics-coverage',
    'mechanics coverage',
    coverage.missing.length === 0,
    {
      coveredCount: coverage.covered.length,
      missingCount: coverage.missing.length,
      missing: coverage.missing,
    },
  );
}

function buildParitySummary(candidate, options = {}) {
  const canonicalFacts = options.canonicalFacts || getCanonicalShowdownFormatFacts();
  if (!candidate || typeof candidate !== 'object') {
    return {
      ok: false,
      parityStatus: 'unvalidated',
      parityScore: 0,
      metrics: {
        totalFixtures: 0,
        passedFixtures: 0,
        failedFixtures: 0,
        totalCategories: REQUIRED_FIXTURE_CATEGORIES.length,
        supportedCategories: 0,
        unsupportedCategories: REQUIRED_FIXTURE_CATEGORIES.length,
      },
      mechanicsCoverage: {
        status: 'missing-candidate',
        covered: [],
        missing: [...REQUIRED_FIXTURE_CATEGORIES],
      },
      knownLimitations: [
        'Instant candidate is missing or unsupported; parity harness fails closed.',
      ],
      showdownDelta: {
        canonicalSource: 'pokemon-showdown',
        status: 'missing-candidate',
        fixtureResults: [],
        mismatches: ['instant-candidate-missing'],
      },
      gates: {
        evOptimizerUnlocked: false,
        canClaimShowdownParity: false,
        canFeedTrainingMode: false,
        canWriteHistory: false,
        canWriteArchive: false,
        canAccumulateConfidence: false,
      },
    };
  }

  const fixtureResults = [
    validateRequiredContractFields(candidate),
    validateOutputGates(candidate),
    validateBringSixChooseFour(candidate, canonicalFacts),
    validateMechanicsCoverage(candidate),
  ];
  const mismatches = fixtureResults.flatMap((fixture) => fixture.mismatches || fixture.missing || []);
  const passedFixtures = fixtureResults.filter((fixture) => fixture.passed).length;
  const mechanicsCoverage = summarizeMechanicsCoverage(candidate);
  const parityScore = Number((passedFixtures / fixtureResults.length).toFixed(4));
  const parityStatus = parityScore >= 1 ? 'calibrating' : 'unvalidated';
  const knownLimitations = [
    ...uniqueStrings(candidate.knownLimitations),
    ...mechanicsCoverage.missing.map((category) => `Unsupported or unproven mechanic: ${category}`),
  ];

  return {
    ok: fixtureResults.every((fixture) => fixture.passed),
    parityStatus,
    parityScore,
    metrics: {
      totalFixtures: fixtureResults.length,
      passedFixtures,
      failedFixtures: fixtureResults.length - passedFixtures,
      totalCategories: REQUIRED_FIXTURE_CATEGORIES.length,
      supportedCategories: mechanicsCoverage.covered.length,
      unsupportedCategories: mechanicsCoverage.missing.length,
    },
    mechanicsCoverage,
    knownLimitations,
    showdownDelta: {
      canonicalSource: 'pokemon-showdown',
      status: mismatches.length ? 'mismatch' : 'aligned-on-fixtures',
      fixtureResults,
      mismatches,
    },
    gates: {
      evOptimizerUnlocked: false,
      canClaimShowdownParity: false,
      canFeedTrainingMode: false,
      canWriteHistory: false,
      canWriteArchive: false,
      canAccumulateConfidence: false,
    },
  };
}

function buildPassingContractCandidate() {
  const candidate = buildInstantModeResultFixture({
    generatedAt: '2026-05-20T00:00:00.000Z',
    mechanicsCoverage: {
      status: 'fixture-covered',
      covered: REQUIRED_FIXTURE_CATEGORIES,
      missing: [],
    },
  });
  return {
    ...candidate,
    teamPreview: {
      availableCount: 6,
      selectedCount: 4,
      maxChosenTeamSize: 4,
      selectedSlots: [1, 2, 3, 4],
      leads: [1, 2],
      reserves: [3, 4],
    },
  };
}

function runSelfTest() {
  const missing = buildParitySummary(null);
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.parityStatus, 'unvalidated');
  assert.ok(missing.showdownDelta.mismatches.includes('instant-candidate-missing'));
  assert.strictEqual(missing.gates.evOptimizerUnlocked, false);

  const partial = buildInstantModeResultFixture({ generatedAt: '2026-05-20T00:00:00.000Z' });
  const partialSummary = buildParitySummary(partial);
  assert.strictEqual(partialSummary.ok, false);
  assert.ok(partialSummary.metrics.unsupportedCategories > 0);
  assert.ok(partialSummary.showdownDelta.mismatches.length > 0);
  assert.strictEqual(partialSummary.gates.canWriteHistory, false);
  assert.strictEqual(partialSummary.gates.canWriteArchive, false);
  assert.strictEqual(partialSummary.gates.canFeedTrainingMode, false);
  assert.strictEqual(partialSummary.gates.canAccumulateConfidence, false);

  const candidate = buildPassingContractCandidate();
  const passing = buildParitySummary(candidate);
  assert.strictEqual(passing.ok, true);
  assert.strictEqual(passing.parityStatus, 'calibrating');
  assert.strictEqual(passing.mechanicsCoverage.missing.length, 0);
  assert.strictEqual(passing.showdownDelta.mismatches.length, 0);
  assert.strictEqual(passing.gates.evOptimizerUnlocked, false);
  assert.strictEqual(passing.gates.canClaimShowdownParity, false);
  return {
    ok: true,
    missingCandidate: missing,
    partialCandidate: partialSummary,
    passingCandidate: passing,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    const result = runSelfTest();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const candidatePath = args.find((arg) => !arg.startsWith('-'));
  const candidate = candidatePath ? readJsonFile(path.resolve(candidatePath)) : null;
  const summary = buildParitySummary(candidate);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_FIXTURE_CATEGORIES,
  buildParitySummary,
  buildPassingContractCandidate,
  runSelfTest,
};
