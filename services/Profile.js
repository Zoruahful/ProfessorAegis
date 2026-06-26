const { EmbedBuilder } = require('discord.js');
const {
  PROFESSOR_AEGIS_BLUE,
  cleanList,
  buildStoryBlock,
  buildMenuSelect,
  makeCustomId,
  formatRecord,
  formatCareerRecord,
  formatWinRateFromStats,
} = require('./menuCommon');

function buildProfileMenuEmbed({ username, stats }) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle('👤 Professor Aegis • Trainer Profile')
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"A trainer is more than one battle. Review your record with honesty."',
        ]),
        `👤 **Trainer:** ${username}`,
        `🏆 **Season Record:** ${formatRecord(stats)}`,
        `📈 **Season Win Rate:** ${formatWinRateFromStats(stats)}`,
        `⭐ **Season Points:** ${Number(stats?.season_league_points || 0)}`,
        `📚 **Career Record:** ${formatCareerRecord(stats)}`,
      ]),
    );
}

function buildProfileMenuRow({ ownerId }) {
  return buildMenuSelect(makeCustomId('profile_select', ownerId), 'Choose a profile action.', [
    {
      label: 'View My Profile',
      description: 'Refresh your own trainer profile',
      value: 'profile_self',
      emoji: '👤',
    },
    {
      label: 'View Another Trainer',
      description: 'Open another academy profile',
      value: 'profile_other',
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

function buildProfileEmbed({ player, heading = 'Trainer Profile' }) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle(`👤 Professor Aegis • ${heading}`)
    .setDescription(
      cleanList([
        `**Trainer:** ${player.username}`,
        `**Showdown Name:** ${player.showdown_name || 'Not set'}`,
        `**Academy Member:** ${player.is_academy_member ? 'Yes ✅' : 'No ❌'}`,
        `**Registered:** ${player.registered ? 'Yes ✅' : 'No ❌'}`,
        '',
        `**Season Record:** ${formatRecord(player)}`,
        `**Season Points:** ${Number(player.season_league_points || 0)}`,
        `**Best Season Streak:** ${Number(player.season_best_streak || 0)}`,
        '',
        `**Career Record:** ${formatCareerRecord(player)}`,
        `**Career League Points:** ${Number(player.career_total_league_points || 0)}`,
        `**Career Best Streak:** ${Number(player.career_highest_streak || 0)}`,
      ]),
    );
}

module.exports = {
  buildProfileMenuEmbed,
  buildProfileMenuRow,
  buildProfileEmbed,
};
