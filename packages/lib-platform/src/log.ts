// The logger the process pieces take: createLog's Log (log/logger.ts) fits it, and tests pass a stand-in.
export type Logger = {
  info(message: string): void;
  error(message: string, err?: unknown): void;
};
