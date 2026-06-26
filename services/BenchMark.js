const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  PROFESSOR_AEGIS_SLATE,
  PROFESSOR_AEGIS_BLUE,
  DIVIDER,
  cleanList,
  buildStoryBlock,
  buildMenuSelect,
  makeCustomId,
} = require('./menuCommon');

const MODE_S_TIER_TOP = 's-tier-top-tournament';
const MODE_SA_TIER_TOP4 = 'sa-tier-top4-tournament';
const MODE_ALL_META_TOURNAMENT = 'all-meta-all-tournament';
const MODE_FULL_META_RANDOM_100 = 'full-meta-random-100';
const MODE_GAUNTLET_FULL_META_200 = 'gauntlet-full-meta-200';
const CHAMPIONS_FORMAT_ID = 'gen9championscustomgame';
const CHAMPIONSLAB_POOL_PRESETS = [
  { mode: MODE_S_TIER_TOP, label: 'S-Tier + Top Tournament', baseDescription: 'Top signal meta test pool', emoji: '🏆' },
  { mode: MODE_SA_TIER_TOP4, label: 'S/A Tier + Top 4 Tournament', baseDescription: 'High-tier teams plus top finishes', emoji: '💎' },
  { mode: MODE_ALL_META_TOURNAMENT, label: 'All Meta + All Tournament', baseDescription: 'All active tournament teams', emoji: '🌐' },
  { mode: MODE_FULL_META_RANDOM_100, label: 'Full Meta + 100 Random', baseDescription: 'Full meta sample plan', emoji: '🎲' },
  { mode: MODE_GAUNTLET_FULL_META_200, label: 'GAUNTLET - Full Meta + 200 Random', baseDescription: 'Deep gauntlet coverage', emoji: '⚔️' },
];

function normalizeBenchMarkSuiteMode(mode = null) {
  const value = String(mode || '').trim().toLowerCase();
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
  const normalized = aliases[value] || value;
  return CHAMPIONSLAB_POOL_PRESETS.some((preset) => preset.mode === normalized)
    ? normalized
    : MODE_ALL_META_TOURNAMENT;
}

function isBenchMarkSuiteChampionFormat(formatId = null) {
  return String(formatId || CHAMPIONS_FORMAT_ID).trim().toLowerCase() === CHAMPIONS_FORMAT_ID;
}

function sanitizeInlineProgressStatus(text) {
  const value = String(text || '').trim();
  if (!value) return value;
  return value
    .replace(/\s+[◼▭#\-\[\]]+\s+\d+%$/u, '')
    .replace(/\s+•\s+\d+%$/u, '')
    .trim();
}

function buildBlockProgressBarFromPercent(percentValue) {
  const normalized = Number(percentValue);
  if (!Number.isFinite(normalized)) return null;
  const clamped = Math.max(0, Math.min(100, Math.round(normalized)));
  const filled = Math.max(0, Math.min(10, Math.round(clamped / 10)));
  return `${'◼'.repeat(filled)}${'▭'.repeat(10 - filled)} ${clamped}%`;
}

function formatLiveProgressLine(line) {
  const value = String(line || '').trim();
  if (!value) return null;
  const percentMatch = value.match(/(\d{1,3})%/);
  const looksLikeLegacyBar = /^\[[#\-\s]+\]\s*\d{1,3}%$/u.test(value);
  if (percentMatch && (looksLikeLegacyBar || value.startsWith('['))) {
    return buildBlockProgressBarFromPercent(percentMatch[1]) || value;
  }
  return value;
}

function splitLiveProgressTokens(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw
    .split(/\s+•\s+|\r?\n+/)
    .map((part) => String(part || '').trim())
    .filter(Boolean);
}

function extractBenchMarkSettings(tokens = []) {
  const settings = { mode: null, sample: null, setLength: null };
  let sawSettings = false;
  const remaining = [];

  tokens.forEach((token) => {
    const raw = String(token || '').trim().replace(/\.\.\.$/, '').trim();
    if (!raw) return;
    const lower = raw.toLowerCase();

    if (lower === 'submitting benchmark suite to worker') {
      sawSettings = true;
      return;
    }

    const modeMatch = raw.match(/^submitting benchmark suite with\s+(.+)$/i);
    if (modeMatch) {
      settings.mode = modeMatch[1].trim();
      sawSettings = true;
      return;
    }

    if (/^(s-tier \+ top tournament|s\/a tier \+ top 4 tournament|all meta \+ all tournament|full meta \+ 100 random|gauntlet - full meta \+ 200 random|custom only)$/i.test(raw)) {
      settings.mode = raw;
      sawSettings = true;
      return;
    }

    if (/^\d+\s+opponents?$/i.test(raw) || /^all available opponents$/i.test(raw)) {
      settings.sample = raw;
      sawSettings = true;
      return;
    }

    if (/^bo\d+$/i.test(raw)) {
      settings.setLength = raw.toUpperCase();
      sawSettings = true;
      return;
    }

    remaining.push(raw);
  });

  return { settings, sawSettings, remaining };
}

function shouldDropGenericLiveLine(line) {
  const value = String(line || '').trim();
  if (!value) return true;
  const lower = value.toLowerCase();
  if (/^\d{1,3}%$/.test(value)) return true;
  if (lower === 'benchmark suite running.') return true;
  if (lower === 'benchmark suite queued.') return true;
  if (lower === 'benchmark suite status updated.') return true;
  if (lower === 'submitting benchmark suite to worker') return true;
  return false;
}

function buildBenchmarkSuiteLiveLines(detailText = null) {
  const rawTokens = splitLiveProgressTokens(detailText);
  if (!rawTokens.length) return [];

  const formattedTokens = rawTokens.map((token) => formatLiveProgressLine(token)).filter(Boolean);
  const { remaining } = extractBenchMarkSettings(formattedTokens);

  let progressBar = null;
  let opponents = null;
  let battles = null;
  let record = null;
  let slots = null;
  let simWorkers = null;
  let queueSpot = null;
  let waiting = null;
  let safeMode = null;
  let state = null;
  let completion = null;
  let opponent = null;
  let step = null;

  remaining.forEach((token) => {
    const value = String(token || '').trim();
    if (!value || shouldDropGenericLiveLine(value)) return;
    if (!progressBar && /[◼▭]+\s+\d{1,3}%$/u.test(value)) {
      progressBar = value;
      return;
    }
    if (!opponents && /^opponents?\s+\d+\/\d+$/i.test(value)) {
      opponents = value.replace(/^opponents?\s+/i, '');
      return;
    }
    if (!battles && /^battles?\s+\d+\s+completed$/i.test(value)) {
      battles = value.replace(/^battles?\s+/i, '');
      return;
    }
    if (!record && /^record\s+\d+W\s+-\s+\d+L\s+-\s+\d+T$/i.test(value)) {
      record = value.replace(/^record\s*/i, '');
      return;
    }
    if (!slots && /^slots\s+\d+\/\d+\s+active$/i.test(value)) {
      slots = value.replace(/^slots\s+/i, '');
      return;
    }
    if (!slots && /^workers\s+\d+\/\d+\s+assigned$/i.test(value)) {
      const match = value.match(/^workers\s+(\d+)\/(\d+)\s+assigned$/i);
      if (match) {
        const assigned = Math.max(0, Number(match[1]) || 0);
        const total = Math.max(1, Number(match[2]) || 1);
        slots = `${Math.min(assigned, total)}/${total} active`;
      } else {
        slots = value.replace(/^workers\s+/i, '').replace(/\s+assigned$/i, ' active');
      }
      return;
    }
    if (simWorkers && /^\d+\s+(?:ready|live|spawning)$/i.test(value)) {
      simWorkers = `${simWorkers} • ${value}`;
      return;
    }
    if (!simWorkers && /^sim\s+workers\s+/i.test(value)) {
      simWorkers = value.replace(/^sim\s+workers\s+/i, '');
      return;
    }
    if (!queueSpot && /^queue\s+spot\s+\d+$/i.test(value)) {
      queueSpot = value.replace(/^queue\s+/i, '');
      return;
    }
    if (!safeMode && /^safe\s+mode\s+active$/i.test(value)) {
      safeMode = 'Safe Mode Active';
      return;
    }
    if (!waiting && /^waiting\s+for\s+battle\s+workers$/i.test(value)) {
      waiting = value;
      return;
    }
    if (!state && /^state:\s+/i.test(value)) {
      state = value.replace(/^state:\s*/i, '');
      return;
    }
    if (!completion && /^main\s+simulation\s+complete$/i.test(value)) {
      completion = value;
      return;
    }
    if (!opponent && /^opponent\s+/i.test(value)) {
      opponent = value.replace(/^opponent\s+/i, '');
      return;
    }
    if (!step && !/^submitting benchmark suite with\s+/i.test(value)) {
      step = value;
    }
  });

  const lines = [];
  const preparingOpponents = isOpponentPreparationStep(step);
  if (preparingOpponents) {
    const preparationLabel = parseOpponentPreparationLabel(step);
    const preparedCount = formatOpponentPreparationCount(opponents);
    const preparationTitle = preparationLabel
      ? `Preparing opponents for ${preparationLabel}`
      : 'Preparing opponents';
    lines.push(progressBar ? `🧪 ${preparationTitle} ${progressBar}` : `🧪 ${preparationTitle}`);
    if (preparedCount) lines.push(`📦 Prepared: ${preparedCount}`);
    lines.push('🧵 Battle workers: Ready; waiting for opponent prep');
    if (safeMode) lines.push(`🛡️ ${safeMode}`);
    return lines.filter(Boolean);
  }

  if (progressBar) {
    const mode = waiting || queueSpot ? 'Waiting' : 'Running';
    lines.push(`🧪 Matchup Report: ${mode} ${progressBar}`);
  } else if (completion) {
    lines.push(`✅ ${completion}`);
  }
  if (opponents || battles || record || slots || simWorkers || queueSpot || safeMode || state || opponent || waiting) {
    if (lines.length) lines.push('');
    if (waiting) lines.push('⏳ Waiting for battle workers');
    if (queueSpot) lines.push(`👥 ${queueSpot}`);
    if (opponents) lines.push(`👥 Opponents ${opponents}`);
    if (battles) lines.push(`⚔️ Battles ${battles}`);
    if (record) lines.push(`🏆 Record ${record}`);
    if (slots) lines.push(`🧵 Slots ${slots}`);
    if (simWorkers) lines.push(`⚙️ Sim workers ${simWorkers}`);
    if (safeMode) lines.push(`🛡️ ${safeMode}`);
    if (opponent) lines.push(`🎯 ${opponent}`);
    if (state) lines.push(`📍 State: ${state}`);
  } else if (step && step.toLowerCase() !== 'submitting benchmark suite to worker') {
    if (lines.length) lines.push('');
    lines.push(`⚡ ${step}`);
  }

  return lines.filter(Boolean);
}

function parseOpponentPreparationLabel(step) {
  const value = String(step || '').trim();
  if (!value) return null;
  const chunkMatch = value.match(/^Preparing\s+(.+?)\s+chunk\s+\d+\/\d+/i);
  const rawLabel = chunkMatch ? chunkMatch[1] : '';
  if (/^all meta \+ all tournament$/i.test(rawLabel)) return 'All Meta + All Tournament';
  if (/^championlab opponent$/i.test(rawLabel)) return 'ChampionLab opponents';
  if (rawLabel) return rawLabel;
  if (/^Preparing opponents/i.test(value)) return 'selected opponents';
  return null;
}

function isOpponentPreparationStep(step) {
  const value = String(step || '').trim();
  return /^Preparing\s+(All Meta \+ All Tournament|ChampionLab opponent|opponents?)/i.test(value);
}

function formatOpponentPreparationCount(opponents) {
  const value = String(opponents || '').trim();
  return value ? value.replace(/\s*\/\s*/g, ' / ') : null;
}

function buildGenericLiveLines(detailText = null) {
  return splitLiveProgressTokens(detailText)
    .map((token) => formatLiveProgressLine(token))
    .filter((token) => token && !shouldDropGenericLiveLine(token));
}

function parseLeadPairProgressCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function buildBenchMarkSuiteLeadPairProgressBlock(progress = {}) {
  const phase = String(progress?.phase || '').toLowerCase();
  const step = String(progress?.currentStep || '').trim();
  const stepLower = step.toLowerCase();
  const leadPairSweepStatus = String(progress?.leadPairSweepStatus || '').toLowerCase();
  const coreSweepStatus = String(progress?.coreSweepStatus || '').toLowerCase();
  const preparingLeadPairs = /preparing\s+lead-pair\s+sweep/i.test(step);
  const preparingCores = /preparing\s+core\s+sweep/i.test(step);
  const leadPairSweepActive = phase === 'lead-pair-sweep'
    || (progress?.leadPairSweep === true && leadPairSweepStatus && leadPairSweepStatus !== 'completed');
  const coreSweepActive = phase === 'core-sweep'
    || (progress?.coreSweep === true && coreSweepStatus && coreSweepStatus !== 'completed')
    || /^testing\s+top\s+\d+\s+core\s+finalist/i.test(step);

  if (preparingLeadPairs) {
    return {
      title: 'Lead Pair Sweep',
      lines: [
        '🧮 Pre-scoring lead pairs...',
        '📍 State: Preparing lead-pair sweep',
      ],
    };
  }

  if (preparingCores) {
    return {
      title: 'Core Sweep',
      lines: [
        '🧮 Pre-scoring cores...',
        '📍 State: Preparing core sweep',
      ],
    };
  }

  if (coreSweepActive) {
    const coresProcessed = parseLeadPairProgressCount(progress.coreSweepCoresProcessed);
    const coresTotal = parseLeadPairProgressCount(progress.coreSweepCoresTotal);
    const gamesProcessed = parseLeadPairProgressCount(progress.coreSweepGamesProcessed);
    const gamesTotal = parseLeadPairProgressCount(progress.coreSweepGamesTotal);
    const currentCoreNumber = coresTotal
      ? Math.max(1, Math.min(coresTotal, (coresProcessed ?? 0) + 1))
      : null;
    const coreProgressText = currentCoreNumber && coresTotal
      ? `${currentCoreNumber}/${coresTotal}`
      : 'calculating...';
    const gameProgressText = gamesTotal !== null
      ? `${gamesProcessed ?? 0}/${gamesTotal}`
      : 'calculating...';
    return {
      title: 'Core Sweep',
      lines: [
        `🧪 Testing top 2 cores... ${coreProgressText}`,
        `🎮 Game progress: ${gameProgressText}`,
        '🧵 Slots paused for core processing',
        stepLower ? `📍 State: ${sanitizeInlineProgressStatus(step)}` : '📍 State: Core sweep running',
      ],
    };
  }

  if (!leadPairSweepActive) return null;

  const pairsProcessed = parseLeadPairProgressCount(progress.leadPairPairsProcessed);
  const pairsTotal = parseLeadPairProgressCount(progress.leadPairPairsTotal);
  const gamesProcessed = parseLeadPairProgressCount(progress.leadPairGamesProcessed);
  const gamesTotal = parseLeadPairProgressCount(progress.leadPairGamesTotal);

  const currentPairNumber = pairsTotal
    ? Math.max(1, Math.min(pairsTotal, (pairsProcessed ?? 0) + 1))
    : null;
  const pairProgressText = currentPairNumber && pairsTotal
    ? `${currentPairNumber}/${pairsTotal}`
    : 'calculating...';
  const gameProgressText = gamesTotal !== null
    ? `${gamesProcessed ?? 0}/${gamesTotal}`
    : 'calculating...';

  return {
    title: 'Lead Pair Sweep',
    lines: [
      `🧪 Testing top 5 lead pairs... ${pairProgressText}`,
      `🎮 Game progress: ${gameProgressText}`,
      '🧵 Slots paused for lead-pair processing',
      stepLower ? `📍 State: ${sanitizeInlineProgressStatus(step)}` : '📍 State: Lead-pair sweep running',
    ],
  };
}

function buildLiveProgressBlock(title, lines = []) {
  const safeTitle = String(title || '').trim();
  const safeLines = Array.isArray(lines)
    ? lines.map((line) => String(line || '').trim()).filter(Boolean)
    : [];
  if (!safeTitle || !safeLines.length) return null;
  const normalizedTitle = safeTitle.toLowerCase();
  if (normalizedTitle === 'matchup report' || normalizedTitle === 'benchmark suite') {
    return `\`\`\`txt\n${safeLines.join('\n')}\n\`\`\``;
  }
  return `\`\`\`txt\n[${safeTitle}]\n${safeLines.join('\n')}\n\`\`\``;
}


function buildBenchMarkMenuEmbed({
  queueStatusText = 'Idle',
  matchupStatusText = 'Idle',
  simScaffoldStatusText = 'Idle',
  suiteStatusText = 'Idle',
  warmupStatusText = null,
  warmupDetailText = null,
  suiteConfigText = 'Featured Only • 4 opponents • Bo3',
  readinessText = 'Awaiting team submission',
  hasSubmittedTeam = false,
  submittedTeamStatusText = null,
  teamPreviewText = 'No team submitted',
  liveProgressBlocks = [],
  suiteDetailText = null,
}) {
  const normalizedLiveBlocks = Array.isArray(liveProgressBlocks)
    ? liveProgressBlocks
        .map((block) => {
          const title = String(block?.title || '').trim();
          const rawLines = Array.isArray(block?.lines) ? block.lines : [];
          const lines = title.toLowerCase() === 'benchmark suite'
            ? buildBenchmarkSuiteLiveLines(rawLines.join(' • '))
            : buildGenericLiveLines(rawLines.join(' • '));
          return buildLiveProgressBlock(title, lines);
        })
        .filter(Boolean)
    : [];

  const fallbackSuiteBlock = buildLiveProgressBlock(
    'Simulation',
    buildBenchmarkSuiteLiveLines(suiteDetailText),
  );

  const liveBodies = normalizedLiveBlocks.length
    ? normalizedLiveBlocks
    : (fallbackSuiteBlock ? [fallbackSuiteBlock] : []);

  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_SLATE)
    .setTitle('⚔️ Professor Aegis • Battle Simulator')
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"Battle Simulator is where your saved team, simulations, reports, and settings live."',
        ]),
        warmupStatusText ? `**System Warm-up:** ${warmupStatusText}` : null,
        warmupDetailText ? `**Warm-up Progress:** ${warmupDetailText}` : null,
        `**Submitted Team:** ${submittedTeamStatusText || (hasSubmittedTeam ? 'Yes ✅' : 'No ❌')}`,
        `**Team Status:** ${teamPreviewText}`,
        `**Simulation:** ${sanitizeInlineProgressStatus(suiteStatusText)}`,
        `**Settings:** ${suiteConfigText}`,
        `**Ready State:** ${readinessText}`,
        ...(liveBodies.length
          ? ['', '**Live Progress**', ...liveBodies.flatMap((body, index) => (index === 0 ? [body] : ['', body]))]
          : []),
      ]),
    );
}

function buildBenchMarkMenuShellEmbed({
  teamPreviewText = 'Loading saved team status...',
  suiteStatusText = 'Loading saved state...',
  suiteConfigText = 'Loading saved settings...',
  readinessText = 'Professor Aegis is opening the Battle Simulator',
  notice = null,
} = {}) {
  const safeNotice = String(notice || '').trim();
  return buildBenchMarkMenuEmbed({
    submittedTeamStatusText: 'Checking saved team...',
    teamPreviewText,
    suiteStatusText,
    suiteConfigText,
    readinessText: safeNotice || readinessText,
    liveProgressBlocks: [{
      title: 'Simulation',
      lines: [
        '⚔️ Opening Battle Simulator ▰▰▱▱▱▱▱▱▱▱ 20%',
        '⚡ Loading lightweight menu metadata...',
      ],
    }],
  });
}

function buildBenchMarkMenuRow({
  ownerId,
  hasSubmittedTeam = false,
  hasLastReport = false,
  hasActiveJob = false,
  hasLastMatchupEval = false,
  hasActiveMatchupJob = false,
  hasLastSimScaffold = false,
  hasActiveSimJob = false,
  hasLastSuiteReport = false,
  hasActiveSuiteJob = false,
  hasMatchArchiveReady = false,
  benchmarkWarmupActive = false,
  hasHistoryProfiles = false,
}) {
  const options = [{
    label: hasSubmittedTeam ? 'Edit Team' : 'Submit Team',
    description: hasSubmittedTeam ? 'Update the Showdown export used by Battle Simulator' : 'Paste a Showdown export for Battle Simulator',
    value: 'submit_team',
    emoji: '📝',
  }];

  if (hasSubmittedTeam) {
    options.push({
      label: 'View Submitted Team',
      description: 'Review the exact Showdown export on file',
      value: 'view_team',
      emoji: '📘',
    });
  }

  if (hasHistoryProfiles) {
    options.push({
      label: 'Load Team',
      description: 'Restore a previous Battle Simulator team profile',
      value: 'load_team',
      emoji: '📥',
    });
  }

  if (hasSubmittedTeam) {
    if (benchmarkWarmupActive) {
      options.push({
        label: 'Simulator Warm-up In Progress',
        description: 'Professor Aegis is pre-warming the simulator. Please wait for it to finish.',
        value: 'benchmark_warmup_wait',
        emoji: '⏳',
      });
    } else {
      options.push(
        {
          label: hasActiveSuiteJob ? 'Stop Simulation' : 'Run Simulation',
          description: hasActiveSuiteJob ? 'Request stop for your current simulation job' : 'Run a full Battle Simulator gauntlet',
          value: hasActiveSuiteJob ? 'stop_benchmark_suite' : 'run_benchmark_suite',
          emoji: hasActiveSuiteJob ? '🛑' : '🧬',
        },
      );
    }
  }

  if (hasActiveSuiteJob && !benchmarkWarmupActive) {
    options.push({
      label: 'Check Simulation',
      description: 'Refresh the current simulation progress',
      value: 'check_benchmark_suite',
      emoji: '🔁',
    });
  }

  if (hasLastSuiteReport) {
    options.push({
      label: 'Simulation Report',
      description: 'Open the most recently completed simulation report',
      value: 'view_last_benchmark_suite',
      emoji: '🏆',
    });
  }

  options.push({
    label: 'History',
    description: 'Open recent previous Simulation Reports',
    value: 'simulation_history',
    emoji: '🗂️',
  });

  if (hasSubmittedTeam && !benchmarkWarmupActive) {
    options.push({
      label: 'Settings',
      description: 'Choose mode, opponents, and games per opponent',
      value: 'configure_benchmark_suite',
      emoji: '⚙️',
    });

    options.push({
      label: 'Instant Mode Preview',
      description: 'View the locked non-canonical Instant Mode shell',
      value: 'instant_mode_shell',
      emoji: '⚡',
    });
  }

  options.push({ label: 'Back to Menu', description: 'Return to the academy terminal', value: 'back_main', emoji: '⬅️' });

  return buildMenuSelect(makeCustomId('benchmark_select', ownerId), 'Choose a Battle Simulator action.', options);
}

function buildBenchMarkMenuShellRow({ ownerId }) {
  return buildBenchMarkMenuRow({
    ownerId,
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
  });
}

function buildBenchMarkInstantModeShellEmbed({ username = 'Trainer', notice = null } = {}) {
  const noticeText = String(notice || '').trim();
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle(`⚡ Professor Aegis • ${username}'s Instant Mode Preview`)
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"Instant Mode is a future projection path. Pokemon Showdown remains the trusted simulator."',
        ]),
        noticeText ? `**Status:** ${noticeText}` : '**Status:** Experimental preview shell',
        '',
        '**Canonical Simulation:** Run Simulation remains the trusted Pokemon Showdown path.',
        '**Run Instant Simulation:** Experimental one-time Instant Projection; no persistent writes.',
        '**Run EV Optimizer:** Future feature, locked until Instant Mode parity is approved.',
        '',
        'No history, archives, training data, confidence memory, or EV optimizer output is created here.',
      ]),
    );
}

function buildBenchMarkInstantModeShellRow({ ownerId }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(makeCustomId('benchmark_instant_run', ownerId))
      .setLabel('Run Instant Simulation')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⚡'),
    new ButtonBuilder()
      .setCustomId(makeCustomId('benchmark_instant_ev_optimizer', ownerId))
      .setLabel('Run EV Optimizer')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔒')
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(makeCustomId('benchmark_instant_back', ownerId))
      .setLabel('Back to Battle Simulator')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⬅️'),
  );
}

function formatInstantProjectionDate(value) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatInstantProjectionTeamPreview(result = {}) {
  const entries = Array.isArray(result?.teamPreview?.pokemon)
    ? result.teamPreview.pokemon
    : [];
  const lines = entries
    .slice(0, 6)
    .map((entry, index) => {
      const species = String(entry?.species || '').trim() || `Slot ${index + 1}`;
      const item = String(entry?.item || '').trim();
      return `${index + 1}. ${species}${item ? ` @ ${item}` : ''}`;
    });
  return lines.length ? lines.join('\n') : 'Team preview unavailable.';
}

function getInstantProjectionPreviewEntry(result = {}, slotNumber = 1) {
  const entries = Array.isArray(result?.teamPreview?.pokemon)
    ? result.teamPreview.pokemon
    : [];
  const entry = entries.find((item) => Number(item?.slot) === Number(slotNumber))
    || entries[Number(slotNumber) - 1]
    || null;
  if (!entry) return `Slot ${slotNumber}`;
  const species = String(entry.species || `Slot ${slotNumber}`).trim();
  const item = String(entry.item || '').trim();
  return item ? `${species} @ ${item}` : species;
}

function buildInstantProjectionPersistentLines() {
  return [
    '**Saved Data:** None created.',
    '- Your latest Simulation Report and History stay untouched.',
    '- No Simulation Archive or replay files are created.',
    '- No Training Mode or confidence memory is updated.',
  ];
}

function buildInstantProjectionOverviewLines(result = {}) {
  const confidenceLabel = String(result?.confidence?.label || 'Unvalidated').trim();
  const engineLabel = String(result?.engineVersion || 'instant-projection').trim();
  return [
    '# Instant Projection Scout Card',
    'Fast preview only • 0 simulated battles • Not Showdown-equivalent',
    overviewSpacer(),
    '**What This Means**',
    '```txt',
    'This page confirms Aegis can read your saved team and build a temporary preview.',
    'Use Run Simulation when you need trusted matchup results, threats, leads, or cores.',
    '```',
    '',
    '**Team Preview**',
    `\`\`\`txt\n${formatInstantProjectionTeamPreview(result)}\n\`\`\``,
    '',
    '**Instant Status**',
    `\`\`\`txt\nMode       Instant Projection\nTrust      ${confidenceLabel}\nEngine     ${engineLabel}\nCanonical  No\nArchive    Not available\n\`\`\``,
    '',
    ...buildInstantProjectionPersistentLines(),
  ];
}

function buildInstantProjectionThreatLines(result = {}) {
  const limitations = Array.isArray(result?.knownLimitations)
    ? result.knownLimitations.slice(0, 3)
    : ['No approved Instant threat estimator is wired yet.'];
  return [
    '# Threats',
    'Instant threat scoring is locked until an approved estimator exists.',
    overviewSpacer(),
    '**Current Read**',
    '```txt',
    'Threat Scoring   Locked',
    'Trusted Path     Run Simulation',
    'Archive Output   Not available in Instant Mode',
    '',
    'No Instant threat rankings are shown yet so this page does not pretend',
    'to know which Pokemon or archetypes beat you.',
    '```',
    '',
    '**Why It Is Locked**',
    limitations.map((line) => `- ${line}`).join('\n'),
  ];
}

function buildInstantProjectionLeadLines(result = {}) {
  const preview = result?.teamPreview || {};
  const leads = Array.isArray(preview.leads) && preview.leads.length ? preview.leads : [1, 2];
  const reserves = Array.isArray(preview.reserves) && preview.reserves.length ? preview.reserves : [3, 4];
  return [
    '# Leads',
    'Bring-6 choose-4 preview. This is a clean team-read preview, not a ranked lead-pair sweep.',
    overviewSpacer(),
    '**Preview Line**',
    '```txt',
    `Lead 1    ${getInstantProjectionPreviewEntry(result, leads[0])}`,
    `Lead 2    ${getInstantProjectionPreviewEntry(result, leads[1])}`,
    '',
    `Back 1    ${getInstantProjectionPreviewEntry(result, reserves[0])}`,
    `Back 2    ${getInstantProjectionPreviewEntry(result, reserves[1])}`,
    '```',
    '',
    '**How To Use This**',
    '```txt\nUse this tab to confirm Instant Mode read the team correctly.\nRun Simulation for trusted lead recommendations.\n```',
  ];
}

function buildInstantProjectionCoreLines(result = {}) {
  const preview = result?.teamPreview || {};
  const selectedSlots = Array.isArray(preview.selectedSlots) && preview.selectedSlots.length
    ? preview.selectedSlots
    : [1, 2, 3, 4];
  const coreLines = selectedSlots
    .slice(0, 4)
    .map((slot, index) => `Slot ${index + 1}    ${getInstantProjectionPreviewEntry(result, slot)}`);
  return [
    '# Cores',
    'Selected four-Pokemon preview. This is not a scored core sweep yet.',
    overviewSpacer(),
    '**Preview Core**',
    '```txt',
    ...coreLines,
    '```',
    '',
    '**How To Use This**',
    '```txt\nUse this tab to see the temporary four-Pokemon preview.\nRun Simulation for trusted core rankings and matchup guidance.\n```',
  ];
}

function buildInstantProjectionTabLines({ result = null, error = null, reportTab = 'overview' } = {}) {
  if (error) {
    const safeMessage = String(error?.message || 'Instant Projection failed closed.').trim();
    return [
      '# Instant Projection [Failed Closed]',
      `Instant Projection could not produce a one-time result. ${safeMessage}`,
      '',
      ...buildInstantProjectionPersistentLines(),
    ];
  }

  const selected = normalizeBenchMarkSuiteReportTab(reportTab);
  if (selected === 'threats') return buildInstantProjectionThreatLines(result);
  if (selected === 'leads') return buildInstantProjectionLeadLines(result);
  if (selected === 'core') return buildInstantProjectionCoreLines(result);
  return buildInstantProjectionOverviewLines(result);
}

function buildBenchMarkInstantProjectionResultEmbed({
  username = 'Trainer',
  result = null,
  error = null,
  reportTab = 'overview',
} = {}) {
  const failed = Boolean(error);
  const selected = normalizeBenchMarkSuiteReportTab(reportTab);
  const tabTitle = selected === 'overview'
    ? 'Overview'
    : selected === 'threats'
      ? 'Threats'
      : selected === 'core'
        ? 'Cores'
        : 'Leads';
  const generatedText = failed ? null : formatInstantProjectionDate(result?.generatedAt);
  const expiresText = failed ? null : formatInstantProjectionDate(result?.expiresAt);
  const tabLines = buildInstantProjectionTabLines({ result, error, reportTab: selected });

  return new EmbedBuilder()
    .setColor(failed ? 0xED4245 : PROFESSOR_AEGIS_BLUE)
    .setTitle(`⚡ Professor Aegis • ${username}'s Instant Projection • ${tabTitle}`)
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"Instant Projection is experimental estimator output. Pokemon Showdown remains the trusted canonical simulator."',
        ]),
        DIVIDER,
        failed ? '**Status:** Failed closed' : '**Status:** One-time private Instant Projection result',
        '**Mode:** Instant Projection • Experimental • Non-canonical',
        '**Canonical:** No - not Showdown-equivalent.',
        failed ? null : `**Generated:** ${generatedText}`,
        failed ? null : `**Expires:** ${expiresText}`,
        '',
        ...tabLines,
      ]),
    );
}

function buildBenchMarkInstantProjectionReportTabRow({
  ownerId,
  selectedReportTab = 'overview',
} = {}) {
  const selected = normalizeBenchMarkSuiteReportTab(selectedReportTab);
  const options = [
    {
      label: 'Overview',
      description: selected === 'overview' ? 'Current Instant Projection tab' : 'Clean summary and team preview',
      value: 'overview',
      emoji: selected === 'overview' ? '✅' : '📋',
    },
    {
      label: 'Threats',
      description: selected === 'threats' ? 'Current Instant Projection tab' : 'Threat scoring status and trusted path',
      value: 'threats',
      emoji: selected === 'threats' ? '✅' : '🔴',
    },
    {
      label: 'Leads',
      description: selected === 'leads' ? 'Current Instant Projection tab' : 'Bring-6 choose-4 lead preview',
      value: 'leads',
      emoji: selected === 'leads' ? '✅' : '🧭',
    },
    {
      label: 'Cores',
      description: selected === 'core' ? 'Current Instant Projection tab' : 'Selected four-Pokemon core preview',
      value: 'core',
      emoji: selected === 'core' ? '✅' : '🧩',
    },
    {
      label: 'Back to Battle Simulator',
      description: 'Return to the main Battle Simulator menu',
      value: 'back_benchmark',
      emoji: '⬅️',
    },
  ];
  return buildMenuSelect(makeCustomId('benchmark_instant_report_tab', ownerId), 'Choose an Instant Projection tab.', options);
}

function buildBenchMarkInstantProjectionResultRow({ ownerId }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(makeCustomId('benchmark_instant_ev_optimizer', ownerId))
      .setLabel('EV Optimizer Locked')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔒')
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(makeCustomId('benchmark_instant_back', ownerId))
      .setLabel('Back to Battle Simulator')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⬅️'),
  );
}


function buildBenchMarkSuiteDownloadRow({
  ownerId,
  hasPaperReportReady = false,
  hasMatchArchiveReady = false,
} = {}) {
  const buttons = [];
  if (hasPaperReportReady) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(makeCustomId('benchmark_download_paper_report', ownerId))
        .setLabel('Download Paper Report')
        .setEmoji('📄')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (hasMatchArchiveReady) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(makeCustomId('benchmark_download_archive', ownerId))
        .setLabel('Download Simulation Archive')
        .setEmoji('📦')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (!buttons.length) return null;
  return new ActionRowBuilder().addComponents(...buttons);
}

function buildMatchArchiveButtonRow({ ownerId, hasMatchArchiveReady = false }) {
  return buildBenchMarkSuiteDownloadRow({
    ownerId,
    hasPaperReportReady: false,
    hasMatchArchiveReady,
  });
}

function humanizeBenchMarkSuiteMode(mode = MODE_ALL_META_TOURNAMENT) {
  const value = normalizeBenchMarkSuiteMode(mode);
  const preset = CHAMPIONSLAB_POOL_PRESETS.find((entry) => entry.mode === value);
  return preset?.label || 'All Meta + All Tournament';
}

function humanizeBenchMarkSuiteFormat(formatId = 'gen9championscustomgame') {
  const value = String(formatId || '').trim().toLowerCase();
  if (value === 'gen9benchmarkdoublesag') return 'Standard';
  return 'Champions';
}

function describeBenchMarkSuiteBattleBudget(config = {}) {
  const budget = Number(config.battle_budget || config.battleBudget || 200);
  return `${Number.isFinite(budget) ? budget : 200} Battles`;
}

function formatBenchMarkCountText(count) {
  const parsed = Number(count);
  return Number.isFinite(parsed) && parsed >= 0 ? `${parsed} teams` : 'count unavailable';
}

function getBenchMarkModeCountText(mode = '', benchmarkModes = []) {
  const metadata = findBenchMarkModeMetadata(benchmarkModes, normalizeBenchMarkSuiteMode(mode));
  return formatBenchMarkCountText(metadata?.availableOpponents);
}

function describeBenchMarkSuiteModeWithCount(mode = '', benchmarkModes = []) {
  return `${humanizeBenchMarkSuiteMode(mode)} (${getBenchMarkModeCountText(mode, benchmarkModes)})`;
}

function buildBenchMarkSuiteConfigEmbed({ config = {}, benchmarkModes = [], benchmarkWarmupActive = false, hasSubmittedTeam = true, hasActiveSuiteJob = false }) {
  const modeText = describeBenchMarkSuiteModeWithCount(config.mode, benchmarkModes);
  const formatText = humanizeBenchMarkSuiteFormat(config.format_id);
  const battleBudgetText = describeBenchMarkSuiteBattleBudget(config);
  const isChampionFormat = isBenchMarkSuiteChampionFormat(config.format_id);
  const battleBudgetLabel = isChampionFormat ? 'Champions Battle Budget' : 'Battles per Matchup';
  const gamesText = isBenchMarkSuiteChampionFormat(config.format_id)
    ? 'BO1 allocation'
    : `BO${Number(config.games_per_opponent || 1)}`;

  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_SLATE)
    .setTitle('🧪 Professor Aegis • Battle Simulator Settings')
    .setDescription(
      cleanList([
        'Current Settings',
        `Format: ${formatText}`,
        `Opponent Pool: ${modeText}`,
        `${battleBudgetLabel}: ${battleBudgetText}`,
        `Series: ${gamesText}`,
        '',
        'Choose a setting to adjust.',
        normalizeBenchMarkSuiteMode(config.mode) === MODE_ALL_META_TOURNAMENT ? '**Note:** All Meta + All Tournament uses the full selected pool. User teams are excluded and opponent-count sampling is ignored.' : null,
        benchmarkWarmupActive ? '**System Status:** Startup warm-up is still running. Simulations are temporarily locked.' : null,
        !hasSubmittedTeam ? '**Status:** Submit a Battle Simulator team export before running a simulation.' : null,
        hasActiveSuiteJob ? '**Status:** A simulation is already active. Stop it or let it finish before running another.' : null,
      ]),
    );
}

function buildBenchMarkSuiteConfigShellEmbed({ config = {}, notice = null } = {}) {
  const safeConfig = {
    format_id: config.format_id || CHAMPIONS_FORMAT_ID,
    mode: config.mode || MODE_ALL_META_TOURNAMENT,
    battle_budget: config.battle_budget || 200,
    games_per_opponent: config.games_per_opponent || 1,
  };
  const safeNotice = String(notice || '').trim();
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_SLATE)
    .setTitle('🧪 Professor Aegis • Battle Simulator Settings')
    .setDescription(
      cleanList([
        'Current Settings',
        `Format: ${humanizeBenchMarkSuiteFormat(safeConfig.format_id)}`,
        `Opponent Pool: ${humanizeBenchMarkSuiteMode(safeConfig.mode)} • loading count...`,
        `Champions Battle Budget: ${describeBenchMarkSuiteBattleBudget(safeConfig)}`,
        `Series: ${isBenchMarkSuiteChampionFormat(safeConfig.format_id) ? 'BO1 allocation' : `BO${Number(safeConfig.games_per_opponent || 1)}`}`,
        '',
        '```text\n[Settings]\n▰▰▱▱▱▱▱▱▱▱ 20%\nLoading current settings metadata...\n```',
        safeNotice,
      ]),
    );
}

function buildBenchMarkSuiteReportShellEmbed({
  username = 'Trainer',
  reportTab = 'overview',
  history = false,
  notice = null,
} = {}) {
  const selected = normalizeBenchMarkSuiteReportTab(reportTab);
  const tabTitle = selected === 'overview'
    ? 'Overview'
    : selected === 'threats'
      ? 'Threats'
      : selected === 'core'
        ? 'Core'
        : 'Leads';
  const safeNotice = String(notice || '').trim();
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_SLATE)
    .setTitle(`🏁 Professor Aegis • ${username}'s Simulation Report • ${tabTitle}`)
    .setDescription(
      cleanList([
        buildStoryBlock([
          history
            ? '"Professor Aegis is opening that saved report from History."'
            : '"Professor Aegis is opening your saved Simulation Report."',
        ]),
        '',
        '```text',
        '[Simulation Report]',
        '▰▰▱▱▱▱▱▱▱▱ 20%',
        safeNotice || `Loading ${tabTitle} metadata...`,
        '```',
      ]),
    );
}

function buildBenchMarkSuiteHistoryShellEmbed({ username = 'Trainer', notice = null } = {}) {
  const safeNotice = String(notice || '').trim();
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_SLATE)
    .setTitle(`🗂️ Professor Aegis • ${username}'s Simulation Report History`)
    .setDescription(
      cleanList([
        buildStoryBlock(['"Professor Aegis is reading your recent saved Simulation Reports."']),
        '',
        '```text',
        '[Simulation History]',
        '▰▰▱▱▱▱▱▱▱▱ 20%',
        safeNotice || 'Loading previous report list...',
        '```',
      ]),
    );
}

function buildBenchMarkLoadTeamShellEmbed({ username = 'Trainer', notice = null } = {}) {
  const safeNotice = String(notice || '').trim();
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_SLATE)
    .setTitle(`📥 Professor Aegis • ${username}'s Saved Battle Teams`)
    .setDescription(
      cleanList([
        buildStoryBlock(['"Professor Aegis is finding recent teams that can be restored."']),
        '',
        '```text',
        '[Load Team]',
        '▰▰▱▱▱▱▱▱▱▱ 20%',
        safeNotice || 'Loading saved team profiles...',
        '```',
      ]),
    );
}

function buildBenchMarkSuiteConfigRow({ ownerId, currentFormatId = CHAMPIONS_FORMAT_ID }) {
  const isChampionFormat = isBenchMarkSuiteChampionFormat(currentFormatId);
  const options = [
    { label: 'Set Simulation Format', description: 'Choose Champions or view Standard status', value: 'config_format', emoji: '⚙️' },
    { label: 'Set Opponent Pool', description: 'Choose a ChampionsLab-style tournament pool', value: 'config_mode', emoji: '🧪' },
    {
      label: isChampionFormat ? 'Set Battle Budget' : 'Set Battles per Matchup',
      description: isChampionFormat ? 'Choose the ChampionsLab battle budget' : 'Choose battles per matchup',
      value: 'config_battle_budget',
      emoji: '🎯',
    },
  ];
  if (!isChampionFormat) {
    options.push({ label: 'Set Series Length', description: 'Choose BO1 or BO3 for each opponent', value: 'config_games_per_opponent', emoji: '🎮' });
  }

  options.push({
    label: 'Clear Battle Simulator Data',
    description: 'Reset reports, history, archives, and settings. Keeps submitted team.',
    value: 'clear_benchmark_data',
    emoji: '🧹',
  });
  options.push({ label: 'Back to Battle Simulator', description: 'Return to the main Battle Simulator menu', value: 'back_benchmark', emoji: '⬅️' });
  return buildMenuSelect(makeCustomId('benchmark_suite_config_select', ownerId), 'Choose a Battle Simulator setting.', options);
}

function buildBenchMarkClearDataConfirmEmbed() {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_SLATE)
    .setTitle('🧹 Clear Battle Simulator Data')
    .setDescription(
      cleanList([
        'This will clear your Battle Simulator reports, history, archives, progress, saved simulation profiles, and settings.',
        'Your submitted team will stay saved.',
        '',
        'Are you sure?',
      ]),
    );
}

function buildBenchMarkClearDataConfirmRow({ ownerId }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(makeCustomId('benchmark_clear_data_confirm', ownerId))
      .setLabel('Clear Data')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(makeCustomId('benchmark_clear_data_cancel', ownerId))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildBenchMarkSuiteFormatRow({ ownerId, currentFormatId = 'gen9championscustomgame' }) {
  const current = String(currentFormatId || 'gen9championscustomgame').trim().toLowerCase();
  const options = [
    {
      label: 'Champions',
      description: current === 'gen9championscustomgame' ? 'Enabled - current runnable format' : 'Enabled Battle Simulator format',
      value: 'gen9championscustomgame',
      emoji: current === 'gen9championscustomgame' ? '✅' : '🏆',
    },
    {
      label: 'Standard',
      description: 'Coming later - not runnable yet',
      value: 'gen9benchmarkdoublesag',
      emoji: '⏳',
    },
    { label: 'Back to Settings', description: 'Return to the Battle Simulator settings menu', value: 'back_config', emoji: '⬅️' },
  ];
  return buildMenuSelect(makeCustomId('benchmark_suite_format_select', ownerId), 'Choose a benchmark format.', options);
}

function findBenchMarkModeMetadata(benchmarkModes = [], mode = '') {
  const wanted = normalizeBenchMarkSuiteMode(mode);
  if (!wanted || !Array.isArray(benchmarkModes)) return null;
  return benchmarkModes.find((entry) => normalizeBenchMarkSuiteMode(entry?.mode) === wanted) || null;
}

function formatBenchMarkModeAvailability(mode = '', metadata = null) {
  const count = Number(metadata?.availableOpponents);
  if (!Number.isFinite(count) || count < 0) return 'count unavailable';
  return `${count} teams`;
}

function buildBenchMarkModeDescription({ mode, currentMode, baseDescription, benchmarkModes = [] }) {
  const normalizedMode = normalizeBenchMarkSuiteMode(mode);
  const isCurrent = normalizeBenchMarkSuiteMode(currentMode) === normalizedMode;
  const metadata = findBenchMarkModeMetadata(benchmarkModes, normalizedMode);
  const count = Number(metadata?.availableOpponents);
  const availability = formatBenchMarkModeAvailability(normalizedMode, metadata);
  const pending = Number.isFinite(count) && count <= 0 ? 'Data pending' : null;
  const description = [baseDescription, pending, availability ? `(${availability})` : null, isCurrent ? 'Current selection' : null].filter(Boolean).join(' - ');
  return description.length > 100 ? `${description.slice(0, 97).trim()}...` : description;
}

function buildBenchMarkSuiteModeRow({ ownerId, currentMode = MODE_ALL_META_TOURNAMENT, benchmarkModes = [] }) {
  const normalizedCurrent = normalizeBenchMarkSuiteMode(currentMode);
  const options = CHAMPIONSLAB_POOL_PRESETS.map((preset) => {
    const current = normalizedCurrent === preset.mode;
    const metadata = findBenchMarkModeMetadata(benchmarkModes, preset.mode);
    const count = Number(metadata?.availableOpponents);
    const pending = Number.isFinite(count) && count <= 0;
    return {
      label: preset.label,
      description: buildBenchMarkModeDescription({ mode: preset.mode, currentMode, baseDescription: preset.baseDescription, benchmarkModes }),
      value: preset.mode,
      emoji: current ? '✅' : (pending ? '⏳' : preset.emoji),
    };
  });
  options.push(
    { label: 'Back to Settings', description: 'Return to the Battle Simulator settings menu', value: 'back_config', emoji: '⬅️' },
  );
  return buildMenuSelect(makeCustomId('benchmark_suite_mode_select', ownerId), 'Choose a benchmark mode.', options);
}

function buildBenchMarkSuiteBattleBudgetRow({ ownerId, currentBattleBudget = 200 }) {
  const options = [100, 200, 300, 850, 1250].map((count) => {
    const current = Number(currentBattleBudget) === count;
    return {
      label: `${count} Battles`,
      description: current ? 'Current selection' : 'ChampionsLab battle budget',
      value: String(count),
      emoji: current ? '✅' : '🎯',
    };
  });
  options.push({ label: 'Back to Settings', description: 'Return to the Battle Simulator settings menu', value: 'back_config', emoji: '⬅️' });
  return buildMenuSelect(makeCustomId('benchmark_suite_battle_budget_select', ownerId), 'Choose a Battle Simulator budget.', options);
}

function buildBenchMarkSuiteGamesPerOpponentRow({ ownerId, currentGamesPerOpponent = 3 }) {
  const gameCounts = [1, 3];
  const options = gameCounts.map((count) => ({
    label: `BO${count}`,
    description: currentGamesPerOpponent === count
      ? 'Current selection'
      : count === 1
        ? 'Fastest'
        : 'Stronger matchup read',
    value: String(count),
    emoji: currentGamesPerOpponent === count ? '✅' : '🎮',
  }));
  options.push({ label: 'Back to Settings', description: 'Return to the Battle Simulator settings menu', value: 'back_config', emoji: '⬅️' });
  return buildMenuSelect(makeCustomId('benchmark_suite_games_select', ownerId), 'Choose games per opponent.', options);
}

function buildBenchMarkTeamModal({ ownerId, existingTeamExport = '' }) {
  const modal = new ModalBuilder().setCustomId(makeCustomId('benchmark_team_modal', ownerId)).setTitle('BenchMark Team Export');
  const teamExport = new TextInputBuilder()
    .setCustomId('benchmark_team_export')
    .setLabel('Raw Showdown Export')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000)
    .setValue(String(existingTeamExport || '').slice(0, 4000));
  modal.addComponents(new ActionRowBuilder().addComponents(teamExport));
  return modal;
}

function buildBenchMarkSubmittedTeamEmbed({ username, teamExport, updatedAtText = null }) {
  const safeTeam = String(teamExport || '').replace(/```/g, '``\u200b`');
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle(`🧪 Professor Aegis • ${username}'s BenchMark Team`)
    .setDescription(cleanList([`**Updated:** ${updatedAtText || 'Unknown'}`, '', '**Importable**', `\`\`\`\n${safeTeam}\n\`\`\``]));
}

function buildBenchMarkSubmittedTeamExportRow({ ownerId, hasSubmittedTeam = true, hasHistoryProfiles = false }) {
  if (!hasSubmittedTeam) return null;
  const buttons = [
    new ButtonBuilder()
      .setCustomId(makeCustomId('benchmark_submitted_team_export', ownerId, 'standard'))
      .setLabel('Standard Export')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(makeCustomId('benchmark_submitted_team_export', ownerId, 'champion'))
      .setLabel('Champion Export')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Secondary),
  ];
  if (hasHistoryProfiles) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(makeCustomId('benchmark_load_team_open', ownerId))
        .setLabel('Load Team')
        .setEmoji('📥')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return new ActionRowBuilder().addComponents(...buttons);
}

function normalizeLegacyItems(items = []) {
  return Array.isArray(items)
    ? items.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          if (item.detail && item.title) return `${item.title}: ${item.detail}`;
          if (item.name && item.winRate !== undefined) return `${item.name} — ${item.winRate}%`;
          if (item.name && item.estimatedWinRate !== undefined) {
            const verdict = item.structuralVerdict ? ` • ${String(item.structuralVerdict).toUpperCase()}` : '';
            const battles = item.plannedBattles ? ` • ${item.plannedBattles} battles` : '';
            return `${item.name} — ${item.estimatedWinRate}%${verdict}${battles}`;
          }
          if (item.name) return String(item.name);
        }
        return null;
      }).filter(Boolean)
    : [];
}

function uniqueStrings(items = []) {
  return items.filter((item, index, array) => array.indexOf(item) === index);
}

function sectionLines(title, emoji, items, emptyLine) {
  const safeItems = Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item.trim().length > 0) : [];
  if (!safeItems.length) return [`**${emoji} ${title}**`, `• ${emptyLine}`];
  const lines = [`**${emoji} ${title}**`];
  safeItems.forEach((item, index) => {
    lines.push(`• ${item}`);
    if (index < safeItems.length - 1) lines.push('');
  });
  return lines;
}

function archetypeEmoji(label = '') {
  const key = String(label || '').trim().toLowerCase();
  if (key.includes('hard trick room') || key.includes('trick room')) return '🕰️';
  if (key.includes('redirection')) return '🛡️';
  if (key.includes('direct-pressure') || key.includes('direct pressure')) return '⚔️';
  if (key.includes('bulky balance')) return '🧱';
  if (key.includes('spread-heavy') || key.includes('spread heavy')) return '🌊';
  if (key.includes('fast-offense') || key.includes('fast offense')) return '⚡';
  return '🧩';
}

const POKEMON_TYPE_EMOJI = {
  normal: '⚪',
  fire: '🔥',
  water: '💧',
  electric: '⚡',
  grass: '🌿',
  ice: '❄️',
  fighting: '🥊',
  poison: '☠️',
  ground: '⛰️',
  flying: '🦅',
  psychic: '🧠',
  bug: '🐞',
  rock: '🪨',
  ghost: '👻',
  dragon: '🐉',
  dark: '🌑',
  steel: '⚙️',
  fairy: '✨',
};

const POKEMON_TYPE_ORDER = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice',
  'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
  'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
];

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

function formatReportNoteText(noteText) {
  const raw = String(noteText || '').trim();
  if (!raw) return raw;

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const out = ['```md'];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^•\s*Suggested direction:/i.test(line)) {
      out.push(`➡️ ${line.replace(/^•\s*/, '')}`);
      i += 1;
      continue;
    }

    if (/^•\s*Common thread:/i.test(line)) {
      i += 1;
      continue;
    }

    if (/^•\s*/.test(line)) {
      const label = line.replace(/^•\s*/, '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
      out.push(`${archetypeEmoji(label)} ${label}`);
      if (i + 1 < lines.length && /^(Strong into it|Weakness):/i.test(lines[i + 1])) {
        const weaknessLine = lines[i + 1].replace(/^Strong into it:/i, 'Weakness:');
        out.push(`• ${weaknessLine}`);
        i += 1;
      }
      if (i + 1 < lines.length && /^Why:/i.test(lines[i + 1])) {
        out.push(`• ${lines[i + 1]}`);
        i += 1;
      }
      out.push('');
      i += 1;
      continue;
    }

    out.push(line);
    i += 1;
  }

  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  out.push('```');
  return out.join('\n');
}

function templateNameMap(templates = []) {
  const entries = Array.isArray(templates) ? templates : [];
  return new Map(entries.map((item) => [item.key, item.name]));
}

function buildBenchMarkReportEmbed({ username, report }) {
  const safe = report || {};
  const summaryHeadline = safe.summaryHeadline || safe.overallRead || safe.overallSpread || 'No summary available.';
  const summaryBody = safe.summaryBody || safe.quickSummary || 'This is an early BenchMark read based on the submitted team export. Treat it as guidance, not a final verdict.';
  const bestArchetypes = normalizeLegacyItems(safe.bestArchetypes).slice(0, 4);
  const worstArchetypes = normalizeLegacyItems(safe.worstArchetypes).slice(0, 4);
  const strengths = uniqueStrings([...normalizeLegacyItems(safe.strengths)]).slice(0, 4);
  const weaknesses = uniqueStrings([...normalizeLegacyItems(safe.weaknesses)]).slice(0, 4);
  const bestLeads = uniqueStrings([...normalizeLegacyItems(safe.bestLeads)]).slice(0, 3);
  const weakLeads = uniqueStrings([...normalizeLegacyItems(safe.weakLeads), ...normalizeLegacyItems(safe.leadWarnings)]).slice(0, 3);
  const glossary = uniqueStrings(normalizeLegacyItems(safe.glossaryNotes)).slice(0, 3);

  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle(`📊 Professor Aegis • ${username}'s BenchMark Report`)
    .setDescription(cleanList([
      buildStoryBlock(['"Use this as a coach-style read of your team. The goal is to show what may feel comfortable, what may feel shaky, and why."']),
      `**📌 Overall Read:** ${summaryHeadline}`,
      `**🕒 Generated:** ${safe.generatedAt || 'Unknown'}`,
      '\n', '**🧠 Plain-Language Summary**', summaryBody, '\n',
      ...sectionLines('Best Archetypes', '📈', bestArchetypes, 'No favorable archetype notes yet.'), '\n',
      ...sectionLines('Worst Archetypes', '📉', worstArchetypes, 'No difficult archetype notes yet.'), '\n',
      ...sectionLines('Likely Strengths', '✅', strengths, 'No clear strengths were identified yet.'), '\n',
      ...sectionLines('Likely Weaknesses', '⚠️', weaknesses, 'No clear weaknesses were identified yet.'),
      ...(bestLeads.length ? ['\n', ...sectionLines('Stronger Leads / Pairings', '🟢', bestLeads, 'No especially strong lead patterns were identified yet.')] : []),
      ...(weakLeads.length ? ['\n', ...sectionLines('Riskier Leads / Pairings', '🔴', weakLeads, 'No risky lead patterns were identified yet.')] : []),
      ...(glossary.length ? ['\n', ...sectionLines('Helpful Terms', '📚', glossary, 'No terms to explain.')] : []),
    ]));
}

function buildBenchMarkMatchupEvalEmbed({ username, report }) {
  const safe = report || {};
  const templates = Array.isArray(safe.templates) ? safe.templates : [];
  const requestedTemplates = Array.isArray(safe.requestedTemplates) ? safe.requestedTemplates : [];
  const templateNames = templateNameMap(templates);
  const favored = normalizeLegacyItems(templates.filter((item) => item.structuralVerdict === 'favored')).slice(0, 4);
  const shaky = normalizeLegacyItems(templates.filter((item) => item.structuralVerdict === 'shaky')).slice(0, 4);
  const unclear = normalizeLegacyItems(templates.filter((item) => item.structuralVerdict !== 'favored' && item.structuralVerdict !== 'shaky')).slice(0, 4);
  const priorityTemplates = uniqueStrings(requestedTemplates.length ? requestedTemplates.map((key) => templateNames.get(key) || key) : (Array.isArray(safe.priorityTemplates) ? safe.priorityTemplates.map((key) => templateNames.get(key) || key) : [])).slice(0, 4);
  const focusLines = uniqueStrings(templates.slice(0, 3).map((item) => {
    const focus = Array.isArray(item.evaluationFocus) ? item.evaluationFocus[0] : null;
    const pressure = Array.isArray(item.commonPressures) ? item.commonPressures[0] : null;
    const parts = [focus, pressure].filter(Boolean).slice(0, 2);
    return parts.length ? `${item.name}: ${parts.join(' • ')}` : null;
  }).filter(Boolean)).slice(0, 3);

  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle(`🧭 Professor Aegis • ${username}'s Matchup Eval`)
    .setDescription(cleanList([
      buildStoryBlock(['"Use this as the archetype-testing layer. It shows which matchup styles deserve the most testing time first."']),
      `**📌 Evaluation Mode:** ${safe.evaluationMode || 'Unknown'}`,
      `**🕒 Generated:** ${safe.generatedAt || 'Unknown'}`,
      `**⚙️ Showdown Ready:** ${safe.showdownReady ? 'Yes ✅' : 'No ❌'}`,
      `**🎯 Planned Battle Count:** ${safe.recommendedBattleCount || 'Unknown'}`,
      '\n', ...sectionLines('Priority Templates', '🧪', priorityTemplates, 'No priority templates were identified yet.'), '\n',
      ...sectionLines('Favored Matchup Styles', '📈', favored, 'No favored template results yet.'), '\n',
      ...sectionLines('Shaky Matchup Styles', '📉', shaky, 'No shaky template results yet.'),
      ...(unclear.length ? ['\n', ...sectionLines('Unclear / Needs More Testing', '❔', unclear, 'No unclear template results yet.')] : []),
      ...(focusLines.length ? ['\n', ...sectionLines('What To Test For', '🎯', focusLines, 'No template focus notes yet.')] : []),
      ...(safe.noteText ? ['\n', '**📝 Eval Note**', safe.noteText] : []),
    ]));
}

function buildBenchMarkSimScaffoldEmbed({ username, report }) {
  const safe = report || {};
  const templatePlans = Array.isArray(safe.templatePlans) ? safe.templatePlans : [];
  const priorityDetails = Array.isArray(safe.priorityTemplateDetails) ? safe.priorityTemplateDetails : [];
  const modePlans = Array.isArray(safe.benchmarkModePlan?.plans) ? safe.benchmarkModePlan.plans : [];

  const priorityLines = priorityDetails.slice(0, 3).map((item) => {
    const template = templatePlans.find((entry) => entry.key === item.key);
    const name = template?.name || item.key || 'Unknown template';
    const estimated = template?.estimatedWinRate !== undefined ? `${template.estimatedWinRate}%` : null;
    const purpose = String(item.testPurpose || '').replace(/-/g, ' ');
    return [`P${item.recommendedPriority || '?'} ${name}`, purpose || null, estimated].filter(Boolean).join(' • ');
  });

  const selectionReasonLines = priorityDetails.slice(0, 3).map((item) => {
    const template = templatePlans.find((entry) => entry.key === item.key);
    const name = template?.name || item.key || 'Unknown template';
    return `${name}: ${item.selectionReason || 'No selection reason available.'}`;
  });

  const templatePlanLines = templatePlans
    .slice()
    .sort((a, b) => (Number(a.recommendedPriority || 99) - Number(b.recommendedPriority || 99)) || (Number(a.estimatedWinRate || 0) - Number(b.estimatedWinRate || 0)))
    .slice(0, 4)
    .map((item) => {
      const ready = item?.simBattlePlan?.readyOpponentCount !== undefined ? `${item.simBattlePlan.readyOpponentCount} ready opponents` : null;
      const battles = item?.plannedBattles !== undefined ? `${item.plannedBattles} planned battles` : null;
      const estimate = item?.estimatedWinRate !== undefined ? `${item.estimatedWinRate}% est.` : null;
      const purpose = item?.testPurpose ? String(item.testPurpose).replace(/-/g, ' ') : null;
      return [item.name || item.key || 'Unknown template', purpose, estimate, ready, battles].filter(Boolean).join(' • ');
    });

  const modePlanLines = modePlans.slice(0, 3).map((item) => `${item.label || item.id || 'Unknown mode'}: ${item.why || 'No planning note available.'}`);

  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle(`🧱 Professor Aegis • ${username}'s Simulation Scaffold`)
    .setDescription(cleanList([
      buildStoryBlock(['"This is the planning scaffold. It is not a win/loss result yet. It tells you what matchup styles should be tested first and why."']),
      `**📌 Report Type:** ${safe.reportType || 'Simulation Scaffold'}`,
      `**🕒 Generated:** ${safe.generatedAt || 'Unknown'}`,
      `**⚙️ Format:** ${safe.formatId || 'Unknown'}`,
      `**🧪 Simulation Mode:** ${safe.simulationMode || 'Unknown'}`,
      `**✅ Showdown Ready:** ${safe.showdownReady ? 'Yes' : 'No'}`,
      `**🎯 Ready Opponents:** ${safe.readyOpponentCount ?? 0}`,
      '',
      ...sectionLines('Priority Checks', '🧪', priorityLines, 'No priority checks were identified yet.'),
      ...(selectionReasonLines.length ? ['', ...sectionLines('Why These Came First', '📝', selectionReasonLines, 'No selection reasons are available yet.')] : []),
      ...(templatePlanLines.length ? ['', ...sectionLines('Template Plans', '📚', templatePlanLines, 'No template plans are available yet.')] : []),
      ...(modePlanLines.length ? ['', ...sectionLines('Suggested Benchmark Paths', '🗺️', modePlanLines, 'No benchmark paths are available yet.')] : []),
      ...(safe.noteText ? ['', '**📎 Scaffold Note**', safe.noteText] : []),
    ]));
}

function formatRecordLine(item = {}) {
  return `${Number(item.wins || 0)}-${Number(item.losses || 0)}-${Number(item.ties || 0)}`;
}

function prettifyArchetypeLabel(label = '') {
  return String(label || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

function formatSuiteMatchupDisplay(item = {}) {
  const label = resolveFinalOverviewArchetypeLabel(item);
  const winChance = item.winChance || (item.winRate !== undefined ? `${Math.round(Number(item.winRate || 0))}%` : 'Unknown');
  const confidence = item.confidence ? ` • ${item.confidence} Confidence` : '';
  return `${label} • ${winChance} Win Chance • ${formatRecordLine(item)}${confidence}`;
}


function numericWinRate(item = {}) {
  const raw = item.winRate ?? item.winChance ?? null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const match = String(raw || '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function sortMatchupsForSection(items = [], section = 'neutral') {
  const list = Array.isArray(items) ? [...items] : [];
  if (section === 'good') {
    return list.sort((a, b) => (numericWinRate(b) ?? -1) - (numericWinRate(a) ?? -1));
  }
  if (section === 'danger') {
    return list.sort((a, b) => (numericWinRate(a) ?? 101) - (numericWinRate(b) ?? 101));
  }
  return list.sort((a, b) => Math.abs((numericWinRate(a) ?? 50) - 50) - Math.abs((numericWinRate(b) ?? 50) - 50));
}

function formatSuitePercent(value, fallback = 0) {
  const parsed = typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number(String(value ?? '').match(/-?\d+(?:\.\d+)?/)?.[0] ?? fallback);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function resolveSuiteWinRate(safe = {}, summary = {}) {
  return formatSuitePercent(summary.winRate ?? safe.winRate, 0);
}

function buildOverviewTierLabel(winRate = 0) {
  if (winRate >= 75) return 'S-Tier';
  if (winRate >= 65) return 'A-Tier';
  if (winRate >= 55) return 'B-Tier';
  if (winRate >= 45) return 'C-Tier';
  return 'Danger';
}

function formatOverviewNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatOverviewTurns(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(1) : 'Unknown';
}

function buildOverviewBar(percent = 0, width = 10) {
  const clamped = Math.max(0, Math.min(100, formatSuitePercent(percent, 0)));
  const filled = Math.round((clamped / 100) * width);
  return `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
}

function formatOverviewLabel(label = '', width = 22) {
  const pretty = prettifyArchetypeLabel(label || 'Unknown');
  const clipped = pretty.length > width ? `${pretty.slice(0, width - 1)}…` : pretty;
  return clipped.padEnd(width, ' ');
}

function formatOverviewCount(value = 0) {
  return formatOverviewNumber(value, 0).toLocaleString('en-US');
}

function overviewSpacer() {
  return '\u200B';
}

function resolveFinalOverviewArchetypeLabel(item = {}) {
  const canonical = resolveCanonicalMatchupGuideLabel(item);
  if (canonical) return canonical;
  const candidates = [
    item.finalArchetypeLabel,
    item.final_archetype_label,
    item.displayLabel,
    item.templateLabel,
    item.archetype,
    item.opponentArchetype,
    item.championLabArchetype,
    item.name,
    item.templateKey,
  ];
  const label = candidates
    .map((value) => prettifyArchetypeLabel(value || ''))
    .find((value) => value && !isGenericMatchupGuideLabel(value));
  return label || 'Battle Team';
}

function buildOverviewMatchupRows(summary = {}) {
  const breakdown = Array.isArray(summary.templateBreakdown) ? summary.templateBreakdown : [];
  return breakdown
    .filter(Boolean)
    .map((item) => ({
      ...item,
      displayRate: numericWinRate(item) ?? 0,
      displayLabel: resolveFinalOverviewArchetypeLabel(item),
    }))
    .sort((a, b) => (
      b.displayRate - a.displayRate
      || (b.gamesPlayed || 0) - (a.gamesPlayed || 0)
      || String(a.displayLabel || '').localeCompare(String(b.displayLabel || ''))
    ))
    .slice(0, 8);
}

function formatOverviewMatchupRow(item = {}) {
  const winRate = formatSuitePercent(item.displayRate ?? item.winRate ?? item.winChance, 0);
  const wins = formatOverviewNumber(item.wins, 0);
  const losses = formatOverviewNumber(item.losses, 0);
  const record = `${String(wins).padStart(2, ' ')}W • ${String(losses).padStart(2, ' ')}L`;
  return `${formatOverviewLabel(item.displayLabel)} ${buildOverviewBar(winRate)} ${String(winRate).padStart(3, ' ')}%  ${record}`;
}

function buildOverviewMatchupBlock(rows = []) {
  const lines = rows.map(formatOverviewMatchupRow).filter(Boolean);
  if (!lines.length) {
    lines.push('No archetype rows available yet.');
  }
  return ['```txt', '|Archetype|           |Win Rate| |Record| |Games|', ...lines, '```'].join('\n');
}

function threatTypeEmoji(types = [], fallbackLabel = '') {
  const rawTypes = Array.isArray(types)
    ? types
    : String(types || '').split(/[,\s/]+/).filter(Boolean);
  const emojis = rawTypes
    .map((type) => String(type || '').trim().toLowerCase())
    .sort((a, b) => {
      const aIndex = POKEMON_TYPE_ORDER.indexOf(a);
      const bIndex = POKEMON_TYPE_ORDER.indexOf(b);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    })
    .map((type) => POKEMON_TYPE_EMOJI[String(type || '').trim().toLowerCase()])
    .filter(Boolean)
    .slice(0, 2);
  if (emojis.length) return emojis.join('');
  return archetypeEmoji(fallbackLabel);
}

function getThreatTypes(item = {}) {
  const rawTypes = item.types || item.pokemonTypes || item.type || [item.type1, item.type2].filter(Boolean);
  const types = Array.isArray(rawTypes)
    ? rawTypes.filter(Boolean)
    : String(rawTypes || '').split(/[,\s/]+/).filter(Boolean);
  return types.length ? types : lookupPokemonThreatTypes(getThreatName(item));
}

function getThreatName(item = {}) {
  return item.pokemon || item.species || item.pokemonName || item.name || item.templateLabel || item.templateKey || 'Unknown threat';
}

function resolveLossRate(item = {}) {
  const raw = item.lossRate ?? item.lossChance ?? item.lossPercent;
  if (raw !== undefined && raw !== null) return formatSuitePercent(raw, 0);
  const winRate = numericWinRate(item);
  if (winRate !== null) return Math.max(0, Math.min(100, 100 - formatSuitePercent(winRate, 0)));
  const losses = Number(item.losses || 0);
  const wins = Number(item.wins || 0);
  const ties = Number(item.ties || 0);
  const total = Number(item.gamesPlayed || item.gamesAttempted || wins + losses + ties || 0);
  return total > 0 ? Math.round((losses / total) * 100) : 0;
}

function buildThreatRows({ safe = {}, summary = {}, dangerMatchups = [], neutralMatchups = [] } = {}) {
  const explicitThreats = [
    summary.topThreats,
    summary.pokemonThreats,
    summary.threats,
    safe.topThreats,
    safe.pokemonThreats,
    safe.threats,
  ].find((items) => Array.isArray(items) && items.length);
  const hasExplicitThreats = Array.isArray(explicitThreats) && explicitThreats.length > 0;
  const templateFallback = Array.isArray(summary.templateBreakdown) && summary.templateBreakdown.length
    ? summary.templateBreakdown
    : [...dangerMatchups, ...neutralMatchups];
  const source = explicitThreats || templateFallback;

  return (Array.isArray(source) ? source : [])
    .filter(Boolean)
    .map((item) => {
      const displayName = prettifyArchetypeLabel(getThreatName(item));
      const lossRate = resolveLossRate(item);
      return {
        ...item,
        displayName,
        lossRate,
        displayEmoji: threatTypeEmoji(getThreatTypes(item), displayName),
        gamesPlayed: Number(item.gamesPlayed || item.gamesAttempted || item.wins + item.losses + item.ties || 0),
        sourceKind: hasExplicitThreats ? 'pokemon-threat' : 'archetype-signal',
      };
    })
    .sort((a, b) => (
      b.lossRate - a.lossRate
      || (b.gamesPlayed || 0) - (a.gamesPlayed || 0)
      || String(a.displayName || '').localeCompare(String(b.displayName || ''))
    ))
    .slice(0, 10);
}

function formatThreatLabel(label = '', width = 21) {
  const pretty = prettifyArchetypeLabel(label || 'Unknown');
  const clipped = pretty.length > width ? `${pretty.slice(0, Math.max(0, width - 3)).trimEnd()}...` : pretty;
  return clipped.padEnd(width, ' ');
}

function threatEmojiVisualWidth(value = '') {
  return Array.from(String(value || '').replace(/\uFE0F/g, ''))
    .reduce((total, char) => {
      const code = char.codePointAt(0) || 0;
      if (code === 0x200d) return total;
      if (code >= 0x1f000 || (code >= 0x2600 && code <= 0x27bf)) return total + 2;
      return total + 1;
    }, 0);
}

function formatThreatCell(emoji = '🧩', name = '', width = 29) {
  const rawEmoji = String(emoji || '🧩');
  const pretty = prettifyArchetypeLabel(name || 'Unknown');
  const maxNameWidth = Math.max(8, width - threatEmojiVisualWidth(rawEmoji) - 1);
  const clippedName = pretty.length > maxNameWidth ? `${pretty.slice(0, Math.max(0, maxNameWidth - 3)).trimEnd()}...` : pretty;
  const cell = `${rawEmoji} ${clippedName}`;
  const visualWidth = threatEmojiVisualWidth(cell);
  return `${cell}${' '.repeat(Math.max(1, width - visualWidth))}`;
}

function formatThreatRow(item = {}, index = 0) {
  const rank = `#${String(index + 1).padStart(2, '0')}`;
  const label = `${item.displayEmoji || '🧩'} ${formatThreatLabel(item.displayName, 21).trimEnd()}`;
  const lossRate = formatSuitePercent(item.lossRate, 0);
  return `${rank} ${buildOverviewBar(lossRate)} ${String(lossRate).padStart(3, ' ')}% LR  ${label}`;
}

function buildThreatBlock(rows = []) {
  const lines = rows.map(formatThreatRow).filter(Boolean);
  if (!lines.length) {
    lines.push('No threat rows available yet.');
  }
  return ['```txt', '|R| |Loss Rate|           |Threat|', ...lines, '```'].join('\n');
}

function firstArrayValue(values = []) {
  return values.find((items) => Array.isArray(items) && items.length);
}

function normalizeLeadPercent(value, fallback = null) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value <= 1 ? Math.round(value * 100) : Math.round(value);
  }
  if (value === undefined || value === null || value === '') return fallback;
  return formatSuitePercent(value, fallback ?? 0);
}

function leadTypeEmoji(types = []) {
  const rawTypes = Array.isArray(types)
    ? types
    : String(types || '').split(/[,\s/]+/).filter(Boolean);
  const emojis = rawTypes
    .map((type) => String(type || '').trim().toLowerCase())
    .sort((a, b) => {
      const aIndex = POKEMON_TYPE_ORDER.indexOf(a);
      const bIndex = POKEMON_TYPE_ORDER.indexOf(b);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    })
    .map((type) => POKEMON_TYPE_EMOJI[type])
    .filter(Boolean)
    .slice(0, 2);
  return emojis.join('');
}

function getLeadPokemonTypes(item = {}) {
  return item.types || item.pokemonTypes || item.type || [item.type1, item.type2].filter(Boolean);
}

function getLeadPokemonName(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  return item.name || item.species || item.pokemon || item.pokemonName || item.label || '';
}

function normalizeLeadPokemon(item) {
  if (typeof item === 'string') return { name: item, types: [] };
  if (!item || typeof item !== 'object') return null;
  const name = getLeadPokemonName(item);
  if (!name) return null;
  return { name, types: getLeadPokemonTypes(item) };
}

function splitLeadPairName(value = '') {
  return String(value || '')
    .split(/\s*(?:\+|\/|,|&| and )\s*/i)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 2);
}

function getLeadPairPokemon(item = {}) {
  const pairArray = [
    item.pair,
    item.leadPair,
    item.leads,
    item.pokemonPair,
    item.pokemon,
    item.members,
  ].find((value) => Array.isArray(value) && value.length >= 2);
  if (pairArray) {
    return pairArray.map(normalizeLeadPokemon).filter(Boolean).slice(0, 2);
  }

  const pairedKeys = [
    ['pokemonA', 'pokemonB'],
    ['pokemon1', 'pokemon2'],
    ['lead1', 'lead2'],
    ['first', 'second'],
    ['a', 'b'],
  ];
  for (const [leftKey, rightKey] of pairedKeys) {
    const left = normalizeLeadPokemon(item[leftKey]);
    const right = normalizeLeadPokemon(item[rightKey]);
    if (left && right) return [left, right];
  }

  const label = item.pairName || item.leadPairName || item.name || item.label || item.title || '';
  const names = splitLeadPairName(label);
  return names.map((name) => ({ name, types: [] })).slice(0, 2);
}

function formatLeadPokemon(item = {}) {
  const emoji = leadTypeEmoji(item.types);
  const name = prettifyArchetypeLabel(item.name || 'Unknown');
  return emoji ? `${emoji} ${name}` : name;
}

function formatLeadPairLabel(pair = [], fallback = '') {
  const pieces = pair.map(formatLeadPokemon).filter(Boolean);
  if (pieces.length >= 2) return pieces.join(' + ');
  return prettifyArchetypeLabel(fallback || pieces[0] || 'Unknown lead pair');
}

function formatLeadDisplayLabel(label = '', width = 45) {
  const text = String(label || 'Unknown lead pair').trim();
  const chars = Array.from(text);
  return chars.length > width ? `${chars.slice(0, width - 1).join('')}…` : text;
}

function resolveLeadWinRate(item = {}) {
  return normalizeLeadPercent(
    item.winRate
      ?? item.winChance
      ?? item.successRate
      ?? item.successPercent
      ?? item.rate
      ?? item.percent
      ?? item.score,
    null,
  );
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
    'unknown match up',
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
    's tier top tournament',
    's/a tier top 4 tournament',
    'full meta 100 random',
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

function getMatchupGuideArchetypeMetadata(item = {}) {
  return [
    item.archetypeMetadata,
    item.opponentArchetypeMetadata,
    item.matchupArchetypeMetadata,
    item.templateArchetypeMetadata,
  ].find((value) => value && typeof value === 'object') || null;
}

function resolveCanonicalMatchupGuideLabel(item = {}) {
  const direct = [
    item.finalArchetypeLabel,
    item.final_archetype_label,
    item.displayLabel,
  ]
    .map((value) => prettifyArchetypeLabel(value || ''))
    .find((value) => value && !isGenericMatchupGuideLabel(value));
  if (direct) return direct;
  const metadata = getMatchupGuideArchetypeMetadata(item);
  if (!metadata) return '';
  return [
    metadata.displayLabel,
    metadata.display_label,
    metadata.primaryLabel,
    metadata.primary_label,
    metadata.compactHybridLabel,
    metadata.hybridLabel,
  ]
    .map((value) => prettifyArchetypeLabel(value || ''))
    .find((value) => value && !isGenericMatchupGuideLabel(value)) || '';
}

function resolveMatchupGuideDisplayLabel(item = {}) {
  const canonicalLabel = resolveCanonicalMatchupGuideLabel(item);
  if (canonicalLabel) return canonicalLabel;
  const candidates = [
    item.archetypeLabel,
    item.championLabArchetype,
    item.opponentArchetype,
    item.archetype,
    item.templateLabel,
    item.matchupLabel,
    item.name,
    item.opponentName,
    item.label,
    item.archetypeKey,
    item.templateKey,
    item.key,
  ];
  const label = candidates
    .map((value) => prettifyArchetypeLabel(value || ''))
    .find((value) => value && !isGenericMatchupGuideLabel(value));
  return label || '';
}

function normalizeMatchupGuideRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const wins = Number(item.wins || 0);
      const losses = Number(item.losses || 0);
      const ties = Number(item.ties || 0);
      const gamesPlayed = Number(item.gamesPlayed || wins + losses + ties || 0);
      const winRate = Number.isFinite(Number(item.winRate))
        ? Number(item.winRate)
        : gamesPlayed > 0
          ? (wins / gamesPlayed) * 100
          : null;
      const recommendation = String(item.recommendation || '').trim().toLowerCase();
      return {
        archetypeLabel: resolveMatchupGuideDisplayLabel(item),
        gamesPlayed,
        winRate,
        confidence: String(item.confidence || '').trim(),
        recommendation: ['use', 'avoid', 'neutral'].includes(recommendation) ? recommendation : 'neutral',
      };
    })
    .filter((item) => item.archetypeLabel && item.gamesPlayed > 0);
}

function matchupGuideConfidenceWeight(value = '') {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'high') return 3;
  if (text === 'medium') return 2;
  if (text === 'low') return 1;
  return 0;
}

function selectMatchupGuideLabels(matchupGuide = [], recommendation = 'use', limit = 3) {
  const wanted = String(recommendation || '').toLowerCase();
  return normalizeMatchupGuideRows(matchupGuide)
    .filter((item) => item.recommendation === wanted)
    .filter((item) => wanted !== 'avoid' || matchupGuideConfidenceWeight(item.confidence) >= 1 || item.gamesPlayed >= 2)
    .sort((a, b) => {
      const confidenceDiff = matchupGuideConfidenceWeight(b.confidence) - matchupGuideConfidenceWeight(a.confidence);
      if (confidenceDiff) return confidenceDiff;
      const aRate = Number.isFinite(Number(a.winRate)) ? Number(a.winRate) : 50;
      const bRate = Number.isFinite(Number(b.winRate)) ? Number(b.winRate) : 50;
      const rateDiff = wanted === 'avoid' ? aRate - bRate : bRate - aRate;
      if (rateDiff) return rateDiff;
      return (b.gamesPlayed || 0) - (a.gamesPlayed || 0)
        || a.archetypeLabel.localeCompare(b.archetypeLabel);
    })
    .slice(0, limit)
    .map((item) => item.archetypeLabel);
}

function buildWhenToUseBlock(rows = [], kindLabel = 'option') {
  const lines = [];
  for (const row of rows) {
    const rank = `#${Number(row.rank || lines.length + 1)}`;
    const label = kindLabel === 'Core'
      ? formatLeadDisplayLabel(row.label, 44)
      : formatLeadDisplayLabel(row.label, 42);
    const useInto = selectMatchupGuideLabels(row.matchupGuide, 'use', 3);
    const avoidInto = selectMatchupGuideLabels(row.matchupGuide, 'avoid', 2);
    lines.push(`${rank} ${label}`);
    lines.push(`Use into: ${useInto.length ? useInto.join(', ') : 'More data needed'}`);
    if (avoidInto.length) {
      lines.push(`Avoid into: ${avoidInto.join(', ')}`);
    }
    lines.push('');
  }

  const cleanLines = lines.length
    ? lines.slice(0, lines[lines.length - 1] === '' ? -1 : undefined)
    : [`No ${String(kindLabel || 'option').toLowerCase()} matchup guide data is available yet.`];
  return ['```txt', ...cleanLines, '```'].join('\n');
}

function buildLeadRows({ safe = {}, summary = {} } = {}) {
  const explicitLeads = Array.isArray(summary.bestLeadPairs) ? summary.bestLeadPairs : [];

  return (Array.isArray(explicitLeads) ? explicitLeads : [])
    .filter(Boolean)
    .map((item) => {
      const rawLabel = typeof item === 'string' ? item : item.pairName || item.leadPairName || item.name || item.label || item.title || '';
      const pair = typeof item === 'string'
        ? splitLeadPairName(item).map((name) => ({ name, types: [] }))
        : getLeadPairPokemon(item);
      const winRate = typeof item === 'string' ? normalizeLeadPercent(item, null) : resolveLeadWinRate(item);
      return {
        rank: typeof item === 'object' && item ? Number(item.rank || 0) : 0,
        pair,
        label: formatLeadPairLabel(pair, rawLabel),
        winRate,
        gamesPlayed: typeof item === 'object' && item
          ? Number(item.gamesPlayed || item.gamesCompleted || item.gamesAttempted || item.games || item.total || 0)
          : 0,
        wins: typeof item === 'object' && item ? Number(item.wins || 0) : 0,
        losses: typeof item === 'object' && item ? Number(item.losses || 0) : 0,
        ties: typeof item === 'object' && item ? Number(item.ties || 0) : 0,
        confidence: typeof item === 'object' && item ? item.confidence || item.confidenceLabel || null : null,
        runtimeMs: typeof item === 'object' && item ? Number(item.runtimeMs || 0) : 0,
        matchupGuide: typeof item === 'object' && item ? normalizeMatchupGuideRows(item.matchupGuide) : [],
      };
    })
    .filter((item) => item.label && String(item.label).trim().toLowerCase() !== 'unknown lead pair')
    .sort((a, b) => (
      (a.rank || 999) - (b.rank || 999)
      ||
      (b.winRate ?? -1) - (a.winRate ?? -1)
      || (b.gamesPlayed || 0) - (a.gamesPlayed || 0)
      || String(a.label || '').localeCompare(String(b.label || ''))
    ))
    .slice(0, 5);
}

function formatLeadRow(item = {}, index = 0) {
  const rank = `[#${Number(item.rank || index + 1)}]`;
  const label = formatLeadDisplayLabel(item.label);
  const wins = Number(item.wins || 0);
  const losses = Number(item.losses || 0);
  const games = Number(item.gamesPlayed || wins + losses + Number(item.ties || 0) || 0);
  if (item.winRate === null || item.winRate === undefined) {
    return `${rank.padEnd(5, ' ')}${label}`;
  }
  const winRate = formatSuitePercent(item.winRate, 0);
  const record = `${wins}-${losses}`;
  return `${rank.padEnd(5, ' ')}${formatLeadDisplayLabel(label, 27).padEnd(28, ' ')} ${String(winRate).padStart(3, ' ')}% WR  ${record.padStart(5, ' ')}  ${String(games).padStart(2, ' ')} games`;
}

function buildLeadBlock(rows = []) {
  const lines = rows
    .map(formatLeadRow)
    .filter(Boolean)
    .flatMap((line, index, array) => (index < array.length - 1 ? [line, ''] : [line]));
  if (!lines.length) {
    lines.push('No lead pair data is available in this report yet.');
  }
  return ['```txt', '|Rank| Lead Pair                    |WR|    |Record| |Games|', ...lines, '```'].join('\n');
}

function getCorePokemon(item = {}) {
  const coreArray = [
    item.core,
    item.actualSelectedCore,
    item.plannedCore,
    item.members,
    item.pokemon,
  ].find((value) => Array.isArray(value) && value.length >= 4);
  return Array.isArray(coreArray)
    ? coreArray.map(normalizeLeadPokemon).filter(Boolean).slice(0, 4)
    : [];
}

function formatCorePokemonName(item = {}) {
  const rawName = getLeadPokemonName(item);
  const name = String(rawName || 'Unknown').replace(/\s+/g, ' ').trim();
  return name.replace(/\b\w/g, (match) => match.toUpperCase());
}

function truncateCorePokemonName(name = '', width = 16) {
  const text = String(name || 'Unknown').trim();
  const chars = Array.from(text);
  if (chars.length <= width) return text;
  const safeWidth = Math.max(4, width);
  return `${chars.slice(0, safeWidth - 3).join('')}...`;
}

function formatCoreLabel(core = [], maxWidth = 58) {
  const names = core.map(formatCorePokemonName).filter(Boolean).slice(0, 4);
  if (names.length < 4) return '';
  let nameWidth = 18;
  let label = names.map((name) => truncateCorePokemonName(name, nameWidth)).join(' / ');
  while (Array.from(label).length > maxWidth && nameWidth > 9) {
    nameWidth -= 1;
    label = names.map((name) => truncateCorePokemonName(name, nameWidth)).join(' / ');
  }
  return label;
}

function normalizeCoreRank(item = {}, fallback = 999) {
  const raw = item.coreRank ?? item.rank ?? fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function buildCoreRows({ summary = {} } = {}) {
  const explicitCores = Array.isArray(summary.bestCores) ? summary.bestCores : [];
  return explicitCores
    .filter((item) => item && typeof item === 'object' && item.coreMatched === true)
    .map((item, index) => {
      const core = getCorePokemon(item);
      const rank = normalizeCoreRank(item, index + 1);
      const wins = Number(item.wins || 0);
      const losses = Number(item.losses || 0);
      const ties = Number(item.ties || 0);
      const gamesPlayed = Number(item.gamesPlayed || item.gamesCompleted || wins + losses + ties || 0);
      return {
        sourceIndex: index,
        rank,
        core,
        label: formatCoreLabel(core),
        winRate: resolveLeadWinRate(item),
        wins,
        losses,
        gamesPlayed,
        record: item.record || `${wins}-${losses}`,
        matchupGuide: normalizeMatchupGuideRows(item.matchupGuide),
      };
    })
    .filter((item) => item.label && item.core.length >= 4 && item.gamesPlayed > 0)
    .sort((a, b) => (
      a.rank - b.rank
      || a.sourceIndex - b.sourceIndex
    ))
    .slice(0, 5);
}

function formatCoreRow(item = {}, index = 0) {
  const rank = `[#${Number(item.rank || index + 1)}]`;
  const label = formatLeadDisplayLabel(item.label, 27);
  const winRate = item.winRate === null || item.winRate === undefined
    ? '--'
    : `${formatSuitePercent(item.winRate, 0)}% WR`;
  const games = Number(item.gamesPlayed || 0);
  return `${rank.padEnd(5, ' ')}${label.padEnd(28, ' ')} ${String(winRate).padStart(7, ' ')}  ${String(item.record || '0-0').padStart(5, ' ')}  ${String(games).padStart(2, ' ')} games`;
}

function buildCoreBlock(rows = []) {
  const lines = rows
    .map(formatCoreRow)
    .filter(Boolean)
    .flatMap((line, index, array) => (index < array.length - 1 ? [line, ''] : [line]));
  if (!lines.length) {
    lines.push('Core Sweep data is not available in this report yet.');
  }
  return ['```txt', '|Rank| Core                         |WR|    |Record| |Games|', ...lines, '```'].join('\n');
}

function buildOverviewTextBlock(lines = [], fallback = 'No data available yet.') {
  const safeLines = (Array.isArray(lines) ? lines : []).filter(Boolean);
  return ['```txt', ...(safeLines.length ? safeLines : [fallback]), '```'].join('\n');
}

function buildOverviewWeaknessLines(summary = {}, dangerMatchups = [], neutralMatchups = []) {
  const analyzerLines = summary?.deterministicAnalysis?.weaknesses;
  if (Array.isArray(analyzerLines) && analyzerLines.length) {
    return analyzerLines.filter(Boolean).slice(0, 4);
  }

  const dangerLines = dangerMatchups
    .map((item) => {
      const label = resolveFinalOverviewArchetypeLabel(item);
      const rate = formatSuitePercent(item.winRate ?? item.winChance, 0);
      return `- Respect ${label}: ${rate}% WR over ${formatRecordLine(item)}.`;
    })
    .slice(0, 3);
  const belowEvenLines = neutralMatchups
    .filter((item) => (numericWinRate(item) ?? 50) < 50)
    .map((item) => {
      const label = resolveFinalOverviewArchetypeLabel(item);
      const rate = formatSuitePercent(item.winRate ?? item.winChance, 0);
      return `- Watch ${label}: near-even but below plan at ${rate}% WR.`;
    })
    .slice(0, 2);
  return [...dangerLines, ...belowEvenLines].slice(0, 4);
}

function buildOverviewStrategyTipLines(summary = {}, goodMatchups = [], dangerMatchups = []) {
  const analyzerLines = summary?.deterministicAnalysis?.strategyTips;
  if (Array.isArray(analyzerLines) && analyzerLines.length) {
    return analyzerLines.filter(Boolean).slice(0, 4);
  }

  const tips = [];
  if (summary.practiceFirst) {
    tips.push(`- Practice first into ${summary.practiceFirst}.`);
  }
  if (goodMatchups[0]) {
    const best = resolveFinalOverviewArchetypeLabel(goodMatchups[0]);
    tips.push(`- Preserve the ${best} line as your confidence matchup.`);
  }
  if (dangerMatchups[0]) {
    const danger = resolveFinalOverviewArchetypeLabel(dangerMatchups[0]);
    tips.push(`- Build a dedicated lead plan for ${danger}.`);
  }
  if (summary.takeaway) {
    tips.push(`- Quick read: ${summary.takeaway}`);
  }
  return tips.slice(0, 4);
}

function normalizeBenchMarkSuiteReportTab(tab = 'overview') {
  const value = String(tab || '').trim().toLowerCase();
  if (['overview', 'threats', 'leads', 'core'].includes(value)) return value;
  return 'overview';
}

function buildBenchMarkSuiteReportTabRow({
  ownerId,
  selectedReportTab = 'overview',
  hasPaperReportReady = false,
  hasMatchArchiveReady = false,
  hasLoadTeamReady = false,
  customIdBase = 'benchmark_suite_report_tab',
  customIdParts = [],
} = {}) {
  const selected = normalizeBenchMarkSuiteReportTab(selectedReportTab);
  const options = [
    {
      label: 'Overview',
      description: selected === 'overview' ? 'Current report tab' : 'Summary, record, and matchup bands',
      value: 'overview',
      emoji: selected === 'overview' ? '✅' : '📋',
    },
    {
      label: 'Threats',
      description: selected === 'threats' ? 'Current report tab' : 'Danger matchups and pressure points',
      value: 'threats',
      emoji: selected === 'threats' ? '✅' : '🔴',
    },
    {
      label: 'Leads',
      description: selected === 'leads' ? 'Current report tab' : 'Practice targets and favorable openings',
      value: 'leads',
      emoji: selected === 'leads' ? '✅' : '🧭',
    },
    {
      label: 'Core',
      description: selected === 'core' ? 'Current report tab' : 'Top four-Pokemon cores from the sweep',
      value: 'core',
      emoji: selected === 'core' ? '✅' : '🧩',
    },
    ...(hasPaperReportReady ? [{
      label: 'Download Paper Report',
      description: 'Download the current latest Simulation Report paper report',
      value: 'download_paper_report',
      emoji: '📄',
    }] : []),
    ...(hasMatchArchiveReady ? [{
      label: 'Download Simulation Archive',
      description: 'Download the current latest Simulation Report replay archive',
      value: 'download_simulation_archive',
      emoji: '📦',
    }] : []),
    ...(hasLoadTeamReady ? [{
      label: 'Load Team',
      description: 'Restore this previous Battle Simulator team',
      value: 'load_team',
      emoji: '📥',
    }] : []),
    {
      label: 'Back to Battle Simulator',
      description: 'Return to the main Battle Simulator menu',
      value: 'back_benchmark',
      emoji: '⬅️',
    },
  ];
  return buildMenuSelect(makeCustomId(customIdBase, ownerId, ...customIdParts), 'Choose a Simulation Report tab.', options);
}

function truncateHistoryOptionText(value, limit = 100) {
  const text = String(value || '').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function formatHistoryReportOptionAge(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Saved report';
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (diffMs < minuteMs) return 'just now';
  if (diffMs < hourMs) return `${Math.max(1, Math.floor(diffMs / minuteMs))}m ago`;
  if (diffMs < dayMs) return `${Math.max(1, Math.floor(diffMs / hourMs))}h ago`;
  if (diffMs < 14 * dayMs) return `${Math.max(1, Math.floor(diffMs / dayMs))}d ago`;
  return `${Math.max(2, Math.floor(diffMs / (7 * dayMs)))}w ago`;
}

function getHistoryReportOptionDateMs(historyReport = {}) {
  const report = historyReport.report && typeof historyReport.report === 'object' ? historyReport.report : {};
  const value = report.generatedAt
    || report.generated_at
    || historyReport.completed_at
    || historyReport.updated_at
    || null;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function cleanHistoryOptionName(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPokemonNameFromExportLine(line = '') {
  const raw = String(line || '').trim();
  if (!raw || raw.startsWith('-') || raw.includes(':')) return null;
  const beforeItem = raw.split('@')[0].trim();
  const speciesMatch = beforeItem.match(/\(([^()]+)\)\s*$/);
  return cleanHistoryOptionName(speciesMatch ? speciesMatch[1] : beforeItem) || null;
}

function extractPokemonNamesFromTeamExport(teamExport = '') {
  return String(teamExport || '')
    .split(/\r?\n/)
    .map(extractPokemonNameFromExportLine)
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeHistoryPokemonList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return cleanHistoryOptionName(item);
      if (!item || typeof item !== 'object') return '';
      return cleanHistoryOptionName(item.species || item.name || item.pokemon || item.label || '');
    })
    .filter(Boolean)
    .slice(0, 6);
}

function getHistoryReportTeamExport(historyReport = {}) {
  const request = historyReport.request && typeof historyReport.request === 'object' ? historyReport.request : {};
  const report = historyReport.report && typeof historyReport.report === 'object' ? historyReport.report : {};
  const savedReport = report.savedReport && typeof report.savedReport === 'object' ? report.savedReport : {};
  return request.teamExport
    || request.team_export
    || report.userTeamExport
    || report.playerTeamExport
    || report.teamExport
    || savedReport.userTeamExport
    || savedReport.playerTeamExport
    || savedReport.teamExport
    || '';
}

function getHistoryReportPokemonNames(historyReport = {}) {
  const request = historyReport.request && typeof historyReport.request === 'object' ? historyReport.request : {};
  const report = historyReport.report && typeof historyReport.report === 'object' ? historyReport.report : {};
  const summary = report.compactSummary && typeof report.compactSummary === 'object'
    ? report.compactSummary
    : (report.summary && typeof report.summary === 'object' ? report.summary : {});
  const candidates = [
    request.teamPokemon,
    request.team_pokemon,
    request.pokemon,
    summary.teamPokemon,
    summary.team_pokemon,
    summary.pokemon,
    report.teamPokemon,
    report.team_pokemon,
    report.userTeamPokemon,
    report.playerTeamPokemon,
    report.pokemon,
    report.teamMembers,
  ];
  const fromFields = candidates.map(normalizeHistoryPokemonList).find((names) => names.length);
  if (fromFields?.length) return fromFields;
  return extractPokemonNamesFromTeamExport(getHistoryReportTeamExport(historyReport));
}

function getHistoryReportArchetypeLabel(historyReport = {}) {
  const report = historyReport.report && typeof historyReport.report === 'object' ? historyReport.report : {};
  const summary = report.compactSummary && typeof report.compactSummary === 'object'
    ? report.compactSummary
    : (report.summary && typeof report.summary === 'object' ? report.summary : {});
  const canonical = resolveCanonicalMatchupGuideLabel({
    finalArchetypeLabel: summary.finalArchetypeLabel || report.finalArchetypeLabel,
    archetypeMetadata: summary.teamArchetypeMetadata || summary.archetypeMetadata || report.teamArchetypeMetadata || report.archetypeMetadata,
    opponentArchetypeMetadata: summary.opponentArchetypeMetadata || report.opponentArchetypeMetadata,
  });
  if (canonical) return canonical;
  const candidates = [
    summary.teamArchetype,
    summary.team_archetype,
    summary.primaryArchetype,
    summary.primary_archetype,
    summary.archetype,
    report.teamArchetype,
    report.team_archetype,
    report.primaryArchetype,
    report.primary_archetype,
    report.archetype,
  ];
  return candidates
    .map((value) => prettifyArchetypeLabel(value || ''))
    .find((value) => value && !isGenericMatchupGuideLabel(value)) || 'Battle Team';
}

function formatHistoryPokemonDescription(names = []) {
  const pokemonNames = names.map(cleanHistoryOptionName).filter(Boolean).slice(0, 6);
  if (!pokemonNames.length) return 'Pokemon team unavailable';
  const full = pokemonNames.join(' / ');
  if (full.length <= 100) return full;
  const visible = [];
  for (const name of pokemonNames) {
    const next = [...visible, name, '...'].join(' / ');
    if (next.length > 100) break;
    visible.push(name);
  }
  return visible.length
    ? visible.concat('...').join(' / ')
    : truncateHistoryOptionText(full, 100);
}

function buildHistoryTeamOption(historyReport = {}, index = 0, valuePrefix = 'history') {
  const archetype = getHistoryReportArchetypeLabel(historyReport);
  const age = formatHistoryReportOptionAge(
    historyReport.report?.generatedAt
      || historyReport.report?.generated_at
      || historyReport.completed_at
      || historyReport.updated_at,
  );
  return {
    label: truncateHistoryOptionText(`${archetype} • ${age}`, 100),
    description: formatHistoryPokemonDescription(getHistoryReportPokemonNames(historyReport)),
    value: `${valuePrefix}_${index}`,
  };
}

function sortHistoryReportsForOptions(historyReports = []) {
  return historyReports
    .map((historyReport, index) => ({
      historyReport,
      index,
      option: buildHistoryTeamOption(historyReport, index),
    }))
    .sort((a, b) => {
      const dateDiff = getHistoryReportOptionDateMs(b.historyReport) - getHistoryReportOptionDateMs(a.historyReport);
      if (dateDiff) return dateDiff;
      const labelDiff = a.option.label.localeCompare(b.option.label, undefined, { sensitivity: 'base' });
      if (labelDiff) return labelDiff;
      return a.option.description.localeCompare(b.option.description, undefined, { sensitivity: 'base' });
    });
}

function buildBenchMarkSuiteHistoryRow({
  ownerId,
  historyReports = [],
  selectedHistoryIndex = -1,
  hasPaperReportReady = false,
} = {}) {
  const selectedIndex = Number.isInteger(Number(selectedHistoryIndex))
    ? Number(selectedHistoryIndex)
    : -1;
  const reportOptions = sortHistoryReportsForOptions(historyReports).slice(0, 3).map(({ option, index }) => ({
    ...option,
    emoji: index === selectedIndex ? '✅' : '📄',
  }));
  const actionOptions = selectedIndex >= 0 && hasPaperReportReady
    ? [{
      label: 'Download Paper Report',
      description: 'Download this previous Simulation Report paper report',
      value: 'download_paper_report',
      emoji: '📄',
    }]
    : [];

  return buildMenuSelect(
    selectedIndex >= 0
      ? makeCustomId('benchmark_suite_history_select', ownerId, String(selectedIndex))
      : makeCustomId('benchmark_suite_history_select', ownerId),
    'Choose a previous Simulation Report.',
    [
      ...reportOptions,
      ...actionOptions,
      {
        label: 'Back to Battle Simulator',
        description: 'Return to the main Battle Simulator menu',
        value: 'back_benchmark',
        emoji: '⬅️',
      },
    ],
  );
}

function buildBenchMarkLoadTeamRow({
  ownerId,
  historyReports = [],
} = {}) {
  const options = sortHistoryReportsForOptions(historyReports).slice(0, 3).map(({ historyReport, index }) => ({
    ...buildHistoryTeamOption(historyReport, index, 'load_team'),
    emoji: '📥',
  }));

  return buildMenuSelect(
    makeCustomId('benchmark_load_team_select', ownerId),
    'Choose a previous team to load.',
    [
      ...options,
      {
        label: 'Back to Battle Simulator',
        description: 'Return to the main Battle Simulator menu',
        value: 'back_benchmark',
        emoji: '⬅️',
      },
    ],
  );
}

function buildBenchMarkSuiteOverviewLines({ safe, summary, selectionSummary, goodMatchups, neutralMatchups, dangerMatchups }) {
  const winRate = resolveSuiteWinRate(safe, summary);
  const wins = formatOverviewNumber(safe.wins ?? summary.wins, 0);
  const losses = formatOverviewNumber(safe.losses ?? summary.losses, 0);
  const ties = formatOverviewNumber(safe.ties ?? summary.ties, 0);
  const games = formatOverviewNumber(summary.totalGamesCompleted ?? safe.totalGamesCompleted, wins + losses + ties);
  const averageTurns = formatOverviewTurns(summary.averageTurns ?? safe.averageTurns);
  const matchupRows = buildOverviewMatchupRows(summary);
  const weaknessLines = buildOverviewWeaknessLines(summary, dangerMatchups, neutralMatchups);
  const strategyTipLines = buildOverviewStrategyTipLines(summary, goodMatchups, dangerMatchups);

  return [
    buildStoryBlock(['"Overview is the scout card: score, matchup bands, weaknesses, and the next practice line."']),
    '',
    `# ${winRate}% WR [${buildOverviewTierLabel(winRate)}]`,
    `${formatOverviewCount(wins)} W • ${formatOverviewCount(losses)} L • ${formatOverviewCount(games)} Battles • ${averageTurns} Avg Turns`,
    overviewSpacer(),
    overviewSpacer(),
    '**📊 Win Rate by Archetype**',
    buildOverviewMatchupBlock(matchupRows),
    '',
    '**🔴 Weaknesses**',
    buildOverviewTextBlock(weaknessLines, 'No clear weakness band surfaced in this run.'),
    '',
    '**🧭 Strategy Tips**',
    buildOverviewTextBlock(strategyTipLines, 'No strategy tips available yet. Run more games for better signal.'),
    '',
    `**🕒 Generated:** ${formatGeneratedText(safe, summary)}`,
  ];
}

function buildBenchMarkSuiteThreatLines({ safe, summary, dangerMatchups, neutralMatchups }) {
  const threatRows = buildThreatRows({ safe, summary, dangerMatchups, neutralMatchups });
  const biggestThreat = threatRows[0];
  const hasPokemonThreatRows = Boolean(biggestThreat && biggestThreat.sourceKind === 'pokemon-threat');
  return [
    buildStoryBlock(['"Threats are the opponents and matchup patterns that beat you most. Use this as your first danger list."']),
    '',
    '# Top Threats',
    hasPokemonThreatRows
      ? 'Pokemon that beat you most'
      : 'Matchup patterns that beat you most; Pokemon threat data is not wired yet',
    ...(biggestThreat ? [
      overviewSpacer(),
      `**📌 Biggest ${hasPokemonThreatRows ? 'Threat' : 'Pattern'}:** ${biggestThreat.displayEmoji} ${biggestThreat.displayName} • ${biggestThreat.lossRate}% LR`,
    ] : []),
    overviewSpacer(),
    buildThreatBlock(threatRows),
  ];
}

function buildBenchMarkSuiteLeadLines({ safe, summary }) {
  const leadRows = buildLeadRows({ safe, summary });
  const bestLead = leadRows[0];
  return [
    buildStoryBlock(['"Leads focuses on the openings that give your team the cleanest first turn. Start here before drilling deeper lines."']),
    '',
    '# Best Lead Pairs',
    leadRows.length
      ? 'Top 5 from Lead Pair Sweep'
      : 'Lead-pair sweep data is not available in this report yet',
    ...(bestLead && bestLead.winRate !== null && bestLead.winRate !== undefined ? [
      overviewSpacer(),
      `**📌 Best Lead:** ${bestLead.label} • ${formatSuitePercent(bestLead.winRate, 0)}% WR`,
    ] : []),
    overviewSpacer(),
    buildLeadBlock(leadRows),
    '',
    '**When To Use**',
    buildWhenToUseBlock(leadRows, 'Lead'),
  ];
}

function buildBenchMarkSuiteCoreLines({ summary }) {
  const coreRows = buildCoreRows({ summary });
  const bestCore = coreRows[0];
  return [
    buildStoryBlock(['"Core focuses on the four-Pokemon groups that give your team the most reliable game plan after preview."']),
    '',
    '# Best Cores',
    coreRows.length
      ? 'Top 5 from Core Sweep'
      : 'Core Sweep data is not available in this report yet',
    ...(bestCore && bestCore.winRate !== null && bestCore.winRate !== undefined ? [
      overviewSpacer(),
      `**📌 Best Core:** ${bestCore.label} • ${formatSuitePercent(bestCore.winRate, 0)}% WR`,
    ] : []),
    overviewSpacer(),
    buildCoreBlock(coreRows),
    '',
    '**When To Use**',
    buildWhenToUseBlock(coreRows, 'Core'),
  ];
}

function formatGeneratedText(report = {}, summary = {}) {
  return summary.generatedDiscord || report.generatedAt || 'Unknown';
}

function formatSuiteGamesText(report = {}, summary = {}) {
  const completed = Number(report.totalGamesCompleted ?? summary.totalGamesCompleted ?? 0);
  const safeCompleted = Number.isFinite(completed) ? completed : 0;

  // Best-of early stop means the final battle count can vary by run.
  // Show the actual completed battle count instead of a misleading max target.
  return `${safeCompleted} completed`;
}



function buildBenchMarkSuiteEmbed({
  username,
  report,
  reportTab = 'overview',
}) {
  const safe = report || {};
  const summary = safe.compactSummary || {};
  const selectionSummary = safe.selectionSummary || {};
  const goodMatchups = sortMatchupsForSection(summary.goodMatchups, 'good');
  const neutralMatchups = sortMatchupsForSection(summary.neutralMatchups, 'neutral');
  const dangerMatchups = sortMatchupsForSection(summary.dangerMatchups, 'danger');
  const selectedReportTab = normalizeBenchMarkSuiteReportTab(reportTab);
  const tabTitle = selectedReportTab === 'overview'
    ? 'Overview'
    : selectedReportTab === 'threats'
      ? 'Threats'
      : selectedReportTab === 'core'
        ? 'Core'
        : 'Leads';
  const tabLines = selectedReportTab === 'threats'
    ? buildBenchMarkSuiteThreatLines({ safe, summary, dangerMatchups, neutralMatchups })
    : selectedReportTab === 'leads'
      ? buildBenchMarkSuiteLeadLines({ safe, summary })
      : selectedReportTab === 'core'
        ? buildBenchMarkSuiteCoreLines({ summary })
      : buildBenchMarkSuiteOverviewLines({
        safe,
        summary,
        selectionSummary,
        goodMatchups,
        neutralMatchups,
        dangerMatchups,
      });

  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle(`🏁 Professor Aegis • ${username}'s Simulation Report • ${tabTitle}`)
    .setDescription(cleanList(tabLines));
}

module.exports = {
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
  buildMatchArchiveButtonRow,
  buildBenchMarkTeamModal,
  buildBenchMarkSubmittedTeamExportRow,
  buildBenchMarkClearDataConfirmEmbed,
  buildBenchMarkClearDataConfirmRow,
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
  buildBenchMarkSubmittedTeamEmbed,
  buildBenchMarkReportEmbed,
  buildBenchMarkMatchupEvalEmbed,
  buildBenchMarkSimScaffoldEmbed,
  buildBenchMarkSuiteEmbed,
};
