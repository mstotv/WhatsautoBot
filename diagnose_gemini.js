const axios = require('axios');
const { pool } = require('./src/database/migrate');

async function diagnoseGemini() {
    console.log('🔍 Starting Deep Diagnostic for Gemini...\n');

    try {
        // 1. Get Gemini Settings from DB
        const result = await pool.query("SELECT api_key FROM ai_settings WHERE provider = 'gemini' LIMIT 1");
        if (result.rows.length === 0) {
            console.error('❌ No Gemini API key found in database.');
            return;
        }

        const apiKey = result.rows[0].api_key;
        console.log('✅ API key found in database.\n');

        // 2. Direct API Probe for available models
        console.log('🕵️ Probing models via direct API call...');
        try {
            const listResponse = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            console.log('✅ API call successful!');
            console.log('📋 Available Models:');
            listResponse.data.models.forEach(m => {
                console.log(`  - ${m.name} (${m.displayName})`);
            });
        } catch (error) {
            console.error('❌ Failed to list models.');
            if (error.response) {
                console.error('   Status:', error.response.status);
                console.error('   Error Data:', JSON.stringify(error.response.data, null, 2));
            } else {
                console.error('   Message:', error.message);
            }
        }

        // 3. Test simple completion with multiple models
        const testModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest'];

        for (const model of testModels) {
            console.log(`\n🧪 Testing model: ${model}...`);
            try {
                const response = await axios.post(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                    { contents: [{ parts: [{ text: "Hi" }] }] },
                    { headers: { 'Content-Type': 'application/json' } }
                );
                console.log(`✅ ${model} works!`);
            } catch (error) {
                console.error(`❌ ${model} failed.`);
                if (error.response) {
                    const errMsg = error.response.data?.error?.message || '';
                    console.error(`   Message: ${errMsg}`);
                    if (errMsg.includes('quota') && errMsg.includes('limit: 0')) {
                        console.error('   🚩 CRITICAL: Limit is 0. This almost certainly means your region/IP is restricted.');
                    }
                }
            }
        }

    } catch (error) {
        console.error('❌ Error in diagnostic script:', error.message);
    } finally {
        await pool.end();
    }
}

diagnoseGemini();
