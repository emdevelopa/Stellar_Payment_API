import "dotenv/config";

/** @type {import('knex').Knex.Config} */
const config = {
  client: "pg",
  connection: {
    host: 'db.xomasbwwhhcxrptfdees.supabase.co',
    user: 'postgres',
    database: 'postgres',
    password: 'pluto1234!@#$%^_',
    port: 6543,
    ssl: { rejectUnauthorized: false },
  },
  migrations: {
    directory: "./migrations",
    extension: "js",
  },
};

export default config;
