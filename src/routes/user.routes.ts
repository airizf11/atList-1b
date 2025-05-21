// alis1b/src/routes/user.routes.ts
import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import { supabase } from "../utils/supabaseClient";

export default async function userRoutes(
  server: FastifyInstance,
  opts: FastifyPluginOptions
) {
  server.get(
    "/me",
    {
      onRequest: [server.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userPayload = request.user;

      if (!userPayload || !userPayload.userId) {
        return reply
          .status(401)
          .send({
            error: "Unauthorized: User payload not found after authentication",
          });
      }

      try {
        const { data: userProfile, error } = await supabase
          .from("users")
          .select(
            "id, email, name, avatar_url, youtube_channel_title, created_at"
          )
          .eq("id", userPayload.userId)
          .single();

        if (error) {
          server.log.error(
            { err: error, userId: userPayload.userId },
            "Supabase error fetching user profile"
          );
          if (error.code === "PGRST116") {
            return reply.status(404).send({ error: "User not found" });
          }
          throw error;
        }

        reply.send(userProfile);
      } catch (error: any) {
        if (error.code !== "PGRST116") {
          server.log.error(
            { err: error, userId: userPayload.userId },
            "Error fetching user profile"
          );
        }
        if (!reply.sent) {
          reply.status(500).send({ error: "Failed to fetch user profile" });
        }
      }
    }
  );
}
