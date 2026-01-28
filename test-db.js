require('dotenv').config();
const { Pool } = require('pg');

console.log('🔍 Testing database connection...\n');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Found' : 'Not found');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function testConnection() {
    try {
        console.log('⏳ Connecting to database...');
        const client = await pool.connect();
        console.log('✅ Connected successfully!');

        const result = await client.query('SELECT version()');
        console.log('📊 PostgreSQL version:', result.rows[0].version);

        client.release();
        await pool.end();
        console.log('\n✅ Test completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Connection failed:');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

testConnection();
