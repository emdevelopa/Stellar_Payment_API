import pkg from 'pg';
const { Client } = pkg;
import 'dotenv/config';

async function checkLock() {
  const client = new Client({
    host: 'db.xomasbwwhhcxrptfdees.supabase.co',
    user: 'postgres',
    database: 'postgres',
    password: 'pluto1234!@#$%^_',
    port: 6543,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to DB.');
    
    const checkTable = await client.query("SELECT to_regclass('knex_migrations_lock')");
    if (checkTable.rows[0].to_regclass) {
      const res = await client.query('SELECT * FROM knex_migrations_lock');
      console.log('Lock table content:', res.rows);
      
      if (res.rows[0] && res.rows[0].is_locked) {
        console.log('Database is LOCKED. Clearing lock...');
        await client.query('UPDATE knex_migrations_lock SET is_locked = 0');
        console.log('Lock cleared.');
      } else {
        console.log('Database is not locked.');
      }
    } else {
      console.log('knex_migrations_lock table does not exist yet.');
    }
    
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkLock();
