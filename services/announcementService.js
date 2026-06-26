const {
  buildSeasonStartedEmbed,
  buildSeasonEndedEmbed,
} = require('./Admin');

function buildAnnouncementContent(roleId) {
  return roleId ? `<@&${roleId}>` : undefined;
}

async function resolveAnnouncementChannel(client, channelId) {
  if (!client || !channelId) {
    return null;
  }

  const channel = await client.channels.fetch(channelId).catch((error) => {
    console.error(`[Announcement] Failed to fetch channel ${channelId}:`, error);
    return null;
  });

  if (!channel || !channel.isTextBased()) {
    console.error(
      `[Announcement] Channel ${channelId} is missing or not text-based.`,
    );
    return null;
  }

  return channel;
}

async function sendSeasonStartedAnnouncement(client, seasonData) {
  const channel = await resolveAnnouncementChannel(
    client,
    seasonData?.announcementChannelId,
  );

  if (!channel) {
    console.log("[Announcement] Season start skipped: no valid channel.");
    return false;
  }

  const payload = {
    content: buildAnnouncementContent(seasonData?.announcementRoleId),
    embeds: [
      buildSeasonStartedEmbed({
        seasonNumber: seasonData?.seasonNumber,
        firstGameDayDiscord: seasonData?.firstGameDayDiscord,
        playoffStartDiscord: seasonData?.playoffStartDiscord,
        regulationName: seasonData?.regulationName,
        regulationUrl: seasonData?.regulationUrl,
      }),
    ],
  };

  try {
    const sentMessage = await channel.send(payload);
    console.log(
      `[Announcement] Season start sent to ${channel.id} as ${sentMessage.id}.`,
    );
    return true;
  } catch (error) {
    console.error("[Announcement] Season start send failed:", error);
    return false;
  }
}

async function sendSeasonEndedAnnouncement(client, seasonData) {
  const channel = await resolveAnnouncementChannel(
    client,
    seasonData?.announcementChannelId,
  );

  if (!channel) {
    console.log("[Announcement] Season end skipped: no valid channel.");
    return false;
  }

  const payload = {
    content: buildAnnouncementContent(seasonData?.announcementRoleId),
    embeds: [buildSeasonEndedEmbed(seasonData?.seasonNumber || 0)],
  };

  try {
    const sentMessage = await channel.send(payload);
    console.log(
      `[Announcement] Season end sent to ${channel.id} as ${sentMessage.id}.`,
    );
    return true;
  } catch (error) {
    console.error("[Announcement] Season end send failed:", error);
    return false;
  }
}

function queueSeasonStartedAnnouncement(client, seasonData) {
  setTimeout(() => {
    sendSeasonStartedAnnouncement(client, seasonData).catch((error) => {
      console.error("[Announcement] Season start failed:", error);
    });
  }, 0);
}

function queueSeasonEndedAnnouncement(client, seasonData) {
  setTimeout(() => {
    sendSeasonEndedAnnouncement(client, seasonData).catch((error) => {
      console.error("[Announcement] Season end failed:", error);
    });
  }, 0);
}

async function purgeBotMessagesInAnnouncementChannel(client, channelId) {
  const channel = await resolveAnnouncementChannel(client, channelId);

  if (!channel) {
    return {
      deletedCount: 0,
      reason: "No valid announcement channel.",
    };
  }

  let deletedCount = 0;
  let lastMessageId = null;

  while (true) {
    const fetchOptions = { limit: 100 };

    if (lastMessageId) {
      fetchOptions.before = lastMessageId;
    }

    const batch = await channel.messages.fetch(fetchOptions).catch((error) => {
      console.error("[Announcement] Failed to fetch messages for purge:", error);
      return null;
    });

    if (!batch || batch.size === 0) {
      break;
    }

    const botMessages = batch.filter(
      (message) => message.author?.id === client.user?.id,
    );

    for (const message of botMessages.values()) {
      try {
        await message.delete();
        deletedCount += 1;
      } catch (error) {
        console.error(
          `[Announcement] Failed to delete bot message ${message.id}:`,
          error,
        );
      }
    }

    lastMessageId = batch.last()?.id || null;

    if (!lastMessageId || batch.size < 100) {
      break;
    }
  }

  return {
    deletedCount,
    reason: null,
  };
}

module.exports = {
  buildAnnouncementContent,
  resolveAnnouncementChannel,
  sendSeasonStartedAnnouncement,
  sendSeasonEndedAnnouncement,
  queueSeasonStartedAnnouncement,
  queueSeasonEndedAnnouncement,
  purgeBotMessagesInAnnouncementChannel,
};