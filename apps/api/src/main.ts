import { createApp } from './app.ts';

const port = Number(process.env['API_PORT'] ?? 3001);
createApp().listen(port, '127.0.0.1', () => console.log(`api listening on http://127.0.0.1:${port}`));
