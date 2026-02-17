require('dotenv').config();
const aiService = require('../src/services/aiService');

async function testOrderDetection() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('❌ OPENAI_API_KEY is not set in .env');
        return;
    }

    console.log('🧪 Testing Order Detection with OpenAI...');

    const history = [
        { role: 'user', content: 'مرحباً، أريد طلب بيتزا ببيبروني وسط' },
        { role: 'assistant', content: 'أهلاً بك! 🍕 اختيار رائع. كم عدد البيتزا التي تود طلبها؟' },
        { role: 'user', content: 'واحدة فقط' },
        { role: 'assistant', content: 'ممتاز. باسم من الطلب؟' },
        { role: 'user', content: 'أحمد علي' },
        { role: 'assistant', content: 'تشرفنا يا أحمد. ما هو عنوان التوصيل؟' },
        { role: 'user', content: 'جدة، حي الروضة، شارع الأمير سلطان' },
        { role: 'assistant', content: 'شكراً لك. هل لديك أي ملاحظات إضافية؟' },
        { role: 'user', content: 'لا، شكراً. اعتمد الطلب.' }
    ];

    const systemPrompt = `أنت مساعد مطعم بيتزا.`;

    // Explicitly ask for JSON in the system prompt context similar to the app
    // The aiService.buildAgentPrompt does this, so we just pass the base prompt.

    try {
        const result = await aiService.getAIReply(
            'chatgpt',
            apiKey,
            'gpt-4o-mini',
            systemPrompt,
            history,
            null,
            'ar'
        );

        console.log('\n💬 Raw Reply:\n', result.reply);
        console.log('\n📋 Order Detected:', result.orderDetected);

        if (result.orderDetected) {
            console.log('📦 Order Data:', JSON.stringify(result.orderData, null, 2));
        } else {
            console.log('⚠️ No order detected. Check the raw reply for JSON block.');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

testOrderDetection();
