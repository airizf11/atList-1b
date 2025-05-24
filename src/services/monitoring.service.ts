// atlist1b/src/services/monitoring.service.ts
import { supabase } from "../utils/supabaseClient";
import {
  getAuthenticatedClient,
  getLiveChatId,
  fetchLiveChatMessages,
} from "./google.service";
import { sendToDiscord } from "./discord.service";
import type { Auth, youtube_v3 } from "googleapis";

interface MonitorSession {
  id: string;
  userId: string;
  videoId: string;
  youtubeLiveChatId: string;
  nextPageToken?: string | null;
  oauth2Client: Auth.OAuth2Client;
  isActive: boolean;
  pollIntervalId?: NodeJS.Timeout;
  discordWebhookUrl?: string | null;
}

const activeServerSessions: Map<string, MonitorSession> = new Map();

async function processChatMessages(
  session: MonitorSession,
  messages: youtube_v3.Schema$LiveChatMessage[]
) {
  if (messages.length === 0) return;

  console.log(
    `[${session.userId} - ${session.videoId}] Processing ${messages.length} new messages:`
  );

  if (!session.discordWebhookUrl && session.userId) {
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("discord_webhook_url")
      .eq("id", session.userId)
      .single();

    if (userError) {
      console.error(
        `[${session.id}] Error fetching user data for Discord webhook:`,
        userError.message
      );
    } else {
      session.discordWebhookUrl = userData?.discord_webhook_url ?? null;
    }
  }

  for (const msg of messages) {
    const authorName = msg.authorDetails?.displayName || "Unknown User";
    const messageContent = msg.snippet?.displayMessage || "";
    const authorAvatarUrl = msg.authorDetails?.profileImageUrl;

    console.log(`  [${authorName}]: ${messageContent}`);

    if (session.discordWebhookUrl) {
      const success = await sendToDiscord(
        session.discordWebhookUrl,
        authorName,
        messageContent,
        authorAvatarUrl ?? undefined,
        session.videoId
      );
      if (!success) {
        console.warn(
          `[${session.id}] Failed to send message from ${authorName} to Discord.`
        );
      }
    }
    // TODO: Moderation logic
  }
}

async function pollMessages(sessionId: string) {
  const session = activeServerSessions.get(sessionId);
  if (!session || !session.isActive) {
    console.log(`Polling stopped for session ${sessionId}.`);
    if (session?.pollIntervalId) clearTimeout(session.pollIntervalId);
    activeServerSessions.delete(sessionId);
    return;
  }

  try {
    const chatData = await fetchLiveChatMessages(
      session.oauth2Client,
      session.youtubeLiveChatId,
      session.nextPageToken ?? undefined
    );

    if (chatData) {
      await processChatMessages(session, chatData.messages);

      const { error: updateError } = await supabase
        .from("active_monitors")
        .update({
          next_page_token: chatData.nextPageToken,
          last_polled_at: new Date().toISOString(),
        })
        .eq("id", session.id);

      if (updateError) {
        console.error(
          `[${sessionId}] Error updating monitor session in DB:`,
          updateError.message
        );
      } else {
        session.nextPageToken = chatData.nextPageToken;
      }

      const interval = chatData.pollingIntervalMillis || 7000;
      session.pollIntervalId = setTimeout(
        () => pollMessages(sessionId),
        interval
      );
    } else {
      console.warn(`[${sessionId}] No chat data received. Retrying in 15s.`);
      session.pollIntervalId = setTimeout(() => pollMessages(sessionId), 15000);
    }
  } catch (pollError: any) {
    console.error(`[${sessionId}] Error during polling: ${pollError.message}`);

    let retryDelay = 30000;
    const errorMsg = pollError.message?.toLowerCase() || "";

    if (errorMsg.includes("live_chat_disabled")) {
      console.warn(
        `Live chat disabled for session ${sessionId}. Stopping monitoring.`
      );
      await stopMonitoring(session.userId, session.videoId);
      return;
    }

    if (errorMsg.includes("token") || errorMsg.includes("auth")) {
      console.log(
        `[${sessionId}] Token/auth error. Attempting re-authentication...`
      );
      const newAuthClient = await getAuthenticatedClient(session.userId);
      if (newAuthClient) {
        session.oauth2Client = newAuthClient;
        retryDelay = 5000;
        console.log(`[${sessionId}] Re-authenticated. Retrying polling.`);
      } else {
        console.error(
          `[${sessionId}] Re-authentication failed. Stopping monitoring.`
        );
        await stopMonitoring(session.userId, session.videoId);
        return;
      }
    }

    session.pollIntervalId = setTimeout(
      () => pollMessages(sessionId),
      retryDelay
    );
  }
}

export async function startMonitoring(
  userId: string,
  videoId: string
): Promise<{ success: boolean; message: string; sessionId?: string }> {
  const { data: existingMonitors, error: fetchError } = await supabase
    .from("active_monitors")
    .select("id, video_id")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (fetchError) {
    console.error(
      `Error fetching monitors for user ${userId}:`,
      fetchError.message
    );
    return { success: false, message: "Failed to check existing monitors." };
  }

  for (const monitor of existingMonitors || []) {
    console.log(
      `Stopping existing monitor ${monitor.id} for video ${monitor.video_id}`
    );
    await stopMonitoring(userId, monitor.video_id, monitor.id);
  }

  const oauth2Client = await getAuthenticatedClient(userId);
  if (!oauth2Client) {
    return {
      success: false,
      message: "Google authentication failed. Please re-login.",
    };
  }

  const liveChatId = await getLiveChatId(oauth2Client, videoId);
  if (!liveChatId) {
    return {
      success: false,
      message: "No active live chat found for this video.",
    };
  }

  const { data: newMonitor, error: insertError } = await supabase
    .from("active_monitors")
    .insert({
      user_id: userId,
      video_id: videoId,
      youtube_live_chat_id: liveChatId,
      is_active: true,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !newMonitor) {
    console.error(`Error creating monitor session:`, insertError?.message);
    return { success: false, message: "Failed to create monitoring session." };
  }

  const sessionId = newMonitor.id;
  const session: MonitorSession = {
    id: sessionId,
    userId,
    videoId,
    youtubeLiveChatId: liveChatId,
    oauth2Client,
    isActive: true,
  };
  activeServerSessions.set(sessionId, session);

  console.log(
    `Monitoring started: session ${sessionId}, user ${userId}, video ${videoId}`
  );
  pollMessages(sessionId);

  return {
    success: true,
    message: `Monitoring started for video ${videoId}`,
    sessionId,
  };
}

export async function stopMonitoring(
  userId: string,
  videoId?: string,
  sessionId?: string
): Promise<{ success: boolean; message: string }> {
  let monitorId = sessionId;

  if (!monitorId && videoId) {
    const { data, error } = await supabase
      .from("active_monitors")
      .select("id")
      .eq("user_id", userId)
      .eq("video_id", videoId)
      .eq("is_active", true)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error(`Error finding monitor to stop:`, error.message);
      return { success: false, message: "Error finding active monitor." };
    }

    monitorId = data?.id;
  }

  if (!monitorId) {
    return { success: false, message: "No active session found to stop." };
  }

  const session = activeServerSessions.get(monitorId);
  if (session) {
    session.isActive = false;
    if (session.pollIntervalId) clearTimeout(session.pollIntervalId);
    activeServerSessions.delete(monitorId);
  }

  const { error: updateError } = await supabase
    .from("active_monitors")
    .update({
      is_active: false,
      stopped_at: new Date().toISOString(),
    })
    .eq("id", monitorId)
    .eq("user_id", userId);

  if (updateError) {
    console.error(`Error stopping session ${monitorId}:`, updateError.message);
    return { success: false, message: "Failed to stop session in database." };
  }

  console.log(`Monitoring session ${monitorId} stopped for user ${userId}.`);
  return { success: true, message: `Monitoring stopped.` };
}

export async function resumeActiveMonitorsOnStartup() {
  console.log("Resuming active monitor sessions...");
  const { data, error } = await supabase
    .from("active_monitors")
    .select("*")
    .eq("is_active", true);

  if (error) {
    console.error("Error fetching monitors on startup:", error.message);
    return;
  }

  for (const dbSession of data || []) {
    if (activeServerSessions.has(dbSession.id)) continue;

    console.log(
      `Resuming session ${dbSession.id} for user ${dbSession.user_id}`
    );

    const oauth2Client = await getAuthenticatedClient(dbSession.user_id);
    if (oauth2Client) {
      const session: MonitorSession = {
        id: dbSession.id,
        userId: dbSession.user_id,
        videoId: dbSession.video_id,
        youtubeLiveChatId: dbSession.youtube_live_chat_id,
        nextPageToken: dbSession.next_page_token,
        oauth2Client,
        isActive: true,
      };
      activeServerSessions.set(dbSession.id, session);
      pollMessages(dbSession.id);
    } else {
      console.warn(
        `Failed to resume session ${dbSession.id}: authentication error.`
      );
      await supabase
        .from("active_monitors")
        .update({
          is_active: false,
          last_error_message: "Failed to re-authenticate on startup",
        })
        .eq("id", dbSession.id);
    }
  }
}
