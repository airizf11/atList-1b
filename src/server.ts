// atlist1b/src/server.ts
import { build } from "./app";
import dotenv from "dotenv";
import { resumeActiveMonitorsOnStartup } from "./services/monitoring.service";

dotenv.config();

const server = build({
  logger: {
    level: "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty" }
        : undefined,
  },
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    await server.listen({ port: port, host: "0.0.0.0" });
    await resumeActiveMonitorsOnStartup();
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
