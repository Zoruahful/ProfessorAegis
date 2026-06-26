const {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  PROFESSOR_AEGIS_RED,
  PROFESSOR_AEGIS_GREEN,
  PROFESSOR_AEGIS_BLUE,
  cleanList,
  buildStoryBlock,
  buildMenuSelect,
  makeCustomId,
} = require('./menuCommon');

function buildBattleMenuEmbed({ battleWindowText, battleOverrideEnabled, unresolvedBattleText }) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_RED)
    .setTitle('⚔️ Professor Aegis • Battle Desk')
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"Battles are coordinated here. Challenge with purpose, report with accuracy, and let the room carry the series."',
        ]),
        `**Battle Window:** ${battleWindowText}`,
        `**Override Mode:** ${battleOverrideEnabled ? 'Enabled ✅' : 'Disabled ❌'}`,
        `**Current Status:** ${unresolvedBattleText || 'No unresolved battle'}`,
      ]),
    );
}

function buildBattleMenuRow({ ownerId, hasUnresolvedBattle = false }) {
  const options = [];
  if (!hasUnresolvedBattle) {
    options.push({
      label: 'Open Challengers',
      description: 'Challenge another registered trainer',
      value: 'open_challengers',
      emoji: '🥊',
    });
  }
  options.push({
    label: 'Open My Battle Room',
    description: 'Jump back into your unresolved battle room',
    value: 'open_current_room',
    emoji: '📍',
  });
  options.push({
    label: 'Back to Main Menu',
    description: 'Return to the academy terminal',
    value: 'back_main',
    emoji: '⬅️',
  });

  return buildMenuSelect(makeCustomId('battle_select', ownerId), 'Choose a battle action.', options);
}

function buildBattleOpenChallengersEmbed(players = []) {
  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_RED)
    .setTitle('⚔️ Professor Aegis • Open Challengers')
    .setDescription(
      players.length
        ? 'Select a registered trainer below to issue a private battle request.'
        : 'No eligible challengers are available right now.',
    );
}

function buildBattleOpponentSelectRow({ ownerId, players }) {
  const options = players.slice(0, 24).map((player) => ({
    label: player.username.slice(0, 100),
    description: player.showdown_name
      ? `Showdown: ${player.showdown_name}`.slice(0, 100)
      : `User ID: ${player.user_id}`,
    value: player.user_id,
    emoji: '⚔️',
  }));

  options.push({
    label: 'Back to Battle Menu',
    description: 'Return to the battle desk',
    value: 'back',
    emoji: '⬅️',
  });

  return buildMenuSelect(
    makeCustomId('battle_opponent_select', ownerId),
    'Choose a trainer to challenge.',
    options,
  );
}

function buildBattleRoomEmbed({
  battle,
  currentGame = null,
  roomMention = null,
  notice = null,
  latestTranscript = null,
}) {
  const isPending = battle?.status === 'pending';
  const isCompleted = battle?.status === 'completed';
  const gameNumber = Number(currentGame?.game_number || battle?.current_game_number || 1);

  const designated = battle?.designated_submitter_user_id
    ? `<@${battle.designated_submitter_user_id}>`
    : isPending
      ? 'Will be selected when the defender accepts.'
      : 'Not selected';

  const waitingOn = isPending
    ? `<@${battle?.opponent_user_id}>`
    : currentGame?.status === 'awaiting_link'
      ? designated
      : isCompleted
        ? 'Series complete'
        : 'Live battle update';

  const previewText = String(latestTranscript || '').trim();
  const safePreview = previewText
    ? previewText.replace(/```/g, '``\u200b`').slice(-1800)
    : '';
  const previewBlock = safePreview
    ? `**Live Preview**\n\`\`\`\n${safePreview}\n\`\`\``
    : null;

  return new EmbedBuilder()
    .setColor(isCompleted ? PROFESSOR_AEGIS_GREEN : PROFESSOR_AEGIS_RED)
    .setTitle(`⚔️ Professor Aegis • Battle Room #${battle?.id || '?'}`)
    .setDescription(
      cleanList([
        buildStoryBlock([
          isPending
            ? '"A private challenge has been issued. Defender, decide whether this room becomes an active academy series."'
            : '"This room now tracks the full set. Submit the live Showdown link from your personal controls when it is your turn to do so."',
        ]),
        notice ? `**Update:** ${notice}` : null,
        `👥 **Matchup:** ${battle?.challenger_username || 'Trainer 1'} vs ${battle?.opponent_username || 'Trainer 2'}`,
        `📊 **Series Score:** ${battle?.challenger_username || 'Trainer 1'} ${Number(battle?.challenger_score || 0)} • ${Number(battle?.opponent_score || 0)} ${battle?.opponent_username || 'Trainer 2'}`,
        `🎮 **Current Game:** Game ${gameNumber} of Bo${Number(battle?.best_of || 3)}`,
        `⏳ **Waiting On:** ${waitingOn}`,
        `📨 **Designated Link Submitter:** ${designated}`,
        roomMention ? `📍 **Room:** ${roomMention}` : null,
        currentGame ? `🔗 **Live Link:** ${currentGame.showdown_link_url || 'Waiting for submission'}` : null,
        currentGame ? `👁️ **Spectator:** ${currentGame.spectator_status || 'idle'}` : null,
        currentGame?.showdown_room_id ? `🧭 **Showdown Room ID:** \`${currentGame.showdown_room_id}\`` : null,
        '',
        '**Room Actions**',
        'Use the dropdown below and choose **Open Personal Controls**.',
        'Role-restricted actions live in the private control panel, not on this shared message.',
        previewBlock,
        currentGame?.replay_url ? `🎞️ **Replay:** ${currentGame.replay_url}` : null,
      ]),
    );
}

function buildBattleRoomSharedRow(battleId) {
  return buildMenuSelect(`battle_room_shared_select__${battleId}`, 'Choose a battle room action.', [
    {
      label: 'Open Personal Controls',
      description: 'Open your private control panel for this room',
      value: 'open_controls',
      emoji: '🎛️',
    },
    {
      label: 'Refresh Room Status',
      description: 'Refresh the visible battle room status',
      value: 'refresh_room',
      emoji: '🔁',
    },
  ]);
}

function buildBattleControlPanelEmbed({
  battle,
  currentGame = null,
  archiveGame = null,
  viewerUserId,
  isAdmin = false,
  notice = null,
}) {
  const isPending = battle?.status === 'pending';
  const isActive = battle?.status === 'active';
  const isChallenger = viewerUserId === battle?.challenger_user_id;
  const isDefender = viewerUserId === battle?.opponent_user_id;
  const isSubmitter = viewerUserId === battle?.designated_submitter_user_id;
  const lines = [];

  if (isAdmin) lines.push('• Admin override access');
  if (isChallenger) lines.push('• Challenger permissions');
  if (isDefender) lines.push('• Defender permissions');
  if (isSubmitter) lines.push('• Designated link submitter permissions');
  if (!lines.length) lines.push('• No special actions are available to you right now.');

  return new EmbedBuilder()
    .setColor(PROFESSOR_AEGIS_BLUE)
    .setTitle('🎛️ Professor Aegis • Personal Battle Controls')
    .setDescription(
      cleanList([
        buildStoryBlock([
          '"This panel is private to you. Only actions tied to your role in the series appear here."',
        ]),
        notice ? `**Update:** ${notice}` : null,
        `👥 **Matchup:** ${battle?.challenger_username || 'Trainer 1'} vs ${battle?.opponent_username || 'Trainer 2'}`,
        `📊 **Series Score:** ${Number(battle?.challenger_score || 0)} - ${Number(battle?.opponent_score || 0)}`,
        `🎮 **Current Game:** Game ${Number(currentGame?.game_number || battle?.current_game_number || 1)}`,
        `📨 **Designated Link Submitter:** ${
          battle?.designated_submitter_user_id
            ? `<@${battle.designated_submitter_user_id}>`
            : isPending
              ? 'Will be selected when the defender accepts.'
              : 'Not selected'
        }`,
        currentGame ? `👁️ **Spectator:** ${currentGame.spectator_status || 'idle'}` : null,
        archiveGame?.status === 'completed'
          ? `🎞️ **Replay Target:** Game ${archiveGame.game_number}`
          : null,
        '',
        '**Your Access**',
        ...lines,
        '',
        isActive
          ? 'Attach Link and Reconnect are restricted to the designated submitter.'
          : null,
      ]),
    );
}

function buildBattleControlPanelRows({
  ownerId,
  battle,
  currentGame = null,
  archiveGame = null,
  isAdmin = false,
}) {
  const isPending = battle?.status === 'pending';
  const isActive = battle?.status === 'active';
  const isCompleted = battle?.status === 'completed';
  const isChallenger = ownerId === battle?.challenger_user_id;
  const isDefender = ownerId === battle?.opponent_user_id;
  const isSubmitter = ownerId === battle?.designated_submitter_user_id;
  const options = [];

  if (isPending && (isDefender || isAdmin)) {
    options.push({
      label: 'Accept Request',
      description: 'Accept this private battle request',
      value: 'accept',
      emoji: '✅',
    });
    options.push({
      label: 'Decline Request',
      description: 'Decline this private battle request',
      value: 'decline',
      emoji: '❌',
    });
  }

  if (isPending && (isChallenger || isAdmin)) {
    options.push({
      label: 'Cancel Request',
      description: 'Cancel your outgoing battle request',
      value: 'cancel',
      emoji: '🛑',
    });
  }

  if (isActive && (isSubmitter || isAdmin)) {
    options.push({
      label: `Attach Game ${Number(battle?.current_game_number || 1)} Link`,
      description: 'Paste the live Showdown battle link',
      value: 'attach_link',
      emoji: '🔗',
    });

    if (currentGame?.showdown_room_id) {
      options.push({
        label: 'Reconnect Spectator',
        description: 'Reconnect Professor Aegis to the live room',
        value: 'reconnect',
        emoji: '🔄',
      });
    }
  }

  if ((isCompleted || archiveGame?.status === 'completed') && (isChallenger || isDefender || isAdmin)) {
    options.push({
      label: 'Archive Replay Link',
      description: 'Save or update the replay URL',
      value: 'archive_replay',
      emoji: '🎞️',
    });
  }

  options.push({
    label: 'Refresh Controls',
    description: 'Refresh your personal control panel',
    value: 'refresh',
    emoji: '🔁',
  });

  options.push({
    label: 'Close Panel',
    description: 'Dismiss this private control panel',
    value: 'close',
    emoji: '⬅️',
  });

  return [
    buildMenuSelect(
      makeCustomId('battle_control_select', ownerId, battle.id, archiveGame?.id || currentGame?.id || 0),
      'Choose a battle control action.',
      options,
    ),
  ];
}

function buildBattleAttachLinkModal({ ownerId, battleId, gameNumber }) {
  const modal = new ModalBuilder()
    .setCustomId(makeCustomId('battle_attach_link_modal', ownerId, battleId, gameNumber))
    .setTitle(`Attach Game ${gameNumber} Battle Link`);

  const input = new TextInputBuilder()
    .setCustomId('battle_link_input')
    .setLabel('Pokémon Showdown Battle Link')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('https://play.pokemonshowdown.com/battle-...');

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function buildBattleArchiveReplayModal({ ownerId, battleId, gameId, replayUrl = '' }) {
  const modal = new ModalBuilder()
    .setCustomId(makeCustomId('battle_archive_replay_modal', ownerId, battleId, gameId))
    .setTitle('Archive Replay Link');

  const input = new TextInputBuilder()
    .setCustomId('battle_archive_replay_url_input')
    .setLabel('Replay URL')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(String(replayUrl).slice(0, 400));

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

module.exports = {
  buildBattleMenuEmbed,
  buildBattleMenuRow,
  buildBattleOpenChallengersEmbed,
  buildBattleOpponentSelectRow,
  buildBattleRoomEmbed,
  buildBattleRoomSharedRow,
  buildBattleControlPanelEmbed,
  buildBattleControlPanelRows,
  buildBattleAttachLinkModal,
  buildBattleArchiveReplayModal,
};
