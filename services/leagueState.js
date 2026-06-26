const {
  getStateValueJSON,
  setStateValueJSON,
} = require("./database");

const STATE_KEY = "league_settings";
const TIMEZONE = "America/New_York";

function cloneDefaultState() {
  return {
    season_number: 0,
    league_active: false,
    first_game_day_at: null,
    playoff_start_at: null,
    announcement_channel_id: null,
    announcement_role_id: null,
    regulation_name: null,
    regulation_url: null,
    season_started_at: null,
    season_ended_at: null,
    playoff_minimum_matches: 2,
    battle_room_category_id: null,
    battle_points_per_game_win: 50,
    battle_sweep_bonus_points: 25,
    battle_best_of: 3,
  };
}

function sanitizeLeagueState(rawState = {}) {
  const defaults = cloneDefaultState();
  const source = rawState || {};

  return {
    ...defaults,
    ...source,
    season_number: Number.isInteger(source.season_number)
      ? source.season_number
      : defaults.season_number,
    league_active: source.league_active === true,
    first_game_day_at:
      typeof source.first_game_day_at === "string" && source.first_game_day_at.length > 0
        ? source.first_game_day_at
        : null,
    playoff_start_at:
      typeof source.playoff_start_at === "string" && source.playoff_start_at.length > 0
        ? source.playoff_start_at
        : null,
    announcement_channel_id:
      typeof source.announcement_channel_id === "string" &&
      source.announcement_channel_id.trim().length > 0
        ? source.announcement_channel_id.trim()
        : null,
    announcement_role_id:
      typeof source.announcement_role_id === "string" &&
      source.announcement_role_id.trim().length > 0
        ? source.announcement_role_id.trim()
        : null,
    regulation_name:
      typeof source.regulation_name === "string" &&
      source.regulation_name.trim().length > 0
        ? source.regulation_name.trim()
        : null,
    regulation_url:
      typeof source.regulation_url === "string" &&
      source.regulation_url.trim().length > 0
        ? source.regulation_url.trim()
        : null,
    battle_room_category_id:
      typeof source.battle_room_category_id === "string" &&
      source.battle_room_category_id.trim().length > 0
        ? source.battle_room_category_id.trim()
        : null,
    battle_points_per_game_win:
      Number.isInteger(source.battle_points_per_game_win) &&
      source.battle_points_per_game_win >= 0
        ? source.battle_points_per_game_win
        : defaults.battle_points_per_game_win,
    battle_sweep_bonus_points:
      Number.isInteger(source.battle_sweep_bonus_points) &&
      source.battle_sweep_bonus_points >= 0
        ? source.battle_sweep_bonus_points
        : defaults.battle_sweep_bonus_points,
    battle_best_of:
      Number.isInteger(source.battle_best_of) &&
      source.battle_best_of >= 1
        ? source.battle_best_of
        : defaults.battle_best_of,
    season_started_at:
      typeof source.season_started_at === "string" && source.season_started_at.length > 0
        ? source.season_started_at
        : null,
    season_ended_at:
      typeof source.season_ended_at === "string" && source.season_ended_at.length > 0
        ? source.season_ended_at
        : null,
    playoff_minimum_matches:
      Number.isInteger(source.playoff_minimum_matches) &&
      source.playoff_minimum_matches >= 0
        ? source.playoff_minimum_matches
        : defaults.playoff_minimum_matches,
  };
}

async function getLeagueState() {
  const rawState = await getStateValueJSON(STATE_KEY, cloneDefaultState());
  return sanitizeLeagueState(rawState);
}

async function saveLeagueState(state) {
  const safeState = sanitizeLeagueState(state);
  await setStateValueJSON(STATE_KEY, safeState);
  return safeState;
}

async function updateLeagueState(patch) {
  const currentState = await getLeagueState();
  const patchObject = typeof patch === "function" ? patch(currentState) : patch;

  return saveLeagueState({
    ...currentState,
    ...(patchObject || {}),
  });
}

async function isLeagueActive() {
  return (await getLeagueState()).league_active === true;
}

function getEtParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: map.weekday,
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function getTimeZoneOffsetMilliseconds(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return asUtc - date.getTime();
}

function zonedTimeToUtc(
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone = TIMEZONE,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const guessDate = new Date(utcGuess);
  const offsetMs = getTimeZoneOffsetMilliseconds(guessDate, timeZone);

  return new Date(utcGuess - offsetMs);
}

function weekdayToIndex(weekday) {
  const map = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return map[weekday];
}

function addDaysToLocalDate(year, month, day, daysToAdd) {
  const temp = new Date(Date.UTC(year, month - 1, day + daysToAdd, 12, 0, 0));

  return {
    year: temp.getUTCFullYear(),
    month: temp.getUTCMonth() + 1,
    day: temp.getUTCDate(),
  };
}

function getThisSaturdayAtMidnightEt(now = new Date()) {
  const et = getEtParts(now);
  const weekdayIndex = weekdayToIndex(et.weekday);

  const thisSaturdayLocal = addDaysToLocalDate(
    et.year,
    et.month,
    et.day,
    (6 - weekdayIndex + 7) % 7,
  );

  return zonedTimeToUtc(
    thisSaturdayLocal.year,
    thisSaturdayLocal.month,
    thisSaturdayLocal.day,
    0,
    0,
    0,
  );
}

function getNextFirstGameDay(now = new Date()) {
  const et = getEtParts(now);
  const thisSaturdayAtMidnightEt = getThisSaturdayAtMidnightEt(now);

  if (et.weekday !== "Sat") {
    return thisSaturdayAtMidnightEt;
  }

  if (et.hour === 0 && et.minute === 0 && et.second === 0) {
    return thisSaturdayAtMidnightEt;
  }

  const nextSaturdayLocal = addDaysToLocalDate(
    et.year,
    et.month,
    et.day,
    7,
  );

  return zonedTimeToUtc(
    nextSaturdayLocal.year,
    nextSaturdayLocal.month,
    nextSaturdayLocal.day,
    0,
    0,
    0,
  );
}

function getPlayoffStartFromFirstGameDay(firstGameDayAt) {
  const firstGameDayEt = getEtParts(firstGameDayAt);
  const playoffLocal = addDaysToLocalDate(
    firstGameDayEt.year,
    firstGameDayEt.month,
    firstGameDayEt.day,
    28,
  );

  return zonedTimeToUtc(
    playoffLocal.year,
    playoffLocal.month,
    playoffLocal.day,
    0,
    0,
    0,
  );
}

async function startLeagueSeason(now = new Date()) {
  const currentState = await getLeagueState();
  const startedAt = now instanceof Date ? now : new Date(now);
  const firstGameDayAt = getNextFirstGameDay(startedAt);
  const playoffStartAt = getPlayoffStartFromFirstGameDay(firstGameDayAt);

  return saveLeagueState({
    ...currentState,
    season_number: (currentState.season_number || 0) + 1,
    league_active: true,
    first_game_day_at: firstGameDayAt.toISOString(),
    playoff_start_at: playoffStartAt.toISOString(),
    season_started_at: startedAt.toISOString(),
    season_ended_at: null,
  });
}

async function endLeagueSeason(now = new Date()) {
  const currentState = await getLeagueState();
  const endedAt = now instanceof Date ? now : new Date(now);

  return saveLeagueState({
    ...currentState,
    league_active: false,
    season_ended_at: endedAt.toISOString(),
  });
}

function buildDiscordTimestamp(isoString, style = "F") {
  if (!isoString) {
    return "Not set";
  }

  return `<t:${Math.floor(new Date(isoString).getTime() / 1000)}:${style}>`;
}

async function buildSeasonAnnouncementData(leagueState = null) {
  const state = leagueState || (await getLeagueState());

  return {
    seasonNumber: state.season_number,
    firstGameDayDiscord: buildDiscordTimestamp(state.first_game_day_at, "F"),
    playoffStartDiscord: buildDiscordTimestamp(state.playoff_start_at, "F"),
    regulationName: state.regulation_name || null,
    regulationUrl: state.regulation_url || null,
    announcementChannelId: state.announcement_channel_id || null,
    announcementRoleId: state.announcement_role_id || null,
  };
}

async function setAnnouncementChannel(channelId) {
  return updateLeagueState({
    announcement_channel_id: channelId || null,
  });
}

async function setAnnouncementRole(roleId) {
  return updateLeagueState({
    announcement_role_id: roleId || null,
  });
}

async function setRegulationInfo({ regulationName = null, regulationUrl = null } = {}) {
  return updateLeagueState({
    regulation_name: regulationName || null,
    regulation_url: regulationUrl || null,
  });
}

async function clearRegulationInfo() {
  return updateLeagueState({
    regulation_name: null,
    regulation_url: null,
  });
}


async function setBattleRoomCategory(categoryId) {
  return updateLeagueState({
    battle_room_category_id: categoryId || null,
  });
}

async function setPlayoffMinimumMatches(value) {
  const safeValue = Number.isInteger(value) && value >= 0 ? value : 2;

  return updateLeagueState({
    playoff_minimum_matches: safeValue,
  });
}

async function setBattleScoringConfig({
  gameWinPoints = null,
  sweepBonusPoints = null,
  bestOf = null,
} = {}) {
  const currentState = await getLeagueState();

  return updateLeagueState({
    battle_points_per_game_win:
      Number.isInteger(gameWinPoints) && gameWinPoints >= 0
        ? gameWinPoints
        : currentState.battle_points_per_game_win,
    battle_sweep_bonus_points:
      Number.isInteger(sweepBonusPoints) && sweepBonusPoints >= 0
        ? sweepBonusPoints
        : currentState.battle_sweep_bonus_points,
    battle_best_of:
      Number.isInteger(bestOf) && bestOf >= 1
        ? bestOf
        : currentState.battle_best_of,
  });
}

module.exports = {
  STATE_KEY,
  TIMEZONE,
  cloneDefaultState,
  sanitizeLeagueState,
  getLeagueState,
  saveLeagueState,
  updateLeagueState,
  isLeagueActive,
  getEtParts,
  getTimeZoneOffsetMilliseconds,
  zonedTimeToUtc,
  weekdayToIndex,
  addDaysToLocalDate,
  getThisSaturdayAtMidnightEt,
  getNextFirstGameDay,
  getPlayoffStartFromFirstGameDay,
  startLeagueSeason,
  endLeagueSeason,
  buildDiscordTimestamp,
  buildSeasonAnnouncementData,
  setAnnouncementChannel,
  setAnnouncementRole,
  setRegulationInfo,
  clearRegulationInfo,
  setBattleRoomCategory,
  setPlayoffMinimumMatches,
  setBattleScoringConfig,
};