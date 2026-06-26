#!/usr/bin/env node
'use strict';

// R6.9 persistent simulator worker.
// Keeps Node + Pokemon Showdown loaded and runs one BattleStream per JSON request.
// Protocol: stdin JSONL request -> stdout JSONL response. No normal logs on stdout.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const WORKER_VERSION = '2026.04.26-persistent-sim-worker-v2-cpu-efficiency';
const POLICY_VERSION = 'r6.20.10r-policy-v4-illusion-immunity-memory';
const DECISION_TELEMETRY_VERSION = 'r6.20.10r-battlebrain-v5-illusion-immunity-telemetry';
const startedAt = Date.now();
let battlesRun = 0;
const DEBUG_CAPTURE = ['1', 'true', 'yes', 'on'].includes(String(process.env.BENCHMARK_PERSISTENT_SIM_WORKER_DEBUG_CAPTURE || '0').toLowerCase());
const BATTLE_LOG_CAPTURE = ['1', 'true', 'yes', 'on'].includes(String(process.env.BENCHMARK_PERSISTENT_SIM_WORKER_BATTLE_LOG_CAPTURE || '0').toLowerCase());
const RECENT_MESSAGE_LIMIT = Math.max(Number(process.env.BENCHMARK_PERSISTENT_SIM_WORKER_RECENT_MESSAGE_LIMIT || 4), 0);
const DEBUG_EVENT_LIMIT = Math.max(Number(process.env.BENCHMARK_PERSISTENT_SIM_WORKER_DEBUG_EVENT_LIMIT || 8), 0);
const BATTLEBRAIN_MEMORY_TURNS = 4;
const PROTECT_MOVE_IDS = new Set(['protect', 'detect', 'spikyshield', 'kingsshield', 'banefulbunker', 'silktrap', 'burningbulwark']);
const FAKE_OUT_MOVE_IDS = new Set(['fakeout']);
const SPEED_CONTROL_MOVE_IDS = new Set(['tailwind', 'trickroom', 'icywind', 'electroweb', 'thunderwave', 'nuzzle']);
const REDIRECTION_MOVE_IDS = new Set(['followme', 'ragepowder']);
const GUARD_MOVE_IDS = new Set(['wideguard', 'quickguard']);
const SUPPORT_MOVE_IDS = new Set(['helpinghand', 'willowisp', 'spore', 'sleeppowder']);
const TARGET_WEAK_HP_PERCENT = 35;
const TARGET_CRITICAL_HP_PERCENT = 20;
const TARGET_WEAKENED_BONUS = 10;
const TARGET_CRITICAL_BONUS = 16;
const TARGET_FAKE_OUT_SETTER_BONUS = 24;
const DAMAGE_HIGH_POWER_THRESHOLD = 90;
const DAMAGE_RELIABLE_POWER_THRESHOLD = 70;
const DAMAGE_LOW_VALUE_POWER_THRESHOLD = 45;
const DAMAGE_HIGH_POWER_BONUS = 18;
const DAMAGE_RELIABLE_BONUS = 8;
const DAMAGE_WEAKENED_TARGET_BONUS = 14;
const DAMAGE_CRITICAL_TARGET_BONUS = 24;
const DAMAGE_HEALTHY_LOW_POWER_PENALTY = 10;
const PROTECT_PRESSURE_BONUS = 44;
const PROTECT_OPENING_SCOUT_BONUS = 12;
const FAKE_OUT_SETTER_PRESSURE_BONUS = 26;
const SPEED_CONTROL_DOUBLES_BONUS = 16;
const SPEED_CONTROL_ALREADY_ACTIVE_PENALTY = 120;
const SPREAD_SPEED_CONTROL_BONUS = 18;
const SINGLE_TARGET_SPEED_CONTROL_BONUS = 10;
const SPEED_DISADVANTAGE_CONTROL_BONUS = 32;
const SPEED_DROP_DISADVANTAGE_BONUS = 20;
const KO_BEFORE_ACTION_BONUS = 18;
const MOVE_AFTER_TARGET_CAUTION_PENALTY = 8;
const WIN_STATE_CLEAR_THRESHOLD = 45;
const WIN_STATE_RELIABLE_ACTION_BONUS = 18;
const WIN_STATE_AHEAD_RISK_PENALTY = 80;
const WIN_STATE_LOW_VALUE_AHEAD_PENALTY = 18;
const WIN_STATE_BEHIND_UPSIDE_BONUS = 30;
const WIN_STATE_BEHIND_PRESSURE_BONUS = 14;
const TYPE_STAB_BONUS = 10;
const TYPE_SUPER_EFFECTIVE_BONUS = 24;
const TYPE_RESISTED_PENALTY = 18;
const TYPE_IMMUNITY_PENALTY = 260;
const TACTICAL_SWITCH_MAX_MOVE_SCORE = 80;
const TACTICAL_SWITCH_MIN_BENCH_SCORE = 50;
const DECISION_TRACE_LIMIT = 24;
const TOP_DECISION_ALTERNATIVES = 3;

function telemetryScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : null;
}

function scoreReason(category, delta, detail = null) {
  return {
    category,
    delta: telemetryScore(delta),
    ...(detail ? {detail} : {}),
  };
}

function reasonCategories(reasons) {
  return Array.from(new Set((reasons || []).map((reason) => reason && reason.category).filter(Boolean)));
}

function pushDecisionTrace(state, entry) {
  if (!state || typeof state !== 'object' || !entry || typeof entry !== 'object') return;
  const brain = ensureBattleBrainState(state);
  if (!Array.isArray(brain.decisionTrace)) brain.decisionTrace = [];
  brain.decisionTrace.push({
    ...entry,
    turn: Number.isFinite(Number(entry.turn)) ? Number(entry.turn) : contextTurn(state),
  });
  if (brain.decisionTrace.length > DECISION_TRACE_LIMIT) {
    brain.decisionTrace.splice(0, brain.decisionTrace.length - DECISION_TRACE_LIMIT);
  }
}

function decisionTraceForResponse(state) {
  const brain = ensureBattleBrainState(state);
  return (brain.decisionTrace || []).slice(-DECISION_TRACE_LIMIT);
}

function findShowdownRoot() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'pokemon-showdown'),
    cwd,
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'dist', 'sim', 'battle-stream.js'))) {
      return candidate;
    }
  }
  throw new Error(`Pokemon Showdown dist/sim/battle-stream.js not found from cwd=${cwd}`);
}

const showdownRoot = findShowdownRoot();
process.chdir(showdownRoot);
const {BattleStream} = require(path.join(showdownRoot, 'dist', 'sim', 'battle-stream.js'));
const {Dex} = require(path.join(showdownRoot, 'dist', 'sim', 'dex.js'));

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function pushRecent(target, value, limit = 20) {
  if (value === undefined || value === null) return;
  const text = String(value);
  if (!text) return;
  target.push(text);
  if (target.length > limit) target.splice(0, target.length - limit);
}

function pushDebugEvent(state, value) {
  pushRecent(state.debugEvents, value, DEBUG_EVENT_LIMIT);
}

function isFainted(pokemon) {
  if (!pokemon) return true;
  if (pokemon.fainted === true) return true;
  const condition = String(pokemon.condition || '').toLowerCase();
  return condition.includes('fnt');
}

function firstSwitchableSlot(sidePokemon, taken) {
  const used = taken || new Set();
  let best = null;
  let bestScore = -Infinity;
  for (let idx = 0; idx < (sidePokemon || []).length; idx += 1) {
    const pokemon = sidePokemon[idx];
    if (used.has(idx)) continue;
    if (!pokemon) continue;
    if (isFainted(pokemon)) continue;
    if (pokemon.active === true) continue;
    const score = scoreSwitchSlot(pokemon);
    if (score > bestScore) {
      best = idx + 1;
      bestScore = score;
    }
  }
  return best;
}

function buildTeamPreviewChoice(request, context = null, player = null) {
  const side = request.side || {};
  const pokemon = side.pokemon || [];
  const bring = Number(request.maxChosenTeamSize || request.maxTeamSize || Math.min(pokemon.length, 4) || 4);
  const trace = chooseTeamPreviewOrderTrace(pokemon);
  const forcedSlots = previewSlotsForPlayer(context, 'forcedTeamPreviewSlotsByPlayer', player, pokemon.length);
  const allowedSlots = previewSlotsForPlayer(context, 'allowedTeamPreviewSlotsByPlayer', player, pokemon.length);
  let order = trace.order.slice();
  if (forcedSlots.length) {
    order = [...forcedSlots, ...order.filter((slot) => !forcedSlots.includes(slot))];
  } else if (allowedSlots.length) {
    order = [
      ...order.filter((slot) => allowedSlots.includes(slot)),
      ...order.filter((slot) => !allowedSlots.includes(slot)),
    ];
  }
  const chosenSlots = order.slice(0, bring);
  if (context && player) {
    const playerKey = sideFromPlayer(player) || String(player || '').slice(0, 2).toLowerCase() || null;
    if (playerKey) {
      if (!context.teamPreviewChoices || typeof context.teamPreviewChoices !== 'object') context.teamPreviewChoices = {};
      context.teamPreviewChoices[playerKey] = {
        chosenSlots,
        forcedSlots,
        allowedSlots,
        forcedApplied: forcedSlots.length > 0,
        allowedApplied: forcedSlots.length === 0 && allowedSlots.length > 0,
      };
    }
    pushDecisionTrace(context, {
      type: 'teamPreview',
      player: playerKey,
      chosenSlots,
      forcedSlots,
      allowedSlots,
      forcedApplied: forcedSlots.length > 0,
      allowedApplied: forcedSlots.length === 0 && allowedSlots.length > 0,
      leadScores: trace.scored,
      reasonCategories: Array.from(new Set((trace.scored || []).flatMap((entry) => entry.reasonCategories || []))),
    });
  }
  return `team ${chosenSlots.join(', ')}`;
}

function buildForceSwitchChoice(request) {
  const side = request.side || {};
  const pokemon = side.pokemon || [];
  const forceSwitch = request.forceSwitch || [];
  const choices = [];
  const taken = new Set();

  for (const mustSwitch of forceSwitch) {
    if (!mustSwitch) {
      choices.push('pass');
      continue;
    }
    const slot = firstSwitchableSlot(pokemon, taken);
    if (slot === null) {
      choices.push('pass');
      continue;
    }
    taken.add(slot - 1);
    choices.push(`switch ${slot}`);
  }
  return choices.length ? choices.join(', ') : 'default';
}

function normalizeMoveText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function moveIdFor(move) {
  return normalizeMoveText((move || {}).id || (move || {}).move || (move || {}).name);
}

function sideFromPlayer(player) {
  const side = String(player || '').slice(0, 2).toLowerCase();
  return ['p1', 'p2'].includes(side) ? side : null;
}

function activeSlotForIndex(activeIndex) {
  const index = Number(activeIndex || 0);
  return String.fromCharCode('a'.charCodeAt(0) + Math.max(0, index));
}

function activeKeyFor(player, activeIndex) {
  const side = sideFromPlayer(player);
  if (!side) return null;
  return `${side}${activeSlotForIndex(activeIndex)}`;
}

function createBattleBrainState() {
  return {
    field: {weather: null, terrain: null, trickRoom: false},
    sideConditions: {p1: {}, p2: {}},
    activeMemory: {},
    choiceMemory: [],
    failedMemory: [],
    lastChoiceBySlot: {},
    lastMoveByIdent: {},
    lastGlobalMove: null,
    requestState: {},
    sideRosters: {p1: [], p2: []},
    allyPlan: {},
    decisionTrace: [],
  };
}

function ensureBattleBrainState(state) {
  if (!state || typeof state !== 'object') return createBattleBrainState();
  if (!state.battleBrain || typeof state.battleBrain !== 'object') state.battleBrain = createBattleBrainState();
  const brain = state.battleBrain;
  if (!brain.field) brain.field = {weather: null, terrain: null, trickRoom: false};
  if (!brain.sideConditions) brain.sideConditions = {p1: {}, p2: {}};
  if (!brain.sideConditions.p1) brain.sideConditions.p1 = {};
  if (!brain.sideConditions.p2) brain.sideConditions.p2 = {};
  if (!brain.activeMemory) brain.activeMemory = {};
  if (!Array.isArray(brain.choiceMemory)) brain.choiceMemory = [];
  if (!Array.isArray(brain.failedMemory)) brain.failedMemory = [];
  if (!brain.lastChoiceBySlot) brain.lastChoiceBySlot = {};
  if (!brain.lastMoveByIdent) brain.lastMoveByIdent = {};
  if (!brain.requestState) brain.requestState = {};
  if (!brain.sideRosters) brain.sideRosters = {p1: [], p2: []};
  if (!Array.isArray(brain.sideRosters.p1)) brain.sideRosters.p1 = [];
  if (!Array.isArray(brain.sideRosters.p2)) brain.sideRosters.p2 = [];
  if (!brain.allyPlan) brain.allyPlan = {};
  if (!Array.isArray(brain.decisionTrace)) brain.decisionTrace = [];
  return brain;
}

function activeMemoryFor(state, key) {
  if (!key) return {};
  const brain = ensureBattleBrainState(state);
  if (!brain.activeMemory[key]) {
    brain.activeMemory[key] = {
      switchTurn: 0,
      fakeOutUsed: false,
      protectStreak: 0,
      protectedTurn: null,
      lastMoveId: null,
      lastTargetKey: null,
      lastDamageTakenTurn: null,
      lastDamageDealtTurn: null,
    };
  }
  return brain.activeMemory[key];
}

function trimBattleBrainMemory(brain, turn) {
  const minTurn = Math.max(0, Number(turn || 0) - BATTLEBRAIN_MEMORY_TURNS);
  brain.choiceMemory = (brain.choiceMemory || []).filter((entry) => Number(entry.turn || 0) >= minTurn).slice(-16);
  brain.failedMemory = (brain.failedMemory || []).filter((entry) => Number(entry.turn || 0) >= minTurn).slice(-24);
}

function memoryWeight(entry, turn) {
  const age = Math.max(0, Number(turn || 0) - Number((entry || {}).turn || 0));
  if (age > BATTLEBRAIN_MEMORY_TURNS) return 0;
  return (BATTLEBRAIN_MEMORY_TURNS + 1 - age) / (BATTLEBRAIN_MEMORY_TURNS + 1);
}

function choiceSignature(player, activeIndex, move, targetSuffix) {
  const side = sideFromPlayer(player) || 'p?';
  const slot = activeSlotForIndex(activeIndex);
  return `${side}${slot}:move:${moveIdFor(move)}:target:${String(targetSuffix || '').trim() || 'auto'}`;
}

function switchSignature(player, switchSlot, activeIndex) {
  const side = sideFromPlayer(player) || 'p?';
  return `${side}${activeSlotForIndex(activeIndex)}:switch:${Number(switchSlot || 0)}`;
}

function failedChoicePenalty(context, signature, moveId, targetSuffix) {
  const brain = ensureBattleBrainState(context);
  const turn = contextTurn(context);
  let penalty = 0;
  for (const entry of brain.failedMemory || []) {
    const weight = memoryWeight(entry, turn);
    if (weight <= 0) continue;
    const immuneNoEffect = String(entry.reason || '') === 'immune';
    if (entry.signature && signature && entry.signature === signature) penalty += (immuneNoEffect ? 190 : 95) * weight;
    if (entry.moveId && moveId && entry.moveId === moveId) penalty += (immuneNoEffect ? 70 : 35) * weight;
    if (entry.moveId && moveId && entry.moveId === moveId && entry.targetSuffix === String(targetSuffix || '').trim()) {
      penalty += (immuneNoEffect ? 120 : 45) * weight;
    }
  }
  return penalty;
}

function failedChoiceReasonCategories(context, signature, moveId, targetSuffix) {
  const brain = ensureBattleBrainState(context);
  const turn = contextTurn(context);
  const categories = new Set();
  const suffix = String(targetSuffix || '').trim();
  for (const entry of brain.failedMemory || []) {
    const weight = memoryWeight(entry, turn);
    if (weight <= 0) continue;
    const sameSignature = entry.signature && signature && entry.signature === signature;
    const sameMove = entry.moveId && moveId && entry.moveId === moveId;
    const sameMoveTarget = sameMove && entry.targetSuffix === suffix;
    if (!sameSignature && !sameMoveTarget) continue;
    if (String(entry.reason || '') === 'immune') categories.add('immune-no-effect-memory-penalty');
    else categories.add('failed-choice-memory-penalty');
  }
  return Array.from(categories);
}

function repeatedChoicePenalty(context, signature) {
  const brain = ensureBattleBrainState(context);
  const turn = contextTurn(context);
  let repeats = 0;
  for (const entry of brain.choiceMemory || []) {
    if (entry.signature !== signature) continue;
    const weight = memoryWeight(entry, turn);
    if (weight > 0) repeats += weight;
  }
  return repeats > 1 ? Math.min(45, repeats * 12) : 0;
}

function hasRecentSwitchChoice(context, player, activeIndex, switchSlot) {
  const signature = switchSignature(player, switchSlot, activeIndex);
  const brain = ensureBattleBrainState(context);
  const turn = contextTurn(context);
  return (brain.choiceMemory || []).some((entry) => entry.signature === signature && memoryWeight(entry, turn) > 0);
}

function isSwitchBlocked(mon, slotState) {
  return Boolean((mon && (mon.trapped === true || mon.maybeTrapped === true)) || (slotState && (slotState.trapped === true || slotState.maybeTrapped === true)));
}

function hasBadActiveMoveSignal(selectedMove) {
  const categories = new Set((selectedMove && selectedMove.reasonCategories) || []);
  return categories.has('known-type-immunity-avoidance')
    || categories.has('failed-choice-memory-penalty')
    || categories.has('low-value-move-penalty');
}

function tacticalSwitchTrace(sidePokemon, taken, context, player, activeIndex, mon, slotState, selectedMove) {
  const reasons = [];
  const selectedScore = selectedMove && Number.isFinite(Number(selectedMove.score)) ? Number(selectedMove.score) : -Infinity;
  const badActiveMoveSignal = hasBadActiveMoveSignal(selectedMove);
  if (selectedScore >= TACTICAL_SWITCH_MAX_MOVE_SCORE && !badActiveMoveSignal) {
    return {
      shouldSwitch: false,
      reasonCategories: ['strong-action-available'],
      reasons: [scoreReason('strong-action-available', selectedScore)],
    };
  }
  reasons.push(scoreReason(badActiveMoveSignal ? 'bad-active-action-signal' : 'weak-active-action', Number.isFinite(selectedScore) ? -Math.max(0, TACTICAL_SWITCH_MAX_MOVE_SCORE - Math.min(selectedScore, TACTICAL_SWITCH_MAX_MOVE_SCORE)) : -TACTICAL_SWITCH_MAX_MOVE_SCORE));

  if (isSwitchBlocked(mon, slotState)) {
    return {shouldSwitch: false, reasonCategories: ['switch-blocked-or-trapped'], reasons};
  }

  const switchSlot = firstSwitchableSlot(sidePokemon, taken);
  if (switchSlot === null) {
    return {shouldSwitch: false, reasonCategories: ['no-legal-bench-switch'], reasons};
  }

  const bench = sidePokemon[switchSlot - 1] || null;
  const benchScore = scoreSwitchSlot(bench);
  if (!Number.isFinite(benchScore) || benchScore < TACTICAL_SWITCH_MIN_BENCH_SCORE) {
    reasons.push(scoreReason('bench-switch-not-clearly-better', Number.isFinite(benchScore) ? benchScore : 0));
    return {shouldSwitch: false, switchSlot, benchScore, reasonCategories: reasonCategories(reasons), reasons};
  }
  if (hasRecentSwitchChoice(context, player, activeIndex, switchSlot)) {
    reasons.push(scoreReason('recent-switch-loop-guard', -TACTICAL_SWITCH_MIN_BENCH_SCORE));
    return {shouldSwitch: false, switchSlot, benchScore, reasonCategories: reasonCategories(reasons), reasons};
  }

  reasons.push(scoreReason('legal-bench-switch-candidate', benchScore));
  return {
    shouldSwitch: true,
    switchSlot,
    benchScore,
    reasonCategories: ['tactical-switch-selected', ...reasonCategories(reasons)],
    reasons,
  };
}

function effectIdFromParts(parts, startIndex) {
  return normalizeMoveText((parts || []).slice(startIndex || 2).join('|'));
}

function pokemonText(pokemon) {
  if (!pokemon) return '';
  const pieces = [
    pokemon.ident,
    pokemon.details,
    pokemon.name,
    pokemon.species,
    pokemon.baseSpecies,
    pokemon.item,
    pokemon.ability,
    pokemon.condition,
    Array.isArray(pokemon.moves) ? pokemon.moves.join(' ') : '',
  ];
  return normalizeMoveText(pieces.filter(Boolean).join(' '));
}

function conditionHpPercent(condition) {
  const text = String(condition || '').toLowerCase();
  if (!text || text.includes('fnt')) return text.includes('fnt') ? 0 : null;
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  const hp = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(hp) || !Number.isFinite(max) || max <= 0) return null;
  return Math.max(0, Math.min(100, (hp / max) * 100));
}

function scoreSwitchSlot(pokemon) {
  if (!pokemon || isFainted(pokemon) || pokemon.active === true) return -Infinity;
  const text = pokemonText(pokemon);
  const conditionText = normalizeMoveText(pokemon.condition);
  let score = 0;
  const hpPercent = conditionHpPercent(pokemon.condition);

  if (Number.isFinite(hpPercent)) score += hpPercent;
  if (text.includes('intimidate')) score += 28;
  if (text.includes('fakeout')) score += 22;
  if (text.includes('regenerator')) score += 18;
  if (text.includes('sitrusberry') || text.includes('leftovers')) score += 10;
  if (['par', 'brn', 'slp', 'psn', 'tox'].some((status) => conditionText.includes(status))) score -= 12;

  return score;
}

function rosterEntryFromPokemon(pokemon, slotIndex) {
  if (!pokemon || typeof pokemon !== 'object') return null;
  const speciesName = speciesNameForEntry(pokemon);
  const speciesId = speciesIdForName(speciesName);
  if (!speciesId) return null;
  const moves = Array.isArray(pokemon.moves)
    ? pokemon.moves.map((move) => normalizeMoveText(move)).filter(Boolean)
    : [];
  return {
    slot: Number(slotIndex || 0) + 1,
    speciesName,
    speciesId,
    ability: normalizeMoveText(pokemon.ability),
    moves,
    types: speciesTypesForName(speciesName),
  };
}

function updateSideRosterFromRequest(state, player, request) {
  const side = sideFromPlayer(player);
  const pokemon = request && request.side && Array.isArray(request.side.pokemon) ? request.side.pokemon : null;
  if (!state || !side || !pokemon) return;
  const roster = pokemon
    .map((entry, idx) => rosterEntryFromPokemon(entry, idx))
    .filter(Boolean);
  if (!roster.length) return;
  ensureBattleBrainState(state).sideRosters[side] = roster;
}

function rosterEntryCanUseMove(entry, moveId) {
  const moves = entry && Array.isArray(entry.moves) ? entry.moves : [];
  if (!moves.length || !moveId) return null;
  return moves.includes(moveId);
}

function isIllusionRosterEntry(entry) {
  if (!entry) return false;
  return entry.ability === 'illusion' || ['zorua', 'zoruahisui', 'zoroark', 'zoroarkhisui'].includes(entry.speciesId);
}

function illusionCandidateForEvidence(state, side, displayedSpeciesName, moveId) {
  const brain = ensureBattleBrainState(state);
  const roster = side && brain.sideRosters ? brain.sideRosters[side] || [] : [];
  if (!roster.length || !moveId) return null;
  const displayedSpeciesId = speciesIdForName(displayedSpeciesName);
  if (!displayedSpeciesId) return null;
  const displayedEntry = roster.find((entry) => entry.speciesId === displayedSpeciesId) || null;
  if (displayedEntry && rosterEntryCanUseMove(displayedEntry, moveId) !== false) return null;
  if (!displayedEntry || !Array.isArray(displayedEntry.moves) || !displayedEntry.moves.length) return null;
  return roster.find((entry) => (
    entry.speciesId !== displayedSpeciesId
    && isIllusionRosterEntry(entry)
    && rosterEntryCanUseMove(entry, moveId) === true
  )) || null;
}

function applyIllusionEvidenceFromMove(state, actorKey, side, slot, moveId) {
  if (!state || !actorKey || !side || !slot || !moveId) return;
  const sideState = state.activeBySide && state.activeBySide[side] ? state.activeBySide[side] : null;
  const entry = sideState ? sideState[slot] || null : null;
  const displayedSpecies = speciesNameForEntry(entry);
  if (!entry || !displayedSpecies) return;
  const candidate = illusionCandidateForEvidence(state, side, displayedSpecies, moveId);
  if (!candidate) return;
  sideState[slot] = {
    ...entry,
    illusionEvidence: true,
    likelySpecies: candidate.speciesName,
    likelyTypes: candidate.types,
    illusionEvidenceMoveId: moveId,
  };
  const memory = activeMemoryFor(state, actorKey);
  memory.illusionEvidence = true;
  memory.likelySpecies = candidate.speciesName;
}

function illusionCandidateForImmuneTarget(state, side, displayedSpeciesName, moveType) {
  const brain = ensureBattleBrainState(state);
  const roster = side && brain.sideRosters ? brain.sideRosters[side] || [] : [];
  if (!roster.length || !moveType) return null;
  const displayedSpeciesId = speciesIdForName(displayedSpeciesName);
  if (!displayedSpeciesId) return null;
  const displayedTypes = speciesTypesForName(displayedSpeciesName);
  if (displayedTypes.length && !Dex.getImmunity(moveType, displayedTypes)) return null;
  return roster.find((entry) => (
    entry.speciesId !== displayedSpeciesId
    && isIllusionRosterEntry(entry)
    && Array.isArray(entry.types)
    && entry.types.length
    && !Dex.getImmunity(moveType, entry.types)
  )) || null;
}

function applyIllusionEvidenceFromImmuneTarget(state, source, targetIdent) {
  if (!state || !source || !source.moveId) return;
  const target = parseBattleIdent(targetIdent);
  const targetKey = identKey(target);
  if (!target || !targetKey) return;
  const sideState = state.activeBySide && state.activeBySide[target.side] ? state.activeBySide[target.side] : null;
  const entry = sideState ? sideState[target.slot || 'a'] || null : null;
  const displayedSpecies = speciesNameForEntry(entry);
  if (!entry || !displayedSpecies || entry.illusionEvidence) return;
  const moveType = moveTypeFor({id: source.moveId});
  const candidate = illusionCandidateForImmuneTarget(state, target.side, displayedSpecies, moveType);
  if (!candidate) return;
  sideState[target.slot || 'a'] = {
    ...entry,
    illusionEvidence: true,
    likelySpecies: candidate.speciesName,
    likelyTypes: candidate.types,
    illusionEvidenceMoveId: source.moveId,
  };
  const memory = activeMemoryFor(state, targetKey);
  memory.illusionEvidence = true;
  memory.likelySpecies = candidate.speciesName;
}

function scoreTeamPreviewSlotTrace(pokemon) {
  const text = pokemonText(pokemon);
  const reasons = [];
  let score = 0;

  if (!pokemon || isFainted(pokemon)) {
    return {score: -Infinity, reasons: [scoreReason('unavailable', 0, 'fainted-or-missing')]};
  }
  if (text.includes('incineroar') || text.includes('rillaboom') || text.includes('grimmsnarl')) {
    score += 70;
    reasons.push(scoreReason('priority-support-species', 70));
  }
  if (text.includes('fakeout')) {
    score += 72;
    reasons.push(scoreReason('fake-out-lead-value', 72));
  }
  if (text.includes('tailwind') || text.includes('trickroom')) {
    score += 76;
    reasons.push(scoreReason('speed-control-lead-value', 76));
  }
  if (text.includes('icywind') || text.includes('electroweb') || text.includes('thunderwave')) {
    score += 44;
    reasons.push(scoreReason('secondary-speed-control', 44));
  }
  if (text.includes('intimidate')) {
    score += 56;
    reasons.push(scoreReason('intimidate-lead-value', 56));
  }
  if (text.includes('followme') || text.includes('ragepowder')) {
    score += 54;
    reasons.push(scoreReason('redirection-lead-value', 54));
  }
  if (text.includes('wideguard') || text.includes('quickguard')) {
    score += 42;
    reasons.push(scoreReason('guard-support-lead-value', 42));
  }
  if (text.includes('spore') || text.includes('sleeppowder')) {
    score += 36;
    reasons.push(scoreReason('sleep-pressure-lead-value', 36));
  }
  if (text.includes('calyrex') || text.includes('miraidon') || text.includes('koraidon')) {
    score += 24;
    reasons.push(scoreReason('restricted-threat-lead-value', 24));
  }
  if (text.includes('focussash') || text.includes('boostenergy') || text.includes('choicescarf')) {
    score += 16;
    reasons.push(scoreReason('tempo-item-lead-value', 16));
  }
  if (text.includes('protect')) {
    score += 8;
    reasons.push(scoreReason('protect-option-lead-value', 8));
  }

  return {score, reasons};
}

function scoreTeamPreviewSlot(pokemon) {
  return scoreTeamPreviewSlotTrace(pokemon).score;
}

function chooseTeamPreviewOrderTrace(pokemon) {
  const scored = (pokemon || [])
    .slice(0, 6)
    .map((entry, idx) => {
      const trace = scoreTeamPreviewSlotTrace(entry);
      return {
        slot: idx + 1,
        score: trace.score,
        reasons: trace.reasons,
        reasonCategories: reasonCategories(trace.reasons),
      };
    })
    .sort((a, b) => (b.score - a.score) || (a.slot - b.slot));
  return {
    order: scored.map((entry) => entry.slot),
    scored: scored.map((entry) => ({
      slot: entry.slot,
      score: telemetryScore(entry.score),
      reasonCategories: entry.reasonCategories,
      reasons: entry.reasons,
    })),
  };
}

function chooseTeamPreviewOrder(pokemon) {
  return chooseTeamPreviewOrderTrace(pokemon).order;
}

function normalizeTeamPreviewSlots(slots, pokemonCount) {
  const normalized = [];
  for (const slot of Array.isArray(slots) ? slots : []) {
    const value = Number.parseInt(slot, 10);
    if (Number.isInteger(value) && value >= 1 && value <= Number(pokemonCount || 0) && !normalized.includes(value)) {
      normalized.push(value);
    }
  }
  return normalized;
}

function normalizePreviewSlotsByPlayer(slotsByPlayer, pokemonCount = 6) {
  const normalized = {};
  const source = slotsByPlayer && typeof slotsByPlayer === 'object' ? slotsByPlayer : {};
  for (const [player, slots] of Object.entries(source)) {
    const key = sideFromPlayer(player) || String(player || '').slice(0, 2).toLowerCase();
    if (!key) continue;
    const values = normalizeTeamPreviewSlots(slots, pokemonCount);
    if (values.length) normalized[key] = values;
  }
  return normalized;
}

function previewSlotsForPlayer(context, fieldName, player, pokemonCount) {
  const slotsByPlayer = context && context[fieldName] && typeof context[fieldName] === 'object'
    ? context[fieldName]
    : {};
  const playerKey = sideFromPlayer(player) || String(player || '').slice(0, 2).toLowerCase();
  const rawSlots = slotsByPlayer[player] || slotsByPlayer[playerKey] || [];
  return normalizeTeamPreviewSlots(rawSlots, pokemonCount);
}

function isSpreadMove(move) {
  const target = String((move || {}).target || '').trim();
  return ['allAdjacent', 'allAdjacentFoes'].includes(target);
}

function contextTurn(context) {
  const value = Number((context || {}).turns || (context || {}).turn || 0);
  return Number.isFinite(value) ? value : 0;
}

function speedControlAlreadyActive(moveId, context, player) {
  const brain = ensureBattleBrainState(context);
  const side = sideFromPlayer(player);
  if (moveId === 'trickroom') return Boolean(brain.field && brain.field.trickRoom);
  if (moveId === 'tailwind') return Boolean(side && brain.sideConditions && brain.sideConditions[side] && brain.sideConditions[side].tailwind);
  return false;
}

function turnsSince(turn, value) {
  const current = Number(turn || 0);
  const previous = Number(value || 0);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return Math.max(0, current - previous);
}

function moveAccuracyPercent(move) {
  const raw = (move || {}).accuracy;
  if (raw === true || raw === false || raw === null || raw === undefined || raw === '') return 100;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(100, value));
}

function visibleHpPercent(entry) {
  if (!entry || entry.hpPercent === null || entry.hpPercent === undefined) return null;
  const value = Number(entry.hpPercent);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function damageUtilityMoveId(moveId) {
  return FAKE_OUT_MOVE_IDS.has(moveId)
    || SPEED_CONTROL_MOVE_IDS.has(moveId)
    || REDIRECTION_MOVE_IDS.has(moveId)
    || GUARD_MOVE_IDS.has(moveId)
    || SUPPORT_MOVE_IDS.has(moveId)
    || PROTECT_MOVE_IDS.has(moveId);
}

function visibleDamageTargets(move, context, player, targetSuffix) {
  const foeSide = foeSideForPlayer(player);
  const foes = foeSide && context && context.activeBySide ? context.activeBySide[foeSide] : null;
  if (!foes) return [];
  const suffix = String(targetSuffix || '').trim();
  const entries = ['a', 'b']
    .map((slot, idx) => ({slot, suffix: `+${idx + 1}`, entry: foes[slot] || null}))
    .filter((item) => item.entry && !item.entry.fainted);
  if (!entries.length) return [];
  if (isSpreadMove(move)) return entries;
  if (suffix) {
    const selected = entries.find((item) => item.suffix === suffix);
    return selected ? [selected] : [];
  }
  return entries.slice(0, 1);
}

function normalizeTypeName(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const type = Dex.types.get(text);
  return type && type.exists ? type.name : null;
}

function explicitTypesForEntry(entry) {
  const rawTypes = [];
  if (Array.isArray(entry && entry.types)) rawTypes.push(...entry.types);
  else rawTypes.push(entry && entry.type);
  const types = rawTypes.map((value) => normalizeTypeName(value)).filter(Boolean);
  return types.length ? Array.from(new Set(types)) : [];
}

function speciesIdForName(value) {
  const name = String(value || '').split(',')[0].trim();
  if (!name) return '';
  const species = Dex.species.get(name);
  return species && species.exists ? species.id : normalizeMoveText(name);
}

function speciesTypesForName(value) {
  const name = String(value || '').split(',')[0].trim();
  if (!name) return [];
  const species = Dex.species.get(name);
  return species && species.exists && Array.isArray(species.types) ? species.types.slice() : [];
}

function speciesNameForEntry(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const raw = entry.species || entry.baseSpecies || entry.name || entry.details || '';
  return String(raw).split(',')[0].trim();
}

function typesForEntry(entry) {
  if (entry && entry.illusionEvidence) {
    const likelyTypes = Array.isArray(entry.likelyTypes)
      ? entry.likelyTypes.map((value) => normalizeTypeName(value)).filter(Boolean)
      : [];
    if (likelyTypes.length) return Array.from(new Set(likelyTypes));
    const likelySpeciesTypes = speciesTypesForName(entry.likelySpecies);
    if (likelySpeciesTypes.length) return likelySpeciesTypes;
  }
  const explicit = explicitTypesForEntry(entry);
  if (explicit.length) return explicit;
  const speciesName = speciesNameForEntry(entry);
  if (!speciesName) return [];
  const species = Dex.species.get(speciesName);
  return species && species.exists && Array.isArray(species.types) ? species.types.slice() : [];
}

function moveTypeFor(move) {
  const explicit = normalizeTypeName((move || {}).type);
  if (explicit) return explicit;
  const data = Dex.moves.get(moveIdFor(move));
  return data && data.exists ? data.type : null;
}

function activeEntryFor(context, player, activeIndex) {
  const side = sideFromPlayer(player);
  const slot = activeSlotForIndex(activeIndex);
  return side && context && context.activeBySide && context.activeBySide[side]
    ? context.activeBySide[side][slot] || null
    : null;
}

function numericSpeedValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function speedForEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const direct = [
    entry.speed,
    entry.spe,
    entry.baseSpeed,
    entry.stats && entry.stats.spe,
    entry.baseStats && entry.baseStats.spe,
  ];
  for (const value of direct) {
    const numeric = numericSpeedValue(value);
    if (numeric !== null) return numeric;
  }
  const speciesName = speciesNameForEntry(entry);
  if (!speciesName) return null;
  const species = Dex.species.get(speciesName);
  return species && species.exists && species.baseStats ? numericSpeedValue(species.baseStats.spe) : null;
}

function sideHasTailwind(context, side) {
  const brain = ensureBattleBrainState(context);
  return Boolean(side && brain.sideConditions && brain.sideConditions[side] && brain.sideConditions[side].tailwind);
}

function effectiveTurnOrderSpeed(context, side, entry) {
  const speed = speedForEntry(entry);
  if (!Number.isFinite(speed)) return null;
  return sideHasTailwind(context, side) ? speed * 2 : speed;
}

function turnOrderCompare(context, actorSide, actorEntry, targetSide, targetEntry) {
  const actorSpeed = effectiveTurnOrderSpeed(context, actorSide, actorEntry);
  const targetSpeed = effectiveTurnOrderSpeed(context, targetSide, targetEntry);
  if (!Number.isFinite(actorSpeed) || !Number.isFinite(targetSpeed) || actorSpeed === targetSpeed) return null;
  const brain = ensureBattleBrainState(context);
  const trickRoom = Boolean(brain.field && brain.field.trickRoom);
  const actorBefore = trickRoom ? actorSpeed < targetSpeed : actorSpeed > targetSpeed;
  return actorBefore ? 1 : -1;
}

function visibleTurnOrderProfile(context, player, activeIndex, targetSuffix) {
  const actorSide = sideFromPlayer(player);
  const foeSide = foeSideForPlayer(player);
  const actorEntry = activeEntryFor(context, player, Number(activeIndex || 0));
  const foes = foeSide && context && context.activeBySide ? context.activeBySide[foeSide] : null;
  if (!actorSide || !foeSide || !actorEntry || !foes) return {known: false};
  const suffix = String(targetSuffix || '').trim();
  const entries = ['a', 'b']
    .map((slot, idx) => ({slot, suffix: `+${idx + 1}`, entry: foes[slot] || null}))
    .filter((item) => item.entry && !item.entry.fainted);
  const comparisons = entries
    .map((item) => ({...item, order: turnOrderCompare(context, actorSide, actorEntry, foeSide, item.entry)}))
    .filter((item) => item.order !== null);
  if (!comparisons.length) return {known: false};
  const selected = suffix ? comparisons.find((item) => item.suffix === suffix) || null : null;
  return {
    known: true,
    actorBeforeAny: comparisons.some((item) => item.order > 0),
    actorAfterAny: comparisons.some((item) => item.order < 0),
    actorBeforeSelected: selected ? selected.order > 0 : false,
    actorAfterSelected: selected ? selected.order < 0 : false,
    reasonCategories: [
      ...(ensureBattleBrainState(context).field.trickRoom ? ['trick-room-turn-order'] : ['normal-turn-order']),
      ...(sideHasTailwind(context, actorSide) ? ['ally-tailwind-turn-order'] : []),
      ...(sideHasTailwind(context, foeSide) ? ['foe-tailwind-turn-order'] : []),
    ],
  };
}

function visibleSideStateSummary(context, side) {
  const sideState = side && context && context.activeBySide ? context.activeBySide[side] : null;
  const entries = sideState ? Object.values(sideState).filter((entry) => entry && typeof entry === 'object') : [];
  let alive = 0;
  let fainted = 0;
  let hpTotal = 0;
  let hpKnown = 0;
  for (const entry of entries) {
    if (entry.fainted) {
      fainted += 1;
      continue;
    }
    alive += 1;
    const hp = visibleHpPercent(entry);
    if (Number.isFinite(hp)) {
      hpKnown += 1;
      hpTotal += hp;
    }
  }
  return {alive, fainted, hpKnown, hpTotal};
}

function visibleWinStateSummary(context, player) {
  const side = sideFromPlayer(player);
  const foeSide = foeSideForPlayer(player);
  if (!side || !foeSide) return {state: 'neutral', margin: 0, known: false};
  const own = visibleSideStateSummary(context, side);
  const foe = visibleSideStateSummary(context, foeSide);
  if ((own.alive + own.fainted + own.hpKnown) === 0 || (foe.alive + foe.fainted + foe.hpKnown) === 0) {
    return {state: 'neutral', margin: 0, known: false};
  }
  const margin = ((own.alive - foe.alive) * 80)
    + ((foe.fainted - own.fainted) * 80)
    + (own.hpTotal - foe.hpTotal);
  const state = margin >= WIN_STATE_CLEAR_THRESHOLD
    ? 'ahead'
    : margin <= -WIN_STATE_CLEAR_THRESHOLD
      ? 'behind'
      : 'neutral';
  return {
    state,
    margin: telemetryScore(margin),
    known: true,
    own,
    foe,
  };
}

function winStateDamageScoreTrace(move, activeCount, context, options = {}, targets = [], typeTrace = null, effectivePower = 0, accuracy = 100) {
  const summary = visibleWinStateSummary(context, options.player || null);
  if (!summary.known || summary.state === 'neutral') return {score: 0, reasons: [], reasonCategories: []};
  const reasons = [];
  let score = 0;
  const moveId = moveIdFor(move);
  const basePower = Number((move || {}).basePower || 0);
  const typeCategories = new Set((typeTrace && typeTrace.reasonCategories) || []);
  const hasSuperEffectiveSignal = typeCategories.has('super-effective-damage-bonus');
  const hasNegativeTypeSignal = typeCategories.has('known-type-immunity-avoidance') || typeCategories.has('resisted-damage-penalty');

  if (summary.state === 'ahead') {
    if (accuracy >= 100 && effectivePower >= DAMAGE_RELIABLE_POWER_THRESHOLD && !hasNegativeTypeSignal) {
      score += WIN_STATE_RELIABLE_ACTION_BONUS;
      reasons.push(scoreReason('ahead-reliable-action-priority', WIN_STATE_RELIABLE_ACTION_BONUS, {margin: summary.margin}));
    }
    if (accuracy < 100 && !hasSuperEffectiveSignal) {
      const penalty = accuracy < 80 ? WIN_STATE_AHEAD_RISK_PENALTY : Math.round(WIN_STATE_AHEAD_RISK_PENALTY / 2);
      score -= penalty;
      reasons.push(scoreReason('ahead-risky-action-penalty', -penalty, {margin: summary.margin, accuracy: telemetryScore(accuracy)}));
    }
    if (effectivePower < DAMAGE_LOW_VALUE_POWER_THRESHOLD && !damageUtilityMoveId(moveId)) {
      score -= WIN_STATE_LOW_VALUE_AHEAD_PENALTY;
      reasons.push(scoreReason('ahead-low-value-action-penalty', -WIN_STATE_LOW_VALUE_AHEAD_PENALTY, {margin: summary.margin}));
    }
  } else if (summary.state === 'behind') {
    if (basePower >= DAMAGE_HIGH_POWER_THRESHOLD || hasSuperEffectiveSignal || isSpreadMove(move)) {
      score += WIN_STATE_BEHIND_UPSIDE_BONUS;
      reasons.push(scoreReason('behind-high-upside-action-priority', WIN_STATE_BEHIND_UPSIDE_BONUS, {margin: summary.margin}));
    } else if (effectivePower >= DAMAGE_RELIABLE_POWER_THRESHOLD) {
      score += WIN_STATE_BEHIND_PRESSURE_BONUS;
      reasons.push(scoreReason('behind-pressure-action-priority', WIN_STATE_BEHIND_PRESSURE_BONUS, {margin: summary.margin}));
    }
  }

  return {score, reasons, reasonCategories: reasonCategories(reasons)};
}

function winStateSupportScoreTrace(moveId, context, options = {}) {
  const summary = visibleWinStateSummary(context, options.player || null);
  if (!summary.known || summary.state === 'neutral') return {score: 0, reasons: [], reasonCategories: []};
  const reasons = [];
  let score = 0;
  if (summary.state === 'ahead') {
    if (['splash', 'celebrate', 'happyhour', 'holdhands'].includes(moveId)) {
      score -= WIN_STATE_LOW_VALUE_AHEAD_PENALTY;
      reasons.push(scoreReason('ahead-low-value-action-penalty', -WIN_STATE_LOW_VALUE_AHEAD_PENALTY, {margin: summary.margin}));
    }
  } else if (summary.state === 'behind') {
    if (SPEED_CONTROL_MOVE_IDS.has(moveId) || ['spore', 'sleeppowder', 'willowisp', 'followme', 'ragepowder'].includes(moveId)) {
      score += WIN_STATE_BEHIND_PRESSURE_BONUS;
      reasons.push(scoreReason('behind-pressure-support-priority', WIN_STATE_BEHIND_PRESSURE_BONUS, {margin: summary.margin}));
    }
  }
  return {score, reasons, reasonCategories: reasonCategories(reasons)};
}

function speedControlTurnOrderScoreTrace(moveId, context, options = {}) {
  const profile = visibleTurnOrderProfile(context, options.player || null, Number(options.activeIndex || 0), options.targetSuffix);
  if (!profile.known || !profile.actorAfterAny) return {score: 0, reasons: [], reasonCategories: []};
  const reasons = [];
  let score = 0;
  if (['tailwind', 'trickroom'].includes(moveId) && !speedControlAlreadyActive(moveId, context, options.player || null)) {
    score += SPEED_DISADVANTAGE_CONTROL_BONUS;
    reasons.push(scoreReason('visible-speed-disadvantage-control-priority', SPEED_DISADVANTAGE_CONTROL_BONUS));
  } else if (['icywind', 'electroweb', 'thunderwave', 'nuzzle'].includes(moveId)) {
    const delta = ['icywind', 'electroweb'].includes(moveId) ? SPEED_DROP_DISADVANTAGE_BONUS : SINGLE_TARGET_SPEED_CONTROL_BONUS;
    score += delta;
    reasons.push(scoreReason('visible-speed-disadvantage-speed-drop-priority', delta));
  }
  return {score, reasons, reasonCategories: reasonCategories(reasons)};
}

function turnOrderDamageScoreTrace(move, context, options = {}, targets = [], typeTrace = null) {
  const category = String((move || {}).category || '').toLowerCase();
  const basePower = Number((move || {}).basePower || 0);
  if (!category || category === 'status' || !Number.isFinite(basePower) || basePower < DAMAGE_LOW_VALUE_POWER_THRESHOLD) {
    return {score: 0, reasons: [], reasonCategories: []};
  }
  const typeCategories = new Set((typeTrace && typeTrace.reasonCategories) || []);
  if (typeCategories.has('known-type-immunity-avoidance')) return {score: 0, reasons: [], reasonCategories: []};
  const target = (targets || [])[0];
  const hpPercent = visibleHpPercent(target && target.entry);
  if (!Number.isFinite(hpPercent) || hpPercent > TARGET_CRITICAL_HP_PERCENT) return {score: 0, reasons: [], reasonCategories: []};
  const profile = visibleTurnOrderProfile(context, options.player || null, Number(options.activeIndex || 0), target && target.suffix);
  if (!profile.known) return {score: 0, reasons: [], reasonCategories: []};
  if (profile.actorBeforeSelected || (!profile.actorAfterSelected && profile.actorBeforeAny)) {
    return {
      score: KO_BEFORE_ACTION_BONUS,
      reasons: [scoreReason('likely-ko-before-action-priority', KO_BEFORE_ACTION_BONUS)],
      reasonCategories: ['likely-ko-before-action-priority'],
    };
  }
  if (profile.actorAfterSelected) {
    return {
      score: -MOVE_AFTER_TARGET_CAUTION_PENALTY,
      reasons: [scoreReason('likely-move-after-target-caution', -MOVE_AFTER_TARGET_CAUTION_PENALTY)],
      reasonCategories: ['likely-move-after-target-caution'],
    };
  }
  return {score: 0, reasons: [], reasonCategories: []};
}

function typeAwareScoreTrace(move, context, options = {}, targets = []) {
  const moveType = moveTypeFor(move);
  if (!moveType || !targets.length) return {score: 0, reasons: [], reasonCategories: []};
  const reasons = [];
  let score = 0;

  const actorTypes = typesForEntry(activeEntryFor(context, options.player || null, Number(options.activeIndex || 0)));
  if (actorTypes.includes(moveType)) {
    score += TYPE_STAB_BONUS;
    reasons.push(scoreReason('stab-damage-bonus', TYPE_STAB_BONUS));
  }

  let strongestEffectiveness = 0;
  let weakestEffectiveness = 0;
  let immuneTargets = 0;
  let typedTargets = 0;
  for (const target of targets) {
    const targetTypes = typesForEntry(target.entry);
    if (!targetTypes.length) continue;
    typedTargets += 1;
    if (!Dex.getImmunity(moveType, targetTypes)) {
      immuneTargets += 1;
      continue;
    }
    const effectiveness = Dex.getEffectiveness(moveType, targetTypes);
    strongestEffectiveness = Math.max(strongestEffectiveness, effectiveness);
    weakestEffectiveness = Math.min(weakestEffectiveness, effectiveness);
  }

  if (!typedTargets) return {score, reasons, reasonCategories: reasonCategories(reasons)};
  if (immuneTargets >= typedTargets) {
    score -= TYPE_IMMUNITY_PENALTY;
    reasons.push(scoreReason('known-type-immunity-avoidance', -TYPE_IMMUNITY_PENALTY));
  } else if (immuneTargets > 0) {
    const penalty = Math.round(TYPE_IMMUNITY_PENALTY / 2);
    score -= penalty;
    reasons.push(scoreReason('partial-type-immunity-risk', -penalty));
  }
  if (strongestEffectiveness > 0) {
    const bonus = Math.min(TYPE_SUPER_EFFECTIVE_BONUS * strongestEffectiveness, TYPE_SUPER_EFFECTIVE_BONUS * 2);
    score += bonus;
    reasons.push(scoreReason('super-effective-damage-bonus', bonus));
  } else if (weakestEffectiveness < 0 && immuneTargets === 0) {
    const penalty = Math.min(TYPE_RESISTED_PENALTY * Math.abs(weakestEffectiveness), TYPE_RESISTED_PENALTY * 2);
    score -= penalty;
    reasons.push(scoreReason('resisted-damage-penalty', -penalty));
  }

  return {score, reasons, reasonCategories: reasonCategories(reasons)};
}

function lightweightDamageScoreTrace(move, activeCount, context, options = {}) {
  const category = String((move || {}).category || '').toLowerCase();
  const basePower = Number((move || {}).basePower || 0);
  const moveId = moveIdFor(move);
  const reasons = [];
  let score = 0;

  if (!category || category === 'status' || !Number.isFinite(basePower) || basePower <= 0) {
    return {score, reasons, reasonCategories: []};
  }

  const accuracy = moveAccuracyPercent(move);
  const effectivePower = basePower * (accuracy / 100);
  if (accuracy < 100) {
    const penalty = Math.min(18, Math.round((basePower - effectivePower) * 0.25));
    if (penalty > 0) {
      score -= penalty;
      reasons.push(scoreReason('damage-accuracy-risk-adjustment', -penalty, {
        accuracy: telemetryScore(accuracy),
      }));
    }
  }

  if (effectivePower >= DAMAGE_HIGH_POWER_THRESHOLD) {
    score += DAMAGE_HIGH_POWER_BONUS;
    reasons.push(scoreReason('high-power-damage-pressure', DAMAGE_HIGH_POWER_BONUS, {
      effectivePower: telemetryScore(effectivePower),
    }));
  } else if (effectivePower >= DAMAGE_RELIABLE_POWER_THRESHOLD) {
    score += DAMAGE_RELIABLE_BONUS;
    reasons.push(scoreReason('reliable-damage-pressure', DAMAGE_RELIABLE_BONUS, {
      effectivePower: telemetryScore(effectivePower),
    }));
  }

  const targets = visibleDamageTargets(move, context, options.player || null, options.targetSuffix);
  const typeTrace = typeAwareScoreTrace(move, context, options, targets);
  score += typeTrace.score;
  reasons.push(...typeTrace.reasons);
  const winStateTrace = winStateDamageScoreTrace(move, activeCount, context, options, targets, typeTrace, effectivePower, accuracy);
  score += winStateTrace.score;
  reasons.push(...winStateTrace.reasons);
  const turnOrderTrace = turnOrderDamageScoreTrace(move, context, options, targets, typeTrace);
  score += turnOrderTrace.score;
  reasons.push(...turnOrderTrace.reasons);

  const visibleHps = targets.map((item) => visibleHpPercent(item.entry)).filter((value) => Number.isFinite(value));
  const weakestHp = visibleHps.length ? Math.min(...visibleHps) : null;
  if (Number.isFinite(weakestHp)) {
    if (weakestHp <= TARGET_CRITICAL_HP_PERCENT && effectivePower >= DAMAGE_LOW_VALUE_POWER_THRESHOLD) {
      score += DAMAGE_CRITICAL_TARGET_BONUS;
      reasons.push(scoreReason('critical-target-damage-pressure', DAMAGE_CRITICAL_TARGET_BONUS, {
        hpPercent: telemetryScore(weakestHp),
      }));
    } else if (weakestHp <= TARGET_WEAK_HP_PERCENT && effectivePower >= DAMAGE_RELIABLE_POWER_THRESHOLD) {
      score += DAMAGE_WEAKENED_TARGET_BONUS;
      reasons.push(scoreReason('weakened-target-damage-pressure', DAMAGE_WEAKENED_TARGET_BONUS, {
        hpPercent: telemetryScore(weakestHp),
      }));
    } else if (weakestHp >= 75 && effectivePower < DAMAGE_LOW_VALUE_POWER_THRESHOLD && !damageUtilityMoveId(moveId)) {
      score -= DAMAGE_HEALTHY_LOW_POWER_PENALTY;
      reasons.push(scoreReason('healthy-target-low-power-penalty', -DAMAGE_HEALTHY_LOW_POWER_PENALTY, {
        hpPercent: telemetryScore(weakestHp),
      }));
    }
  }

  if (isSpreadMove(move) && activeCount > 1 && effectivePower >= DAMAGE_RELIABLE_POWER_THRESHOLD) {
    score += DAMAGE_RELIABLE_BONUS;
    reasons.push(scoreReason('spread-damage-pressure', DAMAGE_RELIABLE_BONUS));
  }

  return {score, reasons, reasonCategories: reasonCategories(reasons)};
}

function supportTargetEntries(move, context, player, targetSuffix) {
  return visibleDamageTargets(move, context, player, targetSuffix);
}

function knownSpeedSetterTarget(move, context, player, targetSuffix) {
  return supportTargetEntries(move, context, player, targetSuffix)
    .some((item) => hasKnownSpeedSetterSignal(item.entry));
}

function supportMoveScoreTrace(move, activeCount, context, options = {}) {
  const id = moveIdFor(move);
  const turn = contextTurn(context);
  const activeKey = activeKeyFor(options.player || null, Number(options.activeIndex || 0));
  const memory = activeKey ? activeMemoryFor(context, activeKey) : {};
  const reasons = [];
  let score = 0;

  if (PROTECT_MOVE_IDS.has(id)) {
    if (turn <= 1) {
      score += PROTECT_OPENING_SCOUT_BONUS;
      reasons.push(scoreReason('protect-opening-scout', PROTECT_OPENING_SCOUT_BONUS));
    }
    const damageAge = turnsSince(turn, memory.lastDamageTakenTurn);
    if (damageAge !== null && damageAge <= 1) {
      score += PROTECT_PRESSURE_BONUS;
      reasons.push(scoreReason('protect-after-pressure', PROTECT_PRESSURE_BONUS, {
        turnsSinceDamage: telemetryScore(damageAge),
      }));
    }
  }

  if (FAKE_OUT_MOVE_IDS.has(id)) {
    const switchTurn = Number.isFinite(Number(memory.switchTurn)) ? Number(memory.switchTurn) : 0;
    const fakeOutWindowOpen = turn <= 1 || (switchTurn > 0 && turn - switchTurn <= 1);
    if (fakeOutWindowOpen && !memory.fakeOutUsed && knownSpeedSetterTarget(move, context, options.player || null, options.targetSuffix)) {
      score += FAKE_OUT_SETTER_PRESSURE_BONUS;
      reasons.push(scoreReason('fake-out-setter-pressure', FAKE_OUT_SETTER_PRESSURE_BONUS));
    }
  }

  if (['tailwind', 'trickroom'].includes(id)) {
    if (!speedControlAlreadyActive(id, context, options.player || null) && activeCount > 1) {
      score += SPEED_CONTROL_DOUBLES_BONUS;
      reasons.push(scoreReason('doubles-speed-control-priority', SPEED_CONTROL_DOUBLES_BONUS));
    }
  }

  const speedTurnOrderTrace = speedControlTurnOrderScoreTrace(id, context, options);
  score += speedTurnOrderTrace.score;
  reasons.push(...speedTurnOrderTrace.reasons);
  const winStateSupportTrace = winStateSupportScoreTrace(id, context, options);
  score += winStateSupportTrace.score;
  reasons.push(...winStateSupportTrace.reasons);

  if (['icywind', 'electroweb'].includes(id) && activeCount > 1) {
    score += SPREAD_SPEED_CONTROL_BONUS;
    reasons.push(scoreReason('spread-speed-control-priority', SPREAD_SPEED_CONTROL_BONUS));
  }

  if (['thunderwave', 'nuzzle'].includes(id)) {
    score += SINGLE_TARGET_SPEED_CONTROL_BONUS;
    reasons.push(scoreReason('single-target-speed-control-priority', SINGLE_TARGET_SPEED_CONTROL_BONUS));
  }

  return {score, reasons, reasonCategories: reasonCategories(reasons)};
}

function scoreDeterministicMoveTrace(move, activeCount, context, options = {}) {
  if (!move || move.disabled) {
    return {
      score: -Infinity,
      moveId: moveIdFor(move),
      targetSuffix: '',
      reasons: [scoreReason('unavailable-move', 0)],
      reasonCategories: ['unavailable-move'],
    };
  }

  const id = moveIdFor(move);
  const category = String((move || {}).category || '').toLowerCase();
  const basePower = Number((move || {}).basePower || 0);
  const turn = contextTurn(context);
  const player = options.player || null;
  const activeIndex = Number(options.activeIndex || 0);
  const targetSuffix = options.targetSuffix !== undefined ? options.targetSuffix : targetSuffixForMove(move, activeIndex, context, player);
  const activeKey = activeKeyFor(player, activeIndex);
  const memory = activeKey ? activeMemoryFor(context, activeKey) : {};
  const signature = choiceSignature(player, activeIndex, move, targetSuffix);
  const reasons = [];
  let score = 0;

  if (category && category !== 'status') {
    score += 100;
    reasons.push(scoreReason('damaging-move', 100));
  }
  if (Number.isFinite(basePower) && basePower > 0) {
    score += basePower;
    reasons.push(scoreReason('base-power', basePower));
  }
  if (isSpreadMove(move) && activeCount > 1) {
    const spreadBonus = Number.isFinite(basePower) && basePower >= 55 ? 20 : 8;
    score += spreadBonus;
    reasons.push(scoreReason('spread-move-bonus', spreadBonus));
  }
  const damageTrace = lightweightDamageScoreTrace(move, activeCount, context, {...options, targetSuffix});
  score += damageTrace.score;
  reasons.push(...damageTrace.reasons);
  const supportTrace = supportMoveScoreTrace(move, activeCount, context, {...options, targetSuffix});
  score += supportTrace.score;
  reasons.push(...supportTrace.reasons);

  if (FAKE_OUT_MOVE_IDS.has(id)) {
    const switchTurn = Number.isFinite(Number(memory.switchTurn)) ? Number(memory.switchTurn) : 0;
    const fakeOutWindowOpen = turn <= 1 || (switchTurn > 0 && turn - switchTurn <= 1);
    const delta = fakeOutWindowOpen && !memory.fakeOutUsed ? 145 : -260;
    score += delta;
    reasons.push(scoreReason(delta > 0 ? 'fake-out-window-open' : 'fake-out-window-closed', delta));
  }
  if (PROTECT_MOVE_IDS.has(id)) {
    const turnDelta = turn <= 1 ? 18 : -35;
    score += turnDelta;
    reasons.push(scoreReason(turn <= 1 ? 'early-protect-option' : 'late-protect-penalty', turnDelta));
    const streakPenalty = Math.min(220, Number(memory.protectStreak || 0) * 95);
    score -= streakPenalty;
    if (streakPenalty) reasons.push(scoreReason('protect-streak-penalty', -streakPenalty));
    if (memory.protectedTurn === turn - 1) {
      score -= 45;
      reasons.push(scoreReason('previous-turn-protect-penalty', -45));
    }
  }
  if (['tailwind', 'trickroom'].includes(id)) {
    const speedDelta = turn <= 3 ? 78 : 36;
    score += speedDelta;
    reasons.push(scoreReason(turn <= 3 ? 'early-speed-control' : 'late-speed-control', speedDelta));
    if (speedControlAlreadyActive(id, context, player)) {
      score -= SPEED_CONTROL_ALREADY_ACTIVE_PENALTY;
      reasons.push(scoreReason('speed-control-already-active', -SPEED_CONTROL_ALREADY_ACTIVE_PENALTY));
    }
  }
  if (['icywind', 'electroweb'].includes(id)) {
    score += 64;
    reasons.push(scoreReason('speed-drop-spread-pressure', 64));
  }
  if (['thunderwave', 'willowisp', 'nuzzle'].includes(id)) {
    score += 42;
    reasons.push(scoreReason('status-pressure', 42));
  }
  if (['spore', 'sleeppowder'].includes(id)) {
    score += 70;
    reasons.push(scoreReason('sleep-pressure', 70));
  }
  if (['followme', 'ragepowder'].includes(id)) {
    score += 62;
    reasons.push(scoreReason('redirection-support', 62));
  }
  if (['wideguard', 'quickguard'].includes(id)) {
    score += 54;
    reasons.push(scoreReason('guard-support', 54));
  }
  if (['helpinghand'].includes(id)) {
    score += 48;
    reasons.push(scoreReason('helping-hand-support', 48));
  }
  if (['splash', 'celebrate', 'happyhour', 'holdhands'].includes(id)) {
    score -= 200;
    reasons.push(scoreReason('low-value-move-penalty', -200));
  }

  const failedPenalty = failedChoicePenalty(context, signature, id, targetSuffix);
  score -= failedPenalty;
  if (failedPenalty) {
    const failedCategories = failedChoiceReasonCategories(context, signature, id, targetSuffix);
    const category = failedCategories.includes('immune-no-effect-memory-penalty')
      ? 'immune-no-effect-memory-penalty'
      : 'failed-choice-memory-penalty';
    reasons.push(scoreReason(category, -failedPenalty));
  }
  const repeatPenalty = repeatedChoicePenalty(context, signature);
  score -= repeatPenalty;
  if (repeatPenalty) reasons.push(scoreReason('repeated-choice-memory-penalty', -repeatPenalty));

  return {
    score,
    moveId: id,
    targetSuffix,
    reasons,
    reasonCategories: reasonCategories(reasons),
  };
}

function scoreDeterministicMove(move, activeCount, context, options = {}) {
  return scoreDeterministicMoveTrace(move, activeCount, context, options).score;
}

function chooseDeterministicMoveTrace(moves, activeCount, context, options = {}) {
  let best = null;
  let bestScore = -Infinity;
  const alternatives = [];

  for (let idx = 0; idx < (moves || []).length; idx += 1) {
    const move = moves[idx];
    const targetTrace = targetSuffixForMoveTrace(move, Number(options.activeIndex || 0), context, options.player || null);
    const scoreTrace = scoreDeterministicMoveTrace(move, activeCount, context, {...options, targetSuffix: targetTrace.targetSuffix});
    const score = scoreTrace.score;
    const entry = {
      move,
      index: idx + 1,
      moveId: scoreTrace.moveId,
      score,
      targetSuffix: targetTrace.targetSuffix,
      targetScores: targetTrace.targetScores,
      reasonCategories: Array.from(new Set([...(scoreTrace.reasonCategories || []), ...(targetTrace.reasonCategories || [])])),
      reasons: scoreTrace.reasons,
    };
    alternatives.push(entry);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }

  const sortedAlternatives = alternatives
    .slice()
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, TOP_DECISION_ALTERNATIVES)
    .map((entry) => ({
      index: entry.index,
      moveId: entry.moveId,
      score: telemetryScore(entry.score),
      targetSuffix: String(entry.targetSuffix || '').trim(),
      reasonCategories: entry.reasonCategories,
    }));

  return best ? {
    selected: {
      move: best.move,
      index: best.index,
      moveId: best.moveId,
      score: best.score,
      targetSuffix: best.targetSuffix,
      targetScores: best.targetScores,
      reasonCategories: best.reasonCategories,
      reasons: best.reasons,
    },
    topAlternatives: sortedAlternatives,
  } : {selected: null, topAlternatives: sortedAlternatives};
}

function chooseDeterministicMove(moves, activeCount, context, options = {}) {
  const trace = chooseDeterministicMoveTrace(moves, activeCount, context, options);
  return trace.selected ? {move: trace.selected.move, index: trace.selected.index} : null;
}

function parseBattleIdent(ident) {
  const match = String(ident || '').match(/^(p[12])([a-z])?:\s*(.*)$/i);
  if (!match) return null;
  return {
    side: match[1].toLowerCase(),
    slot: (match[2] || 'a').toLowerCase(),
    name: (match[3] || '').trim(),
  };
}

function identKey(parsed) {
  if (!parsed || !parsed.side) return null;
  return `${parsed.side}${parsed.slot || 'a'}`;
}

function targetSuffixFromTargetKey(actorSide, targetKey) {
  const foeSide = actorSide === 'p1' ? 'p2' : actorSide === 'p2' ? 'p1' : null;
  const key = String(targetKey || '').toLowerCase();
  if (!foeSide || !key.startsWith(foeSide)) return '';
  return key.endsWith('b') ? '+2' : '+1';
}

function sideFromSideConditionIdent(value) {
  const match = String(value || '').match(/^(p[12])(?::|\b)/i);
  return match ? match[1].toLowerCase() : null;
}

function recordMoveLine(parts, state) {
  const parsed = parseBattleIdent(parts[2]);
  if (!parsed) return;
  const key = identKey(parsed);
  const moveId = normalizeMoveText(parts[3]);
  const target = parseBattleIdent(parts[4]);
  const targetKey = identKey(target);
  const turn = contextTurn(state);
  const memory = activeMemoryFor(state, key);
  const brain = ensureBattleBrainState(state);
  const lastChoice = brain.lastChoiceBySlot[key] || null;
  const observedTargetSuffix = lastChoice && lastChoice.moveId === moveId
    ? lastChoice.targetSuffix
    : targetSuffixFromTargetKey(parsed.side, targetKey);
  const entry = {
    actorKey: key,
    actorSide: parsed.side,
    moveId,
    targetKey,
    targetSuffix: observedTargetSuffix,
    signature: lastChoice && lastChoice.moveId === moveId ? lastChoice.signature : null,
    turn,
  };
  memory.lastMoveId = moveId;
  memory.lastTargetKey = targetKey;
  if (PROTECT_MOVE_IDS.has(moveId)) {
    memory.protectStreak = Number(memory.protectStreak || 0) + 1;
    memory.protectedTurn = turn;
  } else {
    memory.protectStreak = 0;
  }
  if (FAKE_OUT_MOVE_IDS.has(moveId)) memory.fakeOutUsed = true;
  if (SPEED_CONTROL_MOVE_IDS.has(moveId) || REDIRECTION_MOVE_IDS.has(moveId) || GUARD_MOVE_IDS.has(moveId) || SUPPORT_MOVE_IDS.has(moveId)) {
    brain.allyPlan[key] = {moveId, targetKey, turn};
  }
  brain.lastMoveByIdent[key] = entry;
  brain.lastGlobalMove = entry;
  applyIllusionEvidenceFromMove(state, key, parsed.side, parsed.slot || 'a', moveId);
}

function markFailedMemory(state, source, reason) {
  const brain = ensureBattleBrainState(state);
  const turn = contextTurn(state);
  const entry = source || brain.lastGlobalMove;
  if (!entry) return;
  brain.failedMemory.push({
    signature: entry.signature || null,
    moveId: entry.moveId || null,
    targetKey: entry.targetKey || null,
    targetSuffix: entry.targetSuffix || '',
    reason,
    turn,
  });
  trimBattleBrainMemory(brain, turn);
}

function updateKnownHp(parsed, condition, state) {
  const key = identKey(parsed);
  if (!key) return;
  const activeBySide = state.activeBySide || {};
  const sideState = activeBySide[parsed.side] || {};
  const current = sideState[parsed.slot] || {};
  const hpPercent = conditionHpPercent(condition);
  sideState[parsed.slot] = {
    ...current,
    name: parsed.name || current.name,
    condition: condition || current.condition || '',
    hpPercent,
    fainted: hpPercent === 0 || current.fainted === true,
  };
  activeBySide[parsed.side] = sideState;
  state.activeBySide = activeBySide;
  activeMemoryFor(state, key).lastDamageTakenTurn = contextTurn(state);
  const brain = ensureBattleBrainState(state);
  if (brain.lastGlobalMove && brain.lastGlobalMove.actorKey) {
    activeMemoryFor(state, brain.lastGlobalMove.actorKey).lastDamageDealtTurn = contextTurn(state);
  }
}

function updateFieldState(parts, state) {
  const event = parts[1];
  const brain = ensureBattleBrainState(state);
  const effect = effectIdFromParts(parts, 2);
  if (event === '-weather') {
    brain.field.weather = effect && !effect.includes('none') ? effect : null;
  } else if (event === '-fieldstart') {
    if (effect.includes('trickroom')) brain.field.trickRoom = true;
    if (effect.includes('electricterrain') || effect.includes('grassyterrain') || effect.includes('mistyterrain') || effect.includes('psychicterrain')) {
      brain.field.terrain = effect;
    }
  } else if (event === '-fieldend') {
    if (effect.includes('trickroom')) brain.field.trickRoom = false;
    if (effect.includes('terrain')) brain.field.terrain = null;
  } else if (event === '-sidestart' || event === '-sideend') {
    const side = sideFromSideConditionIdent(parts[2]);
    if (!side) return;
    const sideState = brain.sideConditions[side] || {};
    const active = event === '-sidestart';
    if (effect.includes('tailwind')) sideState.tailwind = active;
    if (effect.includes('reflect')) sideState.reflect = active;
    if (effect.includes('lightscreen')) sideState.lightScreen = active;
    if (effect.includes('auroraveil')) sideState.auroraVeil = active;
    if (effect.includes('safeguard')) sideState.safeguard = active;
    if (effect.includes('mist')) sideState.mist = active;
    brain.sideConditions[side] = sideState;
  }
}

function updateBoardStateFromLine(line, state) {
  if (!state) return;
  const parts = String(line || '').split('|');
  const event = parts[1];
  const brain = ensureBattleBrainState(state);
  if (event === 'turn') {
    const value = Number(parts[2]);
    if (Number.isFinite(value)) {
      state.turns = value;
      trimBattleBrainMemory(brain, value);
    }
    return;
  }
  if (event === 'move') {
    recordMoveLine(parts, state);
    return;
  }
  if (event === '-damage' || event === '-heal') {
    const parsed = parseBattleIdent(parts[2]);
    if (parsed) updateKnownHp(parsed, parts[3], state);
    return;
  }
  if (event === '-status' || event === '-curestatus') {
    const parsed = parseBattleIdent(parts[2]);
    if (parsed) {
      const key = identKey(parsed);
      const memory = activeMemoryFor(state, key);
      memory.status = event === '-status' ? normalizeMoveText(parts[3]) : null;
    }
    return;
  }
  if (['-weather', '-fieldstart', '-fieldend', '-sidestart', '-sideend'].includes(event)) {
    updateFieldState(parts, state);
    return;
  }
  if (event === '-fail') {
    const parsed = parseBattleIdent(parts[2]);
    const key = identKey(parsed);
    markFailedMemory(state, key ? brain.lastMoveByIdent[key] : null, 'fail');
    return;
  }
  if (event === '-miss') {
    const parsed = parseBattleIdent(parts[2]);
    const key = identKey(parsed);
    markFailedMemory(state, key ? brain.lastMoveByIdent[key] : null, 'miss');
    return;
  }
  if (event === '-immune') {
    applyIllusionEvidenceFromImmuneTarget(state, brain.lastGlobalMove, parts[2]);
    markFailedMemory(state, brain.lastGlobalMove, 'immune');
    return;
  }
  if (event === '-activate' && effectIdFromParts(parts, 3).includes('protect')) {
    const protectedMon = parseBattleIdent(parts[2]);
    const protectedKey = identKey(protectedMon);
    if (protectedKey) activeMemoryFor(state, protectedKey).protectedTurn = contextTurn(state);
    if (brain.lastGlobalMove && brain.lastGlobalMove.actorKey !== protectedKey) markFailedMemory(state, brain.lastGlobalMove, 'protected');
    return;
  }
  if (event === 'cant') {
    const parsed = parseBattleIdent(parts[2]);
    const key = identKey(parsed);
    markFailedMemory(state, key ? brain.lastMoveByIdent[key] : null, 'cant');
    return;
  }
  if (!['switch', 'drag', 'faint'].includes(event)) return;
  const parsed = parseBattleIdent(parts[2]);
  if (!parsed) return;
  if (!state.activeBySide) state.activeBySide = {p1: {}, p2: {}};
  if (!state.activeBySide[parsed.side]) state.activeBySide[parsed.side] = {};
  const entry = state.activeBySide[parsed.side][parsed.slot] || {};
  if (event === 'faint') {
    state.activeBySide[parsed.side][parsed.slot] = {...entry, name: parsed.name || entry.name, hpPercent: 0, fainted: true};
    return;
  }
  const key = identKey(parsed);
  const memory = activeMemoryFor(state, key);
  memory.switchTurn = contextTurn(state);
  memory.fakeOutUsed = false;
  memory.protectStreak = 0;
  memory.protectedTurn = null;
  state.activeBySide[parsed.side][parsed.slot] = {
    name: parsed.name,
    details: parts[3] || '',
    condition: parts[4] || '',
    hpPercent: conditionHpPercent(parts[4]),
    fainted: false,
  };
}

function foeSideForPlayer(player) {
  const side = String(player || '').slice(0, 2).toLowerCase();
  if (side === 'p1') return 'p2';
  if (side === 'p2') return 'p1';
  return null;
}

function targetFailurePenaltyTrace(context, moveId, targetSuffix) {
  const brain = ensureBattleBrainState(context);
  const turn = contextTurn(context);
  let penalty = 0;
  const categories = new Set();
  const suffix = String(targetSuffix || '').trim();
  for (const entry of brain.failedMemory || []) {
    const weight = memoryWeight(entry, turn);
    if (weight <= 0) continue;
    if (entry.moveId === moveId && entry.targetSuffix === suffix) {
      const immuneNoEffect = String(entry.reason || '') === 'immune';
      penalty += (immuneNoEffect ? 220 : 80) * weight;
      categories.add(immuneNoEffect ? 'immune-no-effect-target-memory-penalty' : 'failed-target-memory-penalty');
    }
  }
  return {penalty, reasonCategories: Array.from(categories)};
}

function targetFailurePenalty(context, moveId, targetSuffix) {
  return targetFailurePenaltyTrace(context, moveId, targetSuffix).penalty;
}

function entryMoveIds(entry) {
  const values = [];
  const rawMoveGroups = [
    entry && entry.moves,
    entry && entry.moveIds,
    entry && entry.knownMoves,
    entry && entry.recentMoveIds,
  ];
  for (const group of rawMoveGroups) {
    if (Array.isArray(group)) {
      for (const item of group) {
        if (typeof item === 'string') values.push(item);
        else if (item && typeof item === 'object') values.push(item.id || item.move || item.name);
      }
    }
  }
  values.push(entry && entry.lastMoveId);
  return new Set(values.map((value) => normalizeMoveText(value)).filter(Boolean));
}

function entryRoleText(entry) {
  const rawRoles = [
    entry && entry.role,
    entry && entry.roles,
    entry && entry.tags,
    entry && entry.archetype,
    entry && entry.plan,
  ];
  return normalizeMoveText(rawRoles.flat ? rawRoles.flat(Infinity).join(' ') : rawRoles.join(' '));
}

function hasKnownSpeedSetterSignal(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const moveIds = entryMoveIds(entry);
  if (moveIds.has('tailwind') || moveIds.has('trickroom')) return true;
  const text = entryRoleText(entry);
  return text.includes('speedcontrol') || text.includes('trickroomsetter') || text.includes('tailwindsetter') || text.includes('speedsetter');
}

function targetPriorityTrace(entry, moveId, hpPercent) {
  const reasons = [];
  let bonus = 0;
  if (Number.isFinite(hpPercent)) {
    if (hpPercent <= TARGET_CRITICAL_HP_PERCENT) {
      bonus += TARGET_CRITICAL_BONUS;
      reasons.push(scoreReason('critical-visible-hp-target', TARGET_CRITICAL_BONUS));
    } else if (hpPercent <= TARGET_WEAK_HP_PERCENT) {
      bonus += TARGET_WEAKENED_BONUS;
      reasons.push(scoreReason('weakened-visible-hp-target', TARGET_WEAKENED_BONUS));
    }
  }
  if (FAKE_OUT_MOVE_IDS.has(moveId) && hasKnownSpeedSetterSignal(entry)) {
    bonus += TARGET_FAKE_OUT_SETTER_BONUS;
    reasons.push(scoreReason('fake-out-known-speed-setter-target', TARGET_FAKE_OUT_SETTER_BONUS));
  }
  return {bonus, reasons, reasonCategories: reasonCategories(reasons)};
}

function preferredFoeTargetSuffixTrace(context, player, move) {
  const foeSide = foeSideForPlayer(player);
  const foes = foeSide && context && context.activeBySide ? context.activeBySide[foeSide] : null;
  if (!foes) {
    return {targetSuffix: ' +1', targetScores: [], reasonCategories: ['default-no-visible-foes']};
  }
  const id = moveIdFor(move);
  const ranked = ['a', 'b']
    .map((slot, idx) => ({slot, suffix: ` +${idx + 1}`, entry: foes[slot] || null}))
    .filter((item) => item.entry && !item.entry.fainted)
    .map((item) => {
      const failureTrace = targetFailurePenaltyTrace(context, id, item.suffix.trim());
      return {
        ...item,
        hpPercent: item.entry.hpPercent !== null && item.entry.hpPercent !== undefined && Number.isFinite(Number(item.entry.hpPercent))
          ? Number(item.entry.hpPercent)
          : 100,
        memoryPenalty: failureTrace.penalty,
        memoryReasonCategories: failureTrace.reasonCategories,
      };
    })
    .map((item) => {
      const priority = targetPriorityTrace(item.entry, id, item.hpPercent);
      return {
        ...item,
        priorityBonus: priority.bonus,
        priorityReasons: priority.reasons,
        priorityReasonCategories: priority.reasonCategories,
        targetScore: item.hpPercent + item.memoryPenalty - priority.bonus,
      };
    });
  if (ranked.length < 2) {
    return {
      targetSuffix: ranked[0] ? ranked[0].suffix : ' +1',
      targetScores: ranked.map((item) => ({
        slot: item.slot,
        suffix: item.suffix.trim(),
        hpPercent: telemetryScore(item.hpPercent),
        memoryPenalty: telemetryScore(item.memoryPenalty),
        priorityBonus: telemetryScore(item.priorityBonus),
        targetScore: telemetryScore(item.targetScore),
        reasonCategories: [...(item.priorityReasonCategories || []), ...(item.memoryPenalty > 0 ? item.memoryReasonCategories || ['failed-target-memory-penalty'] : [])],
      })),
      reasonCategories: ranked[0] ? ['only-visible-foe'] : ['default-no-actionable-foes'],
    };
  }
  ranked.sort((a, b) => (a.targetScore - b.targetScore) || (a.slot.localeCompare(b.slot)));
  const hasDecisiveTarget = ranked[0].targetScore + 15 <= ranked[1].targetScore;
  const targetSuffix = hasDecisiveTarget ? ranked[0].suffix : ' +1';
  const selected = ranked.find((item) => item.suffix === targetSuffix) || ranked[0];
  const avoidedFailedTarget = ranked.some((item) => item.suffix !== targetSuffix && item.memoryPenalty > 0);
  const avoidedImmuneTarget = ranked.some((item) => item.suffix !== targetSuffix && (item.memoryReasonCategories || []).includes('immune-no-effect-target-memory-penalty'));
  const selectedPriorityCategories = selected ? selected.priorityReasonCategories || [] : [];
  const selectedReasonCategories = hasDecisiveTarget
    ? [
        ...(selectedPriorityCategories.length ? selectedPriorityCategories : ['lower-visible-hp-or-memory']),
        ...(avoidedFailedTarget ? ['failed-target-deprioritized'] : []),
        ...(avoidedImmuneTarget ? ['immune-no-effect-target-deprioritized'] : []),
      ]
    : ['default-target-slot'];
  return {
    targetSuffix,
    targetScores: ranked.map((item) => ({
      slot: item.slot,
      suffix: item.suffix.trim(),
      hpPercent: telemetryScore(item.hpPercent),
      memoryPenalty: telemetryScore(item.memoryPenalty),
      priorityBonus: telemetryScore(item.priorityBonus),
      targetScore: telemetryScore(item.targetScore),
      reasonCategories: [...(item.priorityReasonCategories || []), ...(item.memoryPenalty > 0 ? item.memoryReasonCategories || ['failed-target-memory-penalty'] : [])],
    })),
    reasonCategories: selectedReasonCategories,
  };
}

function preferredFoeTargetSuffix(context, player, move) {
  return preferredFoeTargetSuffixTrace(context, player, move).targetSuffix;
}

function targetSuffixForMoveTrace(move, activeIndex, context, player) {
  const target = String((move || {}).target || '').trim();
  if ([
    '', 'self', 'all', 'allAdjacent', 'allAdjacentFoes', 'allySide',
    'foeSide', 'scripted', 'randomNormal',
  ].includes(target)) {
    return {targetSuffix: '', targetScores: [], reasonCategories: ['no-explicit-target']};
  }
  if (['normal', 'adjacentFoe', 'any'].includes(target)) return preferredFoeTargetSuffixTrace(context, player, move);
  if (target === 'adjacentAlly') {
    return {targetSuffix: activeIndex === 0 ? ' -2' : ' -1', targetScores: [], reasonCategories: ['adjacent-ally-target']};
  }
  if (target === 'adjacentAllyOrSelf') {
    return {targetSuffix: '', targetScores: [], reasonCategories: ['ally-or-self-default']};
  }
  return {targetSuffix: '', targetScores: [], reasonCategories: ['unknown-target-shape']};
}

function targetSuffixForMove(move, activeIndex, context, player) {
  return targetSuffixForMoveTrace(move, activeIndex, context, player).targetSuffix;
}

function isActionableActiveSlot(pokemon) {
  if (!pokemon) return false;
  if (pokemon.active !== true) return false;
  if (pokemon.reviving) return false;
  if (pokemon.commanding) return false;
  return !isFainted(pokemon);
}

function buildActiveMoveChoice(request, context, player) {
  const active = request.active || [];
  const side = request.side || {};
  const sidePokemon = side.pokemon || [];
  const activeSlotStates = sidePokemon.filter((pokemon) => pokemon && pokemon.active === true);
  const activeCount = activeSlotStates.length || active.length;
  const choices = [];
  const takenSwitchSlots = new Set();

  for (let activeIndex = 0; activeIndex < active.length; activeIndex += 1) {
    const mon = active[activeIndex];
    const slotState = activeIndex < activeSlotStates.length ? activeSlotStates[activeIndex] : null;
    if (slotState !== null && !isActionableActiveSlot(slotState)) continue;
    if (!mon) continue;
    const moveTrace = chooseDeterministicMoveTrace(mon.moves || [], activeCount, context, {player, activeIndex});
    const selectedMove = moveTrace.selected;
    const switchTrace = tacticalSwitchTrace(sidePokemon, takenSwitchSlots, context, player, activeIndex, mon, slotState, selectedMove);
    const selectedSwitch = switchTrace.shouldSwitch ? {
      switchSlot: switchTrace.switchSlot,
      benchScore: telemetryScore(switchTrace.benchScore),
      reasonCategories: switchTrace.reasonCategories,
      reasons: switchTrace.reasons,
    } : null;
    const switchDecision = {
      shouldSwitch: Boolean(switchTrace.shouldSwitch),
      switchSlot: switchTrace.switchSlot || null,
      benchScore: Number.isFinite(Number(switchTrace.benchScore)) ? telemetryScore(switchTrace.benchScore) : null,
      reasonCategories: switchTrace.reasonCategories || [],
    };
    if (selectedSwitch) takenSwitchSlots.add(Number(switchTrace.switchSlot) - 1);
    const selected = selectedSwitch
      ? `switch ${selectedSwitch.switchSlot}`
      : selectedMove
        ? `move ${selectedMove.index}${selectedMove.targetSuffix}`
        : 'move 1';
    choices.push(selected);
    if (context && player) {
      pushDecisionTrace(context, {
        type: 'activeMove',
        player: sideFromPlayer(player) || String(player || '').slice(0, 2).toLowerCase() || null,
        activeIndex,
        activeSlot: activeSlotForIndex(activeIndex),
        selectedMove: selectedMove ? {
          index: selectedMove.index,
          moveId: selectedMove.moveId,
          score: telemetryScore(selectedMove.score),
          targetSuffix: String(selectedMove.targetSuffix || '').trim(),
          reasonCategories: selectedMove.reasonCategories,
          reasons: selectedMove.reasons,
        } : null,
        selectedSwitch,
        switchDecision,
        topMoveAlternatives: moveTrace.topAlternatives,
        targetScores: selectedMove ? selectedMove.targetScores : [],
        reasonCategories: selectedSwitch
          ? selectedSwitch.reasonCategories
          : Array.from(new Set([...(selectedMove ? selectedMove.reasonCategories : ['default-move-fallback']), ...(switchDecision.reasonCategories || [])])),
      });
    }
  }
  return choices.length ? choices.join(', ') : 'default';
}

function buildChoiceFromRequest(request, context, player) {
  if (request.wait) return '';
  if (request.teamPreview) return buildTeamPreviewChoice(request, context, player);
  const forceSwitch = request.forceSwitch;
  if (Array.isArray(forceSwitch) && forceSwitch.some(Boolean)) return buildForceSwitchChoice(request);
  if (request.active) return buildActiveMoveChoice(request, context, player);
  return 'default';
}

function parseEndPayload(lines) {
  if (!lines.length) return null;
  const first = lines[0].trim();
  if (first.startsWith('end ')) {
    const raw = first.slice(4).trim();
    return raw ? JSON.parse(raw) : null;
  }
  if (first === 'end' && lines.length > 1) {
    const raw = lines.slice(1).join('\n').trim();
    return raw ? JSON.parse(raw) : null;
  }
  return null;
}

function emit(stream, line) {
  stream.write(`${line}\n`);
}

function splitChoiceTokens(choice) {
  return String(choice || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function rememberChoiceFromRequest(state, player, request, choice) {
  if (!state || !request || !choice) return;
  updateSideRosterFromRequest(state, player, request);
  const brain = ensureBattleBrainState(state);
  const turn = contextTurn(state);
  brain.requestState[player] = {
    turn,
    teamPreview: Boolean(request.teamPreview),
    forceSwitch: Array.isArray(request.forceSwitch) ? request.forceSwitch.slice() : [],
    activeCount: Array.isArray(request.active) ? request.active.length : 0,
    decisionTraceCount: Array.isArray(brain.decisionTrace) ? brain.decisionTrace.length : 0,
  };

  if (request.active) {
    const active = request.active || [];
    const side = request.side || {};
    const sidePokemon = side.pokemon || [];
    const activeSlotStates = sidePokemon.filter((pokemon) => pokemon && pokemon.active === true);
    const tokens = splitChoiceTokens(choice);
    let tokenIndex = 0;
    for (let activeIndex = 0; activeIndex < active.length; activeIndex += 1) {
      const slotState = activeIndex < activeSlotStates.length ? activeSlotStates[activeIndex] : null;
      if (slotState !== null && !isActionableActiveSlot(slotState)) continue;
      const token = tokens[tokenIndex] || '';
      tokenIndex += 1;
      const switchMatch = token.match(/^switch\s+(\d+)/i);
      if (switchMatch) {
        brain.choiceMemory.push({
          signature: switchSignature(player, Number(switchMatch[1]), activeIndex),
          moveId: 'switch',
          targetSuffix: '',
          turn,
          token,
        });
        continue;
      }
      const match = token.match(/^move\s+(\d+)(.*)$/i);
      if (!match) continue;
      const moveIndex = Number(match[1]) - 1;
      const move = active[activeIndex] && active[activeIndex].moves ? active[activeIndex].moves[moveIndex] : null;
      if (!move) continue;
      const targetSuffix = String(match[2] || '').trim();
      const key = activeKeyFor(player, activeIndex);
      const entry = {
        signature: choiceSignature(player, activeIndex, move, targetSuffix),
        moveId: moveIdFor(move),
        targetSuffix,
        turn,
        token,
      };
      if (key) brain.lastChoiceBySlot[key] = entry;
      brain.choiceMemory.push(entry);
    }
  } else if (Array.isArray(request.forceSwitch) && request.forceSwitch.some(Boolean)) {
    const tokens = splitChoiceTokens(choice);
    const switchChoices = [];
    tokens.forEach((token, activeIndex) => {
      const match = token.match(/^switch\s+(\d+)/i);
      if (!match) return;
      const entry = {
        signature: switchSignature(player, Number(match[1]), activeIndex),
        moveId: 'switch',
        targetSuffix: '',
        turn,
        token,
      };
      switchChoices.push({activeIndex, activeSlot: activeSlotForIndex(activeIndex), switchSlot: Number(match[1])});
      brain.choiceMemory.push(entry);
    });
    if (switchChoices.length) {
      pushDecisionTrace(state, {
        type: 'forceSwitch',
        player: sideFromPlayer(player) || String(player || '').slice(0, 2).toLowerCase() || null,
        switchChoices,
        reasonCategories: ['showdown-forced-switch'],
      });
    }
  }
  trimBattleBrainMemory(brain, turn);
}

function processSideupdate(lines, stream, state) {
  if (!lines.length) return;
  const player = (lines[1] || '').trim();
  const bodyLines = lines.length > 2 ? lines.slice(2) : [];
  if (!player) {
    pushDebugEvent(state, 'sideupdate-missing-player');
    return;
  }
  for (const line of bodyLines) {
    if (!line.startsWith('|request|')) continue;
    const raw = line.slice('|request|'.length);
    const request = safeJsonParse(raw);
    if (!request) {
      pushDebugEvent(state, 'request-json-error');
      continue;
    }
    updateSideRosterFromRequest(state, player, request);
    const choice = buildChoiceFromRequest(request, state, player);
    if (!choice) {
      pushDebugEvent(state, `request-wait:${player}`);
      continue;
    }
    emit(stream, `>${player} ${choice}`);
    state.requestsHandled += 1;
    state.lastChoice = choice;
    rememberChoiceFromRequest(state, player, request, choice);
    pushDebugEvent(state, `choice:${player}:${choice}`);
  }
}

function processMessage(message, stream, state) {
  if (!message) return;
  if (DEBUG_CAPTURE && RECENT_MESSAGE_LIMIT > 0) pushRecent(state.recentMessages, message, RECENT_MESSAGE_LIMIT);
  const lines = String(message).split('\n');
  const header = (lines[0] || '').trim();

  if (header === 'sideupdate') {
    processSideupdate(lines, stream, state);
    return;
  }

  if (header.startsWith('sideupdate ')) {
    const player = header.split(' ', 2)[1].trim();
    const bodyLines = lines.slice(1);
    processSideupdate(['sideupdate', player, ...bodyLines], stream, state);
    return;
  }

  if (header === 'update') {
    for (const line of lines.slice(1)) {
      if (BATTLE_LOG_CAPTURE && line.startsWith('|')) state.battleLogLines.push(line);
      updateBoardStateFromLine(line, state);
      if (line.startsWith('|turn|')) {
        const value = Number(line.split('|')[2]);
        if (Number.isFinite(value)) state.turns = value;
      } else if (line.startsWith('|win|')) {
        state.winner = line.split('|')[2] || null;
        state.tie = false;
        pushDebugEvent(state, `winner:${state.winner}`);
      } else if (line === '|tie' || line.startsWith('|tie|')) {
        state.tie = true;
        pushDebugEvent(state, 'tie');
      }
    }
    return;
  }

  if (header === 'end' || header.startsWith('end ')) {
    try {
      const endJson = parseEndPayload(lines);
      if (!endJson) throw new Error('No end payload found.');
      state.end = endJson;
      if (endJson.winner) {
        state.winner = endJson.winner;
        state.tie = false;
      }
      if (Number.isInteger(endJson.turns)) state.turns = endJson.turns;
      if (state.winner !== null) state.tie = false;
      state.ended = true;
      pushDebugEvent(state, `end:${state.winner}:${state.turns}`);
    } catch (err) {
      pushDebugEvent(state, `end-parse-error:${err.message}`);
    }
  }
}

async function runBattle(request) {
  const started = Date.now();
  const timeoutMs = Math.max(Number(request.timeoutMs || request.timeout_ms || 30000), 2500);
  const stream = new BattleStream();
  let buffer = '';
  let doneResolve;
  let doneReject;
  let readerDone = false;
  const donePromise = new Promise((resolve, reject) => {
    doneResolve = resolve;
    doneReject = reject;
  });
  const state = {
    winner: null,
    turns: 0,
    tie: false,
    ended: false,
    end: null,
    requestsHandled: 0,
    lastChoice: null,
    recentMessages: [],
    debugEvents: [],
    battleLogLines: [],
    teamPreviewChoices: {},
    forcedTeamPreviewSlotsByPlayer: normalizePreviewSlotsByPlayer({
      ...(request.forcedTeamPreviewSlotsByPlayer || {}),
      ...(request.p1ForcedTeamPreviewSlots || request.p1_forced_team_preview_slots ? {p1: request.p1ForcedTeamPreviewSlots || request.p1_forced_team_preview_slots} : {}),
    }),
    allowedTeamPreviewSlotsByPlayer: normalizePreviewSlotsByPlayer({
      ...(request.allowedTeamPreviewSlotsByPlayer || {}),
      ...(request.p1AllowedTeamPreviewSlots || request.p1_allowed_team_preview_slots ? {p1: request.p1AllowedTeamPreviewSlots || request.p1_allowed_team_preview_slots} : {}),
    }),
    activeBySide: {p1: {}, p2: {}},
    battleBrain: createBattleBrainState(),
  };

  const reader = (async () => {
    try {
      for await (const chunk of stream) {
        buffer += String(chunk || '');
        if (buffer.includes('\n\n')) {
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';
          for (const part of parts) {
            const message = part.replace(/\n+$/g, '');
            if (message) processMessage(message, stream, state);
            if (state.ended) {
              doneResolve();
              return;
            }
          }
        } else if (buffer.trim()) {
          // BattleStream usually yields one complete message per chunk. Process it immediately
          // so player requests do not wait for a delimiter that may already be stripped.
          const message = buffer.replace(/\n+$/g, '');
          buffer = '';
          if (message) processMessage(message, stream, state);
          if (state.ended) {
            doneResolve();
            return;
          }
        }
      }
      readerDone = true;
      if (!state.ended && buffer.trim()) processMessage(buffer.replace(/\n+$/g, ''), stream, state);
      doneResolve();
    } catch (err) {
      doneReject(err);
    }
  })();

  emit(stream, `>start ${JSON.stringify({formatid: request.formatId || request.format_id, seed: request.seed || undefined})}`);
  emit(stream, `>player p1 ${JSON.stringify({name: request.p1Name || 'Professor Aegis User', team: request.p1Team || request.p1_team || ''})}`);
  emit(stream, `>player p2 ${JSON.stringify({name: request.p2Name || 'Benchmark Opponent', team: request.p2Team || request.p2_team || ''})}`);

  let timedOut = false;
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });

  await Promise.race([donePromise, timeoutPromise]);
  const durationMs = Date.now() - started;
  try {
    if (typeof stream.destroy === 'function') stream.destroy();
  } catch (_err) {}
  try {
    await Promise.race([reader, new Promise((resolve) => setTimeout(resolve, 25))]);
  } catch (_err) {}

  battlesRun += 1;
  return {
    ok: Boolean(state.winner !== null || state.tie),
    winner: state.winner,
    turns: state.turns,
    tie: Boolean(state.tie && state.winner === null),
    end: state.end,
    requestsHandled: state.requestsHandled,
    lastChoice: state.lastChoice,
    returnCode: null,
    durationMs,
    timeoutMs,
    timeoutSource: timedOut ? 'persistent_sim_worker_timeout' : null,
    stderr: '',
    recentMessages: DEBUG_CAPTURE ? state.recentMessages.slice(-RECENT_MESSAGE_LIMIT) : [],
    recentDebugEvents: state.debugEvents.slice(-DEBUG_EVENT_LIMIT),
    battleLogData: BATTLE_LOG_CAPTURE ? state.battleLogLines.join('\n') : '',
    battleLogCaptured: BATTLE_LOG_CAPTURE,
    battleLogLineCount: state.battleLogLines.length,
    teamPreviewChoices: state.teamPreviewChoices || {},
    forcedTeamPreviewSlots: state.forcedTeamPreviewSlotsByPlayer || {},
    forcedTeamPreviewApplied: Object.values(state.forcedTeamPreviewSlotsByPlayer || {}).some((slots) => Array.isArray(slots) && slots.length > 0),
    allowedTeamPreviewSlots: state.allowedTeamPreviewSlotsByPlayer || {},
    allowedTeamPreviewApplied: Object.values(state.allowedTeamPreviewSlotsByPlayer || {}).some((slots) => Array.isArray(slots) && slots.length > 0),
    runnerVersion: WORKER_VERSION,
    runnerPoolMode: 'persistent-sim-worker',
    policy: 'persistent BattleStream worker with V3 BattleBrain visible-state and anti-repeat memory policy',
    policyVersion: POLICY_VERSION,
    decisionTelemetryVersion: DECISION_TELEMETRY_VERSION,
    decisionTrace: decisionTraceForResponse(state),
    decisionTraceCount: decisionTraceForResponse(state).length,
    seed: request.seed || null,
    persistentWorker: {
      version: WORKER_VERSION,
      startedAt: new Date(startedAt).toISOString(),
      uptimeMs: Date.now() - startedAt,
      battlesRun,
      showdownRoot,
      readerDone,
      debugCapture: DEBUG_CAPTURE,
      battleLogCapture: BATTLE_LOG_CAPTURE,
    },
  };
}

async function handleRequest(request) {
  if (!request || typeof request !== 'object') {
    return {ok: false, error: 'invalid-request', runnerVersion: WORKER_VERSION, runnerPoolMode: 'persistent-sim-worker'};
  }
  if (request.type === 'ping') {
    return {ok: true, type: 'pong', version: WORKER_VERSION, policyVersion: POLICY_VERSION, ts: nowIso(), battlesRun, showdownRoot};
  }
  if (request.type !== 'battle') {
    return {ok: false, error: `unsupported-request-type:${request.type}`, runnerVersion: WORKER_VERSION, runnerPoolMode: 'persistent-sim-worker'};
  }
  return runBattle(request);
}

if (require.main === module) {
  const rl = readline.createInterface({input: process.stdin, crlfDelay: Infinity});
  let chain = Promise.resolve();

  rl.on('line', (line) => {
    chain = chain.then(async () => {
      const request = safeJsonParse(line);
      const requestId = request && request.requestId;
      try {
        const response = await handleRequest(request);
        response.requestId = requestId;
        response.ts = nowIso();
        process.stdout.write(`${JSON.stringify(response)}\n`);
      } catch (err) {
        process.stdout.write(`${JSON.stringify({
          ok: false,
          requestId,
          error: err && err.stack ? err.stack : String(err),
          runnerVersion: WORKER_VERSION,
          runnerPoolMode: 'persistent-sim-worker',
          ts: nowIso(),
          persistentWorkerShouldRetire: true,
        })}\n`);
      }
    });
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

module.exports = {
  buildActiveMoveChoice,
  buildTeamPreviewChoice,
  chooseTeamPreviewOrder,
  chooseDeterministicMove,
  contextTurn,
  firstSwitchableSlot,
  buildForceSwitchChoice,
  buildChoiceFromRequest,
  scoreTeamPreviewSlot,
  scoreTeamPreviewSlotTrace,
  scoreDeterministicMove,
  scoreDeterministicMoveTrace,
  targetSuffixForMove,
  targetSuffixForMoveTrace,
  preferredFoeTargetSuffix,
  preferredFoeTargetSuffixTrace,
  chooseTeamPreviewOrderTrace,
  chooseDeterministicMoveTrace,
  decisionTraceForResponse,
  updateBoardStateFromLine,
  createBattleBrainState,
  ensureBattleBrainState,
  rememberChoiceFromRequest,
};
