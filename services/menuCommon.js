const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

const PROFESSOR_AEGIS_GOLD = 0xf1c40f;
const PROFESSOR_AEGIS_BLUE = 0x5865f2;
const PROFESSOR_AEGIS_GREEN = 0x2ecc71;
const PROFESSOR_AEGIS_RED = 0xe74c3c;
const PROFESSOR_AEGIS_PURPLE = 0x9b59b6;
const PROFESSOR_AEGIS_SLATE = 0x2f3136;
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━';
const ID_SEPARATOR = '::';

function makeCustomId(base, ownerId, ...parts) {
  return [base, ownerId, ...parts]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => String(value))
    .join(ID_SEPARATOR);
}

function parseCustomId(customId) {
  const raw = String(customId || '');
  if (!raw.includes(ID_SEPARATOR)) {
    return { raw, base: raw, ownerId: null, parts: [], scoped: false };
  }
  const [base, ownerId, ...parts] = raw.split(ID_SEPARATOR);
  return { raw, base, ownerId: ownerId || null, parts, scoped: true };
}

function cleanList(lines) {
  return lines.filter(Boolean).join('\n');
}

function buildStoryBlock(lines) {
  return ['**📖 Professor Aegis\' Notes**', ...lines, '', DIVIDER].join('\n');
}

function buildMenuSelect(customId, placeholder, options, minValues = 1, maxValues = 1) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMinValues(minValues)
      .setMaxValues(maxValues)
      .addOptions(options),
  );
}

function formatRecord(stats) {
  return `${Number(stats?.season_wins || 0)}-${Number(stats?.season_losses || 0)}-${Number(stats?.season_ties || 0)}`;
}

function formatCareerRecord(stats) {
  return `${Number(stats?.career_wins || 0)}-${Number(stats?.career_losses || 0)}-${Number(stats?.career_ties || 0)}`;
}

function formatWinRateFromStats(stats) {
  const wins = Number(stats?.season_wins || 0);
  const losses = Number(stats?.season_losses || 0);
  const ties = Number(stats?.season_ties || 0);
  const total = wins + losses + ties;
  if (!total) return '0.0%';
  return `${((wins / total) * 100).toFixed(1)}%`;
}

function buildTrainerSelectRow({ ownerId, base, placeholder, players, backValue = 'back' }) {
  const options = players.slice(0, 24).map((player) => ({
    label: String(player.username || 'Unknown Trainer').slice(0, 100),
    description: player.showdown_name
      ? `Showdown: ${player.showdown_name}`.slice(0, 100)
      : `User ID: ${player.user_id}`,
    value: player.user_id,
    emoji: '🎯',
  }));

  options.push({
    label: 'Back',
    description: 'Return to the previous menu',
    value: backValue,
    emoji: '⬅️',
  });

  return buildMenuSelect(makeCustomId(base, ownerId), placeholder, options);
}

module.exports = {
  PROFESSOR_AEGIS_GOLD,
  PROFESSOR_AEGIS_BLUE,
  PROFESSOR_AEGIS_GREEN,
  PROFESSOR_AEGIS_RED,
  PROFESSOR_AEGIS_PURPLE,
  PROFESSOR_AEGIS_SLATE,
  DIVIDER,
  ID_SEPARATOR,
  makeCustomId,
  parseCustomId,
  cleanList,
  buildStoryBlock,
  buildMenuSelect,
  formatRecord,
  formatCareerRecord,
  formatWinRateFromStats,
  buildTrainerSelectRow,
};
