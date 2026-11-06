import express from 'express';

// Placeholder until the generic handler (M1-08): one health route so `npm run dev` has something to answer.
const app = express();
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});
const port = Number(process.env['API_PORT'] ?? 3001);
app.listen(port, '127.0.0.1', () => console.log(`api listening on http://127.0.0.1:${port}`));
