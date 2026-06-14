import pino from "pino";

export const logger = pino({
  name: "subwire-server",
  level: process.env.LOG_LEVEL ?? "info",
});
