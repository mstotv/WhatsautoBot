const { Markup } = require('telegraf');
const db = require('../services/database');
const { t } = require('./i18n');
const axios = require('axios');
const aiService = require('../services/aiService');
const sheetsService = require('../services/sheetsService');
const evolutionAPI = require('../services/evolutionAPI');
const excelService = require('../services/excelService');
const fs = require('fs');

// AI Settings Handler
async function showAISettings(ctx) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  const aiSettings = await db.getAISettings(user.id);
  const lang = user.language || 'ar';

  let message = '🧠 <b>' + t('ai_settings', lang) + '</b>\n\n';
  message += '━━━━━━━━━━━━━━━\n';

  if (aiSettings && aiSettings.is_active) {
    message += `✅ <b>` + (lang === 'ar' ? 'الحالة:' : 'Status:') + `</b> ` + t('ai_active', lang) + `\n`;
    message += `🔗 <b>` + (lang === 'ar' ? 'المزود:' : 'Provider:') + `</b> ChatGPT (OpenAI)\n`;
    message += `🌐 <b>` + (lang === 'ar' ? 'اللغة:' : 'Language:') + `</b> ${aiSettings.language || 'ar'}\n`;
    if (aiSettings.system_prompt) {
      const prompt = aiSettings.system_prompt.substring(0, 100);
      message += `📝 <b>` + (lang === 'ar' ? 'التعليمات:' : 'Instructions:') + `</b> ${prompt}...\n`;
    }
  } else {
    message += '❌ <b>' + (lang === 'ar' ? 'الحالة:' : 'Status:') + '</b> ' + t('ai_inactive', lang) + '\n';
  }

  message += '\n━━━━━━━━━━━━━━━\n';
  message += '🔔 <b>' + (lang === 'ar' ? 'الإشعارات:' : 'Notifications:') + '</b> ' + (user.notifications_enabled !== false ? (lang === 'ar' ? '✅ مفعلة' : '✅ Enabled') : (lang === 'ar' ? '❌ معطلة' : '❌ Disabled')) + '\n';
  message += '━━━━━━━━━━━━━━━\n\n';
  message += (lang === 'ar' ? 'اختر المزود أو الإعداد:' : 'Choose provider or setting:');

  const buttons = [
    [Markup.button.callback(lang === 'ar' ? '⚪ إعداد ChatGPT (OpenAI)' : '⚪ Setup ChatGPT (OpenAI)', 'setup_chatgpt')],
    [Markup.button.callback(t('train_bot', lang), 'train_ai')],
    [Markup.button.callback(user.notifications_enabled !== false ? (lang === 'ar' ? '🔕 إيقاف الإشعارات' : '🔕 Stop Notifications') : (lang === 'ar' ? '🔔 تفعيل الإشعارات' : '🔔 Enable Notifications'), 'toggle_notifications')]
  ];

  if (aiSettings && aiSettings.is_active) {
    buttons.push([Markup.button.callback(t('disable_ai', lang), 'disable_ai')]);
  }

  buttons.push([Markup.button.callback(t('back', lang), 'back_dashboard')]);

  await ctx.reply(message, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons }
  });
}

// Setup AI (DeepSeek)

// Setup Gemini

// Setup ChatGPT (OpenAI)
async function handleSetupChatGPT(ctx, telegramBot) {
  const state = telegramBot.userStates.get(ctx.from.id);

  if (!state || state.action !== 'setup_chatgpt') {
    telegramBot.userStates.set(ctx.from.id, { action: 'setup_chatgpt', step: 'api_key' });
    await ctx.reply('🔑 <b>أرسل API Key من OpenAI</b>\n\n' +
      'يمكنك الحصول عليه من: https://platform.openai.com/api-keys',
      { parse_mode: 'HTML' });
    return;
  }

  if (state.step === 'api_key' && ctx.message) {
    state.apiKey = ctx.message.text;
    state.step = 'language';
    telegramBot.userStates.set(ctx.from.id, state);
    await ctx.reply('🌐 اختر لغة الذكاء الاصطناعي:', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🇸🇦 العربية', 'ai_lang_ar')],
          [Markup.button.callback('🇺🇸 English', 'ai_lang_en')],
          [Markup.button.callback('🇫🇷 Français', 'ai_lang_fr')],
          [Markup.button.callback('🇩🇪 Deutsch', 'ai_lang_de')]
        ]
      }
    });
  } else if (state.step === 'system_prompt') {
    const systemPrompt = ctx.message.text;

    const user = await db.getUserByTelegramId(ctx.from.id);
    const lang = state.language || 'ar';
    await db.setAISettings(user.id, 'chatgpt', state.apiKey, 'gpt-4o-mini', systemPrompt, lang);

    telegramBot.userStates.delete(ctx.from.id);

    const langNames = { ar: 'العربية', en: 'English', fr: 'Français', de: 'Deutsch' };
    await ctx.reply('✅ <b>تم حفظ إعدادات ChatGPT بنجاح!</b>\n\n' +
      '🔗 المزود: ChatGPT (OpenAI)\n' +
      '🌐 اللغة: ' + (langNames[lang] || lang) + '\n' +
      '🤖 سيتم الرد تلقائياً على جميع الرسائل الواردة باستخدام ChatGPT.',
      { parse_mode: 'HTML' });
    await showAISettings(ctx);
  }
}

// Disable AI
async function disableAI(ctx) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  await db.toggleAI(user.id, false);
  await ctx.reply('✅ تم تعطيل الذكاء الاصطناعي');
  await showAISettings(ctx);
}

// Handle Google Sheets Setup
async function handleSheetsSetup(ctx, telegramBot) {
  const state = telegramBot.userStates.get(ctx.from.id);
  const googleAuthService = require('../services/googleAuthService');
  const globalOAuth = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const globalCreds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!state || state.action !== 'setup_sheets') {
    // Check if user is already OAuth authorized
    const user = await db.getUserByTelegramId(ctx.from.id);
    const sheetsSettings = await db.getSheetsSettings(user.id);

    if (globalOAuth && (!sheetsSettings || !sheetsSettings.access_token)) {
      const authUrl = googleAuthService.generateAuthUrl(ctx.from.id);
      console.log(`🔗 Generated Auth URL for user ${ctx.from.id}: ${authUrl}`);

      // Set state even before login so it's ready when they come back
      telegramBot.userStates.set(ctx.from.id, { action: 'setup_sheets', step: 'spreadsheet_url' });

      await ctx.reply(
        '📊 <b>ربط Google Sheets (الربط المباشر)</b>\n\n' +
        'اضغط على الزر أدناه لتسجيل الدخول بحساب جوجل ومنح البوت صلاحية الوصول لملفاتك لكي يتمكن من تسجيل الطلبات آلياً.\n\n' +
        '✨ <b>مميزات الربط المباشر:</b>\n' +
        '• لا حاجة لنسخ ملفات JSON.\n' +
        '• لا حاجة لمشاركة الملف يدوياً.\n' +
        '• الربط يتم بضغطة زر واحدة.\n\n' +
        '⚠️ <b>ملاحظة للمطور:</b> إذا واجهت خطأ redirect_uri_mismatch، تأكد أنك أضفت هذا الرابط في Google Console:\n' +
        `<code>${googleAuthService.redirectUri}</code>`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[Markup.button.url('👤 تسجيل الدخول بجوجل', authUrl)]]
          }
        }
      );
      return;
    }

    telegramBot.userStates.set(ctx.from.id, { action: 'setup_sheets', step: 'spreadsheet_url' });

    let message = '📊 <b>إكمال إعداد Google Sheets</b>\n\n';

    if (sheetsSettings && sheetsSettings.auth_type === 'oauth2') {
      message += '✅ حساب جوجل مرتبطة.\n\n';
      message += '📝 أرسل الآن رابط ملف الإكسل (URL) الذي تريد استخدامه للطلبات:';
    } else if (globalCreds) {
      try {
        const creds = JSON.parse(globalCreds);
        message += `✅ نظام الربط السهل مفعل.\n\n`;
        message += `1️⃣ قم بمشاركة الشيت الخاص بك مع هذا البريد:\n<code>${creds.client_email}</code>\n(أعطه صلاحية Editor)\n\n`;
        message += `2️⃣ أرسل رابط الشيت (URL) هنا مباشرة.\n`;
      } catch (e) {
        message += `⚠️ خطأ في إعدادات النظام العالمية. سيتم استخدام الطريقة اليدوية.\n\n`;
        message += `أرسل Spreadsheet ID الخاص بك:`;
      }
    } else {
      message += '1️⃣ أنشئ مشروع في Google Cloud Console\n' +
        '2️⃣ فعّل Google Sheets API\n' +
        '3️⃣ أنشئ Service Account وحمّل ملف JSON\n' +
        '4️⃣ شارك الشيت مع إيميل الـ Service Account\n\n' +
        '━━━━━━━━━━━━━━━\n' +
        '📝 أرسل Spreadsheet ID:';
    }

    await ctx.reply(message, { parse_mode: 'HTML' });
    return;
  }

  if (state.step === 'spreadsheet_url' && ctx.message) {
    let input = ctx.message.text.trim();
    let spreadsheetId = input;

    // Extract ID from URL if provided
    const urlMatch = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) {
      spreadsheetId = urlMatch[1];
    }

    state.spreadsheetId = spreadsheetId;

    const user = await db.getUserByTelegramId(ctx.from.id);
    const sheetsSettings = await db.getSheetsSettings(user.id);

    if (sheetsSettings && sheetsSettings.auth_type === 'oauth2') {
      state.credentials = {
        access_token: sheetsSettings.access_token,
        refresh_token: sheetsSettings.refresh_token,
        token_expiry: sheetsSettings.token_expiry,
        auth_type: 'oauth2'
      };
      state.step = 'test';
      telegramBot.userStates.set(ctx.from.id, state);
      return handleSheetsTest(ctx, state, telegramBot);
    } else if (globalCreds) {
      state.credentials = globalCreds;
      state.step = 'test';
      telegramBot.userStates.set(ctx.from.id, state);
      return handleSheetsTest(ctx, state, telegramBot);
    } else {
      state.step = 'credentials';
      telegramBot.userStates.set(ctx.from.id, state);
      await ctx.reply(
        '📄 الآن أرسل محتوى ملف credentials JSON:\n\n' +
        '(الصق كل محتوى ملف JSON الذي حملته من Google Cloud)',
        { parse_mode: 'HTML' }
      );
    }
  } else if (state.step === 'credentials' && ctx.message) {
    try {
      JSON.parse(ctx.message.text);
      state.credentials = ctx.message.text;
      state.step = 'test';
      telegramBot.userStates.set(ctx.from.id, state);
      await handleSheetsTest(ctx, state, telegramBot);
    } catch (e) {
      await ctx.reply('❌ JSON غير صحيح. تأكد من لصق كامل محتوى ملف credentials.');
    }
  }
}

// Helper to test and initialize
async function handleSheetsTest(ctx, state, telegramBot) {
  try {
    await ctx.reply('⏳ جاري اختبار الاتصال وتجهيز الجداول...');
    const testResult = await sheetsService.testConnection(state.credentials, state.spreadsheetId);

    if (testResult.success) {
      // Initialize Tabs (الطلبات والمنتجات)
      const initResult = await sheetsService.initializeSheet(state.credentials, state.spreadsheetId);

      const user = await db.getUserByTelegramId(ctx.from.id);
      await db.setSheetsSettings(
        user.id,
        state.spreadsheetId,
        typeof state.credentials === 'string' ? state.credentials : null,
        'المنتجات!A:Z',
        'الطلبات!A:A'
      );

      telegramBot.userStates.delete(ctx.from.id);

      let successMsg = '🎊 <b>مبروك! تم تأكيد ربط ملف الإكسل بنجاح</b> ✨\n\n';
      successMsg += `� <b>اسم الملف:</b> <code>${testResult.title}</code>\n`;
      successMsg += `📊 <b>الحالة:</b> متصل وجاهز للعمل\n\n`;

      if (initResult.success) {
        successMsg += `✅ تم إنشاء وتجهيز صفحات "الطلبات" و "المنتجات" داخل الملف آلياً.\n`;
      } else {
        successMsg += `⚠️ تم الربط، ولكن يرجى التأكد من وجود صفحات باسم "الطلبات" و "المنتجات".\n`;
      }

      successMsg += `\n🚀 <b>النظام الآن جاهز!</b> أي طلب يتم اكتشافه عبر الواتساب سيتم تسجيله فوراً في هذا الملف.`;

      await ctx.reply(successMsg, { parse_mode: 'HTML' });
      await showAISettings(ctx);
    } else {
      await ctx.reply('❌ فشل الاتصال: ' + testResult.error + '\n\nتأكد من مشاركة الشيت مع البريد الإلكتروني الصحيح أو تسجيل الدخول بشكل صحيح.');
      telegramBot.userStates.delete(ctx.from.id);
    }
  } catch (error) {
    console.error('Error in handleSheetsTest:', error);
    await ctx.reply('❌ حدث خطأ غير متوقع أثناء إعداد الشيت.');
    telegramBot.userStates.delete(ctx.from.id);
  }
}

// Toggle notifications
async function handleToggleNotifications(ctx) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  const newState = user.notifications_enabled === false ? true : false;
  await db.toggleNotifications(ctx.from.id, newState);
  await ctx.reply(newState ? '🔔 تم تفعيل الإشعارات' : '🔕 تم إيقاف الإشعارات');
  await showAISettings(ctx);
}

// Train AI
async function handleTrainAI(ctx, telegramBot) {
  const state = telegramBot.userStates.get(ctx.from.id);
  const user = await db.getUserByTelegramId(ctx.from.id);
  const aiSettings = await db.getAISettings(user.id);

  if (!state) {
    const currentPrompt = aiSettings?.system_prompt || '';

    let message = '🧠 تدريب الذكاء الاصطناعي\n\n';
    message += '📝 التعليمات الحالية: ' + (currentPrompt || 'لا توجد');
    message += '\n\nاختر نوع التدريب:\n';
    message += '1️⃣ تعليمات بسيطة\n';
    message += '2️⃣ تدريب متقدم\n';
    message += '3️⃣ تحسين الرد\n';
    message += '4️⃣ اختبار الذكاء';

    await ctx.reply(message, {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('1️⃣ تعليمات بسيطة', 'train_simple')],
          [Markup.button.callback('2️⃣ تدريب متقدم', 'train_advanced')],
          [Markup.button.callback('3️⃣ تحسين الرد', 'enhance_response')],
          [Markup.button.callback('4️⃣ اختبار الذكاء', 'test_ai')],
          [Markup.button.callback('🔙 العودة', 'ai_settings')]
        ]
      }
    });
    return;
  }

  if (state.step === 'simple_prompt') {
    if (!aiSettings) {
      await ctx.reply('❌ يجب إعداد DeepSeek أولاً.');
      telegramBot.userStates.delete(ctx.from.id);
      return;
    }

    const simplePrompt = ctx.message.text;
    const userLang = aiSettings.language || 'ar';

    const detailedPrompts = {
      ar: 'أنت ' + simplePrompt + '. أجب بشكل مفصّل وواضح. اكتب فقرات كاملة. اجعل إجاباتك شاملة ومفيدة.',
      en: 'You are ' + simplePrompt + '. Answer in detail and clearly. Write full paragraphs. Make your answers comprehensive.',
      fr: 'Vous êtes ' + simplePrompt + '. Répondez en détail. Écrivez des paragraphes entiers. Soyez complet.',
      de: 'Sie sind ' + simplePrompt + '. Antworten Sie detailliert. Schreiben Sie vollständige Absätze. Seien Sie umfassend.'
    };

    const detailedPrompt = detailedPrompts[userLang] || detailedPrompts.ar;

    await db.setAISettings(user.id, aiSettings.provider, aiSettings.api_key, aiSettings.model, detailedPrompt, userLang);

    telegramBot.userStates.delete(ctx.from.id);
    await ctx.reply('✅ تم التدريب!');
    await showAISettings(ctx);
  }

  if (state.step === 'advanced_prompt') {
    if (!aiSettings) {
      await ctx.reply('❌ يجب إعداد DeepSeek أولاً.');
      telegramBot.userStates.delete(ctx.from.id);
      return;
    }

    const userPrompt = ctx.message.text;
    const userLang = aiSettings.language || 'ar';

    const advancedSuffixes = {
      ar: '. أجب بشكل مفصّل وواضح. اكتب فقرات كاملة. اجعل إجاباتك شاملة ومفيدة.',
      en: '. Answer in detail and clearly. Write full paragraphs. Make your answers comprehensive and useful.',
      fr: '. Répondez en détail et clairement. Écrivez des paragraphes entiers. Soyez complet et utile.',
      de: '. Antworten Sie detailliert und klar. Schreiben Sie vollständige Absätze. Seien Sie umfassend und nützlich.'
    };

    const advancedPrompt = userPrompt + (advancedSuffixes[userLang] || advancedSuffixes.ar);

    await db.setAISettings(user.id, aiSettings.provider, aiSettings.api_key, aiSettings.model, advancedPrompt, userLang);

    telegramBot.userStates.delete(ctx.from.id);
    await ctx.reply('✅ تم التدريب!');
    await showAISettings(ctx);
  }

  if (state.step === 'enhance_prompt') {
    if (!aiSettings) {
      await ctx.reply('❌ يجب إعداد الذكاء الاصطناعي أولاً.');
      telegramBot.userStates.delete(ctx.from.id);
      return;
    }

    const userText = ctx.message.text || '';
    const enhancePrompt = 'حسّن: ' + userText;

    try {
      const result = await aiService.getAIReply(
        aiSettings.provider,
        aiSettings.api_key,
        aiSettings.model,
        'أنت مساعد محترف لتحسين النصوص.',
        [{ role: 'user', content: enhancePrompt }]
      );

      await ctx.reply('✨ النتيجة:\n\n' + result.reply);

      // Store in state to avoid callback_data size limits (64 bytes)
      telegramBot.userStates.set(ctx.from.id, {
        ...telegramBot.userStates.get(ctx.from.id),
        enhancedPrompt: result.reply
      });

      await ctx.reply('هل تريد حفظ هذا كتعليمات؟', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('✅ نعم', 'save_enhanced')],
            [Markup.button.callback('❌ لا', 'train_ai')]
          ]
        }
      });
    } catch (error) {
      console.error('Error enhancing text:', error.message);
      await ctx.reply('❌ حدث خطأ: ' + error.message);
    }

    telegramBot.userStates.delete(ctx.from.id);
  }

  if (state.step === 'test_ai_input') {
    if (!aiSettings) {
      await ctx.reply('❌ يجب إعداد الذكاء الاصطناعي أولاً.');
      telegramBot.userStates.delete(ctx.from.id);
      return;
    }

    try {
      const result = await aiService.getAIReply(
        aiSettings.provider,
        aiSettings.api_key,
        aiSettings.model,
        aiSettings.system_prompt || 'أنت مساعد ذكي.',
        [{ role: 'user', content: ctx.message.text }]
      );

      await ctx.reply('🤖 الرد:\n\n' + result.reply);
      await ctx.reply('جرب مرة أخرى؟', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('✅ نعم', 'test_ai')],
            [Markup.button.callback('❌ لا', 'ai_settings')]
          ]
        }
      });
    } catch (error) {
      console.error('AI test error:', error.message);
      await ctx.reply('❌ خطأ في الاختبار: ' + error.message);
    }

    telegramBot.userStates.delete(ctx.from.id);
  }
}

// Broadcast Menu
async function showBroadcastMenu(ctx) {
  await ctx.reply(
    '📢 رسالة جماعية\n\nاختر النوع:',
    Markup.inlineKeyboard([
      [Markup.button.callback('📝 نص فقط', 'broadcast_text')],
      [Markup.button.callback('🖼️ صورة + نص', 'broadcast_image')],
      [Markup.button.callback('🎥 فيديو + نص', 'broadcast_video')],
      [Markup.button.callback('🔙 العودة', 'back_dashboard')]
    ])
  );
}

// Start broadcast flow
async function startBroadcastFlow(ctx, type, telegramBot) {
  telegramBot.userStates.set(ctx.from.id, {
    action: 'broadcast',
    step: type === 'text' ? 'message' : 'media',
    type: type
  });

  if (type === 'text') {
    await ctx.reply('📝 أرسل نص الرسالة:');
  } else if (type === 'image') {
    await ctx.reply('🖼️ أرسل الصورة:');
  } else if (type === 'video') {
    await ctx.reply('🎥 أرسل الفيديو:');
  }
}

// Handle broadcast flow
async function handleBroadcastFlow(ctx, state, telegramBot) {
  const user = await db.getUserByTelegramId(ctx.from.id);

  if (state.type !== 'text' && state.step === 'media') {
    let fileId;
    if (ctx.message.photo) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      state.mediaType = 'image';
    } else if (ctx.message.video) {
      fileId = ctx.message.video.file_id;
      state.mediaType = 'video';
    }

    const file = await ctx.telegram.getFile(fileId);
    state.mediaUrl = 'https://api.telegram.org/file/bot' + process.env.TELEGRAM_BOT_TOKEN + '/' + file.file_path;
    state.step = 'message';
    telegramBot.userStates.set(ctx.from.id, state);
    await ctx.reply('📝 أرسل نص الرسالة:');
    return;
  }

  if (state.step === 'message') {
    state.message = ctx.message.text;
    state.step = 'confirm';
    telegramBot.userStates.set(ctx.from.id, state);

    let preview = state.type === 'text'
      ? state.message
      : (state.mediaType === 'image' ? 'صورة' : 'فيديو') + ' + ' + state.message;

    await ctx.reply('📋 المعاينة:\n\n' + preview);
    await ctx.reply('هل تريد الإرسال؟', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('📤 إرسال', 'broadcast_send_now')],
          [Markup.button.callback('❌ إلغاء', 'broadcast')]
        ]
      }
    });
  }
}

// Confirm broadcast
async function confirmBroadcast(ctx, state, telegramBot) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  const contacts = await db.getContacts(user.id);

  let sent = 0;
  let failed = 0;

  for (const contact of contacts) {
    try {
      const phoneNumber = contact.phone_number.split('@')[0];
      if (state.type === 'text') {
        await evolutionAPI.sendTextMessage(user.instance_name, contact.phone_number, state.message);
      } else if (state.mediaType === 'image') {
        await evolutionAPI.sendMediaMessage(user.instance_name, contact.phone_number, state.mediaUrl, state.message, 'image');
      } else if (state.mediaType === 'video') {
        await evolutionAPI.sendMediaMessage(user.instance_name, contact.phone_number, state.mediaUrl, state.message, 'video');
      }
      sent++;
    } catch (e) {
      failed++;
    }
  }

  await ctx.reply('✅ تم! المرسلة: ' + sent + ' / الفاشلة: ' + failed);
  telegramBot.userStates.delete(ctx.from.id);
}

// Show broadcast list
async function showBroadcastList(ctx) {
  await ctx.reply('📢 استخدم الأمر /broadcast لإرسال رسائل جماعية.');
}

// Show statistics
async function showStatistics(ctx) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  const contacts = await db.getContacts(user.id);
  const autoReplies = await db.getAutoReplies(user.id);

  let message = '📊 الإحصائيات\n\n';
  message += '👥 جهات الاتصال: ' + contacts.length + '\n';
  message += '🤖 الردود النشطة: ' + autoReplies.length;

  await ctx.reply(message);
}

// Handle disconnect
async function handleDisconnect(ctx) {
  try {
    const user = await db.getUserByTelegramId(ctx.from.id);
    if (!user || !user.instance_name) {
      await ctx.reply('⚠️ لم يتم العثور على جلسة نشطة لقطعها.');
      return;
    }

    // Logical disconnect: only update database status
    // We keep instance_name to allow easy reconnection later
    await db.updateUserConnection(ctx.from.id, false, user.phone_number);

    await ctx.reply('✅ تم قطع الاتصال بالواتساب بنجاح.\n\nسيتم تجاهل أي رسائل واردة، ويجب عليك إعادة الربط لاستخدام البوت مجدداً.');
  } catch (error) {
    console.error('Error in handleDisconnect:', error);
    await ctx.reply('❌ حدث خطأ أثناء محاولة قطع الاتصال.');
  }
}

// Add auto reply
async function handleAddAutoReply(ctx, state, telegramBot) {
  const user = await db.getUserByTelegramId(ctx.from.id);

  if (state.step === 'keyword') {
    state.keyword = ctx.message.text;
    state.step = 'reply';
    telegramBot.userStates.set(ctx.from.id, state);
    await ctx.reply('📝 أرسل نص الرد:');
    return;
  }

  if (state.step === 'reply') {
    state.reply = ctx.message.text;
    state.step = 'media_choice';
    telegramBot.userStates.set(ctx.from.id, state);

    await ctx.reply('🖼️ <b>هل تريد إضافة وسائط (صورة/فيديو) لهذا الرد؟</b>', {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🖼️ إضافة صورة', 'ar_media_image')],
          [Markup.button.callback('🎥 إضافة فيديو', 'ar_media_video')],
          [Markup.button.callback('⏭️ تخطي (نص فقط)', 'ar_media_none')]
        ]
      }
    });
    return;
  }

  // Handle actual media upload
  if (state.step === 'media_upload') {
    let fileId;
    if (ctx.message.photo) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      state.mediaType = 'image';
    } else if (ctx.message.video) {
      fileId = ctx.message.video.file_id;
      state.mediaType = 'video';
    } else if (ctx.message.document) {
      fileId = ctx.message.document.file_id;
      state.mediaType = 'document';
    }

    if (fileId) {
      const file = await ctx.telegram.getFile(fileId);
      state.mediaUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      await ctx.reply('✅ تم استلام الوسائط.');
      await finishAutoReply(ctx, state, telegramBot);
    }
  }
}

// Finish and Save Auto Reply
async function finishAutoReply(ctx, state, telegramBot) {
  const user = await db.getUserByTelegramId(ctx.from.id);

  await db.addAutoReply(
    user.id,
    state.keyword,
    state.reply,
    state.mediaUrl || null,
    state.mediaType || null,
    'none' // Reset capture mode to none
  );

  await ctx.reply('✅ <b>تم حفظ الرد التلقائي بنجاح!</b>', { parse_mode: 'HTML' });
  telegramBot.userStates.delete(ctx.from.id);

  // Return to menu
  setTimeout(() => {
    telegramBot.showAutoRepliesMenu(ctx);
  }, 1000);
}

// Handle URL type selection
async function handleURLTypeSelection(ctx, state) {
  const user = await db.getUserByTelegramId(ctx.from.id);

  if (state.step === 'url_keyword') {
    state.keyword = ctx.message.text;
    state.step = 'url_media';
    ctx.session.userState = state;

    await ctx.reply('📤 أرسل الوسائط:', {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🖼️ صورة', 'url_type_image')],
          [Markup.button.callback('🎥 فيديو', 'url_type_video')],
          [Markup.button.callback('📝 نص فقط', 'url_type_none')]
        ]
      }
    });
  }
}

// Set language
async function handleSetLanguage(ctx, lang) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  await db.setUserLanguage(user.id, lang);
  await ctx.reply(t('language_changed', lang));
}

// Handle Order Status Change
async function handleOrderStatusChange(ctx, status, phoneNumber, telegramBot) {
  try {
    const user = await db.getUserByTelegramId(ctx.from.id);
    const storeName = await db.getUserStoreName(ctx.from.id) || 'المتجر';
    const googleMapsLink = await db.getUserGoogleMapsLink(ctx.from.id);

    let message = '';
    let replyText = '';

    if (status === 'cooking') {
      message = '👨‍🍳 <b>تم تغيير الحالة: جاري التجهيز</b>\nسيعلم العميل أن طلبه قيد التحضير.';
      replyText = `مرحباً بك في ${storeName} 🌹\n\nبدأنا بتجهيز طلبك الآن 👨‍🍳🔥\nسيصلك إشعار آخر عند خروج الطلب للتوصيل.`;
    } else if (status === 'delivery') {
      message = '🛵 <b>تم تغيير الحالة: تم الإرسال</b>\nسيعلم العميل أن الطلب في الطريق.';
      replyText = `مرحباً 🌹\n\nطلبك الآن في الطريق إليك 🛵💨\nسيصلك عامل التوصيل في أقرب وقت.`;
    } else if (status === 'completed') {
      message = '✅ <b>تم تغيير الحالة: تم التسليم</b>\nتم شكر العميل وإرسال رابط التقييم.';
      replyText = `شكراً لاختيارك ${storeName} ❤️\n\nنتمنى أن يكون الطلب قد نال إعجابك.\n`;
      if (googleMapsLink) {
        replyText += `\nيسعدنا تقييمك لنا على خرائط جوجل:\n${googleMapsLink}`;
      }
    }

    // Send WhatsApp message via Evolution API
    try {
      const chatId = `${phoneNumber.replace('@s.whatsapp.net', '')}@s.whatsapp.net`;
      await evolutionAPI.sendTextMessage(user.instance_name, chatId, replyText);
    } catch (waError) {
      console.error('Error sending WhatsApp status update:', waError.message);
    }

    await ctx.reply(message, { parse_mode: 'HTML' });

    // Remove buttons only if completed to allow further status changes
    if (status === 'completed') {
      try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      } catch (editError) {
        console.warn('Could not remove buttons:', editError.message);
      }
    }

  } catch (error) {
    console.error('Error handling order status:', error);
    await ctx.reply('❌ حدث خطأ أثناء تحديث حالة الطلب.');
  }
}

// Handle Set Google Maps Link
async function handleSetGoogleMaps(ctx) {
  await ctx.reply('📍 <b>إعداد رابط خرائط جوجل</b>\n\nأرسل رابط موقع المطعم على خرائط جوجل الآن:\n(مثال: https://maps.app.goo.gl/...)', { parse_mode: 'HTML' });
}

// Show Order Reports Menu
async function showOrderReports(ctx) {
  let message = '📊 <b>تقارير الطلبات</b>\n\n';
  message += '━━━━━━━━━━━━━━━━━━━━━\n';
  message += 'اختر نوع التقرير الذي تريد عرضه:';

  await ctx.reply(message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [Markup.button.callback('🗓️ طلبات آخر 24 ساعة', 'report_24h')],
        [Markup.button.callback('📅 طلبات الشهر الحالي', 'report_month')],
        [Markup.button.callback('📥 تصدير إكسل (24 ساعة)', 'export_report_24h')],
        [Markup.button.callback('📥 تصدير إكسل (الشهري)', 'export_report_month')],
        [Markup.button.callback('🔙 العودة', 'back_dashboard')]
      ]
    }
  });
}

// Handle Order Export Reports
async function handleGetOrderExport(ctx, range) {
  try {
    const user = await db.getUserByTelegramId(ctx.from.id);
    const orders = await db.getOrdersByTimeRange(user.id, range);

    if (!orders || orders.length === 0) {
      await ctx.reply('⚠️ لا توجد طلبات لتصديرها في هذه الفترة.');
      await ctx.answerCbQuery();
      return;
    }

    await ctx.reply('⏳ جاري تجهيز ملف الإكسل...');
    await ctx.answerCbQuery();

    const title = range === '24h' ? 'orders_24h' : 'orders_month';
    const filePath = await excelService.generateOrdersExport(orders, `${title}_${user.id}.xlsx`);

    const captionTitle = range === '24h' ? 'آخر 24 ساعة' : 'الشهر الحالي';
    await ctx.replyWithDocument({ source: filePath, filename: `${captionTitle}.xlsx` }, {
      caption: `📊 <b>تقرير إكسل: ${captionTitle}</b>\n\nإجمالي الطلبات: ${orders.length}`,
      parse_mode: 'HTML'
    });

    // Delete file after sending
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Error exporting order report:', error);
    await ctx.reply('❌ حدث خطأ أثناء تصدير الملف.');
  }
}

// Handle dynamic order reports
async function handleGetOrderReport(ctx, range) {
  try {
    const user = await db.getUserByTelegramId(ctx.from.id);
    const orders = await db.getOrdersByTimeRange(user.id, range);

    const title = range === '24h' ? 'آخر 24 ساعة' : 'الشهر الحالي';
    let message = `📊 <b>تقرير الطلبات (${title})</b>\n\n`;
    message += '━━━━━━━━━━━━━━━━━━━━━\n';

    if (orders.length === 0) {
      message += '❌ لا توجد طلبات في هذه الفترة.';
    } else {
      message += `✅ <b>إجمالي الطلبات:</b> ${orders.length}\n\n`;

      // Group by status
      const stats = orders.reduce((acc, order) => {
        acc[order.status] = (acc[order.status] || 0) + 1;
        return acc;
      }, {});

      message += `👨‍🍳 قيد التجهيز: ${stats['cooking'] || stats['pending'] || 0}\n`;
      message += `🛵 في الطريق: ${stats['delivery'] || 0}\n`;
      message += `✅ مكتملة: ${stats['completed'] || 0}\n`;
      message += '━━━━━━━━━━━━━━━━━━━━━\n\n';

      // List last 5 orders for context
      message += '<b>آخر 5 طلبات:</b>\n';
      orders.slice(0, 5).forEach((o, i) => {
        const date = new Date(o.created_at).toLocaleDateString('ar-EG');
        message += `${i + 1}. ${o.customer_name} - ${o.product} (${o.status})\n`;
      });
    }

    await ctx.reply(message, { parse_mode: 'HTML' });
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('Error generating report:', error);
    await ctx.reply('❌ حدث خطأ أثناء إنشاء التقرير.');
  }
}

module.exports = {
  showAISettings,
  handleSetupChatGPT,
  disableAI,
  handleTrainAI,
  handleSheetsSetup,
  handleToggleNotifications,
  handleOrderStatusChange,
  handleSetGoogleMaps,
  showOrderReports,
  handleGetOrderReport,
  handleGetOrderExport,
  showBroadcastMenu,
  startBroadcastFlow,
  handleBroadcastFlow,
  confirmBroadcast,
  showBroadcastList,
  showStatistics,
  handleDisconnect,
  handleAddAutoReply,
  finishAutoReply,
  handleURLTypeSelection,
  handleSetLanguage
};
