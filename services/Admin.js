const {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  PROFESSOR_AEGIS_RED,
  PROFESSOR_AEGIS_GREEN,
  cleanList,
  buildStoryBlock,
  buildMenuSelect,
  makeCustomId,
} = require('./menuCommon');

function buildAdminPanelEmbed({ seasonNumber, battleOverrideEnabled, battleRoomCategoryId }) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_RED)
    .setTitle('🛠️ Professor Aegis • Admin Panel')
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"Staff control must be deliberate. Change league state carefully."',
        ]),
        `**Season:** #${seasonNumber}`,
        `**Battle Override:** ${battleOverrideEnabled ? 'Enabled ✅' : 'Disabled ❌'}`,
        `**Battle Room Category:** ${battleRoomCategoryId ? `<#${battleRoomCategoryId}>` : 'Not set'}`,
      ]),
    );
}

function buildAdminPanelRow({ ownerId }) {
  return buildMenuSelect(makeCustomId('admin_select', ownerId), 'Choose an admin action.', [
    {
      label: 'League Control',
      description: 'Season tools and battle configuration',
      value: 'league_control',
      emoji: '🛠️',
    },
    {
      label: 'Back to Main Menu',
      description: 'Return to the academy terminal',
      value: 'back_main',
      emoji: '⬅️',
    },
  ]);
}

function buildLeagueControlEmbed({
  seasonNumber,
  leagueActive,
  battleOverrideEnabled,
  regulationText,
  playoffMinimumMatches,
  battleRoomCategoryId,
  scoringText,
}) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_RED)
    .setTitle('🛠️ Professor Aegis • League Control')
    .setDescription(
      cleanList([
        `**Season:** #${seasonNumber}`,
        `**League Active:** ${leagueActive ? 'Yes ✅' : 'No ❌'}`,
        `**Battle Override:** ${battleOverrideEnabled ? 'Enabled ✅' : 'Disabled ❌'}`,
        `**Regulation:** ${regulationText || 'Not set'}`,
        `**Playoff Minimum Matches:** ${playoffMinimumMatches}`,
        `**Battle Room Category:** ${battleRoomCategoryId ? `<#${battleRoomCategoryId}>` : 'Not set'}`,
        `**Scoring:** ${scoringText}`,
      ]),
    );
}

function buildLeagueControlRow({ ownerId, battleOverrideEnabled }) {
  return buildMenuSelect(makeCustomId('league_control_select', ownerId), 'Choose a league control action.', [
    {
      label: battleOverrideEnabled ? 'Disable Battle Override' : 'Enable Battle Override',
      description: 'Toggle battle access outside the normal Saturday window',
      value: 'toggle_override',
      emoji: '🧪',
    },
    {
      label: 'Cancel All Battles',
      description: 'Cancel unresolved battles and clear rooms',
      value: 'cancel_all_battles',
      emoji: '🛑',
    },
    {
      label: 'Set Battle Room Category',
      description: 'Choose the category for private battle rooms',
      value: 'set_battle_category',
      emoji: '🗂️',
    },
    {
      label: 'Set Regulation',
      description: 'Update regulation name and URL',
      value: 'set_regulation',
      emoji: '📜',
    },
    {
      label: 'Set Playoff Minimum',
      description: 'Update playoff match requirement',
      value: 'set_playoff_minimum',
      emoji: '🎯',
    },
    {
      label: 'Nuke Database',
      description: 'Wipe all saved Professor Aegis bot data',
      value: 'nuke_database',
      emoji: '💣',
    },
    {
      label: 'Back to Admin Panel',
      description: 'Return to the admin panel',
      value: 'back_admin',
      emoji: '⬅️',
    },
  ]);
}

function buildBattleCategoryEmbed() {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_RED)
    .setTitle('🗂️ Professor Aegis • Battle Room Category')
    .setDescription('Pick the category channel where private battle rooms should be created.');
}

function buildBattleCategorySelectRow({ ownerId }) {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(makeCustomId('battle_category_select', ownerId))
      .setPlaceholder('Choose a category')
      .setChannelTypes(ChannelType.GuildCategory),
  );
}

function buildRegulationModal({ ownerId, regulationName = '', regulationUrl = '' }) {
  const modal = new ModalBuilder()
    .setCustomId(makeCustomId('regulation_modal', ownerId))
    .setTitle('Set Regulation Info');

  const nameInput = new TextInputBuilder()
    .setCustomId('regulation_name')
    .setLabel('Regulation Name')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100)
    .setValue(String(regulationName).slice(0, 100));

  const urlInput = new TextInputBuilder()
    .setCustomId('regulation_url')
    .setLabel('Regulation URL')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(400)
    .setValue(String(regulationUrl).slice(0, 400));

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(urlInput),
  );

  return modal;
}

function buildPlayoffMinimumModal({ ownerId, currentValue = 2 }) {
  const modal = new ModalBuilder()
    .setCustomId(makeCustomId('playoff_minimum_modal', ownerId))
    .setTitle('Set Playoff Minimum Matches');

  const input = new TextInputBuilder()
    .setCustomId('playoff_minimum')
    .setLabel('Minimum Matches')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(String(currentValue || 2));

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildSeasonStartedEmbed({
  seasonNumber,
  firstGameDayDiscord,
  playoffStartDiscord,
  regulationName,
  regulationUrl,
}) {
  const regulationText =
    regulationName && regulationUrl
      ? `[${regulationName}](${regulationUrl})`
      : regulationName || 'Not set';

  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_GREEN)
    .setTitle(`🏁 Professor Aegis • Season #${seasonNumber} Started`)
    .setDescription(
      cleanList([
        `**First Game Day:** ${firstGameDayDiscord || 'Not scheduled'}`,
        `**Playoffs:** ${playoffStartDiscord || 'Not scheduled'}`,
        `**Regulation:** ${regulationText}`,
      ]),
    );
}

function buildSeasonEndedEmbed(seasonNumber) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_RED)
    .setTitle(`🛑 Professor Aegis • Season #${seasonNumber} Ended`)
    .setDescription('The active season has been closed.');
}

module.exports = {
  buildAdminPanelEmbed,
  buildAdminPanelRow,
  buildLeagueControlEmbed,
  buildLeagueControlRow,
  buildBattleCategoryEmbed,
  buildBattleCategorySelectRow,
  buildRegulationModal,
  buildPlayoffMinimumModal,
  buildSeasonStartedEmbed,
  buildSeasonEndedEmbed,
};
