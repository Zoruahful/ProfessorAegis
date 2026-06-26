const { EmbedBuilder } = require('discord.js');
const {
  PROFESSOR_AEGIS_PURPLE,
  PROFESSOR_AEGIS_SLATE,
  cleanList,
  buildStoryBlock,
  buildMenuSelect,
  makeCustomId,
} = require('./menuCommon');

function buildTeamsMenuEmbed({ username }) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_PURPLE)
    .setTitle('🧾 Professor Aegis • Team Archives')
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"Strong rosters are built, reviewed, and remembered."',
        ]),
        `👤 **Trainer:** ${username}`,
        'Use the dropdown below to browse your own team archive or another trainer\'s recorded teams.',
      ]),
    );
}

function buildTeamsMenuRow({ ownerId }) {
  return buildMenuSelect(makeCustomId('teams_select', ownerId), 'Choose a team archive action.', [
    {
      label: 'View My Teams',
      description: 'Browse your season team history',
      value: 'teams_self',
      emoji: '📘',
    },
    {
      label: 'View Another Trainer',
      description: 'Browse another trainer\'s teams',
      value: 'teams_other',
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

function buildNoTeamsEmbed({ username }) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_SLATE)
    .setTitle('🧾 Professor Aegis • Team Archives')
    .setDescription(`No recorded season teams were found for **${username}**.`);
}

function buildViewTrainerTeamsEmbed({ username, seasons }) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_PURPLE)
    .setTitle(`🧾 Professor Aegis • ${username}'s Team Archive`)
    .setDescription(
      cleanList([
        `Recorded seasons: ${seasons.map((season) => `#${season.season_number}`).join(', ')}`,
        '',
        'Select a season below to open the recorded team file.',
      ]),
    );
}

function buildTeamSeasonSelectRow({ ownerId, trainerUserId, seasons }) {
  return buildMenuSelect(
    makeCustomId('team_season_select', ownerId, trainerUserId),
    'Choose a season team to view.',
    [
      ...seasons.slice(0, 24).map((season) => ({
        label: `Season #${season.season_number}`,
        description: season.team_name ? `Team: ${season.team_name}` : 'Open recorded team file',
        value: String(season.season_number),
        emoji: '📂',
      })),
      {
        label: 'Back to Teams Menu',
        description: 'Return to the team archive menu',
        value: 'back',
        emoji: '⬅️',
      },
    ],
  );
}

function buildTeamDisplayEmbed({ username, seasonTeam }) {
  const safeTeam = String(seasonTeam?.team_export || '').replace(/```/g, '``\u200b`');
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_PURPLE)
    .setTitle(`🧾 Professor Aegis • ${username}'s Season #${seasonTeam?.season_number} Team`)
    .setDescription(
      cleanList([
        `**Team Name:** ${seasonTeam?.team_name || 'Unknown Team'}`,
        `**Updated:** ${seasonTeam?.updated_at || 'Unknown'}`,
        '',
        '**Importable**',
        `\`\`\`\n${safeTeam}\n\`\`\``,
      ]),
    );
}

module.exports = {
  buildTeamsMenuEmbed,
  buildTeamsMenuRow,
  buildNoTeamsEmbed,
  buildViewTrainerTeamsEmbed,
  buildTeamSeasonSelectRow,
  buildTeamDisplayEmbed,
};
