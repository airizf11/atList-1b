// atlist1b/src/routes/settings.routes.ts
import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import { supabase } from "../utils/supabaseClient";

function isValidDiscordWebhookUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.hostname === "discord.com" &&
      parsedUrl.pathname.startsWith("/api/webhooks/")
    );
  } catch (e) {
    return false;
  }
}

export default async function settingsRoutes(
  server: FastifyInstance,
  opts: FastifyPluginOptions
) {
  server.put(
    "/settings/discord-webhook",
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

      const body = request.body as { webhookUrl?: string };
      const webhookUrl = body.webhookUrl || null;

      if (webhookUrl && !isValidDiscordWebhookUrl(webhookUrl)) {
        return reply
          .status(400)
          .send({ error: "Invalid Discord Webhook URL format." });
      }

      try {
        const { error: updateError } = await supabase
          .from("users")
          .update({
            discord_webhook_url: webhookUrl,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);

        if (updateError) {
          server.log.error(
            { err: updateError, userId },
            "Error updating Discord webhook URL in DB"
          );
          throw updateError;
        }

        reply.send({
          success: true,
          message: "Discord Webhook URL updated successfully.",
        });
      } catch (error: any) {
        server.log.error(
          { err: error, userId },
          "[Route] Error updating Discord Webhook URL"
        );
        reply
          .status(500)
          .send({
            error: "Failed to update Discord Webhook URL.",
            details: error.message,
          });
      }
    }
  );

  server.get(
    "/settings/user-settings",
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
        const { data: userSettings, error: dbError } = await supabase
          .from("users")
          .select("email, name, avatar_url, discord_webhook_url, created_at")
          .eq("id", userId)
          .single();

        if (dbError) {
          server.log.error(
            { err: dbError, userId },
            "Error fetching user settings from DB"
          );
          throw dbError;
        }
        if (!userSettings) {
          return reply.status(404).send({ error: "User settings not found." });
        }

        reply.send(userSettings);
      } catch (error: any) {
        server.log.error(
          { err: error, userId },
          "[Route] Error getting user settings"
        );
        reply
          .status(500)
          .send({
            error: "Failed to get user settings.",
            details: error.message,
          });
      }
    }
  );
}
