const sql = require('../src/database/postgres');

async function testConnection() {
    try {
        console.log("🔍 Testing database connection with 'postgres' library...");
        const result = await sql`SELECT version()`;
        console.log("✅ Connected to database!");
        console.log("📊 PostgreSQL version:", result[0].version);
        process.exit(0);
    } catch (err) {
        console.error("❌ Connection failed:");
        console.error("Message:", err.message);
        console.error("Code:", err.code);
        process.exit(1);
    }
}

testConnection();
