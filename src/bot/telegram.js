const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const evolutionAPI = require('../services/evolutionAPI');
const db = require('../services/database');
const { pool } = require('../database/migrate');
const { v4: uuidv4 } = require('uuid');
const { t } = require('./i18n');
const excelService = require('../services/excelService');
const fs = require('fs');
const plisioService = require('../services/plisioService');

class TelegramBot {
  constructor() {
    this.bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    this.channelUsername = process.env.TELEGRAM_CHANNEL_USERNAME;
    this.userStates = new Map(); // To track user states in conversations
    this.socketService = null; // To handle socket connections

    this.setupHandlers();
    this.setupErrorHandler();
  }

  // Set socket service
  setSocketService(socketService) {
    this.socketService = socketService;
    console.log('✅ SocketService linked to TelegramBot');
  }

  // Generate a unique instance name
  async getUniqueInstanceName(baseName, attempt = 0) {
    const originalName = attempt === 0 ? baseName : `${baseName}_${attempt}`;

    try {
      const result = await pool.query(
        'SELECT id FROM users WHERE instance_name = $1',
        [originalName]
      );

      if (result.rows.length === 0) {
        // Name is available
        return originalName;
      } else {
        // Name is taken, try with incremented attempt
        return this.getUniqueInstanceName(baseName, attempt + 1);
      }
    } catch (error) {
      console.error('Error checking instance name availability:', error);
      // If there's a database error, return the original name with timestamp as fallback
      return `${baseName}_${Date.now()}`;
    }
  }

  setupErrorHandler() {
    this.bot.catch((err, ctx) => {
      console.error(`🔴 Telegram Bot Error for ${ctx.updateType}:`, err);
      // Don't crash the app
    });
  }

  setupHandlers() {
    // Connection Check Middleware
    this.bot.use(async (ctx, next) => {
      // Skip check for commands/actions that are necessary for connection, subscription or basic info
      const allowedActions = [
        'connect_whatsapp',
        'subscribe_trial',
        'renew_subscription',
        'contact_admin',
        'show_qr',
        'check_connection',
        'buy_plan',
        'back_dashboard',
        'set_language',
        'main_menu',
        'plans_menu',
        'plisio',
        'lang',
        'admin' // Admin panel has its own check
      ];

      const allowedCommands = ['start', 'admin', 'help', 'id'];

      // Extract command or action name
      let actionName = '';
      if (ctx.callbackQuery && ctx.callbackQuery.data) {
        actionName = ctx.callbackQuery.data.split(':')[0];
      } else if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/')) {
        actionName = ctx.message.text.substring(1).split(' ')[0];
      }

      // If it's a message or callback that we don't recognize as a command/action (like text in conversation),
      // we'll handle it later in handleTextMessage, but we should still check connection there.
      // For now, if no actionName and it's a message, let it through to next handlers.
      if (!actionName && !ctx.callbackQuery) return next();

      // Check if action/command is allowed
      const isAllowed = allowedActions.some(a => actionName && actionName.startsWith(a)) ||
        allowedCommands.includes(actionName);

      if (isAllowed) return next();

      // For all other actions, check if user is connected
      const user = await db.getUserByTelegramId(ctx.from.id);

      // Allow if connected
      if (!user || user.is_connected) return next();

      // User is not connected, block action and prompt for connection
      try {
        if (ctx.callbackQuery) await ctx.answerCbQuery();
      } catch (e) { }

      const lang = user.language || 'ar';
      return ctx.reply(lang === 'ar' ? '⚠️ <b>عذراً، يجب عليك ربط حسابك بالواتساب أولاً لاستخدام هذه الميزة.</b>' : '⚠️ <b>Sorry, you must connect your WhatsApp first to use this feature.</b>', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback(lang === 'ar' ? '🔗 ربط واتساب الآن' : '🔗 Connect WhatsApp Now', 'connect_whatsapp')],
            [Markup.button.callback(lang === 'ar' ? '🔙 العودة للقائمة الرئيسية' : '🔙 Back to Main Menu', 'back_dashboard')]
          ]
        }
      });
    });

    // Start command
    this.bot.start(async (ctx) => {
      const telegramId = ctx.from.id;
      const username = ctx.from.username;

      // Create or get user
      await db.createUser(telegramId, username);

      // Check subscription status
      const subscription = await db.checkSubscriptionStatus(telegramId);

      // If no subscription or expired, try to auto-activate trial
      if (!subscription.active) {
        const user = await db.getUserByTelegramId(telegramId);

        // Only activate trial if never used before
        if (user && !user.trial_used) {
          await db.activateTrial(telegramId);
          await this.notifyAdminNewUser(ctx);
        } else {
          // If trial already used, just show main menu or subscription required menu
          // depending on whether they need to subscribe to channel
          const channelSettings = await db.getChannelSettings();
          if (channelSettings && channelSettings.is_enabled) {
            const isSubscribed = await this.checkSubscription(ctx);
            if (!isSubscribed) {
              await this.showSubscriptionRequired(ctx);
              return;
            }
          }
          await this.showMainMenu(ctx);
          return;
        }

        // Check channel subscription for the newly activated trial user
        const channelSettings = await db.getChannelSettings();
        if (channelSettings && channelSettings.is_enabled) {
          const isSubscribed = await this.checkSubscription(ctx);
          if (!isSubscribed) {
            await this.showSubscriptionRequired(ctx);
            return;
          }
        }

        await this.showMainMenu(ctx);
        return;
      }

      // Check if channel subscription is required
      const channelSettings = await db.getChannelSettings();

      if (channelSettings && channelSettings.is_enabled) {
        // Check subscription
        const isSubscribed = await this.checkSubscription(ctx);

        if (!isSubscribed) {
          await this.showSubscriptionRequired(ctx);
        } else {
          await db.updateUserVerification(telegramId, true);
          await this.showMainMenu(ctx);
        }
      } else {
        await this.showMainMenu(ctx);
      }
    });

    // Admin Panel Command
    this.bot.command('admin', async (ctx) => {
      const telegramId = ctx.from.id;
      const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';

      if (String(telegramId) !== String(adminId)) {
        await ctx.reply('⛔ <b>عذراً، هذه الخاصية للأدمن فقط!</b>\n\nللمساعدة تواصل مع المالك:', {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.url('📞 联系管理员', `https://wa.me/447413076745`)]
            ]
          }
        });
        return;
      }

      await this.showAdminPanel(ctx);
    });

    // Handle Media Uploads
    this.bot.on(['photo', 'video', 'document', 'animation'], async (ctx) => {
      const state = this.userStates.get(ctx.from.id);
      if (state && state.action === 'add_auto_reply' && state.step === 'media_upload') {
        const handlers = require('./handlers');
        await handlers.handleAddAutoReply(ctx, this);
      } else if (state && state.action === 'broadcast' && state.step === 'media') {
        const handlers = require('./handlers');
        await handlers.handleBroadcastFlow(ctx, state, this);
      }
    });

    // Unified Subscription Verification
    this.bot.action(['verify_subscription', 'check_subscription'], async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(() => { });
      } catch (e) { }

      const isSubscribed = await this.checkSubscription(ctx);

      if (!isSubscribed) {
        // Fetch settings again to show the correct link in the error if needed
        const settings = await db.getChannelSettings();
        const channelName = settings?.channel_name || 'القناة';
        await ctx.reply(`❌ <b>لم يتم التحقق</b>\n\nيجب أن تكون مشتركاً في ${channelName} أولاً ثم الضغط على زر التحقق.`, { parse_mode: 'HTML' });
      } else {
        await db.updateUserVerification(ctx.from.id, true);
        await ctx.reply('✅ <b>تم التحقق بنجاح!</b>\n\nشكراً لاشتراكك، يمكنك الآن استخدام كافة مميزات البوت. 🎉', { parse_mode: 'HTML' });
        await this.showMainMenu(ctx);
      }
    });

    // Connect WhatsApp
    this.bot.action('connect_whatsapp', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const user = await db.getUserByTelegramId(ctx.from.id);

      if (user.is_connected) {
        await ctx.reply('✅ أنت متصل بالفعل!');
        await this.showDashboard(ctx);
        return;
      }

      // Ask for all data at once
      this.userStates.set(ctx.from.id, { action: 'connect_whatsapp', step: 'input_data' });
      await ctx.reply('🔗 <b>ربط واتساب</b>\n\nالرجاء إرسال البيانات بالصيغة التالية:\n\n`Name*Channel*Token*Number`\n\n' +
        '<b>جميع الحقول إلزامية:</b>\n\n' +
        '📝 <b>Name</b>: اسم الجلسة (4 أحرف أو أكثر)\n' +
        '📢 <b>Channel</b>: القناة (5 أحرف أو أكثر)\n' +
        '🔑 <b>Token</b>: التوكن (10 أحرف وأرقام)\n' +
        '📱 <b>Number</b>: رقم الهاتف مع مفتاح الدولة\n\n' +
        '<b>مثال:</b>\nMySession*MyChannel*Tok123en456*+967771234567',
        { parse_mode: 'HTML' });
    });

    // Dashboard
    this.bot.action('dashboard', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.showDashboard(ctx);
    });

    // Change Language Menu
    this.bot.action('change_language', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      const user = await db.getUserByTelegramId(ctx.from.id);
      const lang = user.language || 'ar';

      await ctx.reply(
        t('select_language', lang),
        Markup.inlineKeyboard([
          [Markup.button.callback('🇸🇦 العربية', 'set_lang_ar')],
          [Markup.button.callback('🇺🇸 English', 'set_lang_en')],
          [Markup.button.callback('🇫🇷 Français', 'set_lang_fr')],
          [Markup.button.callback('🇩🇪 Deutsch', 'set_lang_de')],
          [Markup.button.callback(t('back', lang), 'back_dashboard')]
        ])
      );
    });

    // Set Language Action
    this.bot.action(/^set_lang_(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      const lang = ctx.match[1];
      const handlers = require('./handlers');
      await handlers.handleSetLanguage(ctx, lang);
      await this.showDashboard(ctx);
    });

    // Auto Replies Menu
    this.bot.action('auto_replies', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.showAutoRepliesMenu(ctx);
    });

    // Add Auto Reply
    this.bot.action('add_auto_reply', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      this.userStates.set(ctx.from.id, { action: 'add_auto_reply', step: 'keyword' });
      await ctx.reply('📝 أرسل الكلمة المفتاحية (مثال: السعر، الموقع، ساعات العمل)');
    });

    // View Auto Replies
    this.bot.action('view_auto_replies', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.showAutoRepliesList(ctx);
    });

    // AI Settings
    this.bot.action('ai_settings', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.showAISettings(ctx);
    });

    // Media Type Selection
    this.bot.action(/^media_type_(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      const type = ctx.match[1];
      const state = this.userStates.get(ctx.from.id);
      if (!state) return;

      if (type === 'none') {
        const handlers = require('./handlers');
        await handlers.finishAutoReply(ctx, this);
        return;
      }

      if (type === 'url') {
        state.step = 'media_url_input';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('🔗 من فضلك أرسل "الرابط المباشر" للوسائط (صورة، فيديو، أو ملف):');
        return;
      }

      state.step = 'media_upload';
      state.pendingMediaType = type;
      this.userStates.set(ctx.from.id, state);

      const typeLabels = {
        image: 'صورة',
        video: 'فيديو',
        document: 'ملف/مستند'
      };

      const typeLabel = typeLabels[type] || 'وسائط';
      await ctx.reply(`📤 من فضلك أرسل الـ ${typeLabel} الآن:`);
    });

    // URL Type Selection
    this.bot.action(/^url_type_(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      const type = ctx.match[1];
      const handlers = require('./handlers');
      await handlers.handleURLTypeSelection(ctx, type, this);
    });



    // Auto Reply Media Choice
    this.bot.action(/^ar_media_(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const type = ctx.match[1];
      const state = this.userStates.get(ctx.from.id);
      if (!state) return;

      const handlers = require('./handlers');
      if (type === 'none') {
        await handlers.finishAutoReply(ctx, state, this);
      } else {
        state.step = 'media_upload';
        state.pendingMediaType = type;
        this.userStates.set(ctx.from.id, state);
        await ctx.reply(`📤 من فضلك أرسل الـ ${type === 'image' ? 'صورة' : 'فيديو'} الآن:`);
      }
    });

    // Delete Auto Reply List
    this.bot.action('delete_auto_reply', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.showAutoReplyDeletionList(ctx);
    });

    // Confirm Delete Auto Reply
    this.bot.action(/^del_rep:(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const keyword = ctx.match[1];
      const user = await db.getUserByTelegramId(ctx.from.id);

      await db.deleteAutoReply(user.id, keyword);
      await ctx.reply(`✅ تم حذف الرد التلقائي للكلمة: "${keyword}"`);
      await this.showAutoReplyDeletionList(ctx);
    });

    // Pause AI Action
    this.bot.action(/^pause_ai:(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const phoneNumber = ctx.match[1];
      const user = await db.getUserByTelegramId(ctx.from.id);
      await db.setAIPauseState(user.id, phoneNumber, true);
      await ctx.reply(`⏸️ تم إيقاف الذكاء الاصطناعي للرقم: ${phoneNumber}. يمكنك الآن الرد يدوياً.`);
    });

    // Broadcast Menu
    this.bot.action('broadcast', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.showBroadcastMenu(ctx);
    });

    // Statistics
    this.bot.action('statistics', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.showStatistics(ctx);
    });

    // Disconnect
    this.bot.action('disconnect', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.handleDisconnect(ctx);
    });

    // Back to Dashboard
    this.bot.action('back_dashboard', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.showDashboard(ctx);
    });

    // Order Reports Menu
    this.bot.action('order_reports', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.showOrderReports(ctx);
    });

    // Order Reports Actions
    this.bot.action('report_24h', async (ctx) => {
      const handlers = require('./handlers');
      await handlers.handleGetOrderReport(ctx, '24h');
    });

    this.bot.action('report_month', async (ctx) => {
      const handlers = require('./handlers');
      await handlers.handleGetOrderReport(ctx, 'month');
    });

    this.bot.action('export_report_24h', async (ctx) => {
      const handlers = require('./handlers');
      await handlers.handleGetOrderExport(ctx, '24h');
    });

    this.bot.action('export_report_month', async (ctx) => {
      const handlers = require('./handlers');
      await handlers.handleGetOrderExport(ctx, 'month');
    });

    // Store Settings
    this.bot.action('store_settings', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.showStoreSettings(ctx);
    });

    // Set Store Name
    this.bot.action('set_store_name', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      this.userStates.set(ctx.from.id, { action: 'set_store_name', step: 'input' });
      await ctx.reply('🏪 <b>إعداد اسم المتجر</b>\n\nيرجى إرسال اسم المتجر أو المطعم الذي سيظهر في الفواتير:', { parse_mode: 'HTML' });
    });

    // Set Google Maps Link
    this.bot.action('set_google_maps', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      this.userStates.set(ctx.from.id, { action: 'set_google_maps', step: 'input' });
      await ctx.reply('📍 <b>إعداد جوجل ماب</b>\n\nيرجى إرسال رابط موقعك على خرائط جوجل:', { parse_mode: 'HTML' });
    });

    // Handle Order Status Change
    this.bot.action(/^ord_st:(.+):(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const status = ctx.match[1];
      const phoneNumber = ctx.match[2];
      const handlers = require('./handlers');
      await handlers.handleOrderStatusChange(ctx, status, phoneNumber, this);
    });

    // Handle text messages (for conversations)
    this.bot.on('text', async (ctx) => {
      await this.handleTextMessage(ctx);
    });

    // Handle photo messages
    this.bot.on('photo', async (ctx) => {
      await this.handlePhotoMessage(ctx);
    });

    // Handle video messages
    this.bot.on('video', async (ctx) => {
      await this.handleVideoMessage(ctx);
    });

    // Handle document messages
    this.bot.on('document', async (ctx) => {
      await this.handleDocumentMessage(ctx);
    });

    // AI Settings menu
    this.bot.action('ai_settings', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.showAISettings(ctx);
    });



    // Additional action handlers
    this.bot.action('setup_ai', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.handleSetupAI(ctx, this);
    });

    // AI Language Selection
    this.bot.action(/^ai_lang_(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      const lang = ctx.match[1];
      const state = this.userStates.get(ctx.from.id);
      if (state) {
        state.language = lang;
        state.step = 'system_prompt';
        this.userStates.set(ctx.from.id, state);

        await ctx.reply('📝 <b>أرسل التعليمات (System Prompt)</b>\n\n' +
          'صف كيف تريد أن يرد الذكاء الاصطناعي. مثال:\n' +
          '"أنت مساعد حجز فنادق. أجب على استفسارات العملاء حول الغرف والأسعار والحجز."',
          { parse_mode: 'HTML' });
      }
    });

    this.bot.action('disable_ai', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.disableAI(ctx);
    });

    this.bot.action('train_ai', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.handleTrainAI(ctx, this);
    });

    // Train AI - Simple
    this.bot.action('train_simple', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      this.userStates.set(ctx.from.id, { action: 'train_ai', step: 'simple_prompt' });
      await ctx.reply('📝 <b>تعليمات بسيطة</b>\n\nأخبر البوت بدوره مثلا:\n• "مساعد حجز فنادق"\n• "مساعد مبيعات"\n• "دعم فني"\n\nأرسل دور البوت الآن:', { parse_mode: 'HTML' });
    });

    // Train AI - Advanced
    this.bot.action('train_advanced', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      this.userStates.set(ctx.from.id, { action: 'train_ai', step: 'advanced_prompt' });
      let message = '📝 <b>تدريب متقدم</b>\n\nأرسل التعليمات التفصيلية للذكاء الاصطناعي:\n\n';
      message += '━━━━━━━━━━━━━━━━━━━━━\n';
      message += '<b>مثال للتدريب:</b>\n';
      message += 'أنت مساعد حجز تذاكر طيران.\n';
      message += '- ابرد بإجابات قصيرة\n';
      message += '- إذا سألوا عن سعر، اذكر السعر فقط\n';
      message += '- لا تضيف كلام غير ضروري\n';
      message += '- استخدم لغة عربية فصحى\n';
      message += '━━━━━━━━━━━━━━━━━━━━━';
      await ctx.reply(message, { parse_mode: 'HTML' });
    });

    // Enhance Response
    this.bot.action('enhance_response', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      this.userStates.set(ctx.from.id, { action: 'train_ai', step: 'enhance_prompt' });
      await ctx.reply('✨ <b>تحسين الرد</b>\n\nأرسل النص الذي تريد تحسينه و إعادة كتابته بشكل أفضل و أكثر احترافية:', { parse_mode: 'HTML' });
    });

    // Test AI
    this.bot.action('test_ai', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      this.userStates.set(ctx.from.id, { action: 'train_ai', step: 'test_ai_input' });
      await ctx.reply('🧪 <b>اختبار الذكاء الاصطناعي</b>\n\nأرسل رسالة للذكاء الاصطناعي للرد عليها:', { parse_mode: 'HTML' });
    });

    // Save Enhanced Prompt
    this.bot.action(/save_enhanced_(.+)/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      const enhancedText = ctx.match[1];
      const user = await db.getUserByTelegramId(ctx.from.id);
      const aiSettings = await db.getAISettings(user.id);

      if (!aiSettings) {
        await ctx.reply('❌ يجب إعداد DeepSeek API أولاً.');
        return;
      }

      await db.setAISettings(user.id, aiSettings.provider, aiSettings.api_key, aiSettings.model, enhancedText);

      await ctx.reply('✅ <b>تم حفظ النص المحسّن بنجاح!</b>', { parse_mode: 'HTML' });
      const handlers = require('./handlers');
      await handlers.showAISettings(ctx);
    });

    // Export Orders
    this.bot.action('export_orders', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.handleExportOrders(ctx);
    });


    // ChatGPT (OpenAI) setup
    this.bot.action('setup_chatgpt', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.handleSetupChatGPT(ctx, this);
    });

    // Google Sheets setup
    this.bot.action('setup_sheets', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.handleSheetsSetup(ctx, this);
    });

    // Toggle notifications
    this.bot.action('toggle_notifications', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.handleToggleNotifications(ctx);
    });


    this.bot.action('broadcast_text', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.startBroadcastFlow(ctx, 'text', this);
    });

    this.bot.action('broadcast_image', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.startBroadcastFlow(ctx, 'image', this);
    });

    this.bot.action('broadcast_video', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.startBroadcastFlow(ctx, 'video', this);
    });

    this.bot.action('broadcast_all', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.confirmBroadcast(ctx, 'all', this);
    });

    // Broadcast by date range
    this.bot.action('broadcast_date_range', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      // Set state to wait for date input
      const state = this.userStates.get(ctx.from.id);
      if (state) {
        state.step = 'broadcast_date';
        state.dateStep = 'from';
        this.userStates.set(ctx.from.id, state);
      }

      await ctx.reply(
        '📅 إرسال حسب التاريخ\n\n' +
        'أرسل تاريخ البداية بالتنسيق التالي:\n' +
        'مثال: 01/01/2026\n\n' +
        'أو أرسل "1" للرسائل اليومية\n' +
        'أرسل "7" للأسبوع الماضي\n' +
        'أرسل "30" للشهر الماضي'
      );
    });

    this.bot.action('broadcast_send_now', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      const state = this.userStates.get(ctx.from.id);
      console.log('📤 Broadcast send - State:', JSON.stringify(state));

      if (!state || !state.recipients || state.recipients.length === 0) {
        await ctx.reply('❌ لا توجد جهات اتصال. يرجى إنشاء قائمة المستلمين أولاً.');
        return;
      }

      await this.executeBroadcast(ctx);
    });

    // Show full recipients list
    this.bot.action('broadcast_show_list', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      const handlers = require('./handlers');
      await handlers.showBroadcastList(ctx, this);
    });

    // Back to main menu
    this.bot.action('back_main', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.showMainMenu(ctx);
    });

    // Admin Panel Actions
    this.bot.action('admin_panel', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.reply('⛔ عذراً، هذه الخاصية للأدمن فقط!');
        return;
      }
      await this.showAdminPanel(ctx);
    });

    this.bot.action('admin_users', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.handleAdminAction(ctx, 'admin_users');
    });

    this.bot.action('admin_channel', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.handleAdminAction(ctx, 'admin_channel');
    });

    this.bot.action('admin_stats', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.handleAdminAction(ctx, 'admin_stats');
    });

    this.bot.action('admin_settings', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.handleAdminAction(ctx, 'admin_settings');
    });

    // Admin: Manage subscription plans
    this.bot.action('admin_manage_plans', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.showSubscriptionPlansManagement(ctx);
    });

    // Admin: Activate user subscription
    this.bot.action('admin_activate_user', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.showActivateUserSubscription(ctx);
    });

    // Admin: Activate trial for user
    this.bot.action('admin_activate_trial', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      this.userStates.set(ctx.from.id, { action: 'admin_activate_subscription', planId: 1 });
      await ctx.reply('أرسل معرف المستخدم (Telegram ID) لتفعيل التجربة المجانية:');
    });

    // Admin: Activate monthly for user
    this.bot.action('admin_activate_monthly', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      this.userStates.set(ctx.from.id, { action: 'admin_activate_subscription', planId: 2 });
      await ctx.reply('أرسل معرف المستخدم (Telegram ID) لتفعيل الاشتراك الشهري:');
    });

    // Admin: Activate yearly for user
    this.bot.action('admin_activate_yearly', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      this.userStates.set(ctx.from.id, { action: 'admin_activate_subscription', planId: 3 });
      await ctx.reply('أرسل معرف المستخدم (Telegram ID) لتفعيل الاشتراك السنوي:');
    });

    // Admin: Add new subscription plan
    this.bot.action('admin_add_plan', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.reply('⛔ عذراً، هذه الخاصية للأدمن فقط!');
        return;
      }
      this.userStates.set(ctx.from.id, { action: 'admin_add_plan', step: 'name' });
      await ctx.reply('📝 <b>إضافة خطة جديدة</b>\n\nأرسل اسم الخطة (بالعربية):', { parse_mode: 'HTML' });
    });

    // Admin: Edit subscription plan
    this.bot.action(/admin_edit_plan_(\d+)/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.reply('⛔ عذراً، هذه الخاصية للأدمن فقط!');
        return;
      }
      const planId = parseInt(ctx.match[1]);
      this.userStates.set(ctx.from.id, { action: 'admin_edit_plan', planId: planId, step: 'name' });
      await ctx.reply('📝 <b>تعديل الخطة</b>\n\nأرسل اسم الخطة الجديد (بالعربية):', { parse_mode: 'HTML' });
    });

    // Admin: Delete subscription plan
    this.bot.action(/admin_delete_plan_(\d+)/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.reply('⛔ عذراً، هذه الخاصية للأدمن فقط!');
        return;
      }
      const planId = parseInt(ctx.match[1]);

      const deleted = await db.deleteSubscriptionPlan(planId);

      if (deleted) {
        await ctx.reply('✅ <b>تم حذف الخطة بنجاح!</b>', { parse_mode: 'HTML' });
      } else {
        await ctx.reply('❌ <b>لم يتم العثور على الخطة!</b>', { parse_mode: 'HTML' });
      }

      await this.showSubscriptionPlansManagement(ctx);
    });

    this.bot.action('admin_add_channel', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.reply('⛔ عذراً، هذه الخاصية للأدمن فقط!');
        return;
      }
      this.userStates.set(ctx.from.id, { action: 'admin_add_channel', step: 'name' });
      await ctx.reply('📢 <b>إضافة قناة/مجموعة</b>\n\nأرسل اسم القناة أو المجموعة:', { parse_mode: 'HTML' });
    });

    this.bot.action('admin_enable_channel', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.reply('⛔ عذراً، هذه الخاصية للأدمن فقط!');
        return;
      }
      await db.toggleChannelSubscription(true);
      await ctx.reply('✅ تم تفعيل الاشتراك الإجباري!');
      await this.showChannelSettings(ctx);
    });

    this.bot.action('admin_disable_channel', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.reply('⛔ عذراً، هذه خاصية للأدمن فقط!');
        return;
      }
      await db.toggleChannelSubscription(false);
      await ctx.reply('❌ تم إلغاء تفعيل الاشتراك الإجباري!');
      await this.showChannelSettings(ctx);
    });


    // Subscribe to trial
    this.bot.action('subscribe_trial', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      // Check if trial already used
      const user = await db.getUserByTelegramId(ctx.from.id);
      if (user && user.trial_used && user.subscription_type !== 'تجربة مجانية') {
        await ctx.reply('❌ <b>عذراً، لقد استنفذت حقك في التجربة المجانية سابقاً!</b>\n\nيرجى اختيار أحد خطط الاشتراك المدفوعة للاستمرار.', { parse_mode: 'HTML' });
        await this.showSubscriptionPlans(ctx);
        return;
      }

      // Activate trial
      await db.activateTrial(ctx.from.id);

      await ctx.reply('🎉 <b>تم تفعيل التجربة المجانية!</b>\n\n📅 لمدة 7 أيام\n✅ جميع المميزات متاحة\n\nاستمتع بالبوت!', { parse_mode: 'HTML' });

      // Check channel subscription
      const channelSettings = await db.getChannelSettings();
      if (channelSettings && channelSettings.is_enabled) {
        const isSubscribed = await this.checkSubscription(ctx);
        if (!isSubscribed) {
          await this.showSubscriptionRequired(ctx);
          return;
        }
      }

      await this.showMainMenu(ctx);
    });

    // Contact admin for subscription
    this.bot.action('contact_admin', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      await ctx.reply('💬 <b>للاشتراك تواصل معنا:</b>\n\n📞 +447413076745\n\n👈 او اضغط للدردشة', {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.url('📞 واتساب', 'https://wa.me/447413076745')]
          ]
        }
      });
    });

    // Renew subscription
    this.bot.action('renew_subscription', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }

      await this.showSubscriptionPlans(ctx);
    });

    // Buy plan (Redirect to Plisio)
    this.bot.action(/^buy_plan_(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const planId = ctx.match[1];
      await this.handleBuyPlan(ctx, planId);
    });

    // Notify admin about new user
    async function notifyAdminNewUser(ctx) {
      const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';
      const user = await db.getUserByTelegramId(ctx.from.id);

      const message = `🆕 <b>مستخدم جديد!</b>\n\n` +
        `━━━━━━━━━━━━━━━\n` +
        `👤 الاسم: ${ctx.from.first_name || 'غير معروف'}\n` +
        `🆔 المعرف: ${ctx.from.id}\n` +
        `📋 username: @${ctx.from.username || 'غير موجود'}\n` +
        `📅 الوقت: ${new Date().toLocaleString('ar')}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `🎁 تم تفعيل تجربة مجانية 7 أيام`;

      try {
        await ctx.telegram.sendMessage(adminId, message, { parse_mode: 'HTML' });
      } catch (e) {
        console.error('Error sending admin notification:', e.message);
      }
    }
    this.notifyAdminNewUser = notifyAdminNewUser;

    this.bot.action('confirm_disconnect', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.confirmDisconnect(ctx);
    });

    // Admin: View User Details
    this.bot.action(/admin_user_(\d+)/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.reply('⛔ عذراً، هذه الخاصية للأدمن فقط!');
        return;
      }
      const telegramId = ctx.match[1];
      await this.showUserDetails(ctx, telegramId);
    });

    // Admin: Disconnect User
    this.bot.action(/admin_disconnect_(\d+)/, async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';
      if (String(ctx.from.id) !== String(adminId)) {
        await ctx.reply('⛔ عذراً، هذه الخاصية للأدمن فقط!');
        return;
      }
      const telegramId = ctx.match[1];
      const user = await db.getUserByTelegramId(telegramId);
      if (!user) {
        await ctx.reply('❌ المستخدم غير موجود');
        return;
      }

      // Delete instance from Evolution API
      if (user.instance_name) {
        try {
          await evolutionAPI.deleteInstance(user.instance_name);
        } catch (e) {
          console.error('Error deleting instance:', e.message);
        }
      }

      // Update user in database
      await pool.query(
        "UPDATE users SET is_connected = false, instance_name = NULL, instance_token = NULL WHERE telegram_id = $1",
        [telegramId]
      );

      await ctx.reply('✅ تم قطع اتصال المستخدم بنجاح!');
      await this.showUserDetails(ctx, telegramId);
    });
  }

  // Check if user is subscribed to channel
  async checkSubscription(ctx) {
    try {
      const settings = await db.getChannelSettings();
      if (!settings || !settings.is_enabled || !settings.channel_link) {
        return true; // Not required or not set
      }

      let channelId = settings.channel_link;

      // Robust parsing of Telegram links
      // Handle https://t.me/username
      if (channelId.includes('t.me/')) {
        const parts = channelId.split('t.me/');
        const identifier = parts[1].split('/')[0].split('?')[0];

        // If it's a joinchat or + format, it's a private link and cannot be verified by username
        // The bot MUST be an admin in the channel to check members by ID/Username
        if (identifier.startsWith('+') || identifier.startsWith('joinchat')) {
          console.warn('⚠️ Cannot verify membership for private join links via getChatMember without numeric ID.');
          // If we have a numeric ID saved in name or elsewhere we could use it, 
          // but for now, we'll try to treat it as a public username if it doesn't have +
          channelId = identifier;
        } else {
          channelId = '@' + identifier;
        }
      }

      // If the link starts with @ already, use it
      if (!channelId.startsWith('@') && !channelId.startsWith('-100') && !isNaN(channelId)) {
        // Likely a numeric ID
      } else if (!channelId.startsWith('@') && isNaN(channelId)) {
        channelId = '@' + channelId;
      }

      const member = await ctx.telegram.getChatMember(channelId, ctx.from.id);
      return ['creator', 'administrator', 'member'].includes(member.status);
    } catch (error) {
      console.error('Error checking subscription:', error.message);
      // If error is "chat not found", it might be a private link problem
      if (error.message.includes('chat not found')) {
        console.error('❌ Bot cannot find the channel. Make sure the bot is an ADMIN in the channel/group.');
      }
      return false;
    }
  }

  // Show subscription required message
  async showSubscriptionRequired(ctx) {
    // Check if there's a custom channel set
    const channelSettings = await db.getChannelSettings();

    // If channel subscription is not required, skip this screen
    if (!channelSettings || !channelSettings.is_enabled) {
      await this.showMainMenu(ctx);
      return;
    }

    let channelLink = channelSettings.channel_link || `https://t.me/${this.channelUsername.replace('@', '')}`;
    let channelName = channelSettings.channel_name || 'القناة';

    // Ensure channel link is a valid URL
    if (!channelLink.startsWith('http')) {
      channelLink = `https://t.me/${channelLink.replace('@', '')}`;
    }

    let message = '🔐 <b>مرحباً بك في بوت واتساب الآلي!</b>\n\n';
    message += 'للاستخدام، يجب الاشتراك في ' + channelName + ' أولاً:\n\n';
    message += '📢 اضغط على الزر أدناه للاشتراك، ثم اضغط "تحقق من الاشتراك"';

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.url('📢 اشتراك في ' + channelName, channelLink)],
          [Markup.button.callback('✅ تحقق من الاشتراك', 'verify_subscription')]
        ]
      }
    });
  }

  // Show main menu after subscription
  async showMainMenu(ctx) {
    const user = await db.getUserByTelegramId(ctx.from.id);
    const subscription = await db.checkSubscriptionStatus(ctx.from.id);
    const lang = user.language || 'ar';

    let message = '';

    // Check subscription status
    if (!subscription.active) {
      // Show subscription required message
      message = t('subscription_required', lang) + '\n\n';
      message += t('subscription_needed', lang) + '\n\n';

      if (subscription.reason === 'expired') {
        message += t('expired', lang) + '\n\n';
      } else if (subscription.reason === 'inactive') {
        message += t('inactive', lang) + '\n\n';
      }

      if (user && !user.trial_used) {
        message += t('trial', lang) + '\n';
        message += t('all_features', lang) + '\n';
      }

      message += t('monthly', lang) + '\n';
      message += t('features_plus_support', lang) + '\n';
      message += t('yearly', lang) + '\n';
      message += t('all_features_support_discount', lang) + '\n\n';
      message += t('contact_to_subscribe', lang) + '\n';
      message += '+447413076745\n\n';
      message += t('or_subscribe_channel', lang) + '\n';
      message += 'https://t.me/mstoviral';

      const buttons = [];
      if (user && !user.trial_used) {
        buttons.push([Markup.button.callback(t('trial_button', lang), 'subscribe_trial')]);
      }
      buttons.push([Markup.button.callback(t('renew_subscription', lang), 'renew_subscription')]);
      buttons.push([Markup.button.callback(t('contact_button', lang), 'contact_admin')]);

      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      });
      return;
    }

    // User has active subscription
    const expiresDate = new Date(subscription.expires).toLocaleDateString(lang === 'ar' ? 'ar-EG' : lang === 'fr' ? 'fr-FR' : lang === 'de' ? 'de-DE' : 'en-US');
    message = t('welcome', lang) + '\n\n';
    message += t('subscription_active', lang) + ' ' + subscription.type + '\n';
    message += t('expires', lang) + ' ' + expiresDate + '\n\n';
    message += '━━━━━━━━━━━━━━━\n\n';
    message += t('features_available', lang) + '\n\n';
    message += t('feature_whatsapp', lang) + '\n';
    message += t('feature_autoreplies', lang) + '\n';
    message += t('feature_ai', lang) + '\n';
    message += t('feature_broadcast', lang) + '\n';
    message += t('feature_stats', lang) + '\n\n';
    message += '━━━━━━━━━━━━━━━';

    const buttons = [];

    if (!user.is_connected) {
      buttons.push([Markup.button.callback(t('connect_whatsapp', lang), 'connect_whatsapp')]);
    } else {
      buttons.push([Markup.button.callback(t('dashboard_title', lang), 'dashboard')]);
    }

    buttons.push([Markup.button.callback(t('renew_subscription', lang), 'renew_subscription')]);

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons }
    });
  }

  // Show subscription plans
  async showSubscriptionPlans(ctx) {
    const plans = await db.getSubscriptionPlans();

    let message = '💳 <b>خطط الاشتراك</b>\n\n';
    message += '━━━━━━━━━━━━━━━\n';

    for (const plan of plans) {
      const priceDisplay = plan.price_usd > 0
        ? `${plan.price_usd}$ / ${plan.price_iqd} IQD`
        : 'مجاني';

      message += `\n<b>${plan.name}</b>\n`;
      message += `⏰ المدة: ${plan.duration_days} يوم\n`;
      message += `💰 السعر: ${priceDisplay}\n`;

      if (plan.features && plan.features.length > 0) {
        message += `✅ المميزات:\n`;
        plan.features.forEach(f => message += `   • ${f}\n`);
      }
      message += '━━━━━━━━━━━━━━━\n';
    }

    message += '\n💬 للاشتراك الشهري أو السنوي:\n';
    message += '📞 +447413076745';

    const user = await db.getUserByTelegramId(ctx.from.id);
    const buttons = [];

    // Only show trial button if never used
    if (user && !user.trial_used) {
      buttons.push([Markup.button.callback('🎁 تجربة مجانية 7 أيام', 'subscribe_trial')]);
    }

    // Add buttons for each paid plan
    for (const plan of plans) {
      buttons.push([Markup.button.callback(`💳 ${plan.name} (${plan.price_usd}$)`, `buy_plan_${plan.id}`)]);
    }

    buttons.push([Markup.button.callback('📞 تواصل للاشتراك', 'contact_admin')]);
    buttons.push([Markup.button.callback('🔙 رجوع', 'back_main')]);

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons }
    });
  }

  // Handle Buy Plan
  async handleBuyPlan(ctx, planId) {
    const telegramId = ctx.from.id;
    const user = await db.getUserByTelegramId(telegramId);
    const lang = user.language || 'ar';

    try {
      const plan = await db.getSubscriptionPlan(planId);
      if (!plan) {
        await ctx.reply('❌ Plan not found');
        return;
      }

      // Check for existing pending invoice
      const existingInvoice = await db.getPendingInvoice(telegramId, planId);
      if (existingInvoice) {
        await ctx.reply(t('payment_already_exists', lang), {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [Markup.button.url(t('pay_with_crypto', lang), existingInvoice.invoice_url)],
              [Markup.button.callback(t('back', lang), 'renew_subscription')]
            ]
          }
        });
        return;
      }

      const baseUrl = process.env.BASE_URL || 'https://bot.magicaikrd.com';
      const callbackUrl = `${baseUrl}/api/payment/plisio-webhook`;

      const invoice = await plisioService.createInvoice({
        order_number: `${telegramId}:${planId}`,
        amount: plan.price_usd,
        order_name: `Subscription: ${plan.name}`,
        callback_url: callbackUrl,
        success_url: `https://t.me/${ctx.botInfo.username}`
      });

      // Save invoice to database
      // Plisio invoice expires in 1 hour by default
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      await db.savePaymentInvoice(
        telegramId,
        planId,
        invoice.invoice_url,
        invoice.txn_id || invoice.id, // txn_id is Plisio's ID
        expiresAt
      );

      await ctx.reply(t('payment_link_sent', lang), {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [Markup.button.url(t('pay_with_crypto', lang), invoice.invoice_url)],
            [Markup.button.callback(t('back', lang), 'renew_subscription')]
          ]
        }
      });

    } catch (error) {
      console.error('Error creating Plisio invoice:', error.message);
      await ctx.reply('❌ <b>حدث خطأ أثناء إنشاء رابط الدفع</b>\nالرجاء المحاولة مرة أخرى لاحقاً أو التواصل مع الدعم.', { parse_mode: 'HTML' });
    }
  }

  // Admin Panel
  async showAdminPanel(ctx) {
    let message = '🛠 <b>لوحة الأدمن</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━\n';
    message += '📊 <b>إحصائيات النظام:</b>\n\n';

    // Get stats
    const totalUsers = await pool.query('SELECT COUNT(*) as count FROM users');
    const connectedUsers = await pool.query('SELECT COUNT(*) as count FROM users WHERE is_connected = true');
    const totalContacts = await pool.query('SELECT COUNT(*) as count FROM contacts');
    const totalBroadcasts = await pool.query('SELECT COUNT(*) as count FROM broadcasts');

    message += `👥 إجمالي المستخدمين: ${totalUsers.rows[0].count}\n`;
    message += `✅ المتصلين: ${connectedUsers.rows[0].count}\n`;
    message += `📱 جهات الاتصال: ${totalContacts.rows[0].count}\n`;
    message += `📢 البرودكاست: ${totalBroadcasts.rows[0].count}\n`;
    message += '\n━━━━━━━━━━━━━━━━━━━━━\n';

    // Get channel subscription status
    const channelSettings = await db.getChannelSettings();
    if (channelSettings && channelSettings.is_enabled) {
      message += `📢 <b>الاشتراك الإجباري:</b>\n`;
      message += `✅ مفعل\n`;
      message += `🔗 الرابط: ${channelSettings.channel_link}\n`;
      if (channelSettings.channel_name) {
        message += `📛 الاسم: ${channelSettings.channel_name}\n`;
      }
    } else {
      message += `📢 <b>الاشتراك الإجباري:</b>\n`;
      message += `❌ معطل\n`;
    }

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('👥 إدارة المستخدمين', 'admin_users')],
          [Markup.button.callback('📢 إعداد الاشتراك الإجباري', 'admin_channel')],
          [Markup.button.callback('📊 الإحصائيات الكاملة', 'admin_stats')],
          [Markup.button.callback('⚙️ إعدادات البوت', 'admin_settings')],
          [Markup.button.callback('🔙 رجوع', 'back_main')]
        ]
      }
    });
  }

  // Handle Admin Panel Actions
  async handleAdminAction(ctx, action) {
    const adminId = process.env.ADMIN_TELEGRAM_ID || '2009213836';
    if (String(ctx.from.id) !== String(adminId)) {
      await ctx.reply('⛔ عذراً، هذه الخاصية للأدمن فقط!');
      return;
    }

    if (action === 'admin_channel') {
      await this.showChannelSettings(ctx);
    } else if (action === 'admin_users') {
      await this.showAdminUsers(ctx);
    } else if (action === 'admin_stats') {
      await this.showFullStats(ctx);
    } else if (action === 'admin_settings') {
      await this.showBotSettings(ctx);
    }
  }

  // Bot Settings
  async showBotSettings(ctx) {
    let message = '⚙️ <b>إعدادات البوت</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━\n';
    message += '📱 <b>معلومات البوت:</b>\n\n';
    message += `• الإصدار: 1.0.0\n`;
    message += `• الحالة: يعمل بنجاح\n`;
    message += '\n━━━━━━━━━━━━━━━━━━━━━\n';
    message += '📊 <b>إعدادات الاشتراك:</b>\n\n';

    const channelSettings = await db.getChannelSettings();
    if (channelSettings && channelSettings.is_enabled) {
      message += `✅ الاشتراك الإجباري: مفعل\n`;
    } else {
      message += `❌ الاشتراك الإجباري: معطل\n`;
    }

    // Get subscription stats
    const activeSubscriptions = await pool.query("SELECT COUNT(*) as count FROM users WHERE subscription_status = 'active'");
    const trialUsers = await pool.query("SELECT COUNT(*) as count FROM users WHERE subscription_type = 'تجربة مجانية'");
    const expiredUsers = await pool.query("SELECT COUNT(*) as count FROM users WHERE subscription_status = 'expired'");

    message += '\n📈 <b>إحصائيات الاشتراكات:</b>\n\n';
    message += `✅ النشطون: ${activeSubscriptions.rows[0].count}\n`;
    message += `🎁 التجربة المجانية: ${trialUsers.rows[0].count}\n`;
    message += `❌ المنتهية: ${expiredUsers.rows[0].count}\n`;

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('📢 إعداد الاشتراك الإجباري', 'admin_channel')],
          [Markup.button.callback('💳 إدارة الخطط', 'admin_manage_plans')],
          [Markup.button.callback('👤 تفعيل اشتراك مستخدم', 'admin_activate_user')],
          [Markup.button.callback('🔙 رجوع للأدمن', 'admin_panel')]
        ]
      }
    });
  }

  // Show subscription plans management
  async showSubscriptionPlansManagement(ctx) {
    const plans = await db.getSubscriptionPlans();

    let message = '💳 <b>إدارة خطط الاشتراك</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━\n';

    const keyboard = [];

    for (const plan of plans) {
      const priceDisplay = plan.price_usd > 0
        ? `${plan.price_usd}$ / ${plan.price_iqd} IQD`
        : 'مجاني';

      message += `\n<b>${plan.name}</b>\n`;
      message += `💰 السعر: ${priceDisplay}\n`;
      message += `⏰ المدة: ${plan.duration_days} يوم\n`;
      message += `🆔 ID: ${plan.id}\n`;
      message += '━━━━━━━━━━━━━━━━━━━━━\n';

      // Add edit and delete buttons for each plan
      keyboard.push([
        Markup.button.callback(`✏️ تعديل`, `admin_edit_plan_${plan.id}`),
        Markup.button.callback(`🗑 حذف`, `admin_delete_plan_${plan.id}`)
      ]);
    }

    keyboard.push([Markup.button.callback('➕ إضافة خطة جديدة', 'admin_add_plan')]);
    keyboard.push([Markup.button.callback('🔙 رجوع', 'admin_settings')]);

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  }

  // Show activate user subscription
  async showActivateUserSubscription(ctx) {
    const users = await pool.query('SELECT telegram_id, telegram_username, subscription_type, subscription_status, subscription_expires FROM users ORDER BY created_at DESC LIMIT 10');

    let message = '👤 <b>تفعيل اشتراك مستخدم</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━\n';
    message += 'اختر المستخدم لتفعيل اشتراكه:\n';

    for (const user of users.rows) {
      const status = user.subscription_status === 'active' ? '✅ نشط' : '❌ ' + user.subscription_status;
      const name = user.telegram_username || user.telegram_id;
      message += `\n👤 ${name}\n`;
      message += `   🆔: ${user.telegram_id}\n`;
      message += `   💳: ${user.subscription_type || 'لا يوجد'}\n`;
      message += `   📊: ${status}\n`;
      message += '━━━━━━━━━━━━━━━━━━━━━\n';
    }

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🎁 تفعيل 7 أيام', 'admin_activate_trial')],
          [Markup.button.callback('📅 تفعيل 30 يوم', 'admin_activate_monthly')],
          [Markup.button.callback('📆 تفعيل سنة', 'admin_activate_yearly')],
          [Markup.button.callback('🔙 رجوع', 'admin_settings')]
        ]
      }
    });
  }

  // Channel Subscription Settings
  async showChannelSettings(ctx) {
    const settings = await db.getChannelSettings();

    let message = '📢 <b>إعداد الاشتراك الإجباري</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━\n';

    if (settings && settings.is_enabled) {
      message += `✅ <b>الحالة:</b> مفعل\n`;
      message += `📛 <b>الاسم:</b> ${settings.channel_name || 'غير محدد'}\n`;
      message += `🔗 <b>الرابط:</b> ${settings.channel_link}\n`;
    } else {
      message += `❌ <b>الحالة:</b> معطل\n`;
    }

    message += '\n━━━━━━━━━━━━━━━━━━━━━\n';
    message += '<b>اختر الإجراء:</b>';

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('➕ إضافة قناة/مجموعة', 'admin_add_channel')],
          [settings && settings.is_enabled ? Markup.button.callback('❌ إلغاء تفعيل', 'admin_disable_channel') : Markup.button.callback('✅ تفعيل', 'admin_enable_channel')],
          [Markup.button.callback('🔙 رجوع للأدمن', 'admin_panel')]
        ]
      }
    });
  }

  // Show Admin Users
  async showAdminUsers(ctx) {
    const users = await pool.query('SELECT telegram_id, telegram_username, is_connected, created_at FROM users ORDER BY created_at DESC LIMIT 20');

    let message = '👥 <b>إدارة المستخدمين</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━\n';

    if (users.rows.length === 0) {
      message += 'لا يوجد مستخدمين بعد';
    } else {
      users.rows.forEach((user, index) => {
        const status = user.is_connected ? '✅ متصل' : '❌ غير متصل';
        const verified = user.is_verified ? '✅ مُتحقق' : '❌ غير مُتحقق';
        message += `${index + 1}. ${user.telegram_username || 'بدون اسم'}\n`;
        message += `   🆔: ${user.telegram_id}\n`;
        message += `   📱 واتساب: ${status}\n`;
        message += `   ✅ التحقق: ${verified}\n`;
        if (user.instance_name) {
          message += `   📡_instance: ${user.instance_name}\n`;
        }
        message += '━━━━━━━━━━━━━━━━━━━━━\n';
      });
    }

    // Get all users for selection
    const allUsers = await pool.query('SELECT telegram_id, telegram_username, is_connected, instance_name, is_verified FROM users ORDER BY created_at DESC LIMIT 50');

    // Create buttons for each user
    const userButtons = [];
    for (let i = 0; i < Math.min(allUsers.rows.length, 10); i++) {
      const user = allUsers.rows[i];
      const name = user.telegram_username || user.telegram_id;
      userButtons.push([Markup.button.callback(`👤 ${name}`, `admin_user_${user.telegram_id}`)]);
    }

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          ...userButtons,
          [Markup.button.callback('🔄 تحديث', 'admin_users')],
          [Markup.button.callback('🔙 رجوع للأدمن', 'admin_panel')]
        ]
      }
    });
  }

  // Show User Details
  async showUserDetails(ctx, telegramId) {
    const user = await db.getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply('❌ المستخدم غير موجود');
      return;
    }

    const contacts = await pool.query('SELECT COUNT(*) as count FROM contacts WHERE user_id = $1', [user.id]);
    const broadcasts = await pool.query('SELECT COUNT(*) as count FROM broadcasts WHERE user_id = $1', [user.id]);
    const autoReplies = await pool.query('SELECT COUNT(*) as count FROM auto_replies WHERE user_id = $1', [user.id]);

    let message = '👤 <b>تفاصيل المستخدم</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━\n';
    message += `🆔 <b>معرف التلغرام:</b> ${user.telegram_id}\n\n`;
    message += `👤 <b>اسم المستخدم:</b> ${user.telegram_username || 'غير محدد'}\n\n`;
    message += `📱 <b>حالة الواتساب:</b> ${user.is_connected ? '✅ متصل' : '❌ غير متصل'}\n\n`;

    if (user.instance_name) {
      message += `📡 <b>اسم_INSTANCE:</b> ${user.instance_name}\n\n`;
    }

    message += `✅ <b>التحقق:</b> ${user.is_verified ? '✅ مُتحقق' : '❌ غير مُتحقق'}\n\n`;
    message += `📅 <b>تاريخ التسجيل:</b> ${new Date(user.created_at).toLocaleDateString('ar')}\n\n`;
    message += '━━━━━━━━━━━━━━━━━━━━━\n';
    message += `<b>📊 الإحصائيات:</b>\n\n`;
    message += `📱 جهات الاتصال: ${contacts.rows[0].count}\n`;
    message += `📢 البرودكاست: ${broadcasts.rows[0].count}\n`;
    message += `🤖 الردود التلقائية: ${autoReplies.rows[0].count}\n`;
    message += '━━━━━━━━━━━━━━━━━━━━━';

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [user.is_connected ? Markup.button.callback('❌ قطع الاتصال', `admin_disconnect_${user.telegram_id}`) : Markup.button.callback('➕ إضافة مستخدم', `admin_add_user`)],
          [Markup.button.callback('🔙 رجوع للمستخدمين', 'admin_users')]
        ]
      }
    });
  }

  // Show Full Stats
  async showFullStats(ctx) {
    const totalUsers = await pool.query('SELECT COUNT(*) as count FROM users');
    const connectedUsers = await pool.query('SELECT COUNT(*) as count FROM users WHERE is_connected = true');
    const totalContacts = await pool.query('SELECT COUNT(*) as count FROM contacts');
    const totalBroadcasts = await pool.query('SELECT COUNT(*) as count FROM broadcasts');
    const completedBroadcasts = await pool.query("SELECT COUNT(*) as count FROM broadcasts WHERE status = 'completed'");
    const totalMessages = await pool.query('SELECT COUNT(*) as count FROM messages_log');

    let message = '📊 <b>الإحصائيات الكاملة</b>\n\n';
    message += '━━━━━━━━━━━━━━━━━━━━━\n';
    message += `👥 <b>المستخدمين:</b>\n`;
    message += `   • إجمالي: ${totalUsers.rows[0].count}\n`;
    message += `   • متصلين: ${connectedUsers.rows[0].count}\n`;
    message += `   • غير متصلين: ${parseInt(totalUsers.rows[0].count) - parseInt(connectedUsers.rows[0].count)}\n`;
    message += '\n';
    message += `📱 <b>جهات الاتصال:</b> ${totalContacts.rows[0].count}\n`;
    message += `💬 <b>الرسائل:</b> ${totalMessages.rows[0].count}\n`;
    message += '\n';
    message += `📢 <b>البرودكاست:</b>\n`;
    message += `   • إجمالي: ${totalBroadcasts.rows[0].count}\n`;
    message += `   • مكتمل: ${completedBroadcasts.rows[0].count}\n`;
    message += '━━━━━━━━━━━━━━━━━━━━━';

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔄 تحديث', 'admin_stats')],
          [Markup.button.callback('🔙 رجوع للأدمن', 'admin_panel')]
        ]
      }
    });
  }

  // Handle WhatsApp connection
  async handleWhatsAppConnection(ctx, manualName = null, manualToken = null, manualPhone = null) {
    try {
      const telegramId = ctx.from.id;
      const user = await db.getUserByTelegramId(telegramId);

      // Get phone number from database if not provided
      const phoneNumber = manualPhone || user.phone_number || null;

      if (user.is_connected) {
        await ctx.reply('✅ أنت متصل بالفعل!');
        await this.showDashboard(ctx);
        return;
      }

      // If manual data is not provided, request phone number first
      if (!manualName || !manualToken) {
        this.userStates.set(ctx.from.id, { action: 'connect_whatsapp_auto', step: 'phone' });
        await ctx.reply('📱 <b>ربط واتساب</b>\n\nأرسل رقم الهاتف مع مفتاح الدولة:\nمثال: +967771234567\n\nيجب أن يكون الرقم غير مستخدم من قبل.', { parse_mode: 'HTML' });
        return;
      }

      await ctx.reply('⏳ جاري إنشاء الاتصال... الرجاء الانتظار');

      // Use manual data or generate unique instance name and token
      let instanceName = manualName || `user_${telegramId}`;
      const instanceToken = manualToken || uuidv4();

      // Validate instance name and token format before sending to Evolution API
      if (instanceName.length < 4 || instanceName.length > 50) {
        await ctx.reply('❌ اسم الجلسة يجب أن يكون بين 4 و 50 حرفًا.');
        return;
      }

      if (instanceToken.length < 10) {
        await ctx.reply('❌ التوكن يجب أن يكون مكونًا من 10 أحرف على الأقل.');
        return;
      }

      // Ensure name contains only alphanumeric characters, underscores, hyphens, and dots
      if (!/^[a-zA-Z0-9_.-]+$/.test(instanceName)) {
        await ctx.reply('❌ اسم الجلسة يحتوي على أحرف غير مسموح بها. استخدم فقط الأحرف الإنجليزية والأرقام والنقاط والشرطات.');
        return;
      }

      // Ensure token contains only alphanumeric characters and common symbols
      if (!/^[a-zA-Z0-9!@#$%^&*()_+={}|\[\]:";'<>?,.\\/-~`]*$/.test(instanceToken)) {
        await ctx.reply('❌ التوكن يحتوي على أحرف غير مسموح بها.');
        return;
      }

      // Ensure instance name is unique in the database
      instanceName = await this.getUniqueInstanceName(instanceName);

      // Create instance in Evolution API
      let instanceData;
      try {
        console.log(`📡 Attempting to create instance: ${instanceName}`);
        instanceData = await evolutionAPI.createInstance(instanceName, instanceToken);
      } catch (error) {
        const errorMsg = error.response?.data?.message || error.response?.data?.response?.message?.[0] || error.message;
        console.log(`⚠️ Create instance error details:`, errorMsg);

        // If instance already exists, we can continue to get QR code
        if (errorMsg?.includes('already in use') || errorMsg?.includes('exists') || error.response?.status === 403) {
          console.log(`ℹ️ Instance ${instanceName} already exists or in use, reusing it.`);
        } else if (error.response?.status === 400) {
          console.error(`⚠️ Bad Request when creating instance ${instanceName}:`, errorMsg);
          // Still try to continue to QR code stage, as the instance might have been created
          console.log(`ℹ️ Attempting to continue with existing instance ${instanceName}`);
        } else {
          console.error(`❌ Failed to create/reuse instance ${instanceName}:`, errorMsg);
          throw error;
        }
      }

      // Save instance info to database
      await db.updateUserInstance(telegramId, instanceName, instanceToken);

      // Set webhook for this instance
      try {
        if (process.env.WEBHOOK_URL &&
          !process.env.WEBHOOK_URL.includes('your-bot-domain.com') &&
          !process.env.WEBHOOK_URL.includes('your-bot-url.com')) {
          const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/evolution/${instanceName}`;
          console.log(`📡 Setting webhook: ${webhookUrl}`);
          await evolutionAPI.setWebhook(instanceName, webhookUrl);
        } else {
          console.log('ℹ️ Skipping webhook setup: WEBHOOK_URL is not configured or is a placeholder.');
        }
      } catch (webhookError) {
        console.error('⚠️ Warning: Failed to set webhook (continuing anyway):', webhookError.response?.data || webhookError.message);
      }

      // Check current connection status if instance exists
      try {
        const statusData = await evolutionAPI.getInstanceStatus(instanceName);
        const state = statusData.instance?.state || statusData.state;

        if (state === 'open' || state === 'CONNECTED') {
          console.log(`✅ Instance ${instanceName} is already connected.`);

          // Use phone number from parameter or database, not from Evolution API
          let phoneNum = phoneNumber;
          if (!phoneNum) {
            const userCheck = await db.getUserByTelegramId(telegramId);
            phoneNum = userCheck.phone_number || statusData.instance?.owner || null;
          }
          console.log(`📱 Phone number: ${phoneNum}`);

          try {
            await db.updateUserConnection(telegramId, true, phoneNum);
            console.log(`✅ Phone number saved: ${phoneNum}`);
            await ctx.reply('✅ تم استعادة الاتصال بنجاح! واتساب الخاص بك مرتبط بالفعل.');
            await this.showDashboard(ctx);
          } catch (error) {
            if (error.message === 'PHONE_NUMBER_IN_USE') {
              await ctx.reply('❌ <b>هذا الرقم مستخدم بالفعل!</b>\n\nلا يمكن استخدام نفس الرقم في حسابين مختلفين.\n\nللاشتراك تواصل معنا: +447413076745', { parse_mode: 'HTML' });
              await db.updateUserConnection(telegramId, false, null);
              await this.handleWhatsAppDisconnect(ctx, telegramId);
            } else {
              throw error;
            }
          }
          return;
        }
      } catch (e) {
        console.log('Status check failed, proceeding to get QR code...');
      }

      // Get QR Code
      try {
        const qrData = await evolutionAPI.getQRCode(instanceName);
        console.log('🔍 QR Data retrieved successfully');

        if (qrData && (qrData.qrcode || qrData.base64 || qrData.code)) {
          const base64Data = qrData.qrcode?.base64 || qrData.base64 || (qrData.code ? `data:image/png;base64,${qrData.code}` : null);

          if (base64Data) {
            // Send QR code as image
            const qrBuffer = Buffer.from(base64Data.split(',')[1], 'base64');

            await ctx.replyWithPhoto(
              { source: qrBuffer },
              {
                caption: `
📱 امسح رمز الـ QR من تطبيق واتساب:

1️⃣ افتح واتساب
2️⃣ اذهب إلى الإعدادات (Settings)
3️⃣ اضغط على "الأجهزة المتصلة" (Linked Devices)
4️⃣ اضغط على "ربط جهاز" (Link a Device)
5️⃣ امسح رمز الـ QR أعلاه

⏱ الرمز صالح لمدة دقيقة واحدة
                `
              }
            );

            await ctx.reply('⏳ في انتظار المسح الضوئي...');

            // Get phone number from user input or database
            const user = await db.getUserByTelegramId(telegramId);
            const userPhone = user.phone_number || null;

            // Start polling for connection status
            this.startConnectionPolling(ctx, instanceName, telegramId, userPhone);
          } else {
            console.error('QR Base64 data not found');
            await ctx.reply('❌ رمز QR غير متوفر حالياً. الرجاء المحاولة مرة أخرى بعد قليل.');
          }
        } else {
          console.error('Unexpected QR data format');
          await ctx.reply('❌ حدث خطأ في إنشاء رمز الـ QR (تنسيق غير مدعوم).');
        }
      } catch (qrError) {
        console.error('Error fetching QR code:', qrError.response?.data || qrError.message);

        // Provide more specific error messages
        if (qrError.response?.status === 401 || qrError.response?.status === 403) {
          await ctx.reply('❌ مصادقة غير ناجحة. تحقق من صحة مفتاح API Evolution.');
        } else if (qrError.response?.status === 404) {
          await ctx.reply('❌ لم يتم العثور على نقطة النهاية. تحقق من عنوان URL لـ Evolution API.');
        } else if (qrError.response?.data?.message) {
          const msg = Array.isArray(qrError.response.data.message) ? qrError.response.data.message[0] : qrError.response.data.message;
          await ctx.reply(`❌ ${msg}`);
        } else {
          await ctx.reply(`❌ فشل الحصول على رمز QR: ${qrError.message || 'خطأ غير معروف'}`);
        }
      }
    } catch (error) {
      console.error('Error connecting WhatsApp:', error.response?.data || error.message);

      // Provide more specific error messages
      let errorMessage = '❌ حدث خطأ أثناء الاتصال. ';

      if (error.response) {
        // Server responded with error status
        if (error.response.status === 401 || error.response.status === 403) {
          errorMessage += 'خطأ في مصادقة API. تحقق من صحة المفتاح.';
        } else if (error.response.status === 404) {
          errorMessage += 'API غير موجود. تحقق من عنوان URL.';
        } else if (error.response.status === 400) {
          const apiMsg = error.response.data?.message;
          const detailedMsg = Array.isArray(apiMsg) ? apiMsg.join(', ') : apiMsg;
          errorMessage += `طلب غير صحيح: ${detailedMsg || 'تحقق من البيانات المرسلة'}`;
        } else {
          errorMessage += `خطأ في الخادم (${error.response.status}).`;
        }
      } else if (error.request) {
        // Request was made but no response received
        errorMessage += 'فشل الاتصال بالخادم. تحقق من الاتصال بالإنترنت.';
      } else {
        // Something else happened
        errorMessage += `تفاصيل: ${error.message}`;
      }

      await ctx.reply(errorMessage);
    }
  }

  // Poll for connection status
  async startConnectionPolling(ctx, instanceName, telegramId, phoneNumber = null, attempts = 0) {
    const maxAttempts = 100; // ~10 minutes (6s * 100)

    if (attempts >= maxAttempts) {
      console.log(`Polling stopped for ${instanceName} after max attempts.`);
      return;
    }

    setTimeout(async () => {
      try {
        const statusData = await evolutionAPI.getInstanceStatus(instanceName);
        const state = statusData.instance?.state || statusData.state;

        console.log(`🔍 Polling status for ${instanceName} (Attempt ${attempts + 1}):`, state);

        if (state === 'open' || state === 'CONNECTED') {
          console.log(`✅ Success! Instance ${instanceName} connected via polling.`);

          // Use phone number from parameter or database, not from Evolution API
          let savedPhone = phoneNumber;
          if (!savedPhone) {
            const user = await db.getUserByTelegramId(telegramId);
            savedPhone = user.phone_number || null;
          }
          console.log(`📱 Using phone number: ${savedPhone}`);

          try {
            await db.updateUserConnection(telegramId, true, savedPhone);
            await ctx.reply('🎉 تم ربط واتساب بنجاح! يمكنك الآن استخدام جميع ميزات البوت.');
          } catch (error) {
            if (error.message === 'PHONE_NUMBER_IN_USE') {
              await ctx.reply('❌ <b>هذا الرقم مستخدم بالفعل!</b>\n\nلا يمكن استخدام نفس الرقم في حسابين مختلفين.\n\nللاشتراك تواصل معنا: +447413076745', { parse_mode: 'HTML' });
              await db.updateUserConnection(telegramId, false, null);
              await this.handleWhatsAppDisconnect(ctx, telegramId);
              return;
            } else {
              throw error;
            }
          }
          await this.showDashboard(ctx);
        } else {
          // Continue polling
          this.startConnectionPolling(ctx, instanceName, telegramId, phoneNumber, attempts + 1);
        }
      } catch (error) {
        console.error(`Error in polling for ${instanceName}:`, error);
        // Continue polling despite error (might be temporary)
        this.startConnectionPolling(ctx, instanceName, telegramId, phoneNumber, attempts + 1);
      }
    }, 6000); // Check every 6 seconds
  }

  // Show dashboard
  async showDashboard(ctx) {
    const user = await db.getUserByTelegramId(ctx.from.id);
    const lang = user.language || 'ar';

    if (!user.is_connected) {
      await ctx.reply(t('not_connected', lang));
      await this.showMainMenu(ctx);
      return;
    }

    const stats = await db.getUserStats(user.id);

    const message = `
${t('dashboard_title', lang)}

📱 ${t('phone_number', lang)}: ${user.phone_number || 'N/A'}
${t('status_connected', lang)}

📈 ${t('statistics', lang)}:
👥 ${t('contacts', lang)}: ${stats.totalContacts}
🤖 ${t('auto_replies', lang)}: ${stats.activeAutoReplies}
📢 ${t('broadcast', lang)}: ${stats.totalBroadcasts}
    `;

    await ctx.reply(message, Markup.inlineKeyboard([
      [Markup.button.callback(t('auto_replies', lang), 'auto_replies')],
      [Markup.button.callback(t('broadcast', lang), 'broadcast')],
      [Markup.button.callback(lang === 'ar' ? '🧠 إعدادات الذكاء الاصطناعي' : '🧠 AI Settings', 'ai_settings')],
      [Markup.button.callback(lang === 'ar' ? '📥 تصدير الطلبات (Excel)' : '📥 Export Orders (Excel)', 'export_orders')],
      [Markup.button.callback(lang === 'ar' ? '🏪 إعدادات المتجر (الفواتير)' : '🏪 Store Settings (Invoices)', 'store_settings')],
      [Markup.button.callback(t('change_language', lang), 'change_language')],
      [Markup.button.callback('📊 تقارير الطلبات', 'order_reports')],
      [Markup.button.callback(t('statistics', lang), 'statistics')],
      [Markup.button.callback(t('disconnect', lang), 'disconnect')]
    ]));
  }

  // Show auto replies menu
  async showAutoRepliesMenu(ctx) {
    const user = await db.getUserByTelegramId(ctx.from.id);
    const lang = user.language || 'ar';

    await ctx.reply(
      t('auto_replies', lang),
      Markup.inlineKeyboard([
        [Markup.button.callback(t('add_auto_reply', lang), 'add_auto_reply')],
        [Markup.button.callback(lang === 'ar' ? '📋 عرض جميع الردود' : '📋 View All Replies', 'view_auto_replies')],
        [Markup.button.callback(t('delete_auto_reply', lang), 'delete_auto_reply')],
        [Markup.button.callback(t('back', lang), 'back_dashboard')]
      ])
    );
  }

  // Handle text messages (for conversations)
  async handleTextMessage(ctx) {
    const state = this.userStates.get(ctx.from.id);

    if (!state) {
      return; // No active conversation
    }

    // Handle different conversation flows
    if (state.action === 'add_auto_reply') {
      const handlers = require('./handlers');
      await handlers.handleAddAutoReply(ctx, state, this);
    } else if (state.action === 'setup_ai') {
      const handlers = require('./handlers');
      await handlers.handleSetupAI(ctx, this);
    } else if (state.action === 'setup_gemini') {
      const handlers = require('./handlers');
      await handlers.handleSetupGemini(ctx, this);
    } else if (state.action === 'setup_chatgpt') {
      const handlers = require('./handlers');
      await handlers.handleSetupChatGPT(ctx, this);
    } else if (state.action === 'train_ai') {
      const handlers = require('./handlers');
      await handlers.handleTrainAI(ctx, this);
    } else if (state.action === 'broadcast') {
      // Check if we're in date selection mode
      if (state.step === 'broadcast_date') {
        await this.handleBroadcastDateInput(ctx, state);
      } else {
        const handlers = require('./handlers');
        await handlers.handleBroadcastFlow(ctx, state, this);
      }
    } else if (state.action === 'connect_whatsapp') {
      await this.handleManualWhatsAppConnection(ctx, state);
    } else if (state.action === 'connect_whatsapp_auto') {
      // Handle automatic WhatsApp connection with phone number only
      const phoneNumber = ctx.message.text.trim();
      const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');

      // Validate phone number
      if (!/^(\+|00|0)/.test(cleanPhone)) {
        await ctx.reply('❌ رقم الهاتف يجب أن يتضمن مفتاح الدولة!\nمثال: +9677xxxxxxxx');
        return;
      }

      const phoneDigits = cleanPhone.replace(/^(\+|00)/, '');
      if (phoneDigits.length < 7 || phoneDigits.length > 15) {
        await ctx.reply('❌ رقم الهاتف غير صحيح! يجب أن يكون 7-15 رقمًا.');
        return;
      }

      // Check if phone number is already used by another user
      const existingPhoneUser = await pool.query(
        'SELECT telegram_id, telegram_username FROM users WHERE phone_number = $1 AND telegram_id != $2',
        [cleanPhone, ctx.from.id]
      );

      if (existingPhoneUser.rows.length > 0) {
        await ctx.reply('❌ <b>هذا الرقم مستخدم بالفعل!</b>\n\nالرقم: ' + cleanPhone + '\n\nلا يمكن استخدام نفس الرقم في حسابين مختلفين.\n\nللاشتراك تواصل معنا: +447413076745', { parse_mode: 'HTML' });
        this.userStates.delete(ctx.from.id);
        return;
      }

      // Generate instance name and token
      const instanceName = `wa_${telegramId}_${Date.now()}`;
      const instanceToken = require('crypto').randomBytes(16).toString('hex');

      // Save phone number
      const user = await db.getUserByTelegramId(ctx.from.id);
      user.phone_number = cleanPhone;
      await pool.query('UPDATE users SET phone_number = $1 WHERE telegram_id = $2', [cleanPhone, ctx.from.id]);

      // Delete state and proceed with connection
      this.userStates.delete(ctx.from.id);

      // Continue with WhatsApp connection
      await this.handleWhatsAppConnection(ctx, instanceName, instanceToken);
    } else if (state.action === 'admin_add_channel') {
      // Admin adding channel
      if (state.step === 'name') {
        state.channelName = ctx.message.text;
        state.step = 'link';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📢 أرسل رابط القناة أو المجموعة:\n\nمثال: https://t.me/channel_name');
      } else if (state.step === 'link') {
        const link = ctx.message.text;
        if (!link.includes('t.me')) {
          await ctx.reply('❌ يرجى إدخال رابط صالح يحتوي على t.me');
          return;
        }
        await db.setChannelSettings(state.channelName, link, true);
        this.userStates.delete(ctx.from.id);
        await ctx.reply('✅ <b>تم إضافة القناة بنجاح!</b>\n\n📛 الاسم: ' + state.channelName + '\n🔗 الرابط: ' + link, { parse_mode: 'HTML' });
        await this.showChannelSettings(ctx);
      }
    } else if (state.action === 'admin_activate_subscription') {
      // Admin activating user subscription
      const telegramId = ctx.message.text.trim();
      const planId = state.planId;

      // Validate telegram ID
      if (isNaN(telegramId)) {
        await ctx.reply('❌ يرجى إدخال معرف صحيح (أرقام فقط)');
        return;
      }

      const user = await db.getUserByTelegramId(telegramId);
      if (!user) {
        await ctx.reply('❌ المستخدم غير موجود');
        this.userStates.delete(ctx.from.id);
        return;
      }

      await db.activateSubscription(telegramId, planId);
      this.userStates.delete(ctx.from.id);

      await ctx.reply('✅ <b>تم تفعيل الاشتراك بنجاح!</b>\n\n📋 للمستخدم: ' + (user.telegram_username || telegramId), { parse_mode: 'HTML' });
      await this.showActivateUserSubscription(ctx);
    } else if (state.action === 'admin_add_plan') {
      // Admin adding new plan
      if (state.step === 'name') {
        state.planName = ctx.message.text;
        state.step = 'name_en';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أرسل اسم الخطة بالإنجليزية:');
      } else if (state.step === 'name_en') {
        state.planNameEn = ctx.message.text;
        state.step = 'description';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أرسل وصف الخطة:');
      } else if (state.step === 'description') {
        state.planDescription = ctx.message.text;
        state.step = 'duration';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أرسل مدة الخطة (بالأيام):');
      } else if (state.step === 'duration') {
        const duration = parseInt(ctx.message.text);
        if (isNaN(duration) || duration <= 0) {
          await ctx.reply('❌ يرجى إدخال رقم صحيح!');
          return;
        }
        state.planDuration = duration;
        state.step = 'price_usd';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أرسل السعر بالدولار USD:');
      } else if (state.step === 'price_usd') {
        const priceUsd = parseFloat(ctx.message.text);
        if (isNaN(priceUsd) || priceUsd < 0) {
          await ctx.reply('❌ يرجى إدخال رقم صحيح!');
          return;
        }
        state.planPriceUsd = priceUsd;
        state.step = 'price_iqd';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أدخل السعر بالدينار Iraqi Dinar (IQD):');
      } else if (state.step === 'price_iqd') {
        const priceIqd = parseInt(ctx.message.text);
        if (isNaN(priceIqd) || priceIqd < 0) {
          await ctx.reply('❌ يرجى إدخال رقم صحيح!');
          return;
        }
        state.planPriceIqd = priceIqd;
        state.step = 'features';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أدخل مميزات الخطة مفصولة بفواصل:\nمثال: مميزة1,ميزة2,ميزة3');
      } else if (state.step === 'features') {
        const features = ctx.message.text.split(',').map(f => f.trim());

        await db.addSubscriptionPlan(
          state.planName,
          state.planNameEn,
          state.planDescription,
          state.planDuration,
          state.planPriceUsd,
          state.planPriceIqd,
          features
        );

        this.userStates.delete(ctx.from.id);
        await ctx.reply('✅ <b>تم إضافة الخطة بنجاح!</b>', { parse_mode: 'HTML' });
        await this.showSubscriptionPlansManagement(ctx);
      }
    } else if (state.action === 'admin_edit_plan') {
      // Admin editing plan
      if (state.step === 'name') {
        state.planName = ctx.message.text;
        state.step = 'name_en';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أرسل اسم الخطة بالإنجليزية:');
      } else if (state.step === 'name_en') {
        state.planNameEn = ctx.message.text;
        state.step = 'description';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أرسل وصف الخطة:');
      } else if (state.step === 'description') {
        state.planDescription = ctx.message.text;
        state.step = 'duration';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أرسل مدة الخطة (بالأيام):');
      } else if (state.step === 'duration') {
        const duration = parseInt(ctx.message.text);
        if (isNaN(duration) || duration <= 0) {
          await ctx.reply('❌ يرجى إدخال رقم صحيح!');
          return;
        }
        state.planDuration = duration;
        state.step = 'price_usd';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أرسل السعر بالدولار USD:');
      } else if (state.step === 'price_usd') {
        const priceUsd = parseFloat(ctx.message.text);
        if (isNaN(priceUsd) || priceUsd < 0) {
          await ctx.reply('❌ يرجى إدخال رقم صحيح!');
          return;
        }
        state.planPriceUsd = priceUsd;
        state.step = 'price_iqd';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أدخل السعر بالدينار Iraqi Dinar (IQD):');
      } else if (state.step === 'price_iqd') {
        const priceIqd = parseInt(ctx.message.text);
        if (isNaN(priceIqd) || priceIqd < 0) {
          await ctx.reply('❌ يرجى إدخال رقم صحيح!');
          return;
        }
        state.planPriceIqd = priceIqd;
        state.step = 'features';
        this.userStates.set(ctx.from.id, state);
        await ctx.reply('📝 أدخل مميزات الخطة مفصولة بفواصل:\nمثال: مميزة1,ميزة2,ميزة3');
      } else if (state.step === 'features') {
        const features = ctx.message.text.split(',').map(f => f.trim());

        await db.updateSubscriptionPlan(
          state.planId,
          state.planName,
          state.planNameEn,
          state.planDescription,
          state.planDuration,
          state.planPriceUsd,
          state.planPriceIqd,
          features
        );

        this.userStates.delete(ctx.from.id);
        await ctx.reply('✅ <b>تم تحديث الخطة بنجاح!</b>', { parse_mode: 'HTML' });
        await this.showSubscriptionPlansManagement(ctx);
      }
    } else if (state.action === 'set_store_name') {
      if (state.step === 'input') {
        const storeName = ctx.message.text.trim();
        if (storeName.length < 2 || storeName.length > 50) {
          await ctx.reply('❌ اسم المتجر يجب أن يكون بين 2 و 50 حرفاً.');
          return;
        }

        const user = await db.getUserByTelegramId(ctx.from.id);
        await db.updateUserStoreName(user.telegram_id, storeName);

        this.userStates.delete(ctx.from.id);
        await ctx.reply('✅ <b>تم حفظ اسم المتجر بنجاح!</b>\n\nستظهر الآن " ' + storeName + ' " في جميع فواتير الـ PDF الجديدة.', { parse_mode: 'HTML' });
        await this.showStoreSettings(ctx);
      }
    } else if (state.action === 'set_google_maps') {
      if (state.step === 'input') {
        const link = ctx.message.text.trim();
        if (!link.includes('http') || !link.includes('map')) {
          await ctx.reply('❌ يرجى إرسال رابط صحيح لخرائط جوجل.');
          return;
        }

        const user = await db.getUserByTelegramId(ctx.from.id);
        await db.setUserGoogleMapsLink(user.telegram_id, link);

        this.userStates.delete(ctx.from.id);
        await ctx.reply('✅ <b>تم حفظ رابط الموقع بنجاح!</b>\n\nسيتم إرساله للعملاء عند اكتمال الطلب.', { parse_mode: 'HTML' });
        await this.showStoreSettings(ctx);
      }
    }
  }

  // Handle broadcast date range input
  async handleBroadcastDateInput(ctx, state) {
    const text = ctx.message.text.trim();
    const handlers = require('./handlers');

    // Check for quick filters (numbers)
    if (!isNaN(text) && parseInt(text) > 0) {
      const days = parseInt(text);
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days);

      const dateFrom = from.toISOString().split('T')[0];
      const dateTo = to.toISOString().split('T')[0];

      state.dateFrom = dateFrom;
      state.dateTo = dateTo;
      state.filter = { dateFrom, dateTo };
      this.userStates.set(ctx.from.id, state);

      await ctx.reply(`✅ تم تحديد الفترة: آخر ${days} يوم\nمن: ${dateFrom}\nإلى: ${dateTo}`);
      await handlers.confirmBroadcast(ctx, state.filter, this);
      return;
    }

    // Parse date input (DD/MM/YYYY)
    const dateMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

    if (!dateMatch) {
      await ctx.reply('❌ تنسيق التاريخ غير صحيح.\nالرجاء استخدام التنسيق: DD/MM/YYYY\nمثال: 01/01/2026');
      return;
    }

    const day = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]);
    const year = parseInt(dateMatch[3]);

    // Validate date
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2020) {
      await ctx.reply('❌ تاريخ غير صالح. الرجاء إدخال تاريخ صحيح.');
      return;
    }

    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

    if (state.dateStep === 'from') {
      // First date (from)
      state.dateFrom = dateStr;
      state.dateStep = 'to';
      this.userStates.set(ctx.from.id, state);

      await ctx.reply(
        `✅ تاريخ البداية: ${dateStr}\n\n` +
        'الآن أرسل تاريخ النهاية (DD/MM/YYYY):\n' +
        'مثال: 01/02/2026'
      );
    } else if (state.dateStep === 'to') {
      // Second date (to)
      state.dateTo = dateStr;
      state.filter = { dateFrom: state.dateFrom, dateTo: dateStr };
      this.userStates.set(ctx.from.id, state);

      await ctx.reply(`✅ تم تحديد الفترة:\nمن: ${state.dateFrom}\nإلى: ${dateStr}`);
      await handlers.confirmBroadcast(ctx, state.filter, this);
    }
  }



  // Handle manual WhatsApp connection data
  async handleManualWhatsAppConnection(ctx, state) {
    const text = ctx.message.text;
    const parts = text.split('*');

    if (parts.length < 4) {
      await ctx.reply('❌ الصيغة غير صحيحة. الرجاء الإرسال بالشكل التالي:\n`Name*Channel*Token*Number`\n\nجميع الحقول إلزامية!');
      return;
    }

    const name = parts[0].trim();
    const channel = parts[1].trim();
    const token = parts[2].trim();
    const phoneNumber = parts[3].trim();

    // Validate all fields are provided
    if (!name || !channel || !token || !phoneNumber) {
      await ctx.reply('❌ جميع الحقول مطلوبة!\n\n`Name*Channel*Token*Number`\n\n- Name: اسم الجلسة\n- Channel: القناة\n- Token: التوكن\n- Number: رقم الهاتف مع مفتاح الدولة');
      return;
    }

    // Validate Name (minimum 4 characters)
    if (name.length < 4) {
      await ctx.reply('❌ اسم الجلسة يجب أن يكون 4 أحرف أو أكثر!');
      return;
    }

    if (name.length > 50) {
      await ctx.reply('❌ اسم الجلسة يجب أن يكون أقل من 50 حرفًا!');
      return;
    }

    // Validate Channel (minimum 5 characters)
    if (channel.length < 5) {
      await ctx.reply('❌ اسم القناة يجب أن يكون 5 أحرف أو أكثر!');
      return;
    }

    // Validate Token (minimum 5 letters + 5 numbers = 10 mixed characters)
    if (token.length < 10) {
      await ctx.reply('❌ التوكن يجب أن يكون 10 أحرف على الأقل (5 أحرف + 5 أرقام)!');
      return;
    }

    // Check token contains both letters and numbers
    const hasLetters = /[a-zA-Z]/.test(token);
    const hasNumbers = /[0-9]/.test(token);
    if (!hasLetters || !hasNumbers) {
      await ctx.reply('❌ التوكن يجب أن يحتوي على أحرف وأرقام معًا!');
      return;
    }

    // Validate Phone Number (must include country code)
    // Remove any spaces or special characters
    const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');

    // Check if it starts with + or 00 or country code
    if (!/^(\+|00|0)/.test(cleanPhone)) {
      await ctx.reply('❌ رقم الهاتف يجب أن يتضمن مفتاح الدولة!\nمثال: +9677xxxxxxxx أو 009677xxxxxxxx');
      return;
    }

    // Remove + or 00 prefix to check length
    const phoneDigits = cleanPhone.replace(/^(\+|00)/, '');
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      await ctx.reply('❌ رقم الهاتف غير صحيح! يجب أن يكون 7-15 رقمًا.');
      return;
    }

    // Ensure name contains only alphanumeric characters, underscores, hyphens, and dots
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
      await ctx.reply('❌ اسم الجلسة يحتوي على أحرف غير مسموح بها. استخدم فقط الأحرف الإنجليزية والأرقام والنقاط والشرطات.');
      return;
    }

    // Ensure token contains only alphanumeric characters and common symbols
    if (!/^[a-zA-Z0-9!@#$%^&*()_+={}|\[\]:";'<>?,.\/\-~`]*$/.test(token)) {
      await ctx.reply('❌ التوكن يحتوي على أحرف غير مسموح بها.');
      return;
    }

    // Check if phone number is already used by another user
    const existingPhoneUser = await pool.query(
      'SELECT telegram_id, telegram_username FROM users WHERE phone_number = $1 AND telegram_id != $2',
      [cleanPhone, ctx.from.id]
    );

    if (existingPhoneUser.rows.length > 0) {
      await ctx.reply('❌ <b>هذا الرقم مستخدم بالفعل!</b>\n\nالرقم: ' + cleanPhone + '\n\nلا يمكن استخدام نفس الرقم في حسابين مختلفين.\n\nللاشتراك تواصل معنا: +447413076745', { parse_mode: 'HTML' });
      return;
    }

    // Clear state and proceed
    this.userStates.delete(ctx.from.id);

    // Ensure instance name is unique
    const uniqueInstanceName = await this.getUniqueInstanceName(name);

    // Save to user object for polling/socket use
    const user = await db.getUserByTelegramId(ctx.from.id);
    user.instance_name = uniqueInstanceName;
    user.instance_token = token;
    user.phone_number = cleanPhone;

    // Save phone number to database immediately
    await pool.query('UPDATE users SET phone_number = $1 WHERE telegram_id = $2', [cleanPhone, ctx.from.id]);
    console.log('📱 Phone number saved to database:', cleanPhone);

    // Connect socket if service available
    if (this.socketService) {
      await this.socketService.connectInstance(user);
    }

    await this.handleWhatsAppConnection(ctx, uniqueInstanceName, token, cleanPhone);
  }

  // handleAddAutoReply moved to handlers.js

  // Show auto replies list
  async showAutoRepliesList(ctx) {
    const user = await db.getUserByTelegramId(ctx.from.id);
    const replies = await db.getAutoReplies(user.id);

    if (replies.length === 0) {
      await ctx.reply('📭 لا توجد ردود تلقائية حالياً');
      await this.showAutoRepliesMenu(ctx);
      return;
    }

    let message = '📋 الردود التلقائية:\n\n';
    replies.forEach((reply, index) => {
      message += `${index + 1}. 🔑 "${reply.keyword}"\n   💬 ${reply.reply_text}\n\n`;
    });

    await ctx.reply(message, Markup.inlineKeyboard([
      [Markup.button.callback('🔙 العودة', 'auto_replies')]
    ]));
  }

  // Show auto replies deletion list
  async showAutoReplyDeletionList(ctx) {
    const user = await db.getUserByTelegramId(ctx.from.id);
    const replies = await db.getAutoReplies(user.id);

    if (replies.length === 0) {
      await ctx.reply('📭 لا توجد ردود تلقائية لحذفها');
      await this.showAutoRepliesMenu(ctx);
      return;
    }

    const buttons = replies.map(reply => [
      Markup.button.callback(`🗑️ ${reply.keyword}`, `del_rep:${reply.keyword}`)
    ]);

    buttons.push([Markup.button.callback('🔙 العودة', 'auto_replies')]);

    await ctx.reply(
      '🗑️ اختر الكلمة المفتاحية التي تريد حذف الرد الخاص بها:',
      Markup.inlineKeyboard(buttons)
    );
  }

  // Execute broadcast
  async executeBroadcast(ctx) {
    try {
      const state = this.userStates.get(ctx.from.id);
      console.log('📤 executeBroadcast - State:', JSON.stringify(state));

      if (!state || !state.recipients) {
        console.error('❌ No state or recipients found');
        await ctx.reply('❌ حدث خطأ. لم يتم العثور على قائمة المستلمين. يرجى المحاولة مرة أخرى.');
        return;
      }

      if (state.recipients.length === 0) {
        await ctx.reply('❌ لا توجد جهات اتصال للمرسلة إليها.');
        return;
      }

      const user = await db.getUserByTelegramId(ctx.from.id);
      console.log('📤 User:', user.telegram_id, 'Instance:', user.instance_name);

      if (!user.instance_name) {
        await ctx.reply('❌ حساب الواتساب غير متصل. يرجى ربط الواتساب أولاً.');
        return;
      }

      // Create broadcast record
      const broadcast = await db.createBroadcast(
        user.id,
        state.messageText,
        state.mediaUrl || null,
        state.mediaType || null,
        state.filter || {}
      );

      // Add recipients
      for (const contact of state.recipients) {
        await db.addBroadcastRecipient(broadcast.id, contact.id);
      }

      // Update total recipients
      await pool.query(
        'UPDATE broadcasts SET total_recipients = $1 WHERE id = $2',
        [state.recipients.length, broadcast.id]
      );

      // Queue the broadcast
      const BroadcastQueue = require('../services/broadcastQueue');
      const queue = new BroadcastQueue();
      await queue.addBroadcastJob(broadcast.id, user.id, user.instance_name, ctx.from.id);

      // Clear state
      this.userStates.delete(ctx.from.id);

      await ctx.reply(
        `🚀 تم بدء الإرسال!\n\n📊 المستلمين: ${state.recipients.length}\n⏱ جاري الإرسال...`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📊 عرض الإحصائيات', 'statistics')],
          [Markup.button.callback('🔙 العودة', 'back_dashboard')]
        ])
      );
    } catch (error) {
      console.error('Error executing broadcast:', error);
      await ctx.reply('❌ حدث خطأ أثناء الإرسال. الرجاء المحاولة مرة أخرى.');
    }
  }

  // Confirm disconnect
  async confirmDisconnect(ctx) {
    try {
      const user = await db.getUserByTelegramId(ctx.from.id);

      if (user.instance_name) {
        // Delete instance from Evolution API
        await evolutionAPI.deleteInstance(user.instance_name);
      }

      // Update user in database
      await db.updateUserConnection(ctx.from.id, false);
      await pool.query(
        'UPDATE users SET instance_name = NULL, instance_token = NULL, phone_number = NULL WHERE telegram_id = $1',
        [ctx.from.id]
      );

      await ctx.reply('✅ تم قطع الاتصال بنجاح!\n\nيمكنك إعادة الربط في أي وقت.');
      await this.showMainMenu(ctx);
    } catch (error) {
      console.error('Error disconnecting:', error);
      await ctx.reply('❌ حدث خطأ أثناء قطع الاتصال.');
    }
  }

  // Handle photo messages
  async handlePhotoMessage(ctx) {
    const state = this.userStates.get(ctx.from.id);
    if (!state) return;

    const handlers = require('./handlers');
    if (state.action === 'broadcast' && state.step === 'media') {
      await handlers.handleBroadcastFlow(ctx, state, this);
    } else if (state.action === 'add_auto_reply' && state.step === 'media_upload') {
      await handlers.handleAddAutoReply(ctx, state, this);
    }
  }

  // Handle video messages
  async handleVideoMessage(ctx) {
    const state = this.userStates.get(ctx.from.id);
    if (!state) return;

    const handlers = require('./handlers');
    if (state.action === 'broadcast' && state.step === 'media') {
      await handlers.handleBroadcastFlow(ctx, state, this);
    } else if (state.action === 'add_auto_reply' && state.step === 'media_upload') {
      await handlers.handleAddAutoReply(ctx, state, this);
    }
  }

  // Show document message handler
  async handleDocumentMessage(ctx) {
    const state = this.userStates.get(ctx.from.id);
    if (!state) return;

    const handlers = require('./handlers');
    if (state.action === 'add_auto_reply' && state.step === 'media_upload') {
      await handlers.handleAddAutoReply(ctx, state, this);
    }
  }

  // Show Store Settings
  async showStoreSettings(ctx) {
    const user = await db.getUserByTelegramId(ctx.from.id);
    const lang = user.language || 'ar';
    const storeName = user.store_name || (lang === 'ar' ? 'غير محدد' : 'Not set');
    const googleMapsLink = await db.getUserGoogleMapsLink(user.telegram_id);

    let message = lang === 'ar'
      ? `🏪 <b>إعدادات المتجر والفواتير</b>\n\n`
      : `🏪 <b>Store & Invoice Settings</b>\n\n`;

    message += lang === 'ar'
      ? `🏭 <b>اسم المتجر الحالي:</b> ${storeName}\n`
      : `🏭 <b>Current Store Name:</b> ${storeName}\n`;

    message += lang === 'ar'
      ? `📍 <b>رابط الموقع:</b> ${googleMapsLink ? '✅ تم الضبط' : '❌ غير محدد'}\n`
      : `📍 <b>Location Link:</b> ${googleMapsLink ? '✅ Set' : '❌ Not Set'}\n`;

    message += lang === 'ar'
      ? `\nاسم المتجر هو الذي سيظهر في ترويسة فواتير الـ PDF التي يرسلها البوت للعملاء.\nرابط الموقع سيتم إرساله للعميل عند اكتمال الطلب.`
      : `\nThe store name will appear in the header of the PDF invoices sent to customers.\nThe location link will be sent to the customer upon order completion.`;

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: lang === 'ar' ? '✏️ تعديل اسم المتجر' : '✏️ Edit Store Name', callback_data: 'set_store_name' }],
          [{ text: lang === 'ar' ? '📍 تعيين رابط جوجل ماب' : '📍 Set Google Maps Link', callback_data: 'set_google_maps' }],
          [{ text: lang === 'ar' ? '🔙 رجوع' : '🔙 Back', callback_data: 'back_dashboard' }]
        ]
      }
    });
  }

  // Launch bot
  launch() {
    this.bot.launch();
    console.log('✅ Telegram Bot is running!');
  }

  // Graceful stop
  stop() {
    this.bot.stop('SIGINT');
  }

  // Get bot instance
  getBot() {
    return this.bot;
  }

  async handleExportOrders(ctx) {
    try {
      const user = await db.getUserByTelegramId(ctx.from.id);
      const orders = await db.getOrders(user.id);

      if (!orders || orders.length === 0) {
        await ctx.reply('⚠️ لا توجد طلبات لتصديرها حالياً.');
        return;
      }

      await ctx.reply('⏳ جاري تجهيز ملف الإكسل...');

      const filePath = await excelService.generateOrdersExport(orders, `orders_${user.id}.xlsx`);

      await ctx.replyWithDocument({ source: filePath, filename: 'الطلبات.xlsx' }, {
        caption: `📊 <b>تقرير الطلبات</b>\n\nإجمالي الطلبات: ${orders.length}`,
        parse_mode: 'HTML'
      });

      // Delete file after sending
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error('Error exporting orders:', error);
      await ctx.reply('❌ حدث خطأ أثناء تصدير الطلبات. يرجى المحاولة لاحقاً.');
    }
  }
}

module.exports = TelegramBot;
