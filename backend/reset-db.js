import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  host: 'db.xomasbwwhhcxrptfdees.supabase.co',
  user: 'postgres',
  database: 'postgres',
  password: 'pluto1234!@#$%^_',
  port: 6543,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  console.log('Connected.');

  // Drop all application tables to start fresh since migration 001 only partially ran
  console.log('Dropping any partial tables...');
  const tables = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename NOT LIKE 'knex%'
    ORDER BY tablename;
  `);
  
  const appTables = tables.rows.map(r => r.tablename);
  console.log('Application tables to drop:', appTables);
  
  if (appTables.length > 0) {
    // Drop in reverse dependency order
    await client.query(`DROP TABLE IF EXISTS ${appTables.map(t => `"${t}"`).join(', ')} CASCADE`);
    console.log('Tables dropped.');
  } else {
    console.log('No application tables found, DB is clean.');
  }

  // Clear any migration records so knex starts fresh
  await client.query('DELETE FROM knex_migrations');
  console.log('Migration history cleared.');

  await client.end();
  console.log('Done. Ready for fresh migration run.');
}

main().catch(err => { console.error(err.message); process.exit(1); });
