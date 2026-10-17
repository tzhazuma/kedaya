// 本地开发可选的真实 PostgreSQL；生产环境继续使用外部 PostgreSQL / Docker。
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const databaseDir = resolve('.local-postgres');
const pg = new EmbeddedPostgres({ databaseDir, user: 'kedaya', password: 'kedaya', port: 5432,
  persistent: true, postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => undefined, onError: (message) => console.error(message),
});
if (!existsSync(resolve(databaseDir, 'PG_VERSION'))) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
const result = await client.query("SELECT 1 FROM pg_database WHERE datname = 'kedaya'");
await client.end();
if (!result.rowCount) await pg.createDatabase('kedaya');
console.log('Local development PostgreSQL ready on 127.0.0.1:5432 (database: kedaya).');
const keepAlive = setInterval(() => {}, 60_000);
async function stop() { clearInterval(keepAlive); await pg.stop(); process.exit(0); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
