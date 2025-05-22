// atlist1b/src/types/fastify.d.ts
import {
  FastifyRequest,
  FastifyReply,
  FastifyInstance as OriginalFastifyInstance,
} from "fastify";
import { FastifyJWT } from "@fastify/jwt";

declare module "fastify" {
  interface FastifyRequest {
    user?: FastifyJWT["user"];
  }

  interface FastifyInstance extends OriginalFastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      userId: string;
      email: string;
    };
    user: {
      userId: string;
      email: string;
      iat: number;
      exp: number;
      // Tambah lain jika ada
    };
  }
}
