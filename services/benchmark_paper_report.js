'use strict';

const fs = require('fs');

const {
  loadPokemonIconManifest,
  resolvePokemonIconForDisplayName,
} = require('./pokemon_icon_catalog');

const DEFAULT_SERVER_NAME = 'Professor Aegis';
const DEFAULT_TRAINER_NAME = 'Trainer';
const DEFAULT_FORMAT = 'Unknown format';
const DEFAULT_FILENAME = 'BattleSimulationPaperReport';
const pokemonIconDataUriCache = new Map();
let cachedPokemonMentionNames = null;

function cleanText(value, fallback = '') {
  const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return text || fallback;
}

function plainLine(value, fallback = 'Unavailable') {
  return cleanText(value, fallback).replace(/\s+/g, ' ');
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(value = '') {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pokemonIconDataUri(icon) {
  if (!icon || !icon.absolutePath) return '';
  if (pokemonIconDataUriCache.has(icon.absolutePath)) return pokemonIconDataUriCache.get(icon.absolutePath);

  try {
    const buffer = fs.readFileSync(icon.absolutePath);
    const dataUri = `data:image/png;base64,${buffer.toString('base64')}`;
    pokemonIconDataUriCache.set(icon.absolutePath, dataUri);
    return dataUri;
  } catch (error) {
    pokemonIconDataUriCache.set(icon.absolutePath, '');
    return '';
  }
}

function resolvePaperPokemonIcon(name) {
  const cleanName = plainLine(name, '');
  if (!cleanName) return null;
  return resolvePokemonIconForDisplayName(cleanName);
}

function renderPokemonNameToken(name) {
  const cleanName = plainLine(name, '');
  if (!cleanName) return '';
  const icon = resolvePaperPokemonIcon(cleanName);
  const dataUri = pokemonIconDataUri(icon);
  const image = dataUri
    ? `<img class="pokemon-icon" src="${escapeHtml(dataUri)}" alt="" aria-hidden="true">`
    : '';
  return `<span class="pokemon-token">${image}<span>${escapeHtml(cleanName)}</span></span>`;
}

function renderPokemonNameGroup(names = [], fallback = '', separator = '+') {
  const safeNames = (Array.isArray(names) ? names : [])
    .map((name) => plainLine(name, ''))
    .filter(Boolean);
  if (!safeNames.length) return escapeHtml(plainLine(fallback, 'Unavailable'));

  return safeNames
    .map((name) => renderPokemonNameToken(name))
    .filter(Boolean)
    .join(`<span class="pokemon-separator">${escapeHtml(separator)}</span>`);
}

function pokemonMentionNames() {
  if (cachedPokemonMentionNames) return cachedPokemonMentionNames;

  const manifest = loadPokemonIconManifest();
  const values = [];
  (Array.isArray(manifest.entries) ? manifest.entries : []).forEach((entry) => {
    const displayName = plainLine(entry.displayName || '', '');
    if (displayName) values.push(displayName);
    if (displayName.includes('-')) values.push(displayName.replace(/-/g, ' '));
  });

  cachedPokemonMentionNames = Array.from(new Set(values))
    .filter((name) => name.length >= 3 && resolvePaperPokemonIcon(name))
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  return cachedPokemonMentionNames;
}

function renderPokemonMentionsInText(value = '') {
  const text = plainLine(value, '');
  if (!text) return '';

  const names = pokemonMentionNames();
  const matched = names.filter((name) => {
    const pattern = new RegExp(`(^|[^A-Za-z0-9-])(${escapeRegex(name)})(?![A-Za-z0-9-])`, 'i');
    return pattern.test(text);
  });
  if (!matched.length) return escapeHtml(text);

  const alternates = matched.map(escapeRegex).join('|');
  const pattern = new RegExp(`(^|[^A-Za-z0-9-])(${alternates})(?![A-Za-z0-9-])`, 'gi');
  let lastIndex = 0;
  const parts = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const prefix = match[1] || '';
    const name = match[2] || '';
    const nameStart = match.index + prefix.length;
    parts.push(escapeHtml(text.slice(lastIndex, nameStart)));
    parts.push(renderPokemonNameToken(name));
    lastIndex = nameStart + name.length;
  }
  parts.push(escapeHtml(text.slice(lastIndex)));

  return parts.join('');
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integerValue(value, fallback = 0) {
  return Math.round(numberValue(value, fallback));
}

function percentValue(value, fallback = 0) {
  return Math.max(0, Math.min(100, Math.round(numberValue(value, fallback))));
}

function formatPercent(value, fallback = 0) {
  return `${percentValue(value, fallback)}%`;
}

function formatNumber(value, fallback = 0) {
  return integerValue(value, fallback).toLocaleString('en-US');
}

function formatTurns(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(1) : 'Unavailable';
}

function formatGenerated(value) {
  const raw = cleanText(value);
  if (!raw) return 'Unavailable';
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleString('en-US', { timeZone: 'UTC' });
  }
  return raw;
}

function titleCase(value = '') {
  return plainLine(value, 'Unknown')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeArchetypeLabel(value = '') {
  return plainLine(value, '').replace(/[-_]+/g, ' ').trim();
}

function isForbiddenPaperArchetypeLabel(value = '') {
  const normalized = normalizeArchetypeLabel(value).toLowerCase().replace(/[+:/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return true;

  const exactForbidden = new Set([
    'all meta',
    'all meta all tournament',
    'classified matchup',
    'full meta 100 random',
    'gauntlet full meta 200 random',
    'generated',
    'generated random',
    'goodstuffs',
    'matchup',
    'matchup profile',
    's tier top tournament',
    's a tier top 4 tournament',
    'top tournament',
    'tournament',
    'unknown',
    'unknown matchup',
  ]);

  if (exactForbidden.has(normalized)) return true;
  if (/\btournament\b/.test(normalized)) return true;
  if (/\bunknown\b/.test(normalized)) return true;
  if (/\bgenerated\s+random\b/.test(normalized)) return true;
  if (/\ball\s+meta\b/.test(normalized)) return true;
  if (/\bfull\s+meta\b/.test(normalized)) return true;
  return false;
}

function paperArchetypeLabelCandidate(value = '') {
  const label = normalizeArchetypeLabel(value);
  if (!label || isForbiddenPaperArchetypeLabel(label)) return '';
  return titleCase(label);
}

function metadataArchetypeLabel(row = {}) {
  const metadataCandidates = [
    row.archetypeMetadata,
    row.opponentArchetypeMetadata,
    row.matchupArchetypeMetadata,
    row.templateArchetypeMetadata,
    row.metadata?.archetypeMetadata,
    row.metadata?.opponentArchetypeMetadata,
  ].filter((metadata) => metadata && typeof metadata === 'object');

  const orderedValues = [
    row.finalArchetypeLabel,
    ...metadataCandidates.flatMap((metadata) => [
      metadata.displayLabel,
      metadata.primaryLabel,
      metadata.compactHybridLabel,
      metadata.hybridLabel,
      metadata.compactLabel,
      metadata.styleLabel,
    ]),
  ];

  for (const value of orderedValues) {
    const label = paperArchetypeLabelCandidate(value);
    if (label) return label;
  }

  return '';
}

function paperArchetypeLabel(row = {}, fallback = 'Classified Matchup') {
  const canonical = metadataArchetypeLabel(row);
  if (canonical) return canonical;

  const existingValues = [
    row.canonicalArchetypeLabel,
    row.displayLabel,
    row.classificationLabel,
    row.matchupLabel,
    row.archetypeLabel,
    row.primaryArchetypeLabel,
    row.primaryArchetype,
    row.dominantArchetype,
    row.templateLabel,
    row.templateName,
    row.templateKey,
    row.name,
    row.opponentName,
    row.opponentId,
  ];

  for (const value of existingValues) {
    const label = paperArchetypeLabelCandidate(value);
    if (label) return label;
  }

  return fallback;
}

function matchupName(row = {}) {
  return paperArchetypeLabel(row);
}

function rowGames(row = {}) {
  const wins = integerValue(row.wins, 0);
  const losses = integerValue(row.losses, 0);
  const ties = integerValue(row.ties, 0);
  const explicit = row.gamesPlayed ?? row.gamesCompleted ?? row.totalGamesCompleted ?? row.games;
  return integerValue(explicit, wins + losses + ties);
}

function rowWinRate(row = {}) {
  const explicit = row.winRate ?? row.winChance ?? row.displayRate;
  if (explicit !== undefined && explicit !== null && explicit !== '') return percentValue(explicit, 0);
  const games = rowGames(row);
  return games > 0 ? percentValue((integerValue(row.wins, 0) / games) * 100, 0) : 0;
}

function recordLine(row = {}) {
  return `${integerValue(row.wins, 0)}-${integerValue(row.losses, 0)}-${integerValue(row.ties, 0)}`;
}

function confidenceLabel(row = {}) {
  return titleCase(row.confidence || row.confidenceLabel || row.confidenceLevel || '');
}

function sortByName(a = {}, b = {}) {
  return matchupName(a).localeCompare(matchupName(b));
}

function normalizeRows(value = []) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === 'object') : [];
}

function sourceTemplateRows(report = {}) {
  const summary = report.compactSummary || {};
  const candidates = [
    summary.templateBreakdown,
    report.resultsByTemplate,
    report.templates,
    report.pdf?.fullTemplateRows,
  ].find((rows) => Array.isArray(rows) && rows.length);
  return normalizeRows(candidates || []);
}

function sourceOpponentRows(report = {}) {
  return normalizeRows(
    report.resultsByOpponent
      || report.opponents
      || report.pdf?.fullOpponentRows
      || [],
  );
}

function bucketTemplateRows(rows = []) {
  const sorted = normalizeRows(rows).map((row) => ({
    ...row,
    name: matchupName(row),
    gamesPlayed: rowGames(row),
    displayWinRate: rowWinRate(row),
  }));
  const good = sorted
    .filter((row) => row.displayWinRate >= 60 || String(row.bucket || '').toLowerCase() === 'good')
    .sort((a, b) => b.displayWinRate - a.displayWinRate || b.gamesPlayed - a.gamesPlayed || sortByName(a, b));
  const danger = sorted
    .filter((row) => row.displayWinRate < 45 || String(row.bucket || '').toLowerCase() === 'danger')
    .sort((a, b) => a.displayWinRate - b.displayWinRate || b.gamesPlayed - a.gamesPlayed || sortByName(a, b));
  const used = new Set([...good, ...danger]);
  const neutral = sorted
    .filter((row) => !used.has(row))
    .sort((a, b) => a.displayWinRate - b.displayWinRate || b.gamesPlayed - a.gamesPlayed || sortByName(a, b));
  return { good, danger, neutral };
}

function formatMatchupRow(row = {}) {
  const confidence = confidenceLabel(row);
  return [
    matchupName(row),
    `${formatPercent(row.displayWinRate ?? rowWinRate(row))} WR`,
    `${recordLine(row)} record`,
    `${formatNumber(row.gamesPlayed ?? rowGames(row))} games`,
    confidence ? `${confidence} confidence` : null,
  ].filter(Boolean).join(' - ');
}

function normalizeMatchupGuideRows(rows = []) {
  return normalizeRows(rows)
    .map((row) => {
      const archetypeMetadata = row.archetypeMetadata && typeof row.archetypeMetadata === 'object'
        ? { ...row.archetypeMetadata }
        : {};
      const wins = integerValue(row.wins, 0);
      const losses = integerValue(row.losses, 0);
      const ties = integerValue(row.ties, 0);
      const gamesPlayed = integerValue(row.gamesPlayed, wins + losses + ties);
      const winRate = row.winRate ?? (gamesPlayed ? (wins / gamesPlayed) * 100 : null);
      const recommendation = plainLine(row.recommendation || 'neutral', 'neutral').toLowerCase();
      return {
        archetypeKey: plainLine(row.archetypeKey || row.templateKey || row.key || ''),
        archetypeLabel: paperArchetypeLabel(row, ''),
        wins,
        losses,
        ties,
        gamesPlayed,
        winRate,
        confidence: confidenceLabel(row),
        recommendation: ['use', 'avoid', 'neutral'].includes(recommendation) ? recommendation : 'neutral',
        archetypeMetadata,
        glossaryEntry: plainLine(row.glossaryEntry || archetypeMetadata.glossaryEntry || '', ''),
        respectHint: plainLine(row.respectHint || archetypeMetadata.respectHint || '', ''),
        approachHint: plainLine(row.approachHint || archetypeMetadata.approachHint || '', ''),
        signaturePlan: plainLine(row.signaturePlan || archetypeMetadata.signaturePlan || '', ''),
        explanationSource: plainLine(row.explanationSource || archetypeMetadata.explanationSource || '', ''),
      };
    })
    .filter((row) => row.archetypeLabel && !isForbiddenPaperArchetypeLabel(row.archetypeLabel) && row.gamesPlayed > 0);
}

function guideConfidenceWeight(row = {}) {
  const label = plainLine(row.confidence, '').toLowerCase();
  if (label === 'high') return 3;
  if (label === 'medium') return 2;
  if (label === 'low') return 1;
  return 0;
}

function sortGuideRows(rows = [], recommendation = 'use') {
  const wanted = plainLine(recommendation, 'use').toLowerCase();
  return normalizeMatchupGuideRows(rows)
    .filter((row) => row.recommendation === wanted)
    .sort((a, b) => {
      const confidenceDiff = guideConfidenceWeight(b) - guideConfidenceWeight(a);
      if (confidenceDiff) return confidenceDiff;
      const aRate = numberValue(a.winRate, wanted === 'avoid' ? 100 : 0);
      const bRate = numberValue(b.winRate, wanted === 'avoid' ? 100 : 0);
      const rateDiff = wanted === 'avoid' ? aRate - bRate : bRate - aRate;
      if (rateDiff) return rateDiff;
      return b.gamesPlayed - a.gamesPlayed || a.archetypeLabel.localeCompare(b.archetypeLabel);
    });
}

function formatGuideRecord(row = {}) {
  return `${formatNumber(row.wins)}-${formatNumber(row.losses)}${row.ties ? `-${formatNumber(row.ties)}` : ''}`;
}

function formatGuideLine(row = {}) {
  const confidence = row.confidence ? `${row.confidence} Confidence` : 'Confidence unavailable';
  return `${row.archetypeLabel}: ${formatGuideRecord(row)}, ${formatPercent(row.winRate)}, ${confidence}`;
}

function compactGuideSentence(...parts) {
  return parts
    .map((part) => plainLine(part, ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function guideLabelExplanation(label = '') {
  const normalized = plainLine(label, '').toLowerCase();
  if (!normalized) return '';

  if (normalized.includes('trick room')) {
    if (normalized.includes('hard')) {
      return 'A committed Trick Room team built to reverse speed control and let slower attackers move first.';
    }
    if (normalized.includes('balance')) {
      return 'A balanced team that can switch into Trick Room mode so slower attackers move first.';
    }
    return 'A Trick Room team that reverses speed control and lets slower attackers move first.';
  }

  if (normalized.includes('rain')) {
    return normalized.includes('balance')
      ? 'A balanced rain shell that uses rain turns for Water pressure while staying flexible.'
      : 'A rain team that tries to turn weather control into immediate Water pressure.';
  }

  if (normalized.includes('sun')) {
    return normalized.includes('bulky')
      ? 'A bulky sun shell that uses sun turns for Fire pressure while playing longer positioning games.'
      : 'A sun team that turns weather control into faster Fire pressure and stronger positioning.';
  }

  if (normalized.includes('sand')) {
    return 'A sand team that uses weather chip, Rock pressure, and positioning to wear teams down.';
  }

  if (normalized.includes('snow')) {
    return 'A snow team that uses weather defense and Ice pressure to control trades.';
  }

  if (normalized.includes('aurora veil') || normalized.includes('screens')) {
    return 'A screen-based team that uses early protection to make its sweepers harder to stop.';
  }

  if (normalized.includes('beat up')) {
    return 'A setup team that uses Beat Up turns to unlock a powerful attacker quickly.';
  }

  if (normalized.includes('redirection')) {
    return 'A positioning team that uses redirection to protect setup, weather, or damage turns.';
  }

  if (normalized.includes('hyper offense')) {
    return 'A fast-pressure team that tries to take early knockouts before you stabilize.';
  }

  if (normalized.includes('bulky offense')) {
    return 'A sturdy offense team that mixes pressure with enough bulk to survive trades.';
  }

  if (normalized.includes('balance')) {
    return 'A flexible team that shifts between offense, defense, and positioning based on preview.';
  }

  return '';
}

function guidePressurePhrase(label = '', metadataHint = '') {
  const normalized = plainLine(label, '').toLowerCase();
  const hint = plainLine(metadataHint, '').replace(/^Respect\s+/i, '').replace(/\.$/, '');

  if (normalized.includes('trick room')) return 'setup turns and slow attackers';
  if (normalized.includes('rain')) return 'rain turns and Water pressure';
  if (normalized.includes('sun')) return 'sun turns and Fire pressure';
  if (normalized.includes('sand')) return 'sand chip and Rock pressure';
  if (normalized.includes('snow')) return 'snow defense and Ice pressure';
  if (normalized.includes('aurora veil') || normalized.includes('screens')) return 'screen turns and protected sweepers';
  if (normalized.includes('beat up')) return 'Beat Up setup turns';
  if (normalized.includes('redirection')) return 'redirection and protected setup turns';
  if (normalized.includes('hyper offense')) return 'early knockout pressure';
  if (normalized.includes('bulky offense')) return 'durable damage trades';
  if (normalized.includes('balance')) return 'flexible positioning';
  return hint || 'the matchup pressure';
}

function guideExplanationLine(row = {}, kind = 'lead', recommendation = 'use') {
  const label = plainLine(row.archetypeLabel, 'this archetype');
  const glossary = plainLine(row.glossaryEntry || row.archetypeMetadata?.glossaryEntry || '', '');
  const respect = plainLine(row.respectHint || row.archetypeMetadata?.respectHint || '', '');
  const approach = plainLine(row.approachHint || row.archetypeMetadata?.approachHint || '', '');
  const fallbackShell = `${label} teams use a recognizable game plan that should shape your preview choice.`;
  const base = guideLabelExplanation(label) || glossary || fallbackShell;
  const pressure = guidePressurePhrase(label, recommendation === 'avoid' ? approach : respect);
  if (recommendation === 'avoid') {
    return compactGuideSentence(
      base,
      `This ${kind} struggled here; choose a safer line that can disrupt ${pressure}.`,
    );
  }
  return compactGuideSentence(
    base,
    `Use this ${kind} when your preview plan can control ${pressure}.`,
  );
}

function buildGuideEntries(rows = [], kind = 'lead', limit = Infinity) {
  return (Array.isArray(rows) ? rows : []).slice(0, limit).map((row, index) => {
    const strongRows = sortGuideRows(row.matchupGuide, 'use');
    const avoidRows = sortGuideRows(row.matchupGuide, 'avoid');
    return {
      ...row,
      guideRank: row.rank || index + 1,
      guideKind: kind,
      strongRows,
      avoidRows,
    };
  });
}

function splitPokemonNameLabel(label = '', separatorPattern = /\s+\+\s+/) {
  return plainLine(label, '')
    .split(separatorPattern)
    .map((name) => plainLine(name, ''))
    .filter(Boolean);
}

function normalizeLeadRows(report = {}) {
  const summary = report.compactSummary || {};
  const candidates = Array.isArray(summary.bestLeadPairs) ? summary.bestLeadPairs : [];

  return (Array.isArray(candidates) ? candidates : [])
    .map((item) => {
      if (typeof item === 'string') {
        return {
          label: item,
          pokemonNames: splitPokemonNameLabel(item),
          winRate: null,
          why: '',
        };
      }
      const pair = Array.isArray(item?.pair) ? item.pair : Array.isArray(item?.pokemon) ? item.pokemon : [];
      const pairNames = pair
        .map((pokemon) => (typeof pokemon === 'string' ? pokemon : pokemon?.name || pokemon?.species || pokemon?.pokemon))
        .filter(Boolean)
        .map((pokemon) => plainLine(pokemon, ''));
      const pairLabel = pairNames.join(' + ');
      const label = plainLine(item?.label || item?.name || item?.pairName || pairLabel, 'Lead data unavailable');
      return {
        rank: integerValue(item?.rank, 0),
        label,
        pokemonNames: pairNames.length ? pairNames : splitPokemonNameLabel(label),
        winRate: item?.winRate ?? item?.successRate ?? item?.percent ?? null,
        gamesPlayed: integerValue(item?.gamesPlayed ?? item?.gamesCompleted ?? item?.gamesAttempted ?? item?.games, 0),
        wins: integerValue(item?.wins, 0),
        losses: integerValue(item?.losses, 0),
        ties: integerValue(item?.ties, 0),
        confidence: plainLine(item?.confidence || item?.confidenceLabel || ''),
        runtimeMs: integerValue(item?.runtimeMs, 0),
        why: plainLine(item?.why || item?.summary || item?.note || ''),
        matchupGuide: normalizeMatchupGuideRows(item?.matchupGuide),
      };
    })
    .filter((row) => row.label && row.label.toLowerCase() !== 'lead data unavailable')
    .sort((a, b) => (
      (a.rank || 999) - (b.rank || 999)
      || numberValue(b.winRate, -1) - numberValue(a.winRate, -1)
      || b.gamesPlayed - a.gamesPlayed
      || a.label.localeCompare(b.label)
    ))
    .slice(0, 10);
}

function corePokemonName(item = {}) {
  if (typeof item === 'string') return plainLine(item, 'Unknown Pokemon');
  if (!item || typeof item !== 'object') return 'Unknown Pokemon';
  return plainLine(item.name || item.species || item.pokemon || item.pokemonName || item.label, 'Unknown Pokemon');
}

function truncateCoreName(value = '', limit = 24) {
  const text = plainLine(value, 'Unknown Pokemon');
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  return `${chars.slice(0, Math.max(4, limit - 3)).join('')}...`;
}

function coreLabel(core = [], options = {}) {
  const limit = integerValue(options.nameLimit, 24);
  const names = (Array.isArray(core) ? core : [])
    .map((pokemon) => truncateCoreName(corePokemonName(pokemon), limit))
    .filter(Boolean)
    .slice(0, 4);
  return names.length >= 4 ? names.join(' / ') : '';
}

function coreRecord(row = {}) {
  const wins = integerValue(row.wins, 0);
  const losses = integerValue(row.losses, 0);
  const ties = integerValue(row.ties, 0);
  return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function normalizeCoreRows(report = {}) {
  const summary = report.compactSummary || {};
  const candidates = Array.isArray(summary.bestCores) ? summary.bestCores : [];

  return candidates
    .filter((item) => item && typeof item === 'object' && item.coreMatched === true)
    .map((item, index) => {
      const core = [
        item.core,
        item.actualSelectedCore,
        item.plannedCore,
        item.members,
        item.pokemon,
      ].find((value) => Array.isArray(value) && value.length >= 4) || [];
      const pokemonNames = core
        .map((pokemon) => corePokemonName(pokemon))
        .filter(Boolean)
        .slice(0, 4);
      const label = coreLabel(core);
      const rank = integerValue(item.coreRank ?? item.rank, index + 1);
      const wins = integerValue(item.wins, 0);
      const losses = integerValue(item.losses, 0);
      const ties = integerValue(item.ties, 0);
      const gamesPlayed = integerValue(item.gamesPlayed ?? item.gamesCompleted ?? item.gamesAttempted ?? item.games, wins + losses + ties);
      const winRate = item.winRate ?? (gamesPlayed ? (wins / gamesPlayed) * 100 : null);
      return {
        sourceIndex: index,
        rank,
        label,
        fullLabel: coreLabel(core, { nameLimit: 36 }),
        pokemonNames: pokemonNames.length >= 4 ? pokemonNames : splitPokemonNameLabel(label, /\s*\/\s*/),
        winRate,
        gamesPlayed,
        wins,
        losses,
        ties,
        record: plainLine(item.record || coreRecord({ wins, losses, ties }), coreRecord({ wins, losses, ties })),
        note: plainLine(item.why || item.note || item.summary || '', rank === 1 ? 'Best validated 4-Pokemon core.' : 'Strong secondary core.'),
        matchupGuide: normalizeMatchupGuideRows(item.matchupGuide),
      };
    })
    .filter((row) => row.label && row.gamesPlayed > 0)
    .sort((a, b) => (
      (a.rank || 999) - (b.rank || 999)
      || a.sourceIndex - b.sourceIndex
    ))
    .slice(0, 5);
}

function normalizeThreatRows(report = {}, dangerRows = []) {
  const summary = report.compactSummary || {};
  const candidates = [
    summary.topThreats,
    summary.pokemonThreats,
    summary.threats,
    report.topThreats,
    report.pokemonThreats,
    report.threats,
  ].find((items) => Array.isArray(items) && items.length);
  const hasExplicitThreats = Array.isArray(candidates) && candidates.length > 0;

  return normalizeRows(candidates || dangerRows)
    .map((row) => ({
      ...row,
      name: plainLine(row.pokemon || row.species || row.pokemonName || matchupName(row), 'Unknown threat'),
      lossRate: row.lossRate ?? row.lossChance ?? (100 - rowWinRate(row)),
      gamesPlayed: rowGames(row),
      sourceKind: hasExplicitThreats ? 'pokemon-threat' : 'archetype-signal',
    }))
    .sort((a, b) => percentValue(b.lossRate, 0) - percentValue(a.lossRate, 0) || b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function normalizeTeamCandidateLines(value) {
  if (value === null || value === undefined) return [];

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return cleanText(value)
      .split('\n')
      .map((line) => plainLine(line, ''))
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeTeamCandidateLines(item));
  }

  if (typeof value !== 'object') return [];

  const pokemonName = plainLine(
    value.species || value.pokemonName || value.pokemon || value.name || value.displayName,
    '',
  );
  const itemName = plainLine(value.item || value.heldItem || value.itemName, '');
  if (pokemonName && itemName) return [`${pokemonName} @ ${itemName}`];
  if (pokemonName && !Array.isArray(value.pokemon)) return [pokemonName];

  const directLines = [
    value.lines,
    value.details,
    value.members,
    Array.isArray(value.pokemon) ? value.pokemon : null,
    value.team,
    value.teamPreview,
  ];
  for (const candidate of directLines) {
    const lines = normalizeTeamCandidateLines(candidate);
    if (lines.length) return lines;
  }

  const textFields = [
    value.teamExport,
    value.userTeamExport,
    value.playerTeamExport,
    value.team_export,
    value.text,
    value.value,
    value.label,
    value.preview,
    value.summary,
  ];
  for (const candidate of textFields) {
    const lines = normalizeTeamCandidateLines(candidate);
    if (lines.length) return lines;
  }

  const titleLines = normalizeTeamCandidateLines(value.title);
  const detailLines = normalizeTeamCandidateLines(value.subtitle || value.description);
  return [...titleLines, ...detailLines];
}

function normalizeTeamLines(report = {}) {
  const request = report.request && typeof report.request === 'object' ? report.request : {};
  const identity = report.identity && typeof report.identity === 'object' ? report.identity : {};
  const summary = report.compactSummary && typeof report.compactSummary === 'object' ? report.compactSummary : {};
  const candidates = [
    report.teamExport,
    report.userTeamExport,
    report.playerTeamExport,
    report.team_export,
    request.teamExport,
    request.team_export,
    report.teamPreview,
    identity.teamPreview,
    request.teamPreview,
    summary.teamPreview,
    report.teamSummary,
  ];
  for (const candidate of candidates) {
    const lines = normalizeTeamCandidateLines(candidate)
      .filter((line) => line && line !== '[object Object]');
    if (lines.length) return lines.slice(0, 48);
  }
  return [];
}

function teamPreviewModel(lines = [], fallbackName = DEFAULT_TRAINER_NAME) {
  const normalized = (Array.isArray(lines) ? lines : []).map((line) => plainLine(line)).filter(Boolean);
  if (!normalized.length) {
    return {
      title: plainLine(fallbackName, DEFAULT_TRAINER_NAME),
      details: ['Team preview unavailable in this saved report.'],
    };
  }

  const pokemonRows = normalized
    .filter((line) => line.includes('@'))
    .map((line) => {
      const [pokemon, item] = line.split('@');
      return {
        pokemon: plainLine(pokemon, 'Unknown Pokemon'),
        item: plainLine(item, 'Item unknown'),
      };
    });

  if (pokemonRows.length) {
    return {
      title: pokemonRows.map((row) => row.pokemon).join(' / '),
      details: pokemonRows.map((row) => `${row.pokemon} - ${row.item}`),
    };
  }

  return {
    title: normalized[0],
    details: normalized.slice(1, 6),
  };
}

function dominantVerdict(winRate = 0) {
  const rate = percentValue(winRate, 0);
  if (rate >= 75) return 'Dominant';
  if (rate >= 60) return 'Favored';
  if (rate >= 45) return 'Playable';
  return 'Danger';
}

function tierForWinRate(winRate = 0) {
  const rate = percentValue(winRate, 0);
  if (rate >= 85) return 'S';
  if (rate >= 75) return 'A';
  if (rate >= 65) return 'B';
  if (rate >= 50) return 'C';
  return 'D';
}

function tierClass(tier = '') {
  const normalized = plainLine(tier, 'C').toLowerCase();
  return ['s', 'a', 'b', 'c', 'd'].includes(normalized) ? `tier-${normalized}` : 'tier-c';
}

function rateClass(value = 0) {
  const rate = percentValue(value, 0);
  if (rate >= 85) return 'rate-elite';
  if (rate >= 70) return 'rate-good';
  if (rate >= 55) return 'rate-mid';
  if (rate >= 40) return 'rate-warning';
  return 'rate-danger';
}

function verdictClass(value = '') {
  const normalized = plainLine(value, '').toLowerCase();
  if (normalized.includes('critical')) return 'label-critical';
  if (normalized.includes('high')) return 'label-high';
  if (normalized.includes('moderate')) return 'label-moderate';
  if (normalized.includes('dominant')) return 'label-dominant';
  if (normalized.includes('favored')) return 'label-favored';
  if (normalized.includes('playable')) return 'label-playable';
  if (normalized.includes('danger')) return 'label-danger';
  return 'label-neutral';
}

function appendSection(sections, title, lines = [], fallback = 'Data unavailable.') {
  const body = (Array.isArray(lines) ? lines : []).filter(Boolean);
  sections.push({ title, lines: body.length ? body : [fallback] });
}

function buildBenchmarkPaperReportModel(report = {}, options = {}) {
  const safe = report || {};
  const summary = safe.compactSummary || safe.summary || {};
  const templateRows = sourceTemplateRows(safe);
  const opponentRows = sourceOpponentRows(safe);
  const buckets = bucketTemplateRows(templateRows);
  const leadRows = normalizeLeadRows(safe);
  const coreRows = normalizeCoreRows(safe);
  const leadGuideRows = buildGuideEntries(leadRows, 'lead');
  const coreGuideRows = buildGuideEntries(coreRows, 'core', 5);
  const threatRows = normalizeThreatRows(safe, buckets.danger);
  const opponentBreakdownRows = sourceOpponentRows(safe);
  const wins = integerValue(safe.wins ?? summary.wins ?? safe.summary?.record?.wins, 0);
  const losses = integerValue(safe.losses ?? summary.losses ?? safe.summary?.record?.losses, 0);
  const ties = integerValue(safe.ties ?? summary.ties ?? safe.summary?.record?.ties, 0);
  const winRate = percentValue(safe.winRate ?? summary.winRate, wins + losses + ties ? (wins / (wins + losses + ties)) * 100 : 0);
  const serverName = plainLine(options.serverName || safe.guildName || safe.serverName || safe.identity?.guildName, DEFAULT_SERVER_NAME);
  const trainerName = plainLine(options.trainerName || safe.trainerName || safe.username || safe.identity?.username, DEFAULT_TRAINER_NAME);
  const formatId = plainLine(safe.formatId || summary.formatId || safe.identity?.formatId || safe.simulation?.formatId, DEFAULT_FORMAT);
  const generatedAt = formatGenerated(safe.generatedAt || summary.generatedAt || safe.updatedAt || new Date().toISOString());
  const confidence = plainLine(safe.confidence?.label || safe.validation?.confidence?.label || summary.confidenceLabel || '', 'Unavailable');
  const totalGames = integerValue(summary.totalGamesCompleted ?? safe.totalGamesCompleted ?? safe.summary?.battleCounts?.totalGamesCompleted, wins + losses + ties);
  const modeText = plainLine(summary.benchmarkModeLabel || safe.benchmarkMode || safe.identity?.request?.mode, 'Unavailable');
  const opponentCount = integerValue(safe.opponentsCompleted ?? summary.opponentsCompleted ?? safe.summary?.battleCounts?.opponentsCompleted, 0);
  const poolLabel = plainLine(summary.opponentPoolLabel || modeText, modeText);
  const poolCount = integerValue(summary.opponentPoolCount, 0);
  const teamLines = normalizeTeamLines(safe);
  const teamPreview = teamPreviewModel(teamLines, trainerName);
  const bestLead = leadRows[0];
  const worstThreat = threatRows[0];
  const bestMatchup = buckets.good[0];
  const worstMatchup = buckets.danger[0];
  const tier = tierForWinRate(winRate);
  const deterministicAnalysis = summary.deterministicAnalysis && typeof summary.deterministicAnalysis === 'object'
    ? summary.deterministicAnalysis
    : {};
  const analyzerStrategyTips = Array.isArray(deterministicAnalysis.strategyTips)
    ? deterministicAnalysis.strategyTips.filter(Boolean)
    : [];
  const analyzerWeaknesses = Array.isArray(deterministicAnalysis.weaknesses)
    ? deterministicAnalysis.weaknesses.filter(Boolean)
    : [];
  const analyzerProposals = Array.isArray(deterministicAnalysis.improvementProposals)
    ? deterministicAnalysis.improvementProposals.filter(Boolean)
    : [];
  const archetypeRows = [...buckets.good, ...buckets.neutral, ...buckets.danger]
    .sort((a, b) => b.displayWinRate - a.displayWinRate || b.gamesPlayed - a.gamesPlayed || sortByName(a, b))
    .slice(0, 8);
  const fullBreakdownRows = (opponentBreakdownRows.length ? opponentBreakdownRows : [...buckets.danger, ...buckets.neutral, ...buckets.good])
    .map((row) => ({
      ...row,
      name: matchupName(row),
      displayWinRate: rowWinRate(row),
      gamesPlayed: rowGames(row),
    }))
    .sort((a, b) => b.displayWinRate - a.displayWinRate || b.gamesPlayed - a.gamesPlayed || sortByName(a, b))
    .slice(0, 18);

  const sections = [];
  appendSection(sections, '1. Executive Summary', [
    plainLine(summary.takeaway || safe.quickRead || safe.summary?.quickRead, 'No executive summary is available yet.'),
    `Across ${formatNumber(totalGames)} saved simulations, this team posted ${wins}W-${losses}L-${ties}T for ${formatPercent(winRate)} WR and ${formatTurns(safe.averageTurns ?? summary.averageTurns)} average turns.`,
    opponentCount ? `Opponent pool: ${poolLabel}${poolCount ? ` (${formatNumber(opponentCount)} tested from ${formatNumber(poolCount)} available)` : ` (${formatNumber(opponentCount)} tested)`}.` : null,
    bestMatchup ? `Best matchup: ${matchupName(bestMatchup)} at ${formatPercent(bestMatchup.displayWinRate)} WR.` : null,
    worstMatchup ? `Primary danger: ${matchupName(worstMatchup)} at ${formatPercent(worstMatchup.displayWinRate)} WR.` : null,
  ]);
  appendSection(sections, '2. Lead Selection Guide', leadRows.map((row, index) => {
    const rate = row.winRate === null || row.winRate === undefined ? 'WR unavailable' : `${formatPercent(row.winRate)} WR`;
    return [`#${row.rank || index + 1}`, row.label, rate, `${row.wins}-${row.losses}`, `${formatNumber(row.gamesPlayed)} games`, row.confidence ? `${row.confidence} confidence` : null].filter(Boolean).join(' - ');
  }), 'Lead pair data is not ready in this saved report yet.');
  appendSection(sections, '3. Core Performance Study', coreRows.map((row, index) => {
    const rate = row.winRate === null || row.winRate === undefined ? 'WR unavailable' : `${formatPercent(row.winRate)} WR`;
    return [`#${row.rank || index + 1}`, row.fullLabel || row.label, rate, row.record, row.note].filter(Boolean).join(' - ');
  }), 'Core Sweep data is not ready in this saved report yet.');
  appendSection(sections, '4. Lead & Core Matchup Guide', [
    ...leadGuideRows.flatMap((row) => {
      const lines = [`Best Lead #${row.guideRank}: ${row.label}`];
      if (row.strongRows.length) {
        lines.push('Strong Into');
        row.strongRows.forEach((guideRow) => {
          lines.push(`${formatGuideLine(guideRow)}. ${guideExplanationLine(guideRow, 'lead', 'use')}`);
        });
      }
      if (row.avoidRows.length) {
        lines.push('Avoid Into');
        row.avoidRows.forEach((guideRow) => {
          lines.push(`${formatGuideLine(guideRow)}. ${guideExplanationLine(guideRow, 'lead', 'avoid')}`);
        });
      }
      if (!row.strongRows.length && !row.avoidRows.length) {
        lines.push('Matchup guide data is not ready for this lead yet.');
      }
      return lines;
    }),
    ...coreGuideRows.flatMap((row) => {
      const lines = [`Best Core #${row.guideRank}: ${row.fullLabel || row.label}`];
      if (row.strongRows.length) {
        lines.push('Strong Into');
        row.strongRows.forEach((guideRow) => {
          lines.push(`${formatGuideLine(guideRow)}. ${guideExplanationLine(guideRow, 'core', 'use')}`);
        });
      }
      if (row.avoidRows.length) {
        lines.push('Avoid Into');
        row.avoidRows.forEach((guideRow) => {
          lines.push(`${formatGuideLine(guideRow)}. ${guideExplanationLine(guideRow, 'core', 'avoid')}`);
        });
      }
      if (!row.strongRows.length && !row.avoidRows.length) {
        lines.push('Matchup guide data is not ready for this core yet.');
      }
      return lines;
    }),
  ], 'Lead/Core matchup guide data is not ready in this saved report yet.');
  appendSection(sections, '5. Archetype Matchup Study', [
    ...buckets.good.slice(0, 6).map((row) => `${matchupName(row)} - ${formatPercent(row.displayWinRate)} WR - ${formatNumber(row.gamesPlayed)} games - ${dominantVerdict(row.displayWinRate)}`),
    ...buckets.neutral.slice(0, 4).map((row) => `${matchupName(row)} - ${formatPercent(row.displayWinRate)} WR - ${formatNumber(row.gamesPlayed)} games - ${dominantVerdict(row.displayWinRate)}`),
  ], 'No archetype matchup study is available yet.');
  appendSection(sections, '6. Threat Scouting Report', threatRows.map((row, index) => {
    const severity = percentValue(row.lossRate, 0) >= 70 ? 'Critical' : percentValue(row.lossRate, 0) >= 50 ? 'High' : 'Moderate';
    return `#${index + 1} ${row.name} - ${formatPercent(row.lossRate)} LR - ${formatNumber(row.gamesPlayed)} games - ${severity}`;
  }), 'No threat scouting rows are available yet.');
  appendSection(sections, '7. Full Matchup Breakdown', [
    ...buckets.danger.map((row) => `${formatMatchupRow(row)} - ${dominantVerdict(row.displayWinRate)}`),
    ...buckets.neutral.map((row) => `${formatMatchupRow(row)} - ${dominantVerdict(row.displayWinRate)}`),
    ...buckets.good.map((row) => `${formatMatchupRow(row)} - ${dominantVerdict(row.displayWinRate)}`),
  ], 'No full matchup rows are available yet.');
  appendSection(sections, '8. Strategy / Game Plan', analyzerStrategyTips.length ? analyzerStrategyTips : [
    bestLead ? `Default lead: ${bestLead.label}${bestLead.winRate !== null && bestLead.winRate !== undefined ? ` (${formatPercent(bestLead.winRate)} WR)` : ''}.` : null,
    summary.practiceFirst ? `Practice first: ${plainLine(summary.practiceFirst)}.` : null,
    worstMatchup ? `Build a dedicated plan into ${matchupName(worstMatchup)} before tournament play.` : null,
    bestMatchup ? `Preserve the ${matchupName(bestMatchup)} line as a confidence matchup.` : null,
  ].filter(Boolean), 'No strategy plan is available yet.');
  appendSection(sections, '9. Weaknesses + Common Mistakes', analyzerWeaknesses.length ? analyzerWeaknesses : [
    worstMatchup ? `${matchupName(worstMatchup)} is the main matchup to lab first.` : null,
    worstThreat ? `${worstThreat.name} is the top threat signal at ${formatPercent(worstThreat.lossRate)} LR.` : null,
    buckets.danger[1] ? `${matchupName(buckets.danger[1])} is a secondary danger band.` : null,
    'Do not over-trust favored lanes until lead choice and turn-one protection are confirmed.',
  ].filter(Boolean), 'No weakness notes are available yet.');
  appendSection(sections, '10. Improvement Proposals', analyzerProposals.length ? analyzerProposals : [
    worstThreat ? `Add a concrete answer to ${worstThreat.name} if it appears on preview.` : null,
    worstMatchup ? `Run extra practice reps into ${matchupName(worstMatchup)} until the first three turns are scripted.` : null,
    `Review losses from ${modeText} mode before changing team structure.`,
  ].filter(Boolean), 'No improvement proposals are available yet.');

  const legacyNotes = [
    `Format: ${formatId}`,
    `Mode: ${modeText}`,
    `Confidence: ${confidence}`,
  ];

  return {
    title: `${serverName}'s Battle Lab`,
    subtitle: 'Battle Analysis Report',
    trainerName,
    avatarUrl: cleanText(options.avatarUrl || safe.avatarUrl || safe.identity?.avatarUrl),
    teamPreview,
    generatedAt,
    formatId,
    record: `${wins}-${losses}-${ties}`,
    winRate,
    tier,
    totalGames,
    wins,
    losses,
    averageTurns: formatTurns(safe.averageTurns ?? summary.averageTurns),
    confidence,
    modeText,
    opponentCount,
    poolLabel,
    poolCount,
    leadRows,
    coreRows,
    leadGuideRows,
    coreGuideRows,
    archetypeRows,
    threatRows,
    fullBreakdownRows,
    legacyNotes,
    sections,
    sourceCounts: {
      templateRows: templateRows.length,
      opponentRows: opponentRows.length,
      leadRows: leadRows.length,
      coreRows: coreRows.length,
      threatRows: threatRows.length,
    },
  };
}

function appendGuideMarkdown(lines, rows = [], kind = 'lead') {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) return;
  lines.push(`## ${kind === 'core' ? 'Core Guide' : 'Lead Pair Guide'}`);
  safeRows.forEach((entry, index) => {
    const name = kind === 'core'
      ? plainLine(entry.fullLabel || entry.label, 'Unknown core')
      : plainLine(entry.label, 'Unknown lead');
    lines.push(`### ${kind === 'core' ? 'Core' : 'Lead'} #${entry.guideRank || entry.rank || index + 1}: ${name}`);
    [
      ['Strong Into', entry.strongRows, 'use'],
      ['Avoid Into', entry.avoidRows, 'avoid'],
    ].forEach(([title, guideRows, recommendation]) => {
      const normalizedRows = Array.isArray(guideRows) ? guideRows : [];
      if (!normalizedRows.length) return;
      lines.push(`#### ${title}`);
      normalizedRows.forEach((row) => {
        lines.push(`- ${plainLine(row.archetypeLabel, 'Unknown matchup')}`);
        lines.push(`  - ${formatGuideRecord(row)} - ${formatPercent(row.winRate)} - ${row.confidence ? `${row.confidence} Confidence` : 'Confidence unavailable'}`);
        lines.push(`  - ${guideExplanationLine(row, kind === 'core' ? 'core' : 'lead', recommendation)}`);
      });
    });
    lines.push('');
  });
}

function renderBenchmarkPaperReportMarkdown(model = {}) {
  const lines = [
    `# ${plainLine(model.title, `${DEFAULT_SERVER_NAME}'s Battle Lab`)}`,
    '',
    `## ${plainLine(model.subtitle, 'Battle Simulation Paper Report')}`,
    '',
    `Trainer: ${plainLine(model.trainerName, DEFAULT_TRAINER_NAME)}`,
    `Generated: ${plainLine(model.generatedAt, 'Unavailable')}`,
    `Format: ${plainLine(model.formatId, DEFAULT_FORMAT)}`,
    `Record: ${plainLine(model.record, '0-0-0')}`,
    `Win Rate: ${formatPercent(model.winRate, 0)}`,
    `Average Turns: ${plainLine(model.averageTurns, 'Unavailable')}`,
    `Confidence: ${plainLine(model.confidence, 'Unavailable')}`,
    '',
  ];

  (Array.isArray(model.sections) ? model.sections : []).forEach((section) => {
    lines.push(`## ${plainLine(section.title, 'Section')}`);
    (Array.isArray(section.lines) ? section.lines : []).forEach((line) => {
      lines.push(`- ${plainLine(line, 'Unavailable')}`);
    });
    lines.push('');
  });

  appendGuideMarkdown(lines, model.leadGuideRows, 'lead');
  appendGuideMarkdown(lines, model.coreGuideRows, 'core');

  return lines.join('\n').trim() + '\n';
}

function renderBenchmarkPaperReportHtml(model = {}) {
  const allSections = Array.isArray(model.sections) ? model.sections : [];
  const executiveSection = allSections[0] || {};
  const leadRows = Array.isArray(model.leadRows) ? model.leadRows : [];
  const coreRows = Array.isArray(model.coreRows) ? model.coreRows : [];
  const leadGuideRows = Array.isArray(model.leadGuideRows) ? model.leadGuideRows : [];
  const coreGuideRows = Array.isArray(model.coreGuideRows) ? model.coreGuideRows : [];
  const archetypeRows = Array.isArray(model.archetypeRows) ? model.archetypeRows : [];
  const threatRows = Array.isArray(model.threatRows) ? model.threatRows : [];
  const hasPokemonThreatRows = threatRows.some((row) => row && row.sourceKind === 'pokemon-threat');
  const fullBreakdownRows = Array.isArray(model.fullBreakdownRows) ? model.fullBreakdownRows : [];
  const strategySection = allSections.find((section) => /Strategy/i.test(plainLine(section.title)));
  const weaknessSection = allSections.find((section) => /Weaknesses/i.test(plainLine(section.title)));
  const proposalSection = allSections.find((section) => /Improvement/i.test(plainLine(section.title)));
  const renderCleanSection = (section, title, dotClass, note) => {
    const lines = (Array.isArray(section?.lines) ? section.lines : [])
      .map((line) => plainLine(line))
      .filter(Boolean);
    return `
    <section class="report-section final-section">
      <h2><span class="dot ${escapeHtml(dotClass)}"></span>${escapeHtml(title)}</h2>
      <p class="section-note">${escapeHtml(note)}</p>
      <ul class="clean-list">
        ${(lines.length ? lines : ['No saved detail is available yet.']).map((line) => `<li>${renderPokemonMentionsInText(line)}</li>`).join('\n        ')}
      </ul>
    </section>`;
  };
  const strategyBlock = renderCleanSection(
    strategySection,
    'Strategy & Game Plan',
    'green',
    'Key strategic insights derived from your simulation data. Apply these in your next tournament.',
  );
  const weaknessBlock = renderCleanSection(
    weaknessSection,
    'Weaknesses & Common Mistakes',
    'orange',
    'Problems identified in your team performance. Addressing these will yield the biggest improvement.',
  );
  const proposalLines = (Array.isArray(proposalSection?.lines) ? proposalSection.lines : [])
    .map((line) => plainLine(line))
    .filter(Boolean);
  const proposalCopy = proposalLines.length
    ? proposalLines.join(' ')
    : 'No improvement proposal is available yet.';
  const proposalBlock = `
    <section class="report-section final-section proposal-section">
      <h2><span class="dot"></span>Improvement Proposals</h2>
      <p class="section-note">Concrete suggestions to push your team to the next tier. Prioritise the first item - it will have the biggest impact.</p>
      <strong class="proposal-label">Proposal 1</strong>
      <p class="proposal-copy">${renderPokemonMentionsInText(proposalCopy)}</p>
    </section>`;
  const executiveText = (Array.isArray(executiveSection.lines) ? executiveSection.lines : [])
    .map((line) => plainLine(line))
    .filter(Boolean)
    .join(' ');
  const leadTableRows = leadRows.length
    ? leadRows.map((row, index) => `
          <tr>
            <td>${row.rank || index + 1}</td>
            <td><strong class="pokemon-name-list">${renderPokemonNameGroup(row.pokemonNames, row.label, '+')}</strong></td>
            <td>${escapeHtml(`${formatNumber(row.wins)}-${formatNumber(row.losses)}`)}</td>
            <td>${escapeHtml(formatNumber(row.gamesPlayed))}</td>
            <td class="good">${row.winRate === null || row.winRate === undefined ? 'N/A' : escapeHtml(formatPercent(row.winRate))}</td>
          </tr>`).join('\n')
    : '<tr><td>1</td><td><strong>Lead data unavailable</strong></td><td>0-0</td><td>0</td><td class="good">N/A</td></tr>';
  const bestLead = leadRows[0] || null;
  const worstLead = leadRows.length > 1 ? leadRows[leadRows.length - 1] : null;
  const leadGap = bestLead && worstLead && Number.isFinite(Number(bestLead.winRate)) && Number.isFinite(Number(worstLead.winRate))
    ? Math.max(0, percentValue(bestLead.winRate) - percentValue(worstLead.winRate))
    : null;
  const coreTableRows = coreRows.length
    ? coreRows.map((row, index) => `
          <tr>
            <td>${row.rank || index + 1}</td>
            <td class="core-name"><strong class="pokemon-name-list">${renderPokemonNameGroup(row.pokemonNames, row.label, '/')}</strong></td>
            <td class="good">${row.winRate === null || row.winRate === undefined ? 'N/A' : escapeHtml(formatPercent(row.winRate))}</td>
            <td>${escapeHtml(plainLine(row.record, '0-0'))}</td>
            <td>${escapeHtml(plainLine(row.note, index === 0 ? 'Best validated 4-Pokemon core.' : 'Strong secondary core.'))}</td>
          </tr>`).join('\n')
    : '<tr><td>1</td><td><strong>Core Sweep data unavailable</strong></td><td>N/A</td><td>0-0</td><td>Run a fresh Core Sweep report.</td></tr>';
  const bestCore = coreRows[0] || null;
  const renderGuideList = (rows, kind) => {
    const safeRows = Array.isArray(rows) ? rows : [];
    const label = kind === 'core' ? 'core' : 'lead';
    if (!safeRows.length) {
      return [`<article class="guide-card"><h3>${kind === 'core' ? 'Core Guide' : 'Lead Guide'}</h3><p class="guide-empty">No ${label} matchup guide data is ready in this saved report yet.</p></article>`];
    }
    return safeRows.map((row, index) => {
      const title = kind === 'core'
        ? `Core #${row.guideRank || row.rank || index + 1}`
        : `Lead #${row.guideRank || row.rank || index + 1}`;
      const name = kind === 'core'
        ? plainLine(row.fullLabel || row.label, 'Unknown core')
        : plainLine(row.label, 'Unknown lead');
      const renderedName = kind === 'core'
        ? renderPokemonNameGroup(row.pokemonNames, name, '/')
        : renderPokemonNameGroup(row.pokemonNames, name, '+');
      const renderRows = (guideRows, recommendation) => {
        const safeGuideRows = Array.isArray(guideRows) ? guideRows : [];
        if (!safeGuideRows.length) return '';
        return `
          <h4>${recommendation === 'avoid' ? 'Avoid Into' : 'Strong Into'}</h4>
          <ul class="guide-list">
            ${safeGuideRows.map((guideRow) => `
              <li>
                <strong>${escapeHtml(plainLine(guideRow.archetypeLabel, 'Unknown matchup'))}</strong>
                <span>${escapeHtml(formatGuideRecord(guideRow))} · ${escapeHtml(formatPercent(guideRow.winRate))} · ${escapeHtml(guideRow.confidence ? `${guideRow.confidence} Confidence` : 'Confidence unavailable')}</span>
                <em>${escapeHtml(guideExplanationLine(guideRow, label, recommendation))}</em>
              </li>`).join('\n            ')}
          </ul>`;
      };
      const strongBlock = renderRows(row.strongRows, 'use');
      const avoidBlock = renderRows(row.avoidRows, 'avoid');
      return `
        <article class="guide-card">
          <h3><span>${escapeHtml(title)}</span><strong class="pokemon-name-list">${renderedName}</strong></h3>
          ${strongBlock || ''}
          ${avoidBlock || ''}
          ${!strongBlock && !avoidBlock ? '<p class="guide-empty">More matchup guide data is needed before making a recommendation.</p>' : ''}
        </article>`;
    });
  };
  const leadGuideCards = renderGuideList(leadGuideRows, 'lead');
  const coreGuideCards = renderGuideList(coreGuideRows, 'core');
  const guideCardCount = Math.max(leadGuideCards.length, coreGuideCards.length);
  const guideCardRows = Array.from({ length: guideCardCount }).map((_, index) => `
        <div class="guide-card-row">
          <div class="guide-card-slot">${leadGuideCards[index] || ''}</div>
          <div class="guide-card-slot">${coreGuideCards[index] || ''}</div>
        </div>`).join('\n');
  const matchupGuideBlock = `
    <section class="report-section guide-section">
      <h2><span class="dot green"></span>Lead &amp; Core Matchup Guide</h2>
      <p class="section-note">Use this section to choose your opening lead and four-Pokemon core after reading the opponent preview. Every recommendation comes from completed lead and core testing.</p>
      <div class="guide-grid">
        <div class="guide-heading-row">
          <h3 class="guide-group-title">Lead Pair Guide</h3>
          <h3 class="guide-group-title">Core Guide</h3>
        </div>
        ${guideCardRows}
      </div>
    </section>`;
  const archetypeGraphRows = archetypeRows.length
    ? archetypeRows.map((row) => {
      const rate = percentValue(row.displayWinRate ?? rowWinRate(row), 0);
      const games = row.gamesPlayed ?? rowGames(row);
      return `
        <div class="bar-row ${rateClass(rate)}">
          <strong>${escapeHtml(matchupName(row))}</strong>
          <span>${escapeHtml(formatNumber(games))} teams</span>
          <div class="bar-track"><div class="bar-fill" style="width: ${rate}%"></div></div>
          <em>${escapeHtml(formatPercent(rate))}<small>${escapeHtml(dominantVerdict(rate))}</small></em>
        </div>`;
    }).join('\n')
    : '<p class="section-copy">No archetype matchup study is available yet.</p>';
  const threatTableRows = threatRows.length
    ? threatRows.map((row) => {
      const lossRate = percentValue(row.lossRate, 0);
      const severity = lossRate >= 70 ? 'CRITICAL' : lossRate >= 50 ? 'High' : 'Moderate';
      return `
          <tr>
            <td><strong>${row.sourceKind === 'pokemon-threat' ? renderPokemonNameToken(row.name) : escapeHtml(plainLine(row.name, 'Unknown threat'))}</strong></td>
            <td>${escapeHtml(formatNumber(row.gamesPlayed || 0))}</td>
            <td class="bad">${escapeHtml(formatPercent(lossRate))}</td>
            <td class="${escapeHtml(verdictClass(severity))}">${escapeHtml(severity)}</td>
          </tr>`;
    }).join('\n')
    : `<tr><td><strong>${hasPokemonThreatRows ? 'Threat data unavailable' : 'Pokemon threat data not wired yet'}</strong></td><td>0</td><td class="bad">N/A</td><td class="${escapeHtml(verdictClass('Moderate'))}">Moderate</td></tr>`;
  const threatNotes = threatRows.slice(0, 3).map((row) => {
    const lossRate = percentValue(row.lossRate, 0);
    if (row.sourceKind !== 'pokemon-threat') {
      return `${plainLine(row.name, 'Unknown pattern')} is ${lossRate >= 70 ? 'a severe' : 'an important'} matchup pattern (${formatPercent(lossRate)} loss rate). Use this as archetype guidance until Pokemon threat data is wired.`;
    }
    return `${plainLine(row.name, 'Unknown threat')} is ${lossRate >= 70 ? 'a severe' : 'an important'} threat (${formatPercent(lossRate)} loss rate). When you see this Pokemon on your opponent's team, you must have a clear plan before turn one.`;
  });
  const matchupTableRows = fullBreakdownRows.length
    ? fullBreakdownRows.map((row) => {
      const wins = integerValue(row.wins, 0);
      const losses = integerValue(row.losses, 0);
      const winRate = percentValue(row.displayWinRate ?? rowWinRate(row), 0);
      const verdict = dominantVerdict(winRate);
      return `
          <tr>
            <td>${escapeHtml(plainLine(row.name, 'Unknown opponent'))}</td>
            <td class="good">${escapeHtml(formatNumber(wins))}</td>
            <td class="bad">${escapeHtml(formatNumber(losses))}</td>
            <td class="good">${escapeHtml(formatPercent(winRate))}</td>
            <td class="${escapeHtml(verdictClass(verdict))}">${escapeHtml(verdict)}</td>
          </tr>`;
    }).join('\n')
    : `<tr><td>No matchup rows available</td><td>0</td><td>0</td><td>N/A</td><td class="${escapeHtml(verdictClass('Unknown'))}">Unknown</td></tr>`;

  const fallbackAvatar = '<div class="avatar fallback">Aegis</div>';
  const avatar = cleanText(model.avatarUrl)
    ? `<img class="avatar" src="${escapeHtml(model.avatarUrl)}" alt="Trainer avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">${fallbackAvatar.replace('class="avatar fallback"', 'class="avatar fallback avatar-hidden"')}`
    : fallbackAvatar;
  const teamDetails = Array.isArray(model.teamPreview?.details) ? model.teamPreview.details : [];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(plainLine(model.title, `${DEFAULT_SERVER_NAME}'s Battle Lab`))}</title>
  <style>
    :root { --aegis-purple: #7c4dff; --aegis-blue: #2563eb; --aegis-green: #16a34a; --aegis-red: #dc2626; --ink: #20212a; --muted: #647084; --line: #dfe3ee; --panel: #f6f7fb; }
    * { box-sizing: border-box; }
    body { background: #fff; color: var(--ink); font: 12px/1.35 Arial, sans-serif; margin: 0; padding: 18px; }
    main { background: #fff; margin: 0 auto; max-width: 920px; padding: 14px 24px; }
    header { align-items: center; border-bottom: 3px solid var(--aegis-purple); display: flex; gap: 16px; padding-bottom: 14px; }
    h1 { color: var(--aegis-purple); font-size: 24px; margin: 0 0 3px; }
    h2 { align-items: center; display: flex; font-size: 15px; gap: 8px; margin: 18px 0 6px; }
    .subtitle { color: var(--muted); font-size: 11px; margin: 0; }
    .avatar { border-radius: 10px; height: 58px; object-fit: cover; width: 58px; }
    .fallback { align-items: center; background: linear-gradient(135deg, var(--aegis-purple), var(--aegis-blue)); color: #fff; display: flex; font-weight: 800; justify-content: center; }
    .avatar-hidden { display: none; }
    .hero { background: #f0edff; border: 1px solid #ddd6fe; border-radius: 8px; display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr) 150px; margin: 18px 0 16px; padding: 14px; }
    .hero h3 { color: var(--aegis-purple); font-size: 11px; letter-spacing: .02em; margin: 0 0 6px; text-transform: uppercase; }
    .team-title { display: block; font-size: 14px; margin-bottom: 5px; }
    .team-lines { color: var(--muted); font-size: 10px; line-height: 1.35; }
    .score-stack { display: flex; flex-direction: column; gap: 8px; }
    .tier { align-items: center; border-radius: 7px; color: #fff; display: flex; font-size: 18px; font-weight: 800; justify-content: center; min-height: 38px; }
    .tier-s { background: #d97706; }
    .tier-a { background: #7c3aed; }
    .tier-b { background: #2563eb; }
    .tier-c { background: #059669; }
    .tier-d { background: #6b7280; }
    .score { align-items: center; color: var(--aegis-green); display: flex; flex-direction: column; justify-content: center; text-align: center; }
    .score strong { font-size: 25px; line-height: 1; }
    .score span { color: var(--muted); font-size: 10px; margin-top: 3px; }
    .meta { border-bottom: 1px solid var(--line); display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 14px 0 6px; padding-bottom: 12px; text-align: center; }
    .meta div { border-radius: 8px; padding: 10px 8px; }
    .meta strong { display: block; font-size: 18px; }
    .meta span { color: var(--muted); display: block; font-size: 10px; margin-top: 1px; }
    .wins strong { color: var(--aegis-green); }
    .losses strong { color: var(--aegis-red); }
    .report-section { margin-bottom: 14px; page-break-inside: auto; }
    .dot { background: var(--aegis-purple); border-radius: 50%; display: inline-block; height: 10px; width: 10px; }
    .dot.red { background: var(--aegis-red); }
    .dot.blue { background: var(--aegis-blue); }
    .dot.green { background: var(--aegis-green); }
    .dot.orange { background: #f97316; }
    .section-5 .dot, .section-9 .dot { background: var(--aegis-blue); }
    .section-7 .dot, .section-10 .dot { background: var(--aegis-red); }
    .section-11 .dot { background: #f97316; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { border-bottom: 1px solid #eef1f7; padding: 6px 0; }
    li::before { color: var(--aegis-purple); content: "• "; font-weight: 800; }
    .section-copy { margin: 0 0 10px; }
    .section-note { color: var(--muted); font-size: 10px; font-style: italic; margin: -2px 0 10px; }
    .lead-table { border-collapse: collapse; font-size: 10px; margin: 8px 0 9px; width: 100%; }
    .lead-table th { background: #eef2ff; color: var(--aegis-blue); font-size: 9px; padding: 5px 8px; text-align: left; }
    .lead-table td { border-bottom: 1px solid #eef1f7; padding: 4px 8px; }
    .lead-table tr:nth-child(even) td { background: #f8f9ff; }
    .lead-table td:first-child, .lead-table th:first-child { text-align: center; width: 38px; }
    .lead-table td:nth-child(3), .lead-table th:nth-child(3),
    .lead-table td:nth-child(4), .lead-table th:nth-child(4),
    .lead-table td:nth-child(5), .lead-table th:nth-child(5) { text-align: right; }
    .core-section { break-inside: avoid; page-break-inside: avoid; }
    .core-table th { background: #f3efff; color: var(--aegis-purple); }
    .core-table td:first-child, .core-table th:first-child { width: 38px; }
    .core-table td:nth-child(3), .core-table th:nth-child(3),
    .core-table td:nth-child(4), .core-table th:nth-child(4) { text-align: right; width: 62px; }
    .core-table td:nth-child(5), .core-table th:nth-child(5) { text-align: left; width: 185px; }
    .core-name strong { display: block; line-height: 1.25; overflow-wrap: anywhere; }
    .pokemon-name-list { align-items: center; display: flex; flex-wrap: wrap; gap: 3px 5px; line-height: 1.35; }
    .pokemon-token { align-items: center; display: inline-flex; gap: 3px; min-width: 0; }
    .pokemon-token span { white-space: nowrap; }
    .pokemon-icon { border-radius: 50%; display: inline-block; height: 16px; object-fit: contain; vertical-align: middle; width: 16px; }
    .pokemon-separator { color: var(--muted); font-weight: 700; }
    .guide-section { page-break-before: auto; }
    .guide-grid { display: grid; gap: 10px; }
    .guide-heading-row, .guide-card-row { align-items: stretch; display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); page-break-inside: avoid; }
    .guide-card-slot { display: flex; min-width: 0; }
    .guide-group-title { color: var(--aegis-purple); font-size: 12px; margin: 0 0 8px; }
    .guide-card { background: #f8f9ff; border: 1px solid #e7eafd; border-radius: 8px; box-sizing: border-box; display: flex; flex-direction: column; height: 100%; margin: 0; padding: 10px; page-break-inside: avoid; width: 100%; }
    .guide-card h3 { color: var(--ink); font-size: 11px; margin: 0 0 8px; }
    .guide-card h3 span { color: var(--aegis-purple); display: block; font-size: 9px; letter-spacing: .02em; margin-bottom: 2px; text-transform: uppercase; }
    .guide-card h4 { color: var(--aegis-blue); font-size: 10px; margin: 8px 0 3px; }
    .guide-list li { border: 0; padding: 4px 0; }
    .guide-list li::before { content: ""; }
    .guide-list strong { display: block; font-size: 10px; }
    .guide-list span { color: var(--muted); display: block; font-size: 9px; }
    .guide-list em { color: #485365; display: block; font-size: 9px; font-style: normal; line-height: 1.35; margin-top: 2px; }
    .guide-empty { color: var(--muted); font-size: 10px; margin: 0; }
    .good { color: var(--aegis-green); font-weight: 800; }
    .bad { color: var(--aegis-red); font-weight: 800; }
    .warn { color: #f97316; font-weight: 800; }
    .label-critical, td.label-critical { color: var(--aegis-red); font-weight: 800; }
    .label-high, td.label-high { color: #f97316; font-weight: 800; }
    .label-moderate, td.label-moderate { color: #2563eb; font-weight: 800; }
    .label-dominant, td.label-dominant { color: var(--aegis-green); font-weight: 800; }
    .label-favored, td.label-favored { color: #16a34a; font-weight: 800; }
    .label-playable, td.label-playable { color: #65a30d; font-weight: 800; }
    .label-danger, td.label-danger { color: #dc2626; font-weight: 800; }
    .label-neutral, td.label-neutral { color: var(--muted); font-weight: 800; }
    .danger-table th { background: #fff1f2; color: var(--aegis-red); }
    .compact-table { border-collapse: collapse; font-size: 9px; margin: 10px 0 14px; width: 100%; }
    .compact-table th { background: #f3efff; color: var(--aegis-purple); font-size: 8px; padding: 5px 8px; text-align: left; }
    .compact-table td { border-bottom: 1px solid #eef1f7; padding: 4px 8px; }
    .compact-table tr:nth-child(even) td { background: #f8f9ff; }
    .compact-table td:not(:first-child), .compact-table th:not(:first-child) { text-align: right; }
    .threat-notes { margin: 8px 0 18px; }
    .threat-notes li { border: 0; padding: 2px 0; }
    .final-section { margin-top: 18px; }
    .clean-list li { border: 0; padding: 2px 0; }
    .proposal-label { color: var(--aegis-purple); display: block; font-weight: 800; margin: 8px 0 2px; }
    .proposal-copy { margin: 0; }
    .bar-row { align-items: center; display: grid; gap: 14px; grid-template-columns: 190px 68px 1fr 66px; margin: 9px 0; }
    .bar-row strong { font-size: 10px; }
    .bar-row span { color: var(--muted); font-size: 10px; text-align: right; }
    .bar-track { background: #e7ebf3; border-radius: 999px; height: 13px; overflow: hidden; }
    .bar-fill { border-radius: 999px; height: 100%; }
    .rate-elite .bar-fill { background: #22c55e; }
    .rate-good .bar-fill { background: #49a352; }
    .rate-mid .bar-fill { background: #84cc16; }
    .rate-warning .bar-fill { background: #f97316; }
    .rate-danger .bar-fill { background: #dc2626; }
    .bar-row em { font-style: normal; font-weight: 800; text-align: right; }
    .rate-elite em { color: #16a34a; }
    .rate-good em { color: #16a34a; }
    .rate-mid em { color: #65a30d; }
    .rate-warning em { color: #f97316; }
    .rate-danger em { color: #dc2626; }
    .bar-row small { color: var(--muted); display: block; font-size: 8px; font-weight: 400; line-height: 1; }
    footer { border-top: 1px solid var(--line); color: #9aa3b2; display: flex; font-size: 11px; justify-content: space-between; margin-top: 28px; padding-top: 10px; }
  </style>
</head>
<body>
  <main>
    <header>
      ${avatar}
      <div>
        <h1>${escapeHtml(plainLine(model.title, `${DEFAULT_SERVER_NAME}'s Battle Lab`))}</h1>
        <p class="subtitle">${escapeHtml(plainLine(model.subtitle, 'Battle Simulation Paper Report'))}</p>
      </div>
    </header>
    <div class="hero">
      <div>
        <h3>Your Team</h3>
        <strong class="team-title">${escapeHtml(plainLine(model.teamPreview?.title, model.trainerName || DEFAULT_TRAINER_NAME))}</strong>
        <div class="team-lines">
          ${teamDetails.map((line) => `<div>${escapeHtml(plainLine(line, 'Team detail unavailable'))}</div>`).join('\n          ')}
        </div>
      </div>
      <div class="score-stack">
        <div class="tier ${escapeHtml(tierClass(model.tier))}">${escapeHtml(plainLine(model.tier, 'C'))}</div>
        <div class="score">
          <strong>${escapeHtml(formatPercent(model.winRate, 0))}</strong>
          <span>Win Rate</span>
        </div>
      </div>
    </div>
    <div class="meta">
      <div><strong>${escapeHtml(formatNumber(model.totalGames || 0))}</strong><span>Games</span></div>
      <div class="wins"><strong>${escapeHtml(formatNumber(model.wins || 0))}</strong><span>Wins</span></div>
      <div class="losses"><strong>${escapeHtml(formatNumber(model.losses || 0))}</strong><span>Losses</span></div>
      <div><strong>${escapeHtml(plainLine(model.averageTurns, 'Unavailable'))}</strong><span>Avg Turns</span></div>
    </div>
    <section class="report-section">
      <h2><span class="dot"></span>Executive Summary</h2>
      <p class="section-copy">${escapeHtml(executiveText || 'No executive summary is available yet.')}</p>
    </section>
    <section class="report-section">
      <h2><span class="dot blue"></span>Lead Selection Guide</h2>
      <p class="section-note">Your opening two Pokemon set the tempo of the game. The right lead can turn a shaky matchup into a planned one.</p>
      <table class="lead-table">
        <thead><tr><th>#</th><th>Lead Pair</th><th>Record</th><th>Games</th><th>Win Rate</th></tr></thead>
        <tbody>${leadTableRows}</tbody>
      </table>
      <p class="section-copy">${bestLead ? `Your strongest opening is ${renderPokemonNameGroup(bestLead.pokemonNames, bestLead.label, '+')}${bestLead.winRate !== null && bestLead.winRate !== undefined ? ` at ${escapeHtml(formatPercent(bestLead.winRate))}` : ''}. This should be your default lead when preview does not demand a specific answer.` : 'Lead pair data is not ready in this saved report yet.'}</p>
      ${leadGap !== null ? `<p class="section-copy">There is a ${leadGap}% gap between your best and worst listed leads. Study lead selection before choosing.</p>` : ''}
    </section>
    <section class="report-section core-section">
      <h2><span class="dot"></span>Core Performance Study</h2>
      <p class="section-note">Validated four-Pokemon cores from the Core Sweep. Use these as your most reliable in-game structures after preview.</p>
      <table class="lead-table core-table">
        <thead><tr><th>Rank</th><th>Core</th><th>Win Rate</th><th>Record</th><th>Note</th></tr></thead>
        <tbody>${coreTableRows}</tbody>
      </table>
      <h2><span class="dot green"></span>Best Core Insight</h2>
      <p class="section-copy">${bestCore ? `Your strongest tested core was ${renderPokemonNameGroup(bestCore.pokemonNames, bestCore.fullLabel || bestCore.label, '/')}. It gave the team the most stable validated result among the top Core Sweep results.` : 'Core Sweep data is not ready in this saved report yet.'}</p>
    </section>
    ${matchupGuideBlock}
    <section class="report-section">
      <h2><span class="dot"></span>Archetype Matchup Study</h2>
      <p class="section-note">How your team performs against each competitive archetype. Use this to understand strengths and plan around blind spots.</p>
      ${archetypeGraphRows}
    </section>
    <section class="report-section">
      <h2><span class="dot red"></span>Threat Scouting Report</h2>
      <p class="section-note">${hasPokemonThreatRows ? 'These are the opposing Pokemon that gave your team the most trouble. Loss rate = how often you lost when facing this Pokemon.' : 'Pokemon threat data is not wired yet. These rows show matchup-pattern danger from the completed archetype results.'}</p>
      <table class="lead-table danger-table">
        <thead><tr><th>${hasPokemonThreatRows ? 'Pokemon' : 'Pattern'}</th><th>Seen</th><th>Loss Rate</th><th>Severity</th></tr></thead>
        <tbody>${threatTableRows}</tbody>
      </table>
      <ul class="threat-notes">
        ${threatNotes.map((line) => `<li>${renderPokemonMentionsInText(line)}</li>`).join('\n        ')}
      </ul>
    </section>
    <section class="report-section">
      <h2><span class="dot"></span>Full Matchup Breakdown</h2>
      <p class="section-note">Detailed results against every opponent team in the simulation pool. Study your losing matchups to find patterns.</p>
      <table class="compact-table">
        <thead><tr><th>Opponent Team</th><th>W</th><th>L</th><th>WR%</th><th>Verdict</th></tr></thead>
        <tbody>${matchupTableRows}</tbody>
      </table>
    </section>
    ${strategyBlock}
    ${weaknessBlock}
    ${proposalBlock}
    <footer>
      <span>Professor Aegis Battle Lab</span>
      <span>${escapeHtml(plainLine(model.generatedAt, 'Unavailable'))}</span>
    </footer>
  </main>
</body>
</html>
`;
}

function safeFilename(value = DEFAULT_FILENAME) {
  const cleaned = String(value || DEFAULT_FILENAME).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned || DEFAULT_FILENAME;
}

function buildBenchmarkPaperReportAttachment(report = {}, options = {}) {
  const model = buildBenchmarkPaperReportModel(report, options);
  const format = String(options.format || 'html').toLowerCase() === 'markdown' ? 'markdown' : 'html';
  const body = format === 'markdown'
    ? renderBenchmarkPaperReportMarkdown(model)
    : renderBenchmarkPaperReportHtml(model);
  const extension = format === 'markdown' ? 'md' : 'html';
  const name = `${safeFilename(options.filename || DEFAULT_FILENAME)}.${extension}`;
  return {
    attachment: Buffer.from(body, 'utf8'),
    name,
    contentType: format === 'markdown' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8',
    model,
  };
}

async function renderBenchmarkPaperReportPdfBuffer(html, options = {}) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (error) {
    const dependencyError = new Error('PDF renderer unavailable. Install the approved playwright + chromium runtime before downloading true PDF Paper Reports.');
    dependencyError.cause = error;
    throw dependencyError;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 960, height: 1240 },
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs || 30000 });
    await page.waitForLoadState('networkidle', { timeout: options.assetTimeoutMs || 5000 }).catch(() => null);
    await page.emulateMedia({ media: 'print' });
    return await page.pdf({
      format: 'Letter',
      margin: { top: '0.35in', right: '0.35in', bottom: '0.35in', left: '0.35in' },
      printBackground: true,
    });
  } finally {
    await browser.close().catch(() => null);
  }
}

async function buildBenchmarkPaperReportPdfAttachment(report = {}, options = {}) {
  const model = buildBenchmarkPaperReportModel(report, options);
  const html = renderBenchmarkPaperReportHtml(model);
  const attachment = await renderBenchmarkPaperReportPdfBuffer(html, options);
  return {
    attachment,
    name: `${safeFilename(options.filename || DEFAULT_FILENAME)}.pdf`,
    contentType: 'application/pdf',
    model,
  };
}

module.exports = {
  buildBenchmarkPaperReportModel,
  renderBenchmarkPaperReportMarkdown,
  renderBenchmarkPaperReportHtml,
  renderBenchmarkPaperReportPdfBuffer,
  buildBenchmarkPaperReportAttachment,
  buildBenchmarkPaperReportPdfAttachment,
};
