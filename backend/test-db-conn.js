import pkg from 'pg';
const { Client } = pkg;
import 'dotenv/config';

async function testConnection() {
  const combinations = [
    { host: 'db.xomasbwwhhcxrptfdees.supabase.co', user: 'postgres.xomasbwwhhcxrptfdees', port: 6543, ssl: { rejectUnauthorized: false } },
    { host: 'db.xomasbwwhhcxrptfdees.supabase.co', user: 'postgres', port: 6543, ssl: { rejectUnauthorized: false } },
  ];

  for (const config of combinations) {
    const client = new Client({
      database: 'postgres',
      password: 'pluto1234!@#$%^_',
      ...config
    });

    console.log(`\nTesting combination: host=${config.host}, user=${config.user}, port=${config.port}, ssl=${JSON.stringify(config.ssl)}`);
    try {
      await client.connect();
      console.log('Connected successfully!');
      const res = await client.query('SELECT NOW()');
      console.log('Current time from DB:', res.rows[0]);
      await client.end();
      console.log('--- SUCCESS with this config! ---');
      return;
    } catch (err) {
      console.error('Connection error:', err.message);
    }
  }
}

testConnection();
