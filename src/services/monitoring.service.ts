// atlist1b/src/services/monitoring.service.ts
import { supabase } from "../utils/supabaseClient";
import {
  getAuthenticatedClient,
  getLiveChatId,
  fetchLiveChatMessages,
} from "./google.service";
import type { Auth } from "googleapis";

interface MonitorSession {
  id: string;
  userId: string;
  videoId: string;
  youtubeLiveChatId: string;
  nextPageToken?: string | null;
  oauth2Client: Auth.OAuth2Client;
  isActive: boolean;
  pollIntervalId?: NodeJS.Timeout;
}

const activeServerSessions: Map<string, MonitorSession> = new Map();

async function processChatMessages(session: MonitorSession, messages: any[]) {
  if (messages.length > 0) {
    console.log(
      `[${session.userId} - ${session.videoId}] Fetched ${messages.length} new messages:`
    );
    messages.forEach((msg) => {
      console.log(
        `  [${msg.authorDetails?.displayName}]: ${msg.snippet?.displayMessage}`
      );
      // TODO: Kirim ke Discord Webhook
      // TODO: Proses untuk moderasi
    });
  }
}

async function pollMessages(sessionId: string) {
  const session = activeServerSessions.get(sessionId);
  if (!session || !session.isActive) {
    console.log(
      `Polling stopped for session ${sessionId} as it's no longer active or found.`
    );
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
      console.warn(
        `[${sessionId}] No chat data received, but no critical error. Retrying in 15s.`
      );
      session.pollIntervalId = setTimeout(() => pollMessages(sessionId), 15000);
    }
  } catch (pollError: any) {
    console.error(`[${sessionId}] Error during polling: ${pollError.message}`);
    let retryDelay = 30000;

    if (pollError.message === "LIVE_CHAT_DISABLED") {
      console.warn(
        `Live chat disabled for session ${sessionId}. Stopping monitoring.`
      );
      await stopMonitoring(session.userId, session.videoId);
      return;
    } else if (
      pollError.message.includes("token") ||
      pollError.message.includes("auth")
    ) {
      console.log(
        `[${sessionId}] Token error, attempting to re-authenticate client...`
      );
      const newAuthClient = await getAuthenticatedClient(session.userId);
      if (newAuthClient) {
        session.oauth2Client = newAuthClient;
        retryDelay = 5000;
        console.log(`[${sessionId}] Re-authenticated, will retry polling.`);
      } else {
        console.error(
          `[${sessionId}] Failed to re-authenticate. Stopping monitoring.`
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
): Promise<{
  success: boolean;
  message: string;
  sessionId?: string;
}> {
  // sementara simplifikasi 1 user 1 monitoring
  const { data: existingMonitors, error: fetchExistingError } = await supabase
    .from("active_monitors")
    .select("id, video_id")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (fetchExistingError) {
    console.error(
      `Error fetching existing monitors for user ${userId}:`,
      fetchExistingError.message
    );
    return { success: false, message: "Failed to check existing monitors." };
  }

  if (existingMonitors && existingMonitors.length > 0) {
    for (const monitor of existingMonitors) {
      console.log(
        `Stopping existing active monitor ${monitor.id} for video ${monitor.video_id} for user ${userId}.`
      );
      await stopMonitoring(userId, monitor.video_id, monitor.id);
    }
  }

  const oauth2Client = await getAuthenticatedClient(userId);
  if (!oauth2Client) {
    return {
      success: false,
      message: "Failed to authenticate with Google. Please re-login.",
    };
  }

  const liveChatId = await getLiveChatId(oauth2Client, videoId);
  if (!liveChatId) {
    return {
      success: false,
      message: `Could not find active live chat for video ${videoId}. Ensure it's live with chat enabled.`,
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
    console.error(
      `Error creating monitor session for user ${userId}, video ${videoId}:`,
      insertError?.message
    );
    return {
      success: false,
      message: "Failed to create monitoring session in database.",
    };
  }

  const sessionId = newMonitor.id;

  const newServerSession: MonitorSession = {
    id: sessionId,
    userId,
    videoId,
    youtubeLiveChatId: liveChatId,
    oauth2Client,
    isActive: true,
  };
  activeServerSessions.set(sessionId, newServerSession);

  console.log(
    `Monitoring session ${sessionId} started for user ${userId}, video ${videoId}. Live Chat ID: ${liveChatId}`
  );
  pollMessages(sessionId);

  return {
    success: true,
    message: `Monitoring started for video ${videoId}. Session ID: ${sessionId}`,
    sessionId,
  };
}

export async function stopMonitoring(
  userId: string,
  videoId?: string,
  sessionId?: string
): Promise<{ success: boolean; message: string }> {
  let monitorIdToStop: string | undefined = sessionId;

  if (!monitorIdToStop && videoId) {
    const { data: monitor, error: findError } = await supabase
      .from("active_monitors")
      .select("id")
      .eq("user_id", userId)
      .eq("video_id", videoId)
      .eq("is_active", true)
      .single();

    if (findError && findError.code !== "PGRST116") {
      console.error(
        `Error finding monitor to stop for user ${userId}, video ${videoId}:`,
        findError.message
      );
      return { success: false, message: "Error finding active monitor." };
    }
    if (monitor) monitorIdToStop = monitor.id;
  }

  if (!monitorIdToStop) {
    return {
      success: false,
      message:
        "No active monitoring session found to stop for the given criteria.",
    };
  }

  const serverSession = activeServerSessions.get(monitorIdToStop);
  if (serverSession) {
    serverSession.isActive = false;
    if (serverSession.pollIntervalId)
      clearTimeout(serverSession.pollIntervalId);
    activeServerSessions.delete(monitorIdToStop);
  }

  const { error: updateError } = await supabase
    .from("active_monitors")
    .update({
      is_active: false,
      stopped_at: new Date().toISOString(),
    })
    .eq("id", monitorIdToStop)
    .eq("user_id", userId);

  if (updateError) {
    console.error(
      `Error stopping monitor session ${monitorIdToStop} in DB:`,
      updateError.message
    );
    return {
      success: false,
      message: "Failed to update monitoring session in database.",
    };
  }

  console.log(
    `Monitoring session ${monitorIdToStop} stopped for user ${userId}.`
  );
  return {
    success: true,
    message: `Monitoring stopped for session ${monitorIdToStop}.`,
  };
}

export async function resumeActiveMonitorsOnStartup() {
  console.log("Checking for active monitors to resume...");
  const { data: activeDbSessions, error } = await supabase
    .from("active_monitors")
    .select("*")
    .eq("is_active", true);

  if (error) {
    console.error("Error fetching active monitors on startup:", error.message);
    return;
  }

  if (activeDbSessions && activeDbSessions.length > 0) {
    for (const dbSession of activeDbSessions) {
      if (activeServerSessions.has(dbSession.id)) {
        console.log(
          `Session ${dbSession.id} is already being managed in memory.`
        );
        continue;
      }
      console.log(
        `Resuming monitoring for session ${dbSession.id} (user: ${dbSession.user_id}, video: ${dbSession.video_id})`
      );
      const oauth2Client = await getAuthenticatedClient(dbSession.user_id);
      if (oauth2Client) {
        const serverSession: MonitorSession = {
          id: dbSession.id,
          userId: dbSession.user_id,
          videoId: dbSession.video_id,
          youtubeLiveChatId: dbSession.youtube_live_chat_id,
          nextPageToken: dbSession.next_page_token,
          oauth2Client,
          isActive: true,
        };
        activeServerSessions.set(dbSession.id, serverSession);
        pollMessages(dbSession.id);
      } else {
        console.warn(
          `Could not resume session ${dbSession.id}: failed to get authenticated client.`
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
    console.log(`Resumed ${activeDbSessions.length} active monitors.`);
  } else {
    console.log("No active monitors to resume.");
  }
}
