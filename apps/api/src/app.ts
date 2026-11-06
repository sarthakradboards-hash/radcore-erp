import express from 'express';

// Placeholder until the generic handler (M1-08): one health route so `npm run dev` has something to answer.
export function createApp() {
  const app = express();
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}
