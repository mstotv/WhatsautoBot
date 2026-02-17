const OpenAI = require('openai');

class AIService {
    constructor() {
        // No blacklist or complex state needed for single provider
    }

    /**
     * Get AI reply using OpenAI ChatGPT
     */
    async getAIReply(provider, apiKey, model, systemPrompt, conversationHistory, sheetsContext = null, language = 'ar') {
        // Build the full agent system prompt
        const fullSystemPrompt = this.buildAgentPrompt(systemPrompt, sheetsContext, language);
        let rawReply;

        try {
            // Always use OpenAI, ignoring the 'provider' argument or ensuring it's treated as OpenAI
            // We use the passed apiKey, assuming it is the OpenAI key. 
            // In the previous code, getAIReply was called with specific keys. 
            // We should ensure the calling code passes the OPENAI_API_KEY.

            // If the caller passes 'gemini' or 'deepseek' as provider, we should probably ignore it 
            // and use the OpenAI key from env if not passed, BUT getAIReply signature expects the key passed in.
            // Let's assume the caller configures the bot to use 'chatgpt' or we force it here.

            // However, the caller (socketService.js or server.js) might be passing the key based on the provider name.
            // If the user selected 'gemini' in settings, the bot might pass the gemini key here.
            // But the user said "delete Gemini/DeepSeek from the basis". 
            // So we should assume the "provider" argument is now irrelevant or always "chatgpt".

            // To be safe and robust: We will use the passed apiKey. 
            // The caller is responsible for passing the correct OpenAI key.

            rawReply = await this.callOpenAI(apiKey, model || 'gpt-4o-mini', fullSystemPrompt, conversationHistory);

        } catch (error) {
            console.error('❌ OpenAI Error:', error.message);

            return {
                reply: this.getProviderUnavailableMessage(language),
                orderDetected: false,
                orderData: null
            };
        }

        // Parse the reply for order detection
        const parsed = this.parseAIResponse(rawReply);
        return parsed;
    }

    getProviderUnavailableMessage(language = 'ar') {
        const messages = {
            ar: 'عذراً، خدمة الذكاء الاصطناعي تواجه مشكلة حالياً. الرجاء المحاولة لاحقاً.',
            en: 'Sorry, the AI service is encountering issues. Please try again later.',
            fr: 'Désolé, le service IA rencontre des problèmes.',
            de: 'Entschuldigung, der KI-Dienst hat Probleme.'
        };
        return messages[language] || messages.ar;
    }

    /**
     * OpenAI ChatGPT API call
     */
    async callOpenAI(apiKey, model, systemPrompt, conversationHistory) {
        const openai = new OpenAI({ apiKey: apiKey });

        const messages = [
            { role: 'system', content: systemPrompt },
            ...conversationHistory.map(m => ({ role: m.role, content: m.content }))
        ];

        const response = await openai.chat.completions.create({
            model: model,
            messages: messages,
            temperature: 0.7,
            max_tokens: 1024
        });

        return response.choices[0].message.content;
    }

    /**
     * Build the agent system prompt with sheets data and instructions
     */
    buildAgentPrompt(userPrompt, sheetsData, language = 'ar') {
        const langInstructions = {
            'ar': 'رد دائماً باللغة العربية. كن مهذباً ومحترفاً.',
            'en': 'Always reply in English. Be polite and professional.',
            'fr': 'Répondez toujours en français. Soyez poli et professionnel.',
            'de': 'Antworten Sie immer auf Deutsch. Seien Sie höflich und professionell.'
        };

        let prompt = `أنت وكيل ذكي (AI Agent) محترف يعمل كمساعد خدمة عملاء وخبير مبيعات على واتساب.
يجب أن تعمل بدقة فائقة وفقاً لنوع العمل المكتوب في التعليمات الخاصة (سواء كان مطعماً أو متجر تجزئة).

## قوانين المحادثة:
- ${langInstructions[language] || langInstructions['ar']}
- حلل رسالة العميل بعناية: هل يسأل عن السعر؟ هل يريد الحجز؟ هل يريد الشراء؟
- إذا كان العمل **مطعم**: كن "نادل" محترف، اسأل عن الإضافات، الحجم، والكمية.
- إذا كان العمل **تجارة تجزئة**: كن "بائع" خبير، اسأل عن المقاس، اللون، أو المواصفات.
- **لا تجمع البيانات دفعة واحدة**: اسأل عن معلومة واحدة في كل رد لتكون المحادثة طبيعية.

## خطوات تأكيد أي طلب (Order Protocol):
اجمع المعلومات التالية بالترتيب قبل إغلاق الطلب:
1. **المنتج / الوجبة**: تأكد من الاسم كما هو موجود في القائمة.
2. **الكمية**: كم قطعة أو وجبة؟
3. **الاسم**: اسم العميل الثلاثي.
4. **العنوان**: الموقع التفصيلي (المدينة، الحي، الشارع).
5. **ملاحظات**: مثل إضافات الطعام أو تفضيلات التغليف.

## متى ترسل بيانات الطلب (JSON):
يجب عليك إضافة بلوك JSON التالي **فوراً** في نهاية ردك عندما يحدث أي مما يلي:
1. إذا قال العميل "ثبت الطلب"، "اطلب"، "أكد"، أو أي عبارة تفيد الموافقة النهائية.
2. إذا قام العميل بإرسال بياناته (الاسم والعنوان) وطلب البدء.
3. إذا انتهيت من جمع (المنتج، الكمية، الاسم، العنوان).

أضف في نهاية ردك الأخير هذا البلوك (مهم جداً للنظام):
\`\`\`ORDER_JSON
{
  "order_detected": true,
  "customer_name": "اسم العميل الثلاثي",
  "customer_address": "العنوان التفصيلي",
  "products": [
    {
      "name": "اسم المنتج/الوجبة",
      "quantity": 1,
      "price": "السعر الفردي (رقم فقط)"
    }
  ],
  "delivery_price": "سعر التوصيل (رقم فقط)",
  "total_price": "الإجمالي الكلي (مجموع المنتجات + التوصيل)",
  "phone": "رقم الهاتف المستخرج من المحادثة",
  "notes": "أي ملاحظات إضافية"
}
\`\`\`
**مهم جداً**: قم بحساب الأسعار بدقة بناءً على المعلومات المتوفرة لديك في التدريب أو القوائم.
**تحذير**: لا تذكر كلمة JSON أو كود برمجي في نص كلامك للعميل، فقط أضف البلوك في النهاية.
أجب دائماً بصيغة مساعد مبيعات ذكي ومحبوب.
`;

        // Add user's custom training/prompt
        if (userPrompt) {
            prompt += `\n## تعليمات خاصة من صاحب الحساب:\n${userPrompt}\n`;
        }

        // Add sheets data context
        if (sheetsData) {
            prompt += `\n## بيانات المنتجات والخدمات المتوفرة (من جدول البيانات):\n${sheetsData}\n`;
            prompt += `\nاستخدم هذه البيانات للرد على استفسارات العملاء عن المنتجات والأسعار والتوفر.\n`;
        }

        return prompt;
    }

    /**
     * Parse AI response to detect orders
     */
    parseAIResponse(rawReply) {
        let reply = rawReply;
        let orderDetected = false;
        let orderData = null;

        // Check for ORDER_JSON block
        const orderMatch = rawReply.match(/```ORDER_JSON\s*\n?([\s\S]*?)\n?```/);
        if (orderMatch) {
            try {
                orderData = JSON.parse(orderMatch[1]);
                orderDetected = orderData.order_detected === true;
                // Remove the JSON block from the visible reply
                reply = rawReply.replace(/```ORDER_JSON\s*\n?[\s\S]*?\n?```/, '').trim();
            } catch (e) {
                console.error('Failed to parse ORDER_JSON:', e.message);
            }
        }

        return { reply, orderDetected, orderData };
    }

    async transcribeAudio(apiKey, audioBuffer, fileName = 'speech.ogg') {
        try {
            // Ensure filename has a valid extension for Whisper
            const finalFileName = fileName.includes('.') ? fileName : `${fileName}.ogg`;
            const openai = new OpenAI({ apiKey });

            // Create a file-like object from the buffer
            const file = await OpenAI.toFile(audioBuffer, finalFileName);

            const transcription = await openai.audio.transcriptions.create({
                file: file,
                model: 'whisper-1',
                language: 'ar' // Pre-set to Arabic for better accuracy in this context
            });

            return transcription.text;
        } catch (error) {
            console.error('Error during transcription:', error.message);
            throw error;
        }
    }
}

module.exports = new AIService();
