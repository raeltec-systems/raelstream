import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { DB } from './db.js';

/** Forward-only SQL migrations, each in its own transaction, recorded in schema_migrations. */
export async function migrate(db: Kysely<DB>, dir: string): Promise<string[]> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`.execute(
    db,
  );
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const applied = new Set(
    (await sql<{ name: string }>`select name from schema_migrations`.execute(db)).rows.map(
      (r) => r.name,
    ),
  );
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const body = await readFile(join(dir, f), 'utf8');
    await db.transaction().execute(async (trx) => {
      await sql.raw(body).execute(trx);
      await sql`insert into schema_migrations (name) values (${f})`.execute(trx);
    });
    ran.push(f);
  }
  return ran;
}
