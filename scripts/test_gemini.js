require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini(modelName = 'gemini-2.0-flash') {
    const apiKey = process.env.GEMINI_API_KEY || ''; // Adjust if the key name in .env is different
    if (!apiKey) {
        console.error('❌ No GEMINI_API_KEY found in .env');
        return;
    }

    console.log(`🧪 Testing Gemini with model: ${modelName}...`);
    const genAI = new GoogleGenerativeAI(apiKey);

    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hello, are you working?");
        console.log('✅ Success! Response:', result.response.text());
    } catch (error) {
        console.error('❌ Gemini Test Failed:');
        console.error('Status:', error.status);
        console.error('Message:', error.message);
        if (error.response) {
            console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
        }

        if (modelName !== 'gemini-1.5-flash') {
            console.log('\n🔄 Retrying with gemini-1.5-flash...');
            await testGemini('gemini-1.5-flash');
        }
    }
}

testGemini();
