// atlist1b/src/services/google.service.ts
import { google, Auth, youtube_v3 } from "googleapis";
import { supabase } from "../utils/supabaseClient";
import { decrypt } from "../utils/crypto";

function createOAuth2Client(): Auth.OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * @param userId
 * @returns
 */
export async function getAuthenticatedClient(
  userId: string
): Promise<Auth.OAuth2Client | null> {
  const { data: userTokens, error: fetchError } = await supabase
    .from("users")
    .select(
      "google_access_token, google_refresh_token, google_token_expiry_date"
    )
    .eq("id", userId)
    .single();

  if (fetchError || !userTokens) {
    console.error(
      `Error fetching tokens for user ${userId}:`,
      fetchError?.message
    );
    return null;
  }

  const oauth2Client = createOAuth2Client();
  let { google_access_token, google_refresh_token, google_token_expiry_date } =
    userTokens;

  if (!google_refresh_token) {
    console.error(`User ${userId} does not have a refresh token.`);
    return null;
  }

  const decryptedRefreshToken = decrypt(google_refresh_token);
  if (!decryptedRefreshToken) {
    console.error(`Failed to decrypt refresh token for user ${userId}.`);
    return null;
  }

  oauth2Client.setCredentials({
    access_token: google_access_token,
    refresh_token: decryptedRefreshToken,
    expiry_date: google_token_expiry_date
      ? new Date(google_token_expiry_date).getTime()
      : null,
  });

  const now = new Date().getTime();
  const expiryTime = google_token_expiry_date
    ? new Date(google_token_expiry_date).getTime()
    : 0;
  const fiveMinutes = 5 * 60 * 1000;

  if (!google_access_token || expiryTime < now + fiveMinutes) {
    console.log(`Refreshing token for user ${userId}...`);
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      const { error: updateError } = await supabase
        .from("users")
        .update({
          google_access_token: credentials.access_token,
          // google_refresh_token: credentials.refresh_token ? encrypt(credentials.refresh_token) : undefined, // Refresh token Google biasanya tidak berubah saat refresh, tapi jika berubah, enkripsi lagi
          google_token_expiry_date: credentials.expiry_date
            ? new Date(credentials.expiry_date).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (updateError) {
        console.error(
          `Error updating new tokens for user ${userId}:`,
          updateError.message
        );
      }
      console.log(`Token refreshed and updated for user ${userId}.`);
    } catch (refreshErr: any) {
      console.error(
        `Failed to refresh token for user ${userId}:`,
        refreshErr.message
      );
      return null;
    }
  }

  return oauth2Client;
}

/**
 * @param oauth2Client
 * @param videoId
 * @returns
 */
export async function getLiveChatId(
  oauth2Client: Auth.OAuth2Client,
  videoId: string
): Promise<string | null> {
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  try {
    const response = await youtube.videos.list({
      part: ["liveStreamingDetails"],
      id: [videoId],
    });

    const video = response.data.items?.[0];
    if (video?.liveStreamingDetails?.activeLiveChatId) {
      return video.liveStreamingDetails.activeLiveChatId;
    } else {
      console.warn(
        `No active live chat ID found for video ${videoId}. Is the stream live or has chat enabled?`
      );
      return null;
    }
  } catch (err: any) {
    console.error(
      `Error fetching live chat ID for video ${videoId}:`,
      err.response?.data?.error || err.message
    );
    return null;
  }
}

/**
 * @param oauth2Client
 * @param liveChatId
 * @param pageToken
 * @returns
 */
export async function fetchLiveChatMessages(
  oauth2Client: Auth.OAuth2Client,
  liveChatId: string,
  pageToken?: string
): Promise<{
  messages: youtube_v3.Schema$LiveChatMessage[];
  nextPageToken?: string | null;
  pollingIntervalMillis?: number | null;
} | null> {
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  try {
    const response = await youtube.liveChatMessages.list({
      liveChatId: liveChatId,
      part: ["id", "snippet", "authorDetails"],
      maxResults: 50, // maks 2000
      pageToken: pageToken,
    });

    return {
      messages: response.data.items || [],
      nextPageToken: response.data.nextPageToken,
      pollingIntervalMillis: response.data.pollingIntervalMillis,
    };
  } catch (err: any) {
    console.error(
      `Error fetching live chat messages for ${liveChatId}:`,
      err.response?.data?.error || err.message
    );
    if (
      err.response?.status === 403 &&
      err.response?.data?.error?.errors?.[0]?.reason === "liveChatDisabled"
    ) {
      console.warn(
        `Live chat is disabled for video associated with liveChatId ${liveChatId}. Stopping.`
      );
      throw new Error("LIVE_CHAT_DISABLED");
    }
    return null;
  }
}
