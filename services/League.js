const { EmbedBuilder } = require('discord.js');
const {
  PROFESSOR_AEGIS_GREEN,
  cleanList,
  buildStoryBlock,
  buildMenuSelect,
  makeCustomId,
  formatRecord,
  formatCareerRecord,
} = require('./menuCommon');

function buildLeagueMenuEmbed({ seasonNumber, regulationText, firstGameDayText, playoffStartText }) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_GREEN)
    .setTitle('🏆 Professor Aegis • League Desk')
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"Standings reveal outcomes. Preparation reveals why they happened."',
        ]),
        `**Season:** #${seasonNumber}`,
        `**Regulation:** ${regulationText || 'Not set'}`,
        `**First Game Day:** ${firstGameDayText || 'Not scheduled'}`,
        `**Playoffs:** ${playoffStartText || 'Not scheduled'}`,
      ]),
    );
}

function buildLeagueMenuRow({ ownerId }) {
  return buildMenuSelect(makeCustomId('league_select', ownerId), 'Choose a league action.', [
    {
      label: 'Leaderboard',
      description: 'View academy standings',
      value: 'leaderboard',
      emoji: '🥇',
    },
    {
      label: 'My League Record',
      description: 'View your current season standing',
      value: 'my_record',
      emoji: '📊',
    },
    {
      label: 'View Another Trainer',
      description: 'Inspect a trainer\'s league record',
      value: 'league_other',
      emoji: '🔎',
    },
    {
      label: 'Back to Main Menu',
      description: 'Return to the academy terminal',
      value: 'back_main',
      emoji: '⬅️',
    },
  ]);
}

function buildLeaderboardEmbed(players = []) {
  const lines = players.length
    ? players.map(
        (player, index) =>
          `**${index + 1}. ${player.username}** — ${Number(player.season_league_points || 0)} pts • ${formatRecord(player)}`,
      )
    : ['No registered trainers are on the board yet.'];

  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_GREEN)
    .setTitle('🏆 Professor Aegis • Leaderboard')
    .setDescription(lines.join('\n'));
}

function buildMyLeagueEmbed({ player }) {
  return buildTrainerLeagueEmbed({ player, heading: 'My League Record' });
}

function buildTrainerLeagueEmbed({ player, heading = 'Trainer League Record' }) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_GREEN)
    .setTitle(`🏆 Professor Aegis • ${heading}`)
    .setDescription(
      cleanList([
        `**Trainer:** ${player.username}`,
        `**Season Record:** ${formatRecord(player)}`,
        `**Season Points:** ${Number(player.season_league_points || 0)}`,
        `**Season Best Streak:** ${Number(player.season_best_streak || 0)}`,
        `**Career Record:** ${formatCareerRecord(player)}`,
      ]),
    );
}

module.exports = {
  buildLeagueMenuEmbed,
  buildLeagueMenuRow,
  buildLeaderboardEmbed,
  buildMyLeagueEmbed,
  buildTrainerLeagueEmbed,
};
