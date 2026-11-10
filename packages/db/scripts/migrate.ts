// `npm run db:migrate`: applies the migrations to MIGRATION_DATABASE_URL, the owner login (ADR-004 §3, §5). It runs as
// its own step, before the apps start: in the deploy job, in e2e, and by hand after `npm run db:up`.
import { migrate } from '../src/migrate.ts';

const url = process.env['MIGRATION_DATABASE_URL'];
if (!url) throw new Error('MIGRATION_DATABASE_URL is not set: migrations run with the owner login (ADR-004 §3).');
await migrate(url);
console.log('migrations applied');
