const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const {
  PROFESSOR_AEGIS_GOLD,
  PROFESSOR_AEGIS_BLUE,
  cleanList,
  buildStoryBlock,
  buildMenuSelect,
  makeCustomId,
} = require('./menuCommon');

function buildPublicMenuEmbed() {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_GOLD)
    .setTitle('🎓 Professor Aegis • Academy Terminal')
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"Welcome, trainer. The academy archives are open to those willing to learn, adapt, and battle with purpose."',
          '"Open your private terminal below."',
        ]),
        '**Terminal Access**',
        '• Registrations',
        '• Profile',
        '• Teams',
        '• League',
        '• Battle',
        '• Battle Simulator',
        '• Admin (staff only)',
      ]),
    );
}

function buildPublicMenuRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_academy_terminal')
      .setLabel('Open Academy Terminal')
      .setEmoji('📘')
      .setStyle(ButtonStyle.Primary),
  );
}

function buildPrivateMainMenuEmbed({
  username,
  leagueActive,
  seasonNumber,
  registrationOpen,
  registrationSeasonNumber,
  isRegisteredForCurrentSeason,
  firstGameDayText,
  playoffStartText,
  regulationText,
  battleAccessText,
}) {
  const focusSeason = leagueActive ? seasonNumber : registrationSeasonNumber;

  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle(`📚 Professor Aegis • Academy Records for ${username}`)
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"A strong trainer does not drift. They prepare, review, and return stronger each week."',
          '"Use the dropdown below to move through your academy records."',
        ]),
        '**Academy Overview**',
        `🏷️ **Focus Season:** #${focusSeason}`,
        `📝 **Registration:** ${
          registrationOpen
            ? `Open for Season #${registrationSeasonNumber}`
            : isRegisteredForCurrentSeason
              ? `Locked — submitted for Season #${seasonNumber}`
              : 'Locked'
        }`,
        `⚔️ **League Status:** ${leagueActive ? 'Active ✅' : 'Inactive ⏸️'}`,
        `📜 **Regulation:** ${regulationText || 'Not set'}`,
        `🗓️ **Battle Window:** ${battleAccessText}`,
        `🎯 **First Game Day:** ${firstGameDayText || 'Not scheduled'}`,
        `🏆 **Playoffs:** ${playoffStartText || 'Not scheduled'}`,
      ]),
    );
}

function buildPrivateMainMenuShellEmbed({
  username,
  notice = null,
} = {}) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle(`📚 Professor Aegis • Academy Records for ${username || 'Trainer'}`)
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"A strong trainer does not drift. They prepare, review, and return stronger each week."',
          '"Professor Aegis is opening your private academy records."',
        ]),
        '**Academy Overview**',
        '🏷️ **Focus Season:** Loading...',
        '📝 **Registration:** Loading...',
        '⚔️ **League Status:** Loading...',
        '📜 **Regulation:** Loading...',
        '🗓️ **Battle Window:** Loading...',
        '🎯 **First Game Day:** Loading...',
        '🏆 **Playoffs:** Loading...',
        notice,
      ]),
    );
}

function buildPrivateSectionShellEmbed({
  username,
  sectionLabel,
  sectionEmoji = '📚',
  notice = null,
} = {}) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle(`${sectionEmoji} Professor Aegis • ${sectionLabel || 'Academy Records'} for ${username || 'Trainer'}`)
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"Professor Aegis is opening that academy record now."',
          '"The terminal will update as soon as the archive finishes checking the latest metadata."',
        ]),
        '**Live Progress**',
        '```text\n[Academy Terminal]\n▰▰▱▱▱▱▱▱▱▱ 20%\nLoading lightweight menu metadata...\n```',
        notice,
      ]),
    );
}

function buildPrivateMainMenuRow({ ownerId, isAdminUser }) {
  const options = [
    {
      label: 'Registrations',
      description: 'Manage your upcoming season file',
      value: 'menu_registrations',
      emoji: '📝',
    },
    {
      label: 'Profile',
      description: 'View trainer profile data',
      value: 'menu_profile',
      emoji: '👤',
    },
    {
      label: 'Teams',
      description: 'Browse team archives',
      value: 'menu_teams',
      emoji: '🧾',
    },
    {
      label: 'League',
      description: 'Standings and league records',
      value: 'menu_league',
      emoji: '🏆',
    },
    {
      label: 'Battle',
      description: 'Challenge trainers and manage battle rooms',
      value: 'menu_battle',
      emoji: '⚔️',
    },
    {
      label: 'Battle Simulator',
      description: 'Run simulations and review team reports',
      value: 'menu_benchmark',
      emoji: '📊',
    },
  ];

  if (isAdminUser) {
    options.push({
      label: 'Admin',
      description: 'League control and battle tools',
      value: 'menu_admin',
      emoji: '🛠️',
    });
  }

  return buildMenuSelect(makeCustomId('main_menu_select', ownerId), 'Choose a section.', options);
}

module.exports = {
  buildPublicMenuEmbed,
  buildPublicMenuRow,
  buildPrivateMainMenuEmbed,
  buildPrivateMainMenuShellEmbed,
  buildPrivateSectionShellEmbed,
  buildPrivateMainMenuRow,
};
