// The logger the process pieces take. shortcut: console until M1-11 brings pino; replace consoleLogger there.
export type Logger = {
  info(message: string): void;
  error(message: string, err?: unknown): void;
};

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  error: (message, err) => (err === undefined ? console.error(message) : console.error(message, err)),
};
