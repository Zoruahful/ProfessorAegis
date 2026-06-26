const ANALYZER_VERSION = '2026.04.08-archetype-pool-v1';

function cleanText(value) {
  return String(value || '').trim();
}

const MOVE_PATTERNS = {
  trickRoom: /^(trick room)$/i,
  tailwind: /^(tailwind)$/i,
  fakeOut: /^(fake out)$/i,
  redirection: /^(follow me|rage powder)$/i,
  protect: /^(protect|detect|spiky shield|baneful bunker|silk trap|burning bulwark|obstruct)$/i,
  priority: /^(sucker punch|aqua jet|ice shard|shadow sneak|extreme speed|mach punch|jet punch|vacuum wave|grassy glide)$/i,
  speedControl: /^(tailwind|trick room|icy wind|electroweb|thunder wave|string shot|bulldoze|scary face)$/i,
  pivot: /^(u-turn|volt switch|parting shot|flip turn|baton pass)$/i,
  setup: /^(nasty plot|swords dance|dragon dance|bulk up|calm mind|quiver dance|belly drum|curse)$/i,
  spread: /^(rock slide|heat wave|dazzling gleam|hyper voice|earthquake|discharge|blizzard|eruption|surf|snarl|bleakwind storm|icy wind|electroweb|muddy water|expanding force)$/i,
  disruption: /^(taunt|encore|haze|clear smog|disable|will-o-wisp|thunder wave|spore|yawn)$/i,
  wideGuard: /^(wide guard)$/i,
  helpingHand: /^(helping hand)$/i,
  weather: /^(rain dance|sunny day|sandstorm|snowscape)$/i,
  terrain: /^(electric terrain|grassy terrain|misty terrain|psychic terrain)$/i,
};

const ITEM_PATTERNS = {
  sash: /focus sash/i,
  scarf: /choice scarf/i,
  specs: /choice specs/i,
  band: /choice band/i,
  assaultVest: /assault vest/i,
  booster: /booster energy/i,
  eviolite: /eviolite/i,
  lifeOrb: /life orb/i,
};

const ABILITY_PATTERNS = {
  intimidate: /^intimidate$/i,
  prankster: /^prankster$/i,
  drizzle: /^drizzle$/i,
  drought: /^drought$/i,
  armorTail: /^armor tail$/i,
};

function normalizeMove(line) {
  return String(line || '').replace(/^- /, '').trim();
}

function parseHeaderSpecies(headerLine) {
  const raw = String(headerLine || '').split(' @ ')[0].trim();
  if (!raw) return 'Unknown';
  if (raw.includes('(') && raw.includes(')')) {
    const lastOpen = raw.lastIndexOf('(');
    const lastClose = raw.lastIndexOf(')');
    if (lastOpen >= 0 && lastClose > lastOpen) {
      return raw.slice(lastOpen + 1, lastClose).trim() || raw;
    }
  }
  return raw;
}

function parseTeamExport(teamExport) {
  const normalized = String(teamExport || '').replace(/\r\n/g, '\n').trim();
  const blocks = normalized
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const pokemon = blocks.map((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const header = lines[0] || '';
    const species = parseHeaderSpecies(header);
    const item = header.includes(' @ ') ? header.split(' @ ')[1].trim() : null;
    const abilityLine = lines.find((line) => /^Ability:/i.test(line)) || '';
    const ability = abilityLine ? abilityLine.replace(/^Ability:\s*/i, '').trim() : null;
    const moves = lines.filter((line) => /^- /.test(line)).map(normalizeMove);

    return {
      header,
      species,
      item,
      ability,
      moves,
      lines,
    };
  });

  const teamNames = pokemon.map((mon) => mon.species).filter(Boolean).slice(0, 6);
  return { normalized, pokemon, teamNames };
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

function monHasMove(mon, pattern) {
  return Array.isArray(mon?.moves) && mon.moves.some((move) => pattern.test(move));
}

function monHasAbility(mon, pattern) {
  return pattern.test(cleanText(mon?.ability));
}

function monHasItem(mon, pattern) {
  return pattern.test(cleanText(mon?.item));
}

function hasAnyMove(pokemon, pattern) {
  return pokemon.some((mon) => monHasMove(mon, pattern));
}

function countMoveUsers(pokemon, pattern) {
  return pokemon.filter((mon) => monHasMove(mon, pattern)).length;
}

function countAbilityUsers(pokemon, pattern) {
  return pokemon.filter((mon) => monHasAbility(mon, pattern)).length;
}

function countItemUsers(pokemon, pattern) {
  return pokemon.filter((mon) => monHasItem(mon, pattern)).length;
}

function pushUnique(target, text) {
  if (!text) return;
  if (!target.includes(text)) target.push(text);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function scoreToPercent(score) {
  return clamp(Math.round(50 + score * 4), 35, 65);
}

function buildOverallRead(signals) {
  if (signals.hasTrickRoom && signals.hasTailwind) {
    return 'Flexible speed control with more than one pace option';
  }
  if (signals.hasTrickRoom && signals.redirectionUsers > 0) {
    return 'Supported Trick Room structure';
  }
  if (signals.hasTailwind && signals.fakeOutUsers > 0) {
    return 'Fast tempo offense with strong early-turn pressure';
  }
  if (signals.hasTailwind) {
    return 'Fast offense leaning';
  }
  if (signals.hasTrickRoom) {
    return 'Room-mode leaning';
  }
  if (signals.weatherMode) {
    return 'Weather-enabled offense';
  }
  if (signals.speedControlUsers >= 2 && signals.disruptionUsers >= 2) {
    return 'Balance-style support shell';
  }
  if (signals.setupUsers >= 2) {
    return 'Setup-focused offense';
  }
  return 'Unclear speed profile with mixed support signals';
}

function buildPlainLanguageSummary(signals, archetypeSummary) {
  const pieces = [];

  pieces.push(`This export reads most like ${archetypeSummary}.`);

  if (signals.hasTailwind && signals.hasTrickRoom) {
    pieces.push('Your team shows more than one speed plan, so it may be able to play both fast and slow games depending on the matchup.');
  } else if (signals.hasTailwind) {
    pieces.push('Your team looks built to play faster games and try to attack before the opponent settles in.');
  } else if (signals.hasTrickRoom) {
    pieces.push('Your team looks like it wants to slow the game down and let slower attackers move first.');
  } else {
    pieces.push('Your team does not show one obvious speed plan yet, so some matchups may feel awkward when tempo matters.');
  }

  if (signals.fakeOutUsers > 0) {
    pieces.push('You also show Fake Out support, which usually helps with safer turn-one positioning.');
  } else if (signals.turnOneControlScore <= 1) {
    pieces.push('The export shows fewer true turn-one control tools, so some opening turns may feel more fragile.');
  }

  if (signals.redirectionUsers > 0) {
    pieces.push('Redirection support is present too, so setup or partner-protection turns may feel more stable.');
  } else {
    pieces.push('There is no clear redirection support, so fragile positioning turns may be harder to protect.');
  }

  if (signals.protectUsers <= 2) {
    pieces.push('Protect usage looks a little light, which can matter a lot in doubles endgames.');
  }

  return pieces.join(' ');
}

function supportMoveCount(mon) {
  return mon.moves.filter(
    (move) =>
      MOVE_PATTERNS.trickRoom.test(move) ||
      MOVE_PATTERNS.tailwind.test(move) ||
      MOVE_PATTERNS.fakeOut.test(move) ||
      MOVE_PATTERNS.redirection.test(move) ||
      MOVE_PATTERNS.protect.test(move) ||
      MOVE_PATTERNS.speedControl.test(move) ||
      MOVE_PATTERNS.pivot.test(move) ||
      MOVE_PATTERNS.setup.test(move) ||
      MOVE_PATTERNS.disruption.test(move) ||
      MOVE_PATTERNS.wideGuard.test(move) ||
      MOVE_PATTERNS.helpingHand.test(move) ||
      MOVE_PATTERNS.weather.test(move) ||
      MOVE_PATTERNS.terrain.test(move)
  ).length;
}

function buildMonProfile(mon) {
  const profile = {
    species: mon.species,
    hasTailwind: monHasMove(mon, MOVE_PATTERNS.tailwind),
    hasTrickRoom: monHasMove(mon, MOVE_PATTERNS.trickRoom),
    hasFakeOut: monHasMove(mon, MOVE_PATTERNS.fakeOut),
    hasRedirection: monHasMove(mon, MOVE_PATTERNS.redirection),
    hasProtect: monHasMove(mon, MOVE_PATTERNS.protect),
    hasPriority: monHasMove(mon, MOVE_PATTERNS.priority),
    hasSpeedControl: monHasMove(mon, MOVE_PATTERNS.speedControl),
    hasPivot: monHasMove(mon, MOVE_PATTERNS.pivot),
    hasSetup: monHasMove(mon, MOVE_PATTERNS.setup),
    hasSpread: monHasMove(mon, MOVE_PATTERNS.spread),
    hasDisruption: monHasMove(mon, MOVE_PATTERNS.disruption),
    hasWideGuard: monHasMove(mon, MOVE_PATTERNS.wideGuard),
    hasHelpingHand: monHasMove(mon, MOVE_PATTERNS.helpingHand),
    hasWeather: monHasMove(mon, MOVE_PATTERNS.weather),
    hasTerrain: monHasMove(mon, MOVE_PATTERNS.terrain),
    hasPrankster: monHasAbility(mon, ABILITY_PATTERNS.prankster),
    hasIntimidate: monHasAbility(mon, ABILITY_PATTERNS.intimidate),
    hasArmorTail: monHasAbility(mon, ABILITY_PATTERNS.armorTail),
    hasChoiceItem:
      monHasItem(mon, ITEM_PATTERNS.scarf) ||
      monHasItem(mon, ITEM_PATTERNS.specs) ||
      monHasItem(mon, ITEM_PATTERNS.band),
    hasBoosterItem: monHasItem(mon, ITEM_PATTERNS.booster),
    hasSash: monHasItem(mon, ITEM_PATTERNS.sash),
  };

  const supportCount = supportMoveCount(mon);
  const attackCount = Math.max(0, mon.moves.length - supportCount);
  profile.attackCount = attackCount;
  profile.isAttacker = attackCount >= 2 || profile.hasChoiceItem || profile.hasBoosterItem;
  profile.hasTurnOneControl =
    profile.hasFakeOut || profile.hasPrankster || profile.hasDisruption || profile.hasIntimidate;
  profile.hasProtection =
    profile.hasProtect || profile.hasRedirection || profile.hasWideGuard || profile.hasArmorTail;
  return profile;
}

function buildSignals(pokemon) {
  const profiles = pokemon.map(buildMonProfile);

  const signals = {
    hasTrickRoom: hasAnyMove(pokemon, MOVE_PATTERNS.trickRoom),
    hasTailwind: hasAnyMove(pokemon, MOVE_PATTERNS.tailwind),
    fakeOutUsers: countMoveUsers(pokemon, MOVE_PATTERNS.fakeOut),
    redirectionUsers: countMoveUsers(pokemon, MOVE_PATTERNS.redirection),
    protectUsers: countMoveUsers(pokemon, MOVE_PATTERNS.protect),
    priorityUsers: countMoveUsers(pokemon, MOVE_PATTERNS.priority),
    speedControlUsers: countMoveUsers(pokemon, MOVE_PATTERNS.speedControl),
    pivotUsers: countMoveUsers(pokemon, MOVE_PATTERNS.pivot),
    setupUsers: countMoveUsers(pokemon, MOVE_PATTERNS.setup),
    spreadUsers: countMoveUsers(pokemon, MOVE_PATTERNS.spread),
    disruptionUsers: countMoveUsers(pokemon, MOVE_PATTERNS.disruption),
    wideGuardUsers: countMoveUsers(pokemon, MOVE_PATTERNS.wideGuard),
    helpingHandUsers: countMoveUsers(pokemon, MOVE_PATTERNS.helpingHand),
    terrainUsers: countMoveUsers(pokemon, MOVE_PATTERNS.terrain),
    weatherUsers: countMoveUsers(pokemon, MOVE_PATTERNS.weather),
    intimidateUsers: countAbilityUsers(pokemon, ABILITY_PATTERNS.intimidate),
    pranksterUsers: countAbilityUsers(pokemon, ABILITY_PATTERNS.prankster),
    drizzleUsers: countAbilityUsers(pokemon, ABILITY_PATTERNS.drizzle),
    droughtUsers: countAbilityUsers(pokemon, ABILITY_PATTERNS.drought),
    choiceUsers:
      countItemUsers(pokemon, ITEM_PATTERNS.scarf) +
      countItemUsers(pokemon, ITEM_PATTERNS.specs) +
      countItemUsers(pokemon, ITEM_PATTERNS.band),
    sashUsers: countItemUsers(pokemon, ITEM_PATTERNS.sash),
    boosterUsers: countItemUsers(pokemon, ITEM_PATTERNS.booster),
    evioliteUsers: countItemUsers(pokemon, ITEM_PATTERNS.eviolite),
    lifeOrbUsers: countItemUsers(pokemon, ITEM_PATTERNS.lifeOrb),
    profiles,
  };

  signals.weatherMode = signals.weatherUsers > 0 || signals.drizzleUsers > 0 || signals.droughtUsers > 0;
  signals.turnOneControlScore =
    (signals.fakeOutUsers > 0 ? 2 : 0) +
    (signals.pranksterUsers > 0 ? 1 : 0) +
    (signals.intimidateUsers > 0 ? 1 : 0) +
    (signals.disruptionUsers > 0 ? 1 : 0);
  signals.positioningScore =
    (signals.pivotUsers > 0 ? 1 : 0) +
    (signals.redirectionUsers > 0 ? 2 : 0) +
    (signals.protectUsers >= 4 ? 1 : 0) +
    (signals.wideGuardUsers > 0 ? 1 : 0);
  signals.antiTrickRoomScore =
    (signals.hasTrickRoom ? 2 : 0) +
    (signals.fakeOutUsers > 0 ? 1 : 0) +
    (signals.disruptionUsers > 0 ? 1 : 0);
  signals.antiSpreadScore =
    (signals.wideGuardUsers > 0 ? 2 : 0) +
    (signals.protectUsers >= 4 ? 1 : 0) +
    (signals.positioningScore >= 3 ? 1 : 0);
  signals.modeFlexScore =
    (signals.hasTailwind ? 1 : 0) +
    (signals.hasTrickRoom ? 1 : 0) +
    (signals.weatherMode ? 1 : 0);
  return signals;
}

function evaluateArchetypes(signals) {
  const archetypes = [];

  function addArchetype(name, score, notes = []) {
    archetypes.push({
      name,
      score,
      winRate: scoreToPercent(score),
      notes: notes.filter(Boolean),
    });
  }

  let score = 0;
  const fastNotes = [];
  if (signals.hasTailwind) {
    score += 2;
    fastNotes.push('you can actually contest raw speed');
  }
  if (signals.fakeOutUsers > 0) {
    score += 1;
    fastNotes.push('Fake Out helps stabilize turn one');
  }
  if (signals.hasTrickRoom) {
    score += 1;
    fastNotes.push('a secondary Trick Room line helps if the race goes badly');
  }
  if (signals.priorityUsers > 0) {
    score += 1;
    fastNotes.push('priority can help clean up after speed trades');
  }
  if (!signals.hasTailwind && !signals.hasTrickRoom) {
    score -= 3;
  }
  if (signals.protectUsers <= 2) {
    score -= 1;
  }
  addArchetype('Fast offense mirrors', score, fastNotes);

  score = 0;
  const trNotes = [];
  if (signals.hasTrickRoom) {
    score += 2;
    trNotes.push('you can mirror Trick Room instead of only trying to stop it');
  }
  if (signals.fakeOutUsers > 0) {
    score += 1;
    trNotes.push('Fake Out can pressure the room turn');
  }
  if (signals.disruptionUsers > 0 || signals.pranksterUsers > 0) {
    score += 1;
    trNotes.push('support disruption gives you ways to interfere with setup');
  }
  if (signals.spreadUsers > 0 || signals.choiceUsers > 0 || signals.lifeOrbUsers > 0) {
    score += 1;
    trNotes.push('you show enough pressure to punish passive room turns');
  }
  if (!signals.hasTrickRoom && signals.fakeOutUsers === 0 && signals.disruptionUsers === 0) {
    score -= 3;
  }
  addArchetype('Hard Trick Room', score, trNotes);

  score = 0;
  const redirectNotes = [];
  if (signals.spreadUsers > 0) {
    score += 1;
    redirectNotes.push('spread pressure helps punish boards that hide behind Follow Me or Rage Powder');
  }
  if (signals.fakeOutUsers > 0) {
    score += 1;
    redirectNotes.push('turn-one control helps stop redirection partners from moving freely');
  }
  if (signals.hasTailwind || signals.hasTrickRoom) {
    score += 1;
    redirectNotes.push('you can still contest pace instead of playing their slow game');
  }
  if (signals.redirectionUsers > 0) {
    score += 1;
    redirectNotes.push('your own redirection support lets you fight for the same kind of board control');
  }
  if (signals.redirectionUsers === 0) {
    score -= 2;
  }
  if (signals.protectUsers <= 2) {
    score -= 1;
  }
  addArchetype('Redirection balance', score, redirectNotes);

  score = 0;
  const bulkyNotes = [];
  if (signals.hasTailwind && signals.hasTrickRoom) {
    score += 2;
    bulkyNotes.push('dual speed control helps against slower, adaptable teams');
  }
  if (signals.pivotUsers > 0) {
    score += 1;
    bulkyNotes.push('pivot tools help you reposition around bulky cores');
  }
  if (signals.helpingHandUsers > 0 || signals.setupUsers > 0) {
    score += 1;
    bulkyNotes.push('you have ways to create extra pressure instead of only trading hits');
  }
  if (signals.protectUsers >= 4) {
    score += 1;
    bulkyNotes.push('strong Protect coverage helps in longer board states');
  }
  if (signals.choiceUsers >= 2) {
    score -= 1;
  }
  if (signals.protectUsers <= 2 && signals.pivotUsers === 0) {
    score -= 2;
  }
  addArchetype('Bulky balance', score, bulkyNotes);

  score = 0;
  const spreadNotes = [];
  if (signals.wideGuardUsers > 0) {
    score += 3;
    spreadNotes.push('Wide Guard is a direct answer to spread pressure');
  }
  if (signals.protectUsers >= 4) {
    score += 1;
    spreadNotes.push('good Protect coverage helps you scout and reduce spread damage cycles');
  }
  if (signals.hasTailwind || signals.hasTrickRoom) {
    score += 1;
    spreadNotes.push('clear speed control helps you stop repeated spread turns from snowballing');
  }
  if (signals.wideGuardUsers === 0) {
    score -= 2;
  }
  if (signals.protectUsers <= 2) {
    score -= 2;
  }
  addArchetype('Spread-heavy offense', score, spreadNotes);

  score = 0;
  const pressureNotes = [];
  if (signals.fakeOutUsers > 0) {
    score += 1;
    pressureNotes.push('Fake Out helps blunt immediate pressure');
  }
  if (signals.intimidateUsers > 0) {
    score += 1;
    pressureNotes.push('Intimidate softens physical pressure teams');
  }
  if (signals.hasTailwind) {
    score += 1;
    pressureNotes.push('Tailwind helps stop opponents from freely snowballing speed');
  }
  if (signals.priorityUsers > 0) {
    score += 1;
    pressureNotes.push('priority helps finish threats before they get another turn');
  }
  if (signals.redirectionUsers === 0 && signals.protectUsers <= 2) {
    score -= 2;
  }
  addArchetype('Direct pressure offense', score, pressureNotes);

  return archetypes;
}

function monLeadReasonBits(mon) {
  const reasons = [];
  if (mon.hasTailwind) reasons.push(`${mon.species} gives Tailwind speed control`);
  if (mon.hasTrickRoom) reasons.push(`${mon.species} threatens Trick Room`);
  if (mon.hasFakeOut) reasons.push(`${mon.species} adds Fake Out pressure`);
  if (mon.hasPrankster) reasons.push(`${mon.species} gives faster utility through Prankster`);
  if (mon.hasRedirection) reasons.push(`${mon.species} can protect a partner with redirection`);
  if (mon.hasHelpingHand) reasons.push(`${mon.species} can convert pressure immediately with Helping Hand`);
  if (mon.hasWideGuard) reasons.push(`${mon.species} can shield the pair from spread pressure`);
  if (mon.hasPivot) reasons.push(`${mon.species} gives you a pivot option if the lead position goes bad`);
  if (mon.hasArmorTail) reasons.push(`${mon.species} helps deny opposing priority pressure`);
  if (mon.isAttacker && mon.hasSpread) reasons.push(`${mon.species} keeps spread pressure on the field`);
  if (mon.isAttacker && !mon.hasSpread) reasons.push(`${mon.species} keeps immediate offensive pressure on the field`);
  return reasons;
}

function evaluateLeadPair(pair, signals) {
  const [a, b] = pair;
  const pairName = `${a.species} + ${b.species}`;
  const reasons = [];
  const risks = [];
  let strongScore = 0;
  let riskScore = 0;

  if (a.hasTailwind || b.hasTailwind) {
    strongScore += 2;
    pushUnique(reasons, `${a.hasTailwind ? a.species : b.species} gives Tailwind speed control`);
  }

  if (a.hasTrickRoom || b.hasTrickRoom) {
    strongScore += 2;
    pushUnique(reasons, `${a.hasTrickRoom ? a.species : b.species} threatens Trick Room`);
  }

  if (a.hasFakeOut || b.hasFakeOut) {
    strongScore += 1;
    pushUnique(reasons, `${a.hasFakeOut ? a.species : b.species} adds Fake Out pressure for a safer first turn`);
  }

  if (a.hasPrankster || b.hasPrankster) {
    strongScore += 1;
    pushUnique(reasons, `${a.hasPrankster ? a.species : b.species} gives faster utility through Prankster`);
  }

  if (a.hasRedirection || b.hasRedirection) {
    strongScore += 1;
    pushUnique(reasons, `${a.hasRedirection ? a.species : b.species} can shield the partner with redirection`);
  }

  if (a.hasHelpingHand || b.hasHelpingHand) {
    strongScore += 1;
    pushUnique(reasons, `${a.hasHelpingHand ? a.species : b.species} can convert that board immediately with Helping Hand`);
  }

  if (a.hasPivot || b.hasPivot) {
    strongScore += 1;
    pushUnique(reasons, `${a.hasPivot ? a.species : b.species} gives you a pivot option if the lead goes badly`);
  }

  const attackers = [a, b].filter((mon) => mon.isAttacker);
  if (attackers.length) {
    strongScore += 1;
    pushUnique(reasons, `${attackers[0].species} keeps immediate offensive pressure on the field`);
  }

  const pairHasSpeedMode = a.hasTailwind || b.hasTailwind || a.hasTrickRoom || b.hasTrickRoom;
  if (!pairHasSpeedMode && (signals.hasTailwind || signals.hasTrickRoom)) {
    riskScore += 2;
    pushUnique(risks, 'this pair does not directly establish either of your main speed modes');
  }

  const pairHasTurnOneControl =
    a.hasTurnOneControl || b.hasTurnOneControl || a.hasPrankster || b.hasPrankster;
  if (!pairHasTurnOneControl && signals.turnOneControlScore >= 2) {
    riskScore += 1;
    pushUnique(risks, 'the lead shows little immediate turn-one control');
  }

  const pairHasProtection = a.hasProtection || b.hasProtection || a.hasPivot || b.hasPivot;
  if (!pairHasProtection && (signals.redirectionUsers === 0 || signals.protectUsers <= 2)) {
    riskScore += 1;
    pushUnique(risks, 'it can get punished quickly if the opponent pressures both slots at once');
  }

  if (!attackers.length) {
    riskScore += 1;
    pushUnique(risks, 'it does not keep much immediate damage pressure on the field');
  }

  return {
    pairName,
    strongScore,
    riskScore,
    strongText:
      reasons.length >= 2
        ? `${pairName} looks stronger because ${reasons.slice(0, 3).join(', ')}.`
        : null,
    riskText:
      risks.length
        ? `${pairName} looks riskier because ${risks.slice(0, 3).join(', ')}.`
        : null,
  };
}

function buildStrengths(signals, archetypes) {
  const strengths = [];

  if (signals.hasTailwind) {
    pushUnique(strengths, 'You show Tailwind, which gives the team a clear way to win speed wars in faster matchups.');
  }
  if (signals.hasTrickRoom) {
    pushUnique(strengths, 'You show Trick Room, so the team has a way to flip speed order and punish faster teams.');
  }
  if (signals.fakeOutUsers > 0) {
    pushUnique(strengths, 'Fake Out support gives you stronger turn-one disruption and safer positioning.');
  }
  if (signals.redirectionUsers > 0) {
    pushUnique(strengths, 'Redirection support can make setup turns and partner protection feel more stable.');
  }
  if (signals.pivotUsers > 0) {
    pushUnique(strengths, 'Pivot tools give you ways to salvage awkward openings instead of losing momentum immediately.');
  }
  if (signals.wideGuardUsers > 0) {
    pushUnique(strengths, 'Wide Guard gives the team a real answer into spread-heavy boards.');
  }

  const bestArchetype = archetypes[0];
  if (bestArchetype && bestArchetype.winRate >= 56) {
    pushUnique(strengths, `Your structure should feel more comfortable into ${bestArchetype.name.toLowerCase()} than into average boards.`);
  }

  return strengths.slice(0, 4);
}

function buildWeaknesses(signals, sortedWorstArchetypes) {
  const weaknesses = [];

  if (!signals.hasTrickRoom) {
    pushUnique(weaknesses, 'Hard Trick Room may be awkward because the team does not show a direct way to reverse or mirror that mode.');
  }
  if (!signals.hasTailwind && !signals.hasTrickRoom && signals.speedControlUsers < 2) {
    pushUnique(weaknesses, 'The team does not show one obvious speed plan, so faster teams may control the pace more easily.');
  }
  if (signals.redirectionUsers === 0) {
    pushUnique(weaknesses, 'Without redirection, fragile positioning turns may be easier for opponents to break up.');
  }
  if (signals.priorityUsers === 0) {
    pushUnique(weaknesses, 'No clear priority means it may be harder to finish off very fast or boosted targets once they get ahead.');
  }
  if (signals.protectUsers <= 2) {
    pushUnique(weaknesses, 'Protect coverage looks limited, which can make doubles endgames and target-avoidance turns less flexible.');
  }
  if (signals.wideGuardUsers === 0 && signals.protectUsers <= 2) {
    pushUnique(weaknesses, 'Spread-heavy boards may get awkward because the export shows limited ways to blunt repeated multi-target damage.');
  }

  const worstArchetype = sortedWorstArchetypes[0];
  if (worstArchetype && worstArchetype.winRate <= 45) {
    pushUnique(weaknesses, `${worstArchetype.name} currently looks like one of the shakier matchup styles for this build.`);
  }

  return weaknesses.slice(0, 4);
}

function buildCoachNotes(signals, worstArchetypes) {
  const coachNotes = [];
  const issueNotes = [];

  if (signals.protectUsers <= 2) {
    pushUnique(coachNotes, 'Limited Protect usage usually matters more in doubles than newer players expect.');
    issueNotes.push('Protect coverage looks limited, which may reduce flexibility in endgames and scouting turns.');
  }
  if (signals.redirectionUsers === 0) {
    pushUnique(coachNotes, 'If your plan needs a safe setup or positioning turn, the team may need to earn that turn rather than force it.');
    issueNotes.push('No Follow Me or Rage Powder support detected, which can make fragile turns less stable.');
  }
  if (signals.fakeOutUsers === 0) {
    pushUnique(coachNotes, 'Without Fake Out, your turn-one pressure may depend more on board position and raw damage.');
    issueNotes.push('No Fake Out pressure detected, so early-turn disruption may be less consistent.');
  }
  if (signals.pranksterUsers > 0) {
    pushUnique(coachNotes, 'Prankster utility can help smooth out difficult turns, so look for lines where support moves matter more than raw damage.');
  }
  if (signals.pivotUsers > 0) {
    pushUnique(coachNotes, 'Pivot moves give you repositioning options, which can help weaker leads recover rather than collapse immediately.');
  }
  if (signals.hasTailwind && signals.hasTrickRoom) {
    pushUnique(coachNotes, 'Dual-speed teams are strongest when you already know before team preview which speed mode matters more in that matchup.');
  }

  const worst = worstArchetypes[0];
  if (worst?.name === 'Hard Trick Room' && !signals.hasTrickRoom && signals.fakeOutUsers === 0 && signals.disruptionUsers === 0) {
    pushUnique(coachNotes, 'Into hard Trick Room, your first question should be how you pressure the room turn, because the export does not show many natural tools for that job.');
  }
  if (worst?.name === 'Spread-heavy offense' && signals.wideGuardUsers === 0) {
    pushUnique(coachNotes, 'Into spread-heavy teams, your boards may need cleaner positioning because the export does not show a direct Wide Guard answer.');
  }

  return { coachNotes: coachNotes.slice(0, 5), issueNotes: issueNotes.slice(0, 5) };
}

function buildGlossary(signals) {
  const glossary = [];
  if (signals.hasTailwind) {
    glossary.push('Tailwind: A move that doubles your side’s Speed for a few turns.');
  }
  if (signals.hasTrickRoom) {
    glossary.push('Trick Room: A move that makes slower Pokémon move first for a few turns.');
  }
  if (signals.redirectionUsers > 0) {
    glossary.push('Redirection: Moves like Follow Me or Rage Powder that pull attacks toward one Pokémon.');
  }
  if (signals.wideGuardUsers > 0) {
    glossary.push('Wide Guard: A move that blocks many spread attacks for your side for that turn.');
  }
  return glossary.slice(0, 3);
}

function buildWeaknessReportFromTeam(teamExport) {
  const { pokemon } = parseTeamExport(teamExport);
  const signals = buildSignals(pokemon);

  const archetypeEvaluations = evaluateArchetypes(signals);
  const bestArchetypes = [...archetypeEvaluations]
    .sort((a, b) => b.winRate - a.winRate || b.score - a.score)
    .slice(0, 3)
    .map(({ name, winRate }) => ({ name, winRate }));

  const worstArchetypes = [...archetypeEvaluations]
    .sort((a, b) => a.winRate - b.winRate || a.score - b.score)
    .slice(0, 3)
    .map(({ name, winRate }) => ({ name, winRate }));

  const leadEvaluations = [];
  for (let i = 0; i < signals.profiles.length; i += 1) {
    for (let j = i + 1; j < signals.profiles.length; j += 1) {
      leadEvaluations.push(evaluateLeadPair([signals.profiles[i], signals.profiles[j]], signals));
    }
  }

  const bestLeads = leadEvaluations
    .filter((entry) => entry.strongText && entry.strongScore >= 2)
    .sort((a, b) => b.strongScore - a.strongScore || a.riskScore - b.riskScore)
    .slice(0, 3)
    .map((entry) => entry.strongText);

  const strongPairNames = new Set(
    leadEvaluations
      .filter((entry) => entry.strongText && entry.strongScore >= 2)
      .sort((a, b) => b.strongScore - a.strongScore || a.riskScore - b.riskScore)
      .slice(0, 3)
      .map((entry) => entry.pairName),
  );

  const weakLeads = leadEvaluations
    .filter((entry) => entry.riskText && !strongPairNames.has(entry.pairName))
    .sort((a, b) => b.riskScore - a.riskScore || a.strongScore - b.strongScore)
    .slice(0, 3)
    .map((entry) => entry.riskText);

  const strengths = buildStrengths(signals, archetypeEvaluations);
  const weaknesses = buildWeaknesses(signals, worstArchetypes);
  const { coachNotes, issueNotes } = buildCoachNotes(signals, worstArchetypes);
  const glossaryNotes = buildGlossary(signals);
  const overallRead = buildOverallRead(signals);

  return {
    analyzerVersion: ANALYZER_VERSION,
    reportType: 'Local Worker Weakness Report',
    overallSpread: overallRead,
    summaryHeadline: overallRead,
    summaryBody: buildPlainLanguageSummary(signals, overallRead.toLowerCase()),
    strengths,
    weaknesses,
    bestLeads,
    leadWarnings: weakLeads,
    coachNotes,
    glossaryNotes,
    bestArchetypes,
    worstArchetypes,
    weakLeads,
    issueNotes,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  ANALYZER_VERSION,
  cleanText,
  looksLikeTeamExport,
  parseTeamExport,
  buildWeaknessReportFromTeam,
};
