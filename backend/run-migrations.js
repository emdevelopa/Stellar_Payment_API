// Run all knex migrations programmatically using the known-working pg config
import knex from 'knex';

const db = knex({
  client: 'pg',
  connection: {
    host: 'db.xomasbwwhhcxrptfdees.supabase.co',
    user: 'postgres',
    database: 'postgres',
    password: 'pluto1234!@#$%^_',
    port: 6543,
    ssl: { rejectUnauthorized: false },
  },
  migrations: {
    directory: './migrations',
    extension: 'js',
  },
});

async function main() {
  console.log('Testing connection...');
  await db.raw('SELECT 1');
  console.log('Connection OK.');

  console.log('Running migrations...');
  const [batch, list] = await db.migrate.latest();
  console.log(`Batch: ${batch}`);
  console.log('Applied migrations:', list);
  
  await db.destroy();
  console.log('Done!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
