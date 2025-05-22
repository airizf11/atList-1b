// atlist1b/src/routes/auth.routes.ts
import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import { google } from "googleapis";
import { supabase } from "../utils/supabaseClient";
import { encrypt, decrypt } from "../utils/crypto";

// Inisialisasi OAuth2 sini or impor dari service/config
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

export default async function authRoutes(
  server: FastifyInstance,
  opts: FastifyPluginOptions
) {
  server.get(
    "/google",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scopes = [
        "https://www.googleapis.com/auth/youtube.force-ssl",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
      ];
      const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        prompt: "consent",
      });
      reply.redirect(url);
    }
  );

  server.get(
    "/google/callback",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { code?: string; error?: string };

      if (query.error || !query.code) {
        const errorMessage = query.error || "No authorization code received";
        server.log.error("Error from Google or no code:", errorMessage);
        return reply.redirect(
          `${process.env.FRONTEND_URL}/auth/callback?error=${encodeURIComponent(
            errorMessage
          )}`
        );
      }

      try {
        const { tokens } = await oauth2Client.getToken(query.code);
        oauth2Client.setCredentials(tokens);

        if (!tokens.access_token)
          throw new Error("Failed to retrieve access token from Google.");

        const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
        const userInfoResponse = await oauth2.userinfo.get();
        const googleUser = userInfoResponse.data;

        if (!googleUser.id || !googleUser.email) {
          throw new Error("Failed to retrieve user ID or email from Google.");
        }

        let youtubeChannelTitle: string | null = null;
        let youtubeChannelId: string | null = null;
        try {
          const youtube = google.youtube({ version: "v3", auth: oauth2Client });
          const channelResponse = await youtube.channels.list({
            part: ["snippet"],
            mine: true,
          });
          if (
            channelResponse.data.items &&
            channelResponse.data.items.length > 0
          ) {
            youtubeChannelTitle =
              channelResponse.data.items[0].snippet?.title || null;
            youtubeChannelId = channelResponse.data.items[0].id || null;
          }
        } catch (ytError: any) {
          server.log.warn(
            "Could not fetch YouTube channel info:",
            ytError.message
          );
        }

        const encryptedRefreshToken = tokens.refresh_token
          ? encrypt(tokens.refresh_token)
          : null;

        let alisUserId: string;
        const { data: existingUser, error: findError } = await supabase
          .from("users")
          .select("id")
          .eq("google_user_id", googleUser.id)
          .single();

        if (findError && findError.code !== "PGRST116") throw findError;

        const userDataToUpsert = {
          google_user_id: googleUser.id,
          email: googleUser.email,
          name: googleUser.name || null,
          avatar_url: googleUser.picture || null,
          youtube_channel_id: youtubeChannelId,
          youtube_channel_title: youtubeChannelTitle,
          google_access_token: tokens.access_token,
          google_refresh_token: encryptedRefreshToken,
          google_token_expiry_date: tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        };

        if (existingUser) {
          alisUserId = existingUser.id;
          const { error: updateError } = await supabase
            .from("users")
            .update(userDataToUpsert)
            .eq("id", alisUserId);
          if (updateError) throw updateError;
          server.log.info("User updated in Supabase:", alisUserId);
        } else {
          const { data: newUser, error: insertError } = await supabase
            .from("users")
            .insert({
              ...userDataToUpsert,
              created_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (insertError || !newUser)
            throw insertError || new Error("Failed to create user.");
          alisUserId = newUser.id;
          server.log.info("User created in Supabase:", alisUserId);
        }

        const alisApiTokenPayload = {
          userId: alisUserId,
          email: googleUser.email,
        };
        const alisApiToken = server.jwt.sign(alisApiTokenPayload, {
          expiresIn: "7d",
        });

        reply.redirect(
          `${process.env.FRONTEND_URL}/auth/callback?token=${alisApiToken}`
        );
      } catch (err: any) {
        server.log.error({ err }, "Error in /auth/google/callback");
        const errorMessage =
          err.response?.data?.error_description ||
          err.message ||
          "An unknown error occurred.";
        reply.redirect(
          `${process.env.FRONTEND_URL}/auth/callback?error=${encodeURIComponent(
            errorMessage
          )}`
        );
      }
    }
  );
}
