// src/index.ts
import Fastify, { FastifyInstance } from "fastify";
import dotenv from "dotenv";

dotenv.config();

const server: FastifyInstance = Fastify({
  logger: true,
});

server.get("/", async (request, reply) => {
  return { hello: "world from Fastify backend!" };
});

server.get("/api/test", async (request, reply) => {
  return { message: "Ini adalah test endpoint dari backend ALiS!" };
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    await server.listen({ port: port, host: "0.0.0.0" });
    server.log.info(`Server listening on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
