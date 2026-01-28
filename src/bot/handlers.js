const { Markup } = require('telegraf');
const db = require('../services/database');
const axios = require('axios');

// AI Settings Handler
async function showAISettings(ctx) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  const aiSettings = await db.getAISettings(user.id);

  let message = '🤖 إعدادات الذكاء الاصطناعي\n\n';
  
  if (aiSettings && aiSettings.is_active) {
    message += `✅ الحالة: مفعّل\n`;
    message += `🔧 النموذج: ${aiSettings.provider}\n`;
    message += `📝 النموذج: ${aiSettings.model || 'افتراضي'}\n\n`;
    message += 'عند تفعيل الذكاء الاصطناعي، سيرد على جميع الرسائل تلقائياً.';
  } else {
    message += '❌ الذكاء الاصطناعي غير مفعّل\n\n';
    message += 'قم بإعداد API Key من DeepSeek للبدء.';
  }

  const buttons = [];
  
  if (!aiSettings || !aiSettings.is_active) {
    buttons.push([Markup.button.callback('🔧 إعداد DeepSeek API', 'setup_ai')]);
  } else {
    buttons.push([Markup.button.callback('⚙️ تعديل الإعدادات', 'setup_ai')]);
    buttons.push([Markup.button.callback('❌ تعطيل AI', 'disable_ai')]);
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

  if (state.step === 'api_key') {
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

  // Preview message
  let previewMessage = '📋 معاينة الرسالة:\n\n';
  previewMessage += `📝 النص: ${state.messageText}\n`;
  if (state.mediaUrl) {
    previewMessage += `📎 الوسائط: ${state.mediaType === 'image' ? 'صورة' : 'فيديو'}\n`;
  }
  previewMessage += `\n👥 عدد المستلمين: ${contacts.length}\n`;

  await ctx.reply(
    previewMessage,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ إرسال الآن', 'broadcast_send_now')],
      [Markup.button.callback('✏️ تعديل', 'broadcast')],
      [Markup.button.callback('❌ إلغاء', 'back_dashboard')]
    ])
  );

  // Store recipients in state
  state.recipients = contacts;
  state.filter = filter;
  telegramBot.userStates.set(ctx.from.id, state);
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
  disableAI,
  showWorkingHoursMenu,
  showBroadcastMenu,
  startBroadcastFlow,
  handleBroadcastFlow,
  confirmBroadcast,
  showStatistics,
  handleDisconnect
};
