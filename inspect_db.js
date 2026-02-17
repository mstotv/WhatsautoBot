const { pool } = require('./src/database/migrate');

async function inspectDb() {
    try {
        console.log('📊 Inspecting Database State...');

        // 1. Get recent users
        const users = await pool.query('SELECT id, telegram_id, telegram_username, instance_name, is_connected FROM users ORDER BY updated_at DESC LIMIT 5');
        console.log('\n👤 Recent Users:', JSON.stringify(users.rows, null, 2));

        if (users.rows.length === 0) {
            console.log('❌ No users found.');
            return;
        }

        const userId = users.rows[0].id;

        // 2. Get AI settings for the most active user
        const aiSettings = await pool.query('SELECT * FROM ai_settings WHERE user_id = $1', [userId]);
        console.log('\n🧠 AI Settings for latest user:', JSON.stringify(aiSettings.rows, null, 2));

        // 3. Get recent orders
        const orders = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 5');
        console.log('\n🛒 Recent Orders:', JSON.stringify(orders.rows, null, 2));

        // 4. Get recent conversation history to see what the AI replied
        const history = await pool.query('SELECT * FROM conversation_history ORDER BY created_at DESC LIMIT 10');
        console.log('\n💬 Recent Conversation History:', JSON.stringify(history.rows, null, 2));

    } catch (error) {
        console.error('❌ DB Inspection Error:', error);
    } finally {
        await pool.end();
    }
}

inspectDb();
