// atlist1b/src/services/discord.service.ts
import axios from "axios";

interface DiscordMessagePayload {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: {
    text: string;
    icon_url?: string;
  };
  thumbnail?: {
    url: string;
  };
  author?: {
    name: string;
    url?: string;
    icon_url?: string;
  };
  fields?: {
    name: string;
    value: string;
    inline?: boolean;
  }[];
}

/**
 * @param webhookUrl
 * @param authorName
 * @param messageContent
 * @param authorAvatarUrl
 * @param videoId
 * @returns
 */
export async function sendToDiscord(
  webhookUrl: string,
  authorName: string,
  messageContent: string,
  authorAvatarUrl?: string,
  videoId?: string
): Promise<boolean> {
  if (!webhookUrl) {
    console.warn("Discord webhook URL is not provided. Skipping message.");
    return true;
  }

  const embed: DiscordEmbed = {
    author: {
      name: authorName || "Unknown User",
      icon_url: authorAvatarUrl || undefined,
    },
    description: messageContent || "[empty message]",
    color: 3447003,
    timestamp: new Date().toISOString(),
    footer: {
      text: `From YouTube Live Chat${videoId ? ` (Video: ${videoId})` : ""}`,
      // icon_url: 'URL_LOGO_YOUTUBE_JIKA_ADA'
    },
  };

  const payload: DiscordMessagePayload = {
    username: "atList Chat Logger",
    // avatar_url: 'URL_LOGO_ATLIST_JIKA_ADA',
    embeds: [embed],
  };

  try {
    const response = await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(`Message sent to Discord: ${authorName}: ${messageContent}`);
      return true;
    } else {
      console.error(
        `Error sending message to Discord (status ${response.status}):`,
        response.data
      );
      return false;
    }
  } catch (error: any) {
    if (axios.isAxiosError(error) && error.response) {
      console.error(
        `Axios error sending message to Discord (status ${error.response.status}):`,
        error.response.data
      );
    } else {
      console.error("Generic error sending message to Discord:", error.message);
    }
    return false;
  }
}
