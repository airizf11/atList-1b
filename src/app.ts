// alis1b/src/app.ts
import Fastify, {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
// import "./types/fastify.d.ts";

dotenv.config();

export function build(opts = {}): FastifyInstance {
  const server: FastifyInstance = Fastify(opts);

  server.register(cors, {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  });

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not defined in environment variables.");
  }
  server.register(fastifyJwt, {
    secret: jwtSecret,
  });

  server.decorate(
    "authenticate",
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch (err) {
        server.log.warn({ err }, "JWT verification failed");
        reply.status(401).send(err);
      }
    }
  );

  server.register(authRoutes, { prefix: "/auth" });
  server.register(userRoutes, { prefix: "/api" });

  server.get("/api/test", async (request, reply) => {
    return {
      message: "Ini adalah test endpoint dari backend ALiS! (dari app.ts)",
    };
  });

  return server;
}
