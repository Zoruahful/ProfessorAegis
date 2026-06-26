const STAT_ORDER = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const CHAMPIONS_SP_FORMAT_ID = 'gen9championscustomgame';
const CHAMPIONS_SP_POINT_TO_EV = Object.freeze([
  0, 4, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 100, 108, 116,
  124, 132, 140, 148, 156, 164, 172, 180, 188, 196, 204, 212, 220,
  228, 236, 244, 252,
]);
const CHAMPIONS_SP_TOTAL_CAP = 66;
const CHAMPIONS_SP_PER_STAT_CAP = 32;
const STANDARD_EV_TOTAL_CAP = 508;
const STAT_LABEL_TO_ID = {
  hp: 'hp',
  atk: 'atk',
  def: 'def',
  spa: 'spa',
  spd: 'spd',
  spe: 'spe',
};
const STAT_ID_TO_LABEL = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};
const REVERSE_TRIM_TIE_ORDER = ['atk', 'spa', 'hp', 'def', 'spd', 'spe'];
const NATURE_LOWERED_STAT = {
  adamant: 'spa',
  bashful: null,
  bold: 'atk',
  brave: 'spe',
  calm: 'atk',
  careful: 'spa',
  docile: null,
  gentle: 'def',
  hardy: null,
  hasty: 'def',
  impish: 'spa',
  jolly: 'spa',
  lax: 'spd',
  lonely: 'def',
  mild: 'def',
  modest: 'atk',
  naive: 'spd',
  naughty: 'spd',
  quiet: 'spe',
  quirky: null,
  rash: 'spd',
  relaxed: 'spe',
  sassy: 'spe',
  serious: null,
  timid: 'atk',
};

function normalizeLineEndings(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function splitTeamBlocks(teamExport) {
  const normalized = normalizeLineEndings(teamExport);
  if (!normalized) return [];
  return normalized
    .split(/\n{2,}/)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);
}

function parseAllocationLine(line, prefix, options = {}) {
  const raw = String(line || '').trim();
  const body = raw.slice(prefix.length).trim();
  const values = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

  if (!body) return { ok: false, reason: 'Invalid SP syntax' };

  const seen = new Set();
  const parts = body.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, reason: 'Invalid SP syntax' };

  for (const part of parts) {
    const match = part.match(/^(-?\d+)\s+([A-Za-z]+)$/);
    if (!match) return { ok: false, reason: 'Invalid SP syntax' };

    const amount = Number(match[1]);
    const stat = STAT_LABEL_TO_ID[match[2].toLowerCase()];
    if (!stat) return { ok: false, reason: 'Invalid SP stat' };
    if (amount < 0 || !Number.isInteger(amount)) return { ok: false, reason: 'Invalid SP syntax' };
    if (seen.has(stat)) return { ok: false, reason: 'Invalid SP syntax' };

    seen.add(stat);
    values[stat] = amount;
  }

  if (options.requireAllStats && seen.size !== STAT_ORDER.length) {
    return { ok: false, reason: 'Invalid SP syntax' };
  }

  return { ok: true, values };
}

function canonicalizeSpLine(values = {}) {
  return `SPs: ${Number(values.hp || 0)} HP / ${Number(values.atk || 0)} Atk / ${Number(values.def || 0)} Def / ${Number(values.spa || 0)} SpA / ${Number(values.spd || 0)} SpD / ${Number(values.spe || 0)} Spe`;
}

function canonicalizeEvLine(values = {}) {
  const parts = STAT_ORDER
    .map((stat) => ({ stat, amount: Number(values[stat] || 0) }))
    .filter(({ amount }) => amount > 0)
    .map(({ stat, amount }) => `${amount} ${STAT_ID_TO_LABEL[stat]}`);
  return `EVs: ${parts.length ? parts.join(' / ') : '0 HP'}`;
}

function isAllocationLine(line) {
  return /^(EVs|SPs):/i.test(String(line || '').trim());
}

function isIvLine(line) {
  return /^IVs:/i.test(String(line || '').trim());
}

function coerceNonNegativeInteger(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.floor(amount);
}

function evToChampionsSp(ev) {
  return Math.min(CHAMPIONS_SP_PER_STAT_CAP, Math.floor((coerceNonNegativeInteger(ev) + 4) / 8));
}

function championsSpToEv(sp) {
  const point = Math.min(CHAMPIONS_SP_PER_STAT_CAP, coerceNonNegativeInteger(sp));
  return CHAMPIONS_SP_POINT_TO_EV[point] ?? 0;
}

function mapAllocationValues(values = {}, mapper) {
  const mapped = {};
  for (const stat of STAT_ORDER) {
    mapped[stat] = mapper(values[stat] || 0);
  }
  return mapped;
}

function totalAllocation(values = {}) {
  return STAT_ORDER.reduce((total, stat) => total + coerceNonNegativeInteger(values[stat]), 0);
}

function statOrderIndex(stat) {
  return STAT_ORDER.indexOf(stat);
}

function applyChampionsRemainderFill(values = {}, sourceEvValues = {}) {
  const filled = { ...values };
  let missing = CHAMPIONS_SP_TOTAL_CAP - totalAllocation(filled);
  if (missing <= 0) return filled;

  while (missing > 0) {
    const candidates = STAT_ORDER
      .filter((stat) => coerceNonNegativeInteger(sourceEvValues[stat]) > 0)
      .filter((stat) => coerceNonNegativeInteger(filled[stat]) > 0)
      .filter((stat) => coerceNonNegativeInteger(filled[stat]) < CHAMPIONS_SP_PER_STAT_CAP)
      .sort((a, b) => (
        coerceNonNegativeInteger(filled[a]) - coerceNonNegativeInteger(filled[b])
        || coerceNonNegativeInteger(sourceEvValues[a]) - coerceNonNegativeInteger(sourceEvValues[b])
        || statOrderIndex(a) - statOrderIndex(b)
      ));

    const stat = candidates[0];
    if (!stat) break;
    filled[stat] = coerceNonNegativeInteger(filled[stat]) + 1;
    missing -= 1;
  }

  return filled;
}

function evAllocationToChampionsSp(values = {}, options = {}) {
  const mapped = mapAllocationValues(values, evToChampionsSp);
  return options.fillRemainder ? applyChampionsRemainderFill(mapped, values) : mapped;
}

function getNatureLoweredStat(lines = []) {
  for (const line of lines) {
    const match = String(line || '').trim().match(/^([A-Za-z]+)\s+Nature$/i);
    if (!match) continue;
    const nature = match[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(NATURE_LOWERED_STAT, nature)) {
      return NATURE_LOWERED_STAT[nature];
    }
  }
  return null;
}

function reverseTrimRank(stat, natureLoweredStat = null) {
  if (natureLoweredStat && stat === natureLoweredStat) return -1;
  return REVERSE_TRIM_TIE_ORDER.indexOf(stat);
}

function sortReverseTrimCandidates(stats = [], values = {}, sourceSpValues = {}, natureLoweredStat = null) {
  return stats.sort((a, b) => (
    coerceNonNegativeInteger(sourceSpValues[a]) - coerceNonNegativeInteger(sourceSpValues[b])
    || coerceNonNegativeInteger(values[a]) - coerceNonNegativeInteger(values[b])
    || reverseTrimRank(a, natureLoweredStat) - reverseTrimRank(b, natureLoweredStat)
    || statOrderIndex(a) - statOrderIndex(b)
  ));
}

function trimShowdownEvOverflow(values = {}, sourceSpValues = {}, options = {}) {
  const trimmed = { ...values };
  let excess = totalAllocation(trimmed) - STANDARD_EV_TOTAL_CAP;
  if (excess <= 0) return trimmed;

  const natureLoweredStat = options.natureLoweredStat || null;

  while (excess > 0) {
    const candidates = sortReverseTrimCandidates(
      STAT_ORDER
        .filter((stat) => coerceNonNegativeInteger(sourceSpValues[stat]) > 0)
        .filter((stat) => coerceNonNegativeInteger(sourceSpValues[stat]) < CHAMPIONS_SP_PER_STAT_CAP)
        .filter((stat) => coerceNonNegativeInteger(trimmed[stat]) > 4),
      trimmed,
      sourceSpValues,
      natureLoweredStat,
    );
    const stat = candidates[0];
    if (!stat) break;
    trimmed[stat] = coerceNonNegativeInteger(trimmed[stat]) - 4;
    excess -= 4;
  }

  while (excess > 0) {
    const candidates = sortReverseTrimCandidates(
      STAT_ORDER
        .filter((stat) => coerceNonNegativeInteger(sourceSpValues[stat]) > 0)
        .filter((stat) => coerceNonNegativeInteger(sourceSpValues[stat]) < CHAMPIONS_SP_PER_STAT_CAP)
        .filter((stat) => coerceNonNegativeInteger(trimmed[stat]) > 0),
      trimmed,
      sourceSpValues,
      natureLoweredStat,
    );
    const stat = candidates[0];
    if (!stat) break;
    const trim = Math.min(4, coerceNonNegativeInteger(trimmed[stat]), excess);
    trimmed[stat] = coerceNonNegativeInteger(trimmed[stat]) - trim;
    excess -= trim;
  }

  while (excess > 0) {
    const candidates = sortReverseTrimCandidates(
      STAT_ORDER.filter((stat) => coerceNonNegativeInteger(trimmed[stat]) > 0),
      trimmed,
      sourceSpValues,
      natureLoweredStat,
    );
    const stat = candidates[0];
    if (!stat) break;
    const trim = Math.min(4, coerceNonNegativeInteger(trimmed[stat]), excess);
    trimmed[stat] = coerceNonNegativeInteger(trimmed[stat]) - trim;
    excess -= trim;
  }

  return trimmed;
}

function championsSpAllocationToShowdownEvs(values = {}, options = {}) {
  const mapped = mapAllocationValues(values, championsSpToEv);
  return options.trimOverflow ? trimShowdownEvOverflow(mapped, values, options) : mapped;
}

function validateChampionsSpBudget(values = {}) {
  let total = 0;
  for (const stat of STAT_ORDER) {
    const amount = coerceNonNegativeInteger(values[stat]);
    if (amount > CHAMPIONS_SP_PER_STAT_CAP) {
      return { ok: false, reason: 'SP value over per-stat cap' };
    }
    total += amount;
  }
  if (total > CHAMPIONS_SP_TOTAL_CAP) {
    return { ok: false, reason: 'SP total over budget' };
  }
  return { ok: true, total };
}

function detectChampionsSpTeamMode(teamExport) {
  const blocks = splitTeamBlocks(teamExport);
  let hasSp = false;
  let hasEv = false;
  let hasChampionsEv = false;
  let hasStandardEv = false;

  for (const lines of blocks) {
    for (const line of lines) {
      if (/^SPs:/i.test(line)) hasSp = true;
      if (/^EVs:/i.test(line)) {
        hasEv = true;
        const parsed = parseAllocationLine(line, 'EVs:');
        if (parsed.ok && validateChampionsSpBudget(parsed.values).ok) {
          hasChampionsEv = true;
        } else {
          hasStandardEv = true;
        }
      }
    }
  }

  if (hasSp && hasEv) return { mode: 'mixed', blocks };
  if (hasSp) return { mode: 'sp', blocks };
  if (hasEv) {
    if (hasStandardEv) return { mode: 'standard-ev', blocks };
    if (hasChampionsEv) return { mode: 'champions-ev', blocks };
    return { mode: 'ev', blocks };
  }
  return { mode: 'unknown', blocks };
}

function validateChampionsSpTeamShape(teamExport) {
  const detection = detectChampionsSpTeamMode(teamExport);
  const { mode, blocks } = detection;

  if (mode === 'unknown') return { ok: false, mode, reason: 'Unknown team format' };
  if (mode === 'mixed') return { ok: false, mode, reason: 'Mixed team format' };
  if (blocks.length !== 6) return { ok: false, mode, reason: 'Invalid team size' };

  const allocations = [];
  const displayAllocations = [];
  const simulatorAllocations = [];
  const convertedBlocks = [];

  for (const lines of blocks) {
    const spLines = lines.filter((line) => /^SPs:/i.test(line));
    const evLines = lines.filter((line) => /^EVs:/i.test(line));

    if (spLines.length + evLines.length !== 1) {
      return { ok: false, mode, reason: mode === 'sp' ? 'Invalid SP syntax' : 'Invalid EV syntax' };
    }

    const sourceLine = mode === 'sp' ? spLines[0] : evLines[0];
    const parsed = parseAllocationLine(sourceLine, mode === 'sp' ? 'SPs:' : 'EVs:', {
      requireAllStats: mode === 'sp',
    });
    if (!parsed.ok) return { ok: false, mode, reason: parsed.reason };

    const displayValues = mode === 'standard-ev' || mode === 'ev'
      ? evAllocationToChampionsSp(parsed.values, { fillRemainder: true })
      : parsed.values;
    const budget = validateChampionsSpBudget(displayValues);
    if (!budget.ok) return { ok: false, mode, reason: budget.reason };

    allocations.push(parsed.values);
    displayAllocations.push(displayValues);
    simulatorAllocations.push(mode === 'sp' || mode === 'champions-ev'
      ? displayValues
      : parsed.values);
    convertedBlocks.push(lines
      .filter((line) => !isIvLine(line))
      .map((line) => (
        isAllocationLine(line) ? canonicalizeEvLine(displayValues) : line
      )));
  }

  return {
    ok: true,
    mode,
    allocations,
    displayAllocations,
    simulatorAllocations,
    canonicalTeamExport: convertedBlocks.map((lines) => lines.join('\n')).join('\n\n'),
  };
}

function hasExplicitChampionsSpTeamMode(teamExport) {
  const mode = detectChampionsSpTeamMode(teamExport).mode;
  return mode === 'sp' || mode === 'mixed';
}

function convertChampionsSpTeamExportForShowdown(teamExport, formatId) {
  if (formatId !== CHAMPIONS_SP_FORMAT_ID) return teamExport;

  const detection = detectChampionsSpTeamMode(teamExport);
  if (detection.mode === 'mixed') {
    const validation = validateChampionsSpTeamShape(teamExport);
    throw new Error(`Invalid Champions SP team export: ${validation.reason}`);
  }
  if (detection.mode !== 'sp' && detection.mode !== 'champions-ev') return teamExport;

  const validation = validateChampionsSpTeamShape(teamExport);
  if (!validation.ok) {
    throw new Error(`Invalid Champions SP team export: ${validation.reason}`);
  }

  return detection.blocks.map((lines, index) => {
    const allocation = validation.simulatorAllocations[index] || validation.allocations[index] || {};
    return lines.map((line) => (
      isAllocationLine(line) ? canonicalizeEvLine(allocation) : line
    )).join('\n');
  }).join('\n\n');
}

function buildChampionsSpDisplayTeamExport(teamExport, formatId) {
  if (formatId !== CHAMPIONS_SP_FORMAT_ID) return teamExport;
  const validation = validateChampionsSpTeamShape(teamExport);
  if (!validation.ok) return teamExport;
  return validation.canonicalTeamExport;
}

module.exports = {
  CHAMPIONS_SP_FORMAT_ID,
  CHAMPIONS_SP_PER_STAT_CAP,
  CHAMPIONS_SP_POINT_TO_EV,
  CHAMPIONS_SP_TOTAL_CAP,
  STAT_ORDER,
  buildChampionsSpDisplayTeamExport,
  canonicalizeEvLine,
  canonicalizeSpLine,
  championsSpAllocationToShowdownEvs,
  championsSpToEv,
  convertChampionsSpTeamExportForShowdown,
  detectChampionsSpTeamMode,
  evAllocationToChampionsSp,
  evToChampionsSp,
  hasExplicitChampionsSpTeamMode,
  parseAllocationLine,
  splitTeamBlocks,
  validateChampionsSpTeamShape,
  validateChampionsSpBudget,
};
