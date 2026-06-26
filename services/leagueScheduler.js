const {
  getStateValueJSON,
  setStateValueJSON,
  getTopPlayersForPlayoffs,
} = require("./database");

const { getLeagueState } = require("./leagueState");

const SCHEDULER_KEY = "league_scheduler";
const TIMEZONE = "America/New_York";
const REMINDER_COLOR = 0x5865f2;
const PLAYOFF_COLOR = 0xf1c40f;
const SIMULATION_COLOR = 0x2ecc71;
const DIVIDER = "━━━━━━━━━━━━━━━━━━━━";

function buildDefaultSchedulerState() {
  return {
    sent_reminder_keys: [],
    last_sent_reminder_key: null,
    last_sent_at: null,
  };
}

async function getSchedulerState() {
  const raw = await getStateValueJSON(SCHEDULER_KEY, buildDefaultSchedulerState());

  return {
    sent_reminder_keys: Array.isArray(raw.sent_reminder_keys)
      ? raw.sent_reminder_keys.filter(
          (value) => typeof value === "string" && value.length > 0,
        )
      : [],
    last_sent_reminder_key:
      typeof raw.last_sent_reminder_key === "string"
        ? raw.last_sent_reminder_key
        : null,
    last_sent_at:
      typeof raw.last_sent_at === "string" ? raw.last_sent_at : null,
  };
}

async function saveSchedulerState(state) {
  const safeState = {
    sent_reminder_keys: Array.isArray(state.sent_reminder_keys)
      ? state.sent_reminder_keys
      : [],
    last_sent_reminder_key:
      typeof state.last_sent_reminder_key === "string"
        ? state.last_sent_reminder_key
        : null,
    last_sent_at:
      typeof state.last_sent_at === "string" ? state.last_sent_at : null,
  };

  await setStateValueJSON(SCHEDULER_KEY, safeState);
  return safeState;
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

function getEtDateKey(date = new Date()) {
  const parts = getEtParts(date);

  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getDiscordTimestamp(dateInput, style = "F") {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function diffWholeWeeks(startDate, endDate) {
  const ms = endDate.getTime() - startDate.getTime();
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

function isSameEtDate(dateA, dateB) {
  return getEtDateKey(dateA) === getEtDateKey(dateB);
}

function isFridayReminderWindow(date = new Date()) {
  const et = getEtParts(date);
  return et.weekday === "Fri" && et.hour === 22 && et.minute >= 0 && et.minute <= 14;
}

function getCurrentWeekGameDayAt(now, firstGameDay) {
  const firstGameDayMs = firstGameDay.getTime();
  const reminderOffsetMs = 2 * 60 * 60 * 1000;
  const currentBattleWindowStartMs = now.getTime() + reminderOffsetMs;
  const diffMs = currentBattleWindowStartMs - firstGameDayMs;
  const weeksSinceFirstGameDay = Math.max(0, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)));

  return new Date(firstGameDayMs + weeksSinceFirstGameDay * 7 * 24 * 60 * 60 * 1000);
}

async function getReminderAnnouncementData(now = new Date()) {
  const leagueState = await getLeagueState();

  if (!leagueState.league_active) {
    return null;
  }

  if (!leagueState.first_game_day_at || !leagueState.playoff_start_at) {
    return null;
  }

  const firstGameDay = new Date(leagueState.first_game_day_at);
  const playoffStart = new Date(leagueState.playoff_start_at);
  const firstReminderAt = new Date(firstGameDay.getTime() - 2 * 60 * 60 * 1000);
  const playoffReminderAt = new Date(playoffStart.getTime() - 2 * 60 * 60 * 1000);

  if (now.getTime() < firstReminderAt.getTime()) {
    return null;
  }

  if (now.getTime() > playoffStart.getTime()) {
    return null;
  }

  if (!isFridayReminderWindow(now)) {
    return null;
  }

  const firstReminderKey = getEtDateKey(firstReminderAt);
  const playoffReminderKey = getEtDateKey(playoffReminderAt);
  const nowKey = getEtDateKey(now);

  if (nowKey < firstReminderKey || nowKey > playoffReminderKey) {
    return null;
  }

  const isPlayoffReminder = isSameEtDate(now, playoffReminderAt);
  const currentWeekGameDayAt = getCurrentWeekGameDayAt(now, firstGameDay);
  const totalWeeksUntilPlayoffs = diffWholeWeeks(firstGameDay, playoffStart);
  const weeksElapsedSinceFirstGameDay = diffWholeWeeks(
    firstGameDay,
    currentWeekGameDayAt,
  );
  const scheduledSaturdaysRemaining = Math.max(
    0,
    totalWeeksUntilPlayoffs - weeksElapsedSinceFirstGameDay,
  );
  const reminderKey = `season-${leagueState.season_number}-${nowKey}`;

  return {
    reminderKey,
    seasonNumber: leagueState.season_number,
    leagueState,
    now,
    reminderAt: now,
    gameDayAt: currentWeekGameDayAt,
    playoffStartAt: playoffStart,
    isPlayoffReminder,
    scheduledSaturdaysRemaining,
    announcementChannelId: leagueState.announcement_channel_id || null,
    announcementRoleId: leagueState.announcement_role_id || null,
    regulationName: leagueState.regulation_name || null,
    regulationUrl: leagueState.regulation_url || null,
  };
}

function buildReminderLines(data) {
  const lines = [];

  lines.push(`Season: **#${data.seasonNumber}**`);
  lines.push(`Battle window opens: ${getDiscordTimestamp(data.gameDayAt, "F")}`);
  lines.push(`Battle window closes: ${getDiscordTimestamp(new Date(data.gameDayAt.getTime() + (24 * 60 * 60 * 1000) - 60 * 1000), "F")}`);
  lines.push(`Playoffs begin: ${getDiscordTimestamp(data.playoffStartAt, "F")}`);

  if (data.regulationName && data.regulationUrl) {
    lines.push(`Regulation: [${data.regulationName}](${data.regulationUrl})`);
  } else if (data.regulationName) {
    lines.push(`Regulation: ${data.regulationName}`);
  } else {
    lines.push("Regulation: Not set");
  }

  if (data.isPlayoffReminder) {
    lines.push("Countdown: **Playoffs begin in 2 hours.**");
  } else if (data.scheduledSaturdaysRemaining === 1) {
    lines.push("Countdown: **1 Saturday remains until playoffs.**");
  } else {
    lines.push(
      `Countdown: **${data.scheduledSaturdaysRemaining} Saturdays remain until playoffs.**`,
    );
  }

  return lines;
}

function formatStandingLine(player, index) {
  const wins = Number(player?.season_wins || 0);
  const losses = Number(player?.season_losses || 0);
  const ties = Number(player?.season_ties || 0);
  const points = Number(player?.season_league_points || 0);
  const winRatePercent = `${(Number(player?.season_win_rate || 0) * 100).toFixed(1)}%`;

  return `**${index + 1}. ${player.username}** — ${points} pts • ${wins}-${losses}-${ties} • WR ${winRatePercent}`;
}

async function getTopStandingsLines(limit = 10) {
  const standings = await getTopPlayersForPlayoffs(limit, 0);

  if (!standings.length) {
    return ["No standings are available yet."];
  }

  return standings.map((player, index) => formatStandingLine(player, index));
}

async function buildWeeklyReminderEmbed(data) {
  const lines = [];
  const standingsLines = await getTopStandingsLines(10);

  lines.push(...buildReminderLines(data));
  lines.push("");
  lines.push(DIVIDER);
  lines.push("**Top 10 Standings**");
  lines.push(...standingsLines);

  return {
    title: "📣 Pokémon Academy — Weekly Reminder",
    description: lines.join("\n"),
    color: REMINDER_COLOR,
    footer: {
      text: "Battle window: Saturday 12:00 AM ET to 11:59 PM ET.",
    },
    timestamp: new Date().toISOString(),
  };
}

async function buildPlayoffReminderEmbed(data) {
  const lines = [];
  const minimumGamesRequired =
    typeof data.leagueState.playoff_minimum_matches === "number" &&
    data.leagueState.playoff_minimum_matches >= 0
      ? data.leagueState.playoff_minimum_matches
      : 2;

  lines.push(`Season: **#${data.seasonNumber}**`);
  lines.push(`Playoffs begin: ${getDiscordTimestamp(data.playoffStartAt, "F")}`);
  lines.push(`Playoff check-in reminder sent: ${getDiscordTimestamp(data.reminderAt, "F")}`);

  if (data.regulationName && data.regulationUrl) {
    lines.push(`Regulation: [${data.regulationName}](${data.regulationUrl})`);
  } else if (data.regulationName) {
    lines.push(`Regulation: ${data.regulationName}`);
  } else {
    lines.push("Regulation: Not set");
  }

  lines.push(`Qualification: **Minimum ${minimumGamesRequired} matches played**`);
  lines.push("");
  lines.push(DIVIDER);
  lines.push("**Qualified Trainers**");

  const topPlayers = await getTopPlayersForPlayoffs(4, minimumGamesRequired);

  if (topPlayers.length === 0) {
    lines.push("No playoff standings are available yet.");
  } else {
    topPlayers.forEach((player, index) => {
      lines.push(formatStandingLine(player, index));
    });
  }

  lines.push("");
  lines.push(DIVIDER);
  lines.push("**Top 10 Final Standings Snapshot**");

  const standingsLines = await getTopStandingsLines(10);
  lines.push(...standingsLines);

  return {
    title: "🏆 Pokémon Academy — Playoff Reminder",
    description: lines.join("\n"),
    color: PLAYOFF_COLOR,
    footer: {
      text: "Playoff battle window opens Saturday at 12:00 AM ET.",
    },
    timestamp: new Date().toISOString(),
  };
}

async function getReminderMessagePayload(data) {
  const embed = data.isPlayoffReminder
    ? await buildPlayoffReminderEmbed(data)
    : await buildWeeklyReminderEmbed(data);

  return {
    content: data.announcementRoleId ? `<@&${data.announcementRoleId}>` : "",
    embeds: [embed],
  };
}

async function hasAlreadySentReminder(reminderKey) {
  const schedulerState = await getSchedulerState();
  return schedulerState.sent_reminder_keys.includes(reminderKey);
}

async function markReminderSent(reminderKey) {
  const schedulerState = await getSchedulerState();
  const sentReminderKeys = Array.isArray(schedulerState.sent_reminder_keys)
    ? [...schedulerState.sent_reminder_keys]
    : [];

  if (!sentReminderKeys.includes(reminderKey)) {
    sentReminderKeys.push(reminderKey);
  }

  await saveSchedulerState({
    sent_reminder_keys: sentReminderKeys,
    last_sent_reminder_key: reminderKey,
    last_sent_at: new Date().toISOString(),
  });
}

async function sendReminderMessage(channel, reminderData) {
  const payload = await getReminderMessagePayload(reminderData);
  return channel.send(payload);
}

function buildSimulationSummaryEmbed(seasonNumber, sentItems) {
  const description = sentItems.length
    ? sentItems.map((item) => `• ${item}`).join("\n")
    : "No reminders were simulated.";

  return {
    title: "🧪 Pokémon Academy — Season Simulation Complete",
    description: [
      `Season: **#${seasonNumber}**`,
      "",
      "The following live reminder messages were sent in order:",
      description,
    ].join("\n"),
    color: SIMULATION_COLOR,
    timestamp: new Date().toISOString(),
  };
}

async function simulateSeasonReminders(channel) {
  const leagueState = await getLeagueState();

  if (!leagueState.league_active) {
    return {
      seasonNumber: leagueState.season_number || 0,
      sentItems: [],
      reason: "League is not active.",
    };
  }

  if (!leagueState.first_game_day_at || !leagueState.playoff_start_at) {
    return {
      seasonNumber: leagueState.season_number || 0,
      sentItems: [],
      reason: "Season dates are not configured.",
    };
  }

  const firstGameDay = new Date(leagueState.first_game_day_at);
  const playoffStart = new Date(leagueState.playoff_start_at);
  const sentItems = [];

  for (let week = 0; ; week += 1) {
    const gameDayAt = new Date(
      firstGameDay.getTime() + week * 7 * 24 * 60 * 60 * 1000,
    );
    const reminderAt = new Date(gameDayAt.getTime() - 2 * 60 * 60 * 1000);
    const reminderKey = `season-${leagueState.season_number}-${getEtDateKey(reminderAt)}`;
    const isPlayoffReminder =
      getEtDateKey(reminderAt) ===
      getEtDateKey(new Date(playoffStart.getTime() - 2 * 60 * 60 * 1000));
    const scheduledSaturdaysRemaining = Math.max(
      0,
      diffWholeWeeks(firstGameDay, playoffStart) - week,
    );

    const data = {
      reminderKey,
      seasonNumber: leagueState.season_number,
      leagueState,
      now: reminderAt,
      reminderAt,
      gameDayAt,
      playoffStartAt: playoffStart,
      isPlayoffReminder,
      scheduledSaturdaysRemaining,
      announcementChannelId: leagueState.announcement_channel_id || null,
      announcementRoleId: leagueState.announcement_role_id || null,
      regulationName: leagueState.regulation_name || null,
      regulationUrl: leagueState.regulation_url || null,
    };

    await sendReminderMessage(channel, data);

    sentItems.push(
      isPlayoffReminder
        ? `Playoffs — ${getDiscordTimestamp(data.playoffStartAt, "F")}`
        : `Week ${week + 1} — reminder ${getDiscordTimestamp(data.reminderAt, "F")} • battle window ${getDiscordTimestamp(data.gameDayAt, "F")}`,
    );

    if (isPlayoffReminder || data.gameDayAt.getTime() >= playoffStart.getTime()) {
      break;
    }
  }

  return {
    seasonNumber: leagueState.season_number || 0,
    sentItems,
    reason: null,
  };
}

async function getPendingReminder(now = new Date()) {
  const data = await getReminderAnnouncementData(now);

  if (!data) {
    return null;
  }

  if (await hasAlreadySentReminder(data.reminderKey)) {
    return null;
  }

  return data;
}

module.exports = {
  TIMEZONE,
  buildDefaultSchedulerState,
  getSchedulerState,
  saveSchedulerState,
  isFridayReminderWindow,
  getCurrentWeekGameDayAt,
  getReminderAnnouncementData,
  buildReminderLines,
  buildWeeklyReminderEmbed,
  buildPlayoffReminderEmbed,
  getReminderMessagePayload,
  hasAlreadySentReminder,
  markReminderSent,
  getPendingReminder,
  sendReminderMessage,
  simulateSeasonReminders,
  buildSimulationSummaryEmbed,
};