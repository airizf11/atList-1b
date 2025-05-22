// atlist1b/src/routes/stream.routes.ts
import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import {
  startMonitoring,
  stopMonitoring,
} from "../services/monitoring.service";
import { supabase } from "../utils/supabaseClient";

export default async function streamRoutes(
  server: FastifyInstance,
  opts: FastifyPluginOptions
) {
  server.post(
    "/stream/start",
    {
      onRequest: [server.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!user || !user.userId) {
        return reply
          .status(401)
          .send({ error: "User not authenticated properly." });
      }
      const userId = user.userId;

      const body = request.body as { videoId?: string };
      if (
        !body.videoId ||
        typeof body.videoId !== "string" ||
        body.videoId.trim() === ""
      ) {
        return reply.status(400).send({ error: "Missing or invalid videoId." });
      }
      const videoId = body.videoId.trim();

      try {
        server.log.info(
          `[Route] User ${userId} attempting to start monitoring video: ${videoId}`
        );
        const result = await startMonitoring(userId, videoId);
        if (result.success) {
          reply.send({
            success: true,
            message: result.message,
            sessionId: result.sessionId,
          });
        } else {
          let statusCode = 500;
          if (
            result.message.includes("authenticate with Google") ||
            result.message.includes("re-login")
          ) {
            statusCode = 401;
          } else if (
            result.message.includes("Could not find active live chat")
          ) {
            statusCode = 404;
          }
          reply.status(statusCode).send({ error: result.message });
        }
      } catch (error: any) {
        server.log.error(
          { err: error },
          `[Route] Unhandled error starting stream for user ${userId}, video ${videoId}`
        );
        reply.status(500).send({
          error:
            "An unexpected error occurred while starting stream monitoring.",
          details: error.message,
        });
      }
    }
  );

  server.post(
    "/stream/stop",
    {
      onRequest: [server.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!user || !user.userId) {
        return reply
          .status(401)
          .send({ error: "User not authenticated properly." });
      }
      const userId = user.userId;

      // Untuk sekarang, service stopMonitoring kita bisa handle jika videoId tidak ada, ia akan coba stop semua.
      // Jika kita ingin lebih spesifik, frontend perlu mengirim videoId di body.
      // const body = request.body as { videoId?: string };
      // const videoIdToStop = body?.videoId;

      try {
        server.log.info(
          `[Route] User ${userId} attempting to stop monitoring.`
        );
        const { videoId } = request.body as { videoId?: string };

        const result = await stopMonitoring(userId, videoId);
        if (result.success) {
          reply.send({ success: true, message: result.message });
        } else {
          reply.status(404).send({ error: result.message });
        }
      } catch (error: any) {
        server.log.error(
          { err: error },
          `[Route] Unhandled error stopping stream for user ${userId}`
        );
        reply.status(500).send({
          error:
            "An unexpected error occurred while stopping stream monitoring.",
          details: error.message,
        });
      }
    }
  );

  server.get(
    "/stream/status",
    {
      onRequest: [server.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!user || !user.userId) {
        return reply
          .status(401)
          .send({ error: "User not authenticated properly." });
      }
      const userId = user.userId;

      try {
        const { data: activeMonitor, error: dbError } = await supabase
          .from("active_monitors")
          .select("video_id, youtube_live_chat_id, started_at, next_page_token")
          .eq("user_id", userId)
          .eq("is_active", true)
          .maybeSingle();

        if (dbError) {
          server.log.error(
            { err: dbError, userId },
            "Error fetching active monitor status from DB"
          );
          throw dbError;
        }

        if (activeMonitor) {
          reply.send({
            isActive: true,
            videoId: activeMonitor.video_id,
            liveChatId: activeMonitor.youtube_live_chat_id,
            startedAt: activeMonitor.started_at,
          });
        } else {
          reply.send({ isActive: false });
        }
      } catch (error: any) {
        server.log.error(
          { err: error, userId },
          "[Route] Error getting stream status"
        );
        reply.status(500).send({
          error: "Failed to get stream monitoring status.",
          details: error.message,
        });
      }
    }
  );
}
