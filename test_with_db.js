const { pool } = require('./src/database/migrate');
const aiService = require('./src/services/aiService');

async function testOrderDetection() {
    try {
        console.log('🧪 Testing Order Detection with DB Settings...');

        // Get AI settings for user 13 (or the latest user)
        const result = await pool.query('SELECT * FROM ai_settings ORDER BY updated_at DESC LIMIT 1');
        const settings = result.rows[0];

        if (!settings || !settings.api_key) {
            console.error('❌ No AI settings found in DB.');
            return;
        }

        console.log(`📡 Using provider: ${settings.provider}, Model: ${settings.model}`);

        const history = [
            { role: 'user', content: 'مرحباً، أريد طلب برياني دجاج' },
            { role: 'assistant', content: 'أهلاً بك! كم حبة؟' },
            { role: 'user', content: '2' },
            { role: 'assistant', content: 'تمام، محتاج الاسم والعنوان للتوصيل' },
            { role: 'user', content: 'اسمي مصطفى، العنوان كركوك' },
            { role: 'assistant', content: 'تمام يا مصطفى، هل تريد تأكيد الطلب؟' },
            { role: 'user', content: 'نعم، ثبت الطلب' }
        ];

        const aiResult = await aiService.getAIReply(
            settings.provider,
            settings.api_key,
            settings.model,
            settings.system_prompt,
            history,
            null,
            settings.language || 'ar'
        );

        console.log('\n💬 AI Reply:\n', aiResult.reply);
        console.log('\n📋 Order Detected:', aiResult.orderDetected);

        if (aiResult.orderDetected) {
            console.log('📦 Order Data:', JSON.stringify(aiResult.orderData, null, 2));
        } else {
            console.log('⚠️ No order detected. Check if the AI included the ORDER_JSON block.');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

testOrderDetection();
