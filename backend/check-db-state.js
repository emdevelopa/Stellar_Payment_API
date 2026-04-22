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
  
  // List all tables in public schema
  const tables = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
  `);
  console.log('Tables:', tables.rows.map(r => r.tablename));

  // Check columns in merchants table if it exists
  const merchantTables = tables.rows.filter(r => r.tablename === 'merchants');
  if (merchantTables.length > 0) {
    const cols = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'merchants'
      ORDER BY ordinal_position;
    `);
    console.log('merchants columns:', cols.rows.map(r => r.column_name));
  }

  // Check migration history
  const migTables = tables.rows.filter(r => r.tablename === 'knex_migrations');
  if (migTables.length > 0) {
    const migs = await client.query('SELECT * FROM knex_migrations ORDER BY id');
    console.log('Completed migrations:', migs.rows);
  }

  await client.end();
}

main().catch(err => console.error(err.message));
