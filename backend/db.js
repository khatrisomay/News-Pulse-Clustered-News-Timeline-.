const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from parent folder .env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("Warning: DATABASE_URL is not set in environment variables");
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: connectionString && (connectionString.includes('supabase') || connectionString.includes('neon.tech')) 
    ? { rejectUnauthorized: false } 
    : false
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
