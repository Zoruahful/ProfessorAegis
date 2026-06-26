const {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  PROFESSOR_AEGIS_GOLD,
  cleanList,
  buildStoryBlock,
  buildMenuSelect,
  makeCustomId,
} = require('./menuCommon');

function buildRegistrationsMenuEmbed({
  username,
  registrationOpen,
  targetSeasonNumber,
  hasSubmittedTeam,
  teamName,
  updatedAtText,
}) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_GOLD)
    .setTitle('📝 Professor Aegis • Registration Ledger')
    .setDescription(
      cleanList([
        buildStoryBlock([
          registrationOpen
            ? '"The season file is still open. Submit carefully — every roster choice matters."'
            : '"The season seal has been placed. Registration edits are locked."',
        ]),
        `👤 **Trainer:** ${username}`,
        `📅 **Target Season:** #${targetSeasonNumber}`,
        `📌 **Window:** ${registrationOpen ? 'Open ✅' : 'Locked 🔒'}`,
        `🧾 **Submitted:** ${hasSubmittedTeam ? 'Yes ✅' : 'No ❌'}`,
        `🏷️ **Team Name:** ${hasSubmittedTeam ? teamName : 'Not submitted'}`,
        `🕒 **Last Updated:** ${hasSubmittedTeam ? updatedAtText : 'Not available'}`,
        '',
        '**Required Submission Fields**',
        '• Team name',
        '• Exact Showdown name',
        '• Raw Showdown export',
      ]),
    );
}

function buildRegistrationsMenuRow({ ownerId, registrationOpen, hasSubmittedTeam }) {
  const options = [];

  if (registrationOpen && !hasSubmittedTeam) {
    options.push({
      label: 'Register Now',
      description: 'Create your season submission',
      value: 'registration_create',
      emoji: '✅',
    });
  }

  if (registrationOpen && hasSubmittedTeam) {
    options.push({
      label: 'Edit Submission',
      description: 'Update your season submission',
      value: 'registration_edit',
      emoji: '✏️',
    });
  }

  if (hasSubmittedTeam) {
    options.push({
      label: 'View Submitted Team',
      description: 'Review the exact file on record',
      value: 'registration_view',
      emoji: '📘',
    });
  }

  if (registrationOpen && hasSubmittedTeam) {
    options.push({
      label: 'Deregister',
      description: 'Remove your current submission',
      value: 'registration_delete',
      emoji: '❌',
    });
  }

  options.push({
    label: 'Back to Main Menu',
    description: 'Return to the academy terminal',
    value: 'back_main',
    emoji: '⬅️',
  });

  return buildMenuSelect(
    makeCustomId('registrations_select', ownerId),
    'Choose a registration action.',
    options,
  );
}

function buildRegistrationTeamModal({ ownerId, seasonNumber, existingTeam = null }) {
  const modal = new ModalBuilder()
    .setCustomId(makeCustomId('registration_modal', ownerId, seasonNumber))
    .setTitle(
      existingTeam
        ? `Edit Season #${seasonNumber} Submission`
        : `Register for Season #${seasonNumber}`,
    );

  const teamName = new TextInputBuilder()
    .setCustomId('team_name')
    .setLabel('Team Name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setValue(String(existingTeam?.team_name || '').slice(0, 100));

  const showdownName = new TextInputBuilder()
    .setCustomId('showdown_name')
    .setLabel('Exact Showdown Name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100)
    .setValue(String(existingTeam?.showdown_name || '').slice(0, 100));

  const teamExport = new TextInputBuilder()
    .setCustomId('team_export')
    .setLabel('Raw Showdown Export')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(4000)
    .setValue(String(existingTeam?.team_export || '').slice(0, 4000));

  modal.addComponents(
    new ActionRowBuilder().addComponents(teamName),
    new ActionRowBuilder().addComponents(showdownName),
    new ActionRowBuilder().addComponents(teamExport),
  );

  return modal;
}

module.exports = {
  buildRegistrationsMenuEmbed,
  buildRegistrationsMenuRow,
  buildRegistrationTeamModal,
};
