const { Markup } = require('telegraf');
const db = require('../services/database');
const { t } = require('./i18n');
const axios = require('axios');

// AI Settings Handler
async function showAISettings(ctx) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  const aiSettings = await db.getAISettings(user.id);

  let message = '🤖 إعدادات الذكاء الاصطناعي\n\n';

  if (aiSettings && aiSettings.is_active) {
    message += `✅ الحالة: مفعّل (${aiSettings.provider === 'deepseek' ? 'DeepSeek' : 'Gemini'})\n`;
    message += `📝 الموديل: ${aiSettings.model || 'Default'}\n\n`;
    message += 'عند تفعيل الذكاء الاصطناعي، سيرد على جميع الرسائل تلقائياً.';
  } else {
    message += '❌ الذكاء الاصطناعي غير مفعّل\n\n';
    message += 'اختر أحد المزودين للبدء:';
  }

  const buttons = [];

  if (!aiSettings || !aiSettings.is_active) {
    buttons.push([Markup.button.callback('🔧 إعداد DeepSeek API', 'setup_ai')]);
    buttons.push([Markup.button.callback('🔧 إعداد Google Gemini', 'setup_gemini')]);
  } else {
    buttons.push([aiSettings.provider === 'deepseek'
      ? Markup.button.callback('⚙️ تعديل DeepSeek', 'setup_ai')
      : Markup.button.callback('⚙️ تعديل Gemini', 'setup_gemini')
    ]);
    buttons.push([Markup.button.callback('🧠 تدريب البوت (التعليمات)', 'train_ai')]);
    buttons.push([Markup.button.callback('❌ تعطيل AI', 'disable_ai')]);

    // Add option to switch provider
    if (aiSettings.provider === 'deepseek') {
      buttons.push([Markup.button.callback('🔄 التغيير إلى Gemini', 'setup_gemini')]);
    } else {
      buttons.push([Markup.button.callback('🔄 التغيير إلى DeepSeek', 'setup_ai')]);
    }
  }

  buttons.push([Markup.button.callback('🔙 العودة', 'back_dashboard')]);

  await ctx.reply(message, Markup.inlineKeyboard(buttons));
}

// Setup AI
async function handleSetupAI(ctx, telegramBot) {
  const state = telegramBot.userStates.get(ctx.from.id);

  if (!state) {
    telegramBot.userStates.set(ctx.from.id, { action: 'setup_ai', step: 'api_key' });
    await ctx.reply('🔑 أرسل API Key من DeepSeek:\n\n(يمكنك الحصول عليه من: https://platform.deepseek.com)');
    return;
  }

  if (state.step === 'api_key' && ctx.message) {
    state.apiKey = ctx.message.text;
    state.step = 'system_prompt';
    telegramBot.userStates.set(ctx.from.id, state);
    await ctx.reply('📝 اختياري: أرسل التعليمات للذكاء الاصطناعي (System Prompt)\n\nأو أرسل "تخطي" للاستخدام الافتراضي:');
  } else if (state.step === 'system_prompt') {
    const systemPrompt = ctx.message.text === 'تخطي'
      ? 'أنت مساعد ذكي ومفيد. أجب على الأسئلة بطريقة واضحة ومهذبة.'
      : ctx.message.text;

    const user = await db.getUserByTelegramId(ctx.from.id);
    await db.setAISettings(user.id, 'deepseek', state.apiKey, 'deepseek-chat', systemPrompt);

    telegramBot.userStates.delete(ctx.from.id);
    await ctx.reply('✅ تم حفظ إعدادات الذكاء الاصطناعي بنجاح!\n\nسيتم الرد تلقائياً على جميع الرسائل الواردة.');
    await showAISettings(ctx);
  }
}

async function handleAddAutoReply(ctx, telegramBot) {
  const state = telegramBot.userStates.get(ctx.from.id);
  if (!state) return;

  const user = await db.getUserByTelegramId(ctx.from.id);
  const lang = user.language || 'ar';

  // Step 1: Handle Keyword
  if (state.step === 'keyword' && ctx.message) {
    state.keyword = ctx.message.text.toLowerCase();
    state.step = 'reply_text';
    telegramBot.userStates.set(ctx.from.id, state);

    const msg = lang === 'ar' ? `✅ الكلمة المفتاحية: "${state.keyword}"\n\n📝 الآن أرسل الرد التلقائي:` : `✅ Keyword: "${state.keyword}"\n\n📝 Now send the reply text:`;
    await ctx.reply(msg);
    return;
  }

  // Step 2: Handle Reply Text
  if (state.step === 'reply_text' && ctx.message) {
    state.replyText = ctx.message.text;
    state.step = 'media_type';
    telegramBot.userStates.set(ctx.from.id, state);

    await ctx.reply(
      t('media_prompt', lang),
      Markup.inlineKeyboard([
        [Markup.button.callback(t('media_type_image', lang), 'media_type_image')],
        [Markup.button.callback(t('media_type_video', lang), 'media_type_video')],
        [Markup.button.callback(t('media_type_document', lang), 'media_type_document')],
        [Markup.button.callback(t('media_type_none', lang), 'media_type_none')]
      ])
    );
    return;
  }

  // Step 3: Handle Media Upload
  if (state.step === 'media_upload') {
    let mediaUrl = null;
    let mediaType = state.pendingMediaType;

    try {
      if (ctx.message.photo) {
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        const file = await ctx.telegram.getFile(fileId);
        mediaUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        mediaType = 'image';
      } else if (ctx.message.video || ctx.message.animation) {
        const media = ctx.message.video || ctx.message.animation;

        // Pre-check file size (Telegram getFile limit is 20MB)
        if (media.file_size > 20 * 1024 * 1024) {
          const errorMsg = lang === 'ar' ? '⚠️ حجم الفيديو كبير جداً (أكبر من 20 ميجابايت).' : '⚠️ Video size is too large (greater than 20MB).';
          await ctx.reply(errorMsg);
          return;
        }

        const fileId = media.file_id;
        const file = await ctx.telegram.getFile(fileId);
        mediaUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        mediaType = 'video';
      } else if (ctx.message.document) {
        if (ctx.message.document.file_size > 20 * 1024 * 1024) {
          const errorMsg = lang === 'ar' ? '⚠️ حجم الملف كبير جداً (أكبر من 20 ميجابايت).' : '⚠️ File size is too large (greater than 20MB).';
          await ctx.reply(errorMsg);
          return;
        }
        const fileId = ctx.message.document.file_id;
        const file = await ctx.telegram.getFile(fileId);
        mediaUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        mediaType = 'document';
      } else if (ctx.message.text && ctx.message.text.startsWith('http')) {
        mediaUrl = ctx.message.text;
      } else {
        const errorMsg = lang === 'ar' ? '❌ الرجاء إرسال الملف المطلوب أو رابط مباشر يبدأ بـ http' : '❌ Please send the required file or a direct link starting with http';
        await ctx.reply(errorMsg);
        return;
      }

      console.log(`💾 Saving auto-reply with media: keyword=${state.keyword}, type=${mediaType}, url=${mediaUrl}`);
      await db.addAutoReply(user.id, state.keyword, state.replyText, mediaUrl, mediaType);

      telegramBot.userStates.delete(ctx.from.id);
      await ctx.reply(t('save_success', lang));
      if (telegramBot.showAutoRepliesMenu) await telegramBot.showAutoRepliesMenu(ctx);
      return;
    } catch (error) {
      console.error('Error getting file from Telegram:', error);
      if (error.description && error.description.includes('file is too big')) {
        await ctx.reply('⚠️ عذراً، هذا الملف كبير جداً بالنسبة لتليجرام للتعامل معه عبر البوت. الرجاء استخدام رابط مباشر أو تقليل حجم الملف.');
      } else {
        await ctx.reply('❌ حدث خطأ أثناء معالجة الملف. الرجاء المحاولة مرة أخرى أو استخدام رابط مباشر.');
      }
      return;
    }
  }

  // Step 4: Handle Direct URL Input
  if (state.step === 'media_url_input' && ctx.message.text) {
    const url = ctx.message.text.trim();
    if (!url.startsWith('http')) {
      await ctx.reply('❌ الرجاء إرسال رابط مباشر صحيح يبدأ بـ http');
      return;
    }

    state.mediaUrl = url;
    state.step = 'media_url_type';
    telegramBot.userStates.set(ctx.from.id, state);

    await ctx.reply(
      '🔗 تم استلام الرابط. ما هو نوع الوسائط الموجود في هذا الرابط؟',
      Markup.inlineKeyboard([
        [Markup.button.callback('🖼️ صورة', 'url_type_image')],
        [Markup.button.callback('🎥 فيديو', 'url_type_video')],
        [Markup.button.callback('📂 ملف / مستند', 'url_type_document')]
      ])
    );
    return;
  }

  // Step 5: Handle URL Type Selection (via Button in telegram.js)
}

/**
 * Handle the final step of URL-based auto-reply
 */
async function handleURLTypeSelection(ctx, type, telegramBot) {
  const state = telegramBot.userStates.get(ctx.from.id);
  if (!state || state.step !== 'media_url_type') return;

  const user = await db.getUserByTelegramId(ctx.from.id);
  const mediaType = type; // 'image', 'video', or 'document'
  const mediaUrl = state.mediaUrl;

  console.log(`💾 Saving URL auto-reply: keyword=${state.keyword}, type=${mediaType}, url=${mediaUrl}`);
  await db.addAutoReply(user.id, state.keyword, state.replyText, mediaUrl, mediaType);

  telegramBot.userStates.delete(ctx.from.id);

  const typeLabel = mediaType === 'image' ? '🖼️ صورة' : (mediaType === 'video' ? '🎥 فيديو' : '📂 ملف/مستند');
  await ctx.reply(`✅ تم حفظ الرد التلقائي بنجاح!\n\n🔗 الرابط: ${mediaUrl}\n📂 النوع: ${typeLabel}`);

  if (telegramBot.showAutoRepliesMenu) await telegramBot.showAutoRepliesMenu(ctx);
}

// Finalize Auto-Reply without media
async function finishAutoReply(ctx, telegramBot) {
  const state = telegramBot.userStates.get(ctx.from.id);
  if (!state) return;

  const user = await db.getUserByTelegramId(ctx.from.id);
  await db.addAutoReply(user.id, state.keyword, state.replyText, null, null);

  telegramBot.userStates.delete(ctx.from.id);
  await ctx.reply('✅ تم حفظ الرد التلقائي بنجاح!');
  if (telegramBot.showAutoRepliesMenu) await telegramBot.showAutoRepliesMenu(ctx);
}

/**
 * Handle language selection
 */
async function handleSetLanguage(ctx, lang, telegramBot) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  await db.setUserLanguage(user.id, lang);

  await ctx.reply(t('language_changed', lang));
  await telegramBot.showDashboard(ctx);
}

// Train AI (Update System Prompt)
async function handleTrainAI(ctx, telegramBot) {
  const state = telegramBot.userStates.get(ctx.from.id);
  const user = await db.getUserByTelegramId(ctx.from.id);
  const aiSettings = await db.getAISettings(user.id);

  if (!state) {
    // First time - show training menu
    const currentPrompt = aiSettings?.system_prompt || '';
    
    let message = '🧠 <b> تدريب الذكاء الاصطناعي </b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━\n';
    message += '📝 <b>التعليمات الحالية:</b>\n';
    message += currentPrompt ? `"${currentPrompt}"` : 'لا توجد تعليمات مخصصة';
    message += '\n\n━━━━━━━━━━━━━━━━━━━━━\n';
    message += '⚙️ <b>اختر نوع التدريب:</b>\n\n';
    message += '1️⃣ <b>تعليمات بسيطة</b> - كتابة جملة واحدة تصف دور البوت\n';
    message += '2️⃣ <b>تدريب متقدم</b> - إضافة قواعد و شروط مفصلة\n';
    message += '3️⃣ <b>تحسين الرد</b> - إعادة كتابة رد الذكاء الاصطناعي بشكل أفضل\n';
    message += '4️⃣ <b>اختبار الذكاء</b> - تجربة الذكاء الاصطناعي';

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('1️⃣ تعليمات بسيطة', 'train_simple')],
          [Markup.button.callback('2️⃣ تدريب متقدم', 'train_advanced')],
          [Markup.button.callback('3️⃣ تحسين الرد', 'enhance_response')],
          [Markup.button.callback('4️⃣ اختبار الذكاء', 'test_ai')],
          [Markup.button.callback('🔙 رجوع', 'ai_settings')]
        ]
      }
    });
    return;
  }

  if (state.step === 'simple_prompt') {
    if (!aiSettings) {
      await ctx.reply('❌ يجب إعداد DeepSeek API أولاً قبل التدريب.');
      telegramBot.userStates.delete(ctx.from.id);
      return;
    }

    const simplePrompt = ctx.message.text;
    // Create a more detailed prompt from simple input
    const detailedPrompt = `أنت ${simplePrompt}. 

📋 <strong>القواعد:</strong>
- ابرد بإجابات قصيرة و مختصرة
- لا تكتب كلام كثير
- أجب على حسب السؤال مباشرة
- استخدم لغة عربية فصحى مفهومة
- إذا سألوك عن سعر، اذكر السعر مباشرة
- إذا سألوك عن موعد، اذكر التاريخ مباشرة
- لا تضيف تعليقات غير ضرورية`;

    await db.setAISettings(user.id, aiSettings.provider, aiSettings.api_key, aiSettings.model, detailedPrompt);

    telegramBot.userStates.delete(ctx.from.id);
    await ctx.reply('✅ <b>تم التدريب بنجاح!</b>\n\n📝 التعليمات المضافة:\n' + detailedPrompt, { parse_mode: 'HTML' });
    await showAISettings(ctx);
  }

  if (state.step === 'advanced_prompt') {
    if (!aiSettings) {
      await ctx.reply('❌ يجب إعداد DeepSeek API أولاً قبل التدريب.');
      telegramBot.userStates.delete(ctx.from.id);
      return;
    }

    await db.setAISettings(user.id, aiSettings.provider, aiSettings.api_key, aiSettings.model, ctx.message.text);

    telegramBot.userStates.delete(ctx.from.id);
    await ctx.reply('✅ <b>تم تحديث التدريب المتقدم بنجاح!</b>\n\nسيتم الرد على الرسائل حسب التعليمات الجديدة.', { parse_mode: 'HTML' });
    await showAISettings(ctx);
  }

  if (state.step === 'enhance_prompt') {
    if (!aiSettings) {
      await ctx.reply('❌ يجب إعداد DeepSeek API أولاً.');
      telegramBot.userStates.delete(ctx.from.id);
      return;
    }

    // Get AI to enhance the text
    const enhancePrompt = `راجع و حسّن النص التالي جعله أكثر احترافية و إجابات قصيرة و مختصرة:

"${ctx.message.text}"

أعد كتابة النص فقط بدون إضافة تعليقات.`;

    try {
      const { default: axios } = require('axios');
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: aiSettings.model || 'deepseek-chat',
          messages: [
            { role: 'system', content: 'أنت مساعد عربي محترف. أعد كتابة النصوص بأسلوب أفضل وأقصر.' },
            { role: 'user', content: enhancePrompt }
          ],
          temperature: 0.7,
          max_tokens: 500
        },
        {
          headers: {
            'Authorization': `Bearer ${aiSettings.api_key}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const enhancedText = response.data.choices[0].message.content;
      
      await ctx.reply('✨ <b>النص المحسّن:</b>\n\n' + enhancedText, { parse_mode: 'HTML' });
      await ctx.reply('هل تريد حفظ هذا النص كتعليمات للذكاء الاصطناعي؟', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('✅ نعم، حفظ', 'save_enhanced_' + encodeURIComponent(enhancedText))],
            [Markup.button.callback('❌ لا', 'train_ai')]
          ]
        }
      });
    } catch (error) {
      console.error('Error enhancing text:', error.message);
      await ctx.reply('❌ حدث خطأ أثناء تحسين النص. يرجى المحاولة مرة أخرى.');
    }

    telegramBot.userStates.delete(ctx.from.id);
  }

  if (state.step === 'test_ai_input') {
    if (!aiSettings) {
      await ctx.reply('❌ يجب إعداد DeepSeek API أولاً.');
      telegramBot.userStates.delete(ctx.from.id);
      return;
    }

    try {
      const { default: axios } = require('axios');
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: aiSettings.model || 'deepseek-chat',
          messages: [
            { role: 'system', content: aiSettings.system_prompt || 'أنت مساعد عربي مفيد.' },
            { role: 'user', content: ctx.message.text }
          ],
          temperature: 0.7,
          max_tokens: 500
        },
        {
          headers: {
            'Authorization': `Bearer ${aiSettings.api_key}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const aiReply = response.data.choices[0].message.content;
      
      await ctx.reply('🤖 <b>رد الذكاء الاصطناعي:</b>\n\n' + aiReply, { parse_mode: 'HTML' });
      await ctx.reply('هل تريد تجربة أخرى؟', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('🔄 تجربة أخرى', 'test_ai')],
            [Markup.button.callback('🔙 رجوع', 'train_ai')]
          ]
        }
      });
    } catch (error) {
      console.error('Error testing AI:', error.message);
      await ctx.reply('❌ حدث خطأ. تأكد من صحة API Key.');
    }

    telegramBot.userStates.delete(ctx.from.id);
  }
}

// Setup Gemini
async function handleSetupGemini(ctx, telegramBot) {
  const state = telegramBot.userStates.get(ctx.from.id);

  if (!state || state.action !== 'setup_gemini') {
    telegramBot.userStates.set(ctx.from.id, { action: 'setup_gemini', step: 'api_key' });
    await ctx.reply('🔑 أرسل API Key من Google AI Studio:\n\n(يمكنك الحصول عليه من: https://aistudio.google.com/app/apikey)');
    return;
  }

  if (state.step === 'api_key' && ctx.message) {
    state.apiKey = ctx.message.text;
    state.step = 'system_prompt';
    telegramBot.userStates.set(ctx.from.id, state);
    await ctx.reply('📝 اختياري: أرسل التعليمات للذكاء الاصطناعي (System Prompt)\n\nأو أرسل "تخطي" للاستخدام الافتراضي:');
  } else if (state.step === 'system_prompt') {
    const systemPrompt = ctx.message.text === 'تخطي'
      ? 'أنت مساعد ذكي ومفيد. أجب على الأسئلة بطريقة واضحة ومهذبة.'
      : ctx.message.text;

    const user = await db.getUserByTelegramId(ctx.from.id);
    await db.setAISettings(user.id, 'gemini', state.apiKey, 'gemini-flash-latest', systemPrompt);

    telegramBot.userStates.delete(ctx.from.id);
    await ctx.reply('✅ تم حفظ إعدادات Google Gemini بنجاح!\n\nسيتم الرد تلقائياً على جميع الرسائل الواردة باستخدام Gemini.');
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

// Working Hours Menu
async function showWorkingHoursMenu(ctx) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  const workingHours = await db.getWorkingHours(user.id);

  let message = '⏰ أوقات العمل\n\n';

  if (workingHours.length === 0) {
    message += '❌ لم يتم تحديد أوقات عمل بعد\n\n';
    message += 'عند تحديد أوقات العمل، سيتم إرسال رسالة تلقائية خارج هذه الأوقات.';
  } else {
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    workingHours.forEach(wh => {
      message += `📅 ${days[wh.day_of_week]}: ${wh.start_time} - ${wh.end_time}\n`;
    });
  }

  await ctx.reply(message, Markup.inlineKeyboard([
    [Markup.button.callback('➕ إضافة/تعديل أوقات', 'add_working_hours')],
    [Markup.button.callback('📋 عرض الرسالة الحالية', 'view_hours_message')],
    [Markup.button.callback('🔙 العودة', 'back_dashboard')]
  ]));
}

// Broadcast Menu
async function showBroadcastMenu(ctx) {
  await ctx.reply(
    '📢 إرسال رسالة جماعية\n\nاختر نوع الرسالة:',
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
    // Handle media upload
    let fileId;
    if (ctx.message.photo) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      state.mediaType = 'image';
    } else if (ctx.message.video) {
      fileId = ctx.message.video.file_id;
      state.mediaType = 'video';
    }

    const file = await ctx.telegram.getFile(fileId);
    state.mediaUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    state.step = 'message';
    telegramBot.userStates.set(ctx.from.id, state);
    await ctx.reply('📝 أرسل النص المرفق:');
    return;
  }

  if (state.step === 'message') {
    state.messageText = ctx.message.text;
    state.step = 'recipients';
    telegramBot.userStates.set(ctx.from.id, state);

    const totalContacts = await db.getContactsCount(user.id);

    await ctx.reply(
      `📊 اختر المستلمين:\n\nإجمالي جهات الاتصال: ${totalContacts}`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`✅ الكل (${totalContacts})`, 'broadcast_all')],
        [Markup.button.callback('📅 حسب التاريخ', 'broadcast_date_range')],
        [Markup.button.callback('❌ إلغاء', 'back_dashboard')]
      ])
    );
  }
}

// Confirm and send broadcast
async function confirmBroadcast(ctx, filter, telegramBot) {
  const state = telegramBot.userStates.get(ctx.from.id);
  const user = await db.getUserByTelegramId(ctx.from.id);

  // Get recipients based on filter
  let contacts;
  if (filter === 'all') {
    contacts = await db.getContacts(user.id);
  } else if (filter.dateFrom && filter.dateTo) {
    contacts = await db.getContacts(user.id, filter.dateFrom, filter.dateTo);
  }

  if (contacts.length === 0) {
    await ctx.reply('❌ لا توجد جهات اتصال تطابق المعايير المختارة.');
    return;
  }

  // Build recipients list message
  let recipientsList = '📋 <b>قائمة المستلمين</b>\n\n';
  recipientsList += '━━━━━━━━━━━━━━━━━━━━━\n';
  
  // Show first 15 contacts as preview
  const displayContacts = contacts.slice(0, 15);
  displayContacts.forEach((contact, index) => {
    const name = contact.name || contact.phone_number.split('@')[0];
    const status = contact.first_message_at ? '🟢 نشط' : '⚪ غير نشط';
    recipientsList += `${index + 1}. ${name}\n`;
    recipientsList += `   📱 ${contact.phone_number.split('@')[0]}\n`;
    recipientsList += `   ${status}\n`;
    recipientsList += '━━━━━━━━━━━━━━━━━━━━━\n';
  });

  if (contacts.length > 15) {
    recipientsList += `\n<i>... و ${contacts.length - 15} مستلم آخرين</i>\n`;
  }

  recipientsList += `\n<b>📊 الإجمالي: ${contacts.length} مستلم</b>`;

  // Preview message
  let previewMessage = '\n📋 <b>معاينة الرسالة:</b>\n\n';
  previewMessage += `📝 <b>النص:</b> ${state.messageText}\n`;
  if (state.mediaUrl) {
    previewMessage += `📎 <b>الوسائط:</b> ${state.mediaType === 'image' ? 'صورة' : 'فيديو'}\n`;
  }

  // Send recipients list first
  await ctx.reply(recipientsList, { parse_mode: 'HTML' });
  
  // Then send preview with buttons
  await ctx.reply(
    previewMessage,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('✅ تأكيد والإرسال', 'broadcast_send_now')],
          [Markup.button.callback('📋 عرض القائمة', 'broadcast_show_list')],
          [Markup.button.callback('✏️ تعديل', 'broadcast')],
          [Markup.button.callback('❌ إلغاء', 'back_dashboard')]
        ]
      }
    }
  );

  // Store recipients in state
  state.recipients = contacts;
  state.filter = filter;
  telegramBot.userStates.set(ctx.from.id, state);
}

// Show full recipients list
async function showBroadcastList(ctx, telegramBot) {
  const state = telegramBot.userStates.get(ctx.from.id);
  
  if (!state || !state.recipients) {
    await ctx.reply('❌ لا توجد قائمة مستلمين.');
    return;
  }

  const contacts = state.recipients;
  const totalContacts = contacts.length;
  
  // Send in chunks of 20
  const chunkSize = 20;
  for (let i = 0; i < contacts.length; i += chunkSize) {
    const chunk = contacts.slice(i, i + chunkSize);
    let message = `📋 <b>قائمة المستلمين</b> (${i + 1} - ${Math.min(i + chunkSize, totalContacts)})\n\n`;
    
    chunk.forEach((contact, index) => {
      const name = contact.name || contact.phone_number.split('@')[0];
      const phone = contact.phone_number.split('@')[0];
      const lastMsg = contact.last_message_at ? new Date(contact.last_message_at).toLocaleDateString('ar-EG') : 'N/A';
      message += `${i + index + 1}. ${name}\n`;
      message += `   📱 ${phone}\n`;
      message += `   🕐 آخر رسالة: ${lastMsg}\n`;
      message += '━━━━━━━━━━━━━━━━━━━━━\n';
    });

    await ctx.reply(message, { parse_mode: 'HTML' });
  }

  // Send confirmation buttons
  let previewMessage = '📋 <b>معاينة الرسالة:</b>\n\n';
  previewMessage += `📝 <b>النص:</b> ${state.messageText}\n`;
  if (state.mediaUrl) {
    previewMessage += `📎 <b>الوسائط:</b> ${state.mediaType === 'image' ? 'صورة' : 'فيديو'}\n`;
  }
  previewMessage += `\n<b>📊 الإجمالي: ${totalContacts} مستلم</b>`;

  await ctx.reply(
    previewMessage,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('✅ تأكيد والإرسال', 'broadcast_send_now')],
          [Markup.button.callback('✏️ تعديل', 'broadcast')],
          [Markup.button.callback('❌ إلغاء', 'back_dashboard')]
        ]
      }
    }
  );
}

// Statistics
async function showStatistics(ctx) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  const stats = await db.getUserStats(user.id);
  const contacts = await db.getContacts(user.id);

  // Calculate additional stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayContacts = contacts.filter(c => new Date(c.last_message_at) >= today).length;

  const thisWeek = new Date();
  thisWeek.setDate(thisWeek.getDate() - 7);
  const weekContacts = contacts.filter(c => new Date(c.last_message_at) >= thisWeek).length;

  const message = `
📊 الإحصائيات التفصيلية

👥 جهات الاتصال:
   • الإجمالي: ${stats.totalContacts}
   • اليوم: ${todayContacts}
   • هذا الأسبوع: ${weekContacts}

🤖 الردود التلقائية: ${stats.activeAutoReplies}

📢 الرسائل الجماعية:
   • الإجمالي: ${stats.totalBroadcasts}

📱 الحساب: ${user.phone_number || 'غير متوفر'}
✅ الحالة: متصل
  `;

  await ctx.reply(message, Markup.inlineKeyboard([
    [Markup.button.callback('🔙 العودة', 'back_dashboard')]
  ]));
}

// Handle disconnect
async function handleDisconnect(ctx) {
  await ctx.reply(
    '⚠️ هل أنت متأكد من قطع الاتصال؟\n\nسيتم حذف جميع البيانات المرتبطة بحسابك.',
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ نعم، قطع الاتصال', 'confirm_disconnect')],
      [Markup.button.callback('❌ إلغاء', 'back_dashboard')]
    ])
  );
}

module.exports = {
  showAISettings,
  handleSetupAI,
  handleSetupGemini,
  disableAI,
  handleTrainAI,
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
