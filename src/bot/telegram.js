const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const evolutionAPI = require('../services/evolutionAPI');
const db = require('../services/database');
const { v4: uuidv4 } = require('uuid');

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
      const result = await db.pool.query(
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
    // Start command
    this.bot.start(async (ctx) => {
      const telegramId = ctx.from.id;
      const username = ctx.from.username;

      // Create or get user
      await db.createUser(telegramId, username);

      // Check subscription
      const isSubscribed = await this.checkSubscription(ctx);

      if (!isSubscribed) {
        await this.showSubscriptionRequired(ctx);
      } else {
        await db.updateUserSubscription(telegramId, true);
        await this.showMainMenu(ctx);
      }
    });

    // Check subscription button
    this.bot.action('check_subscription', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const isSubscribed = await this.checkSubscription(ctx);

      if (!isSubscribed) {
        await ctx.reply('❌ لم تقم بالاشتراك في القناة بعد!\nالرجاء الاشتراك أولاً ثم الضغط على زر التحقق.');
      } else {
        await db.updateUserSubscription(ctx.from.id, true);
        await ctx.reply('✅ تم التحقق من الاشتراك بنجاح!');
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

      this.userStates.set(ctx.from.id, { action: 'connect_whatsapp', step: 'input_data' });
      await ctx.reply('🔗 الرجاء إرسال بيانات الجلسة بالصيغة التالية:\n\n`Name*Channel*Token*Number`\n\n- **Name**: اسم الجلسة (إلزامي)\n- **Token**: التوكن الخاص بك (إلزامي)\n- **Channel** و **Number**: اختياري (يمكن تركها فارغة)', { parse_mode: 'Markdown' });
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

    // Working Hours
    this.bot.action('working_hours', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.showWorkingHoursMenu(ctx);
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

    // Add Working Hours Action
    this.bot.action('add_working_hours', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      this.userStates.set(ctx.from.id, { action: 'working_hours', step: 'day' });
      await ctx.reply('📅 اختر اليوم (0 للأحد، 6 للسبت):');
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

    this.bot.action('disable_ai', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      const handlers = require('./handlers');
      await handlers.disableAI(ctx);
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

    this.bot.action('broadcast_send_now', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.executeBroadcast(ctx);
    });

    this.bot.action('confirm_disconnect', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        console.error('Error answering callback query:', e.message);
      }
      await this.confirmDisconnect(ctx);
    });
  }

  // Check if user is subscribed to channel
  async checkSubscription(ctx) {
    try {
      const member = await ctx.telegram.getChatMember(this.channelUsername, ctx.from.id);
      return ['creator', 'administrator', 'member'].includes(member.status);
    } catch (error) {
      console.error('Error checking subscription:', error);
      return false;
    }
  }

  // Show subscription required message
  async showSubscriptionRequired(ctx) {
    const message = `
🔐 مرحباً بك في بوت واتساب الآلي!

للاستخدام، يجب الاشتراك في قناتنا أولاً:

📢 اضغط على الزر أدناه للاشتراك، ثم اضغط "تحققت من الاشتراك"
    `;

    await ctx.reply(message, Markup.inlineKeyboard([
      [Markup.button.url('📢 اشتراك في القناة', `https://t.me/${this.channelUsername.replace('@', '')}`)],
      [Markup.button.callback('✅ تحققت من الاشتراك', 'check_subscription')]
    ]));
  }

  // Show main menu after subscription
  async showMainMenu(ctx) {
    const user = await db.getUserByTelegramId(ctx.from.id);

    let message = `
🎉 مرحباً بك في بوت واتساب الآلي!

يمكنك الآن ربط حسابك في واتساب والبدء في استخدام الميزات التالية:

✅ ردود تلقائية مخصصة
✅ ربط الذكاء الاصطناعي (DeepSeek)
✅ جدولة أوقات العمل
✅ إرسال رسائل جماعية (Broadcast)
✅ إحصائيات مفصلة
    `;

    const buttons = [];

    if (!user.is_connected) {
      buttons.push([Markup.button.callback('🔗 ربط واتساب', 'connect_whatsapp')]);
    } else {
      buttons.push([Markup.button.callback('📊 لوحة التحكم', 'dashboard')]);
    }

    await ctx.reply(message, Markup.inlineKeyboard(buttons));
  }

  // Handle WhatsApp connection
  async handleWhatsAppConnection(ctx, manualName = null, manualToken = null) {
    try {
      const telegramId = ctx.from.id;
      const user = await db.getUserByTelegramId(telegramId);

      if (user.is_connected) {
        await ctx.reply('✅ أنت متصل بالفعل!');
        await this.showDashboard(ctx);
        return;
      }

      await ctx.reply('⏳ جاري إنشاء الاتصال... الرجاء الانتظار');

      // Use manual data or generate unique instance name and token
      let instanceName = manualName || `user_${telegramId}`;
      const instanceToken = manualToken || uuidv4();

      // Validate instance name and token format before sending to Evolution API
      if (instanceName.length < 1 || instanceName.length > 50) {
        await ctx.reply('❌ اسم الجلسة يجب أن يكون بين 1 و 50 حرفًا.');
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
          await db.updateUserConnection(telegramId, true, statusData.instance?.owner || null);
          await ctx.reply('✅ تم استعادة الاتصال بنجاح! واتساب الخاص بك مرتبط بالفعل.');
          await this.showDashboard(ctx);
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

            // Start polling for connection status
            this.startConnectionPolling(ctx, instanceName, telegramId);
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
  async startConnectionPolling(ctx, instanceName, telegramId, attempts = 0) {
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

          // Get instance info for phone number
          const instanceInfo = await evolutionAPI.getInstanceInfo(instanceName);
          const phoneNumber = instanceInfo[0]?.instance?.owner || null;

          await db.updateUserConnection(telegramId, true, phoneNumber);

          // IMMEDIATELY start message polling/socket for this user
          if (this.socketService) {
            const user = await db.getUserByTelegramId(telegramId);
            await this.socketService.startPolling(user);
          }

          await ctx.reply('🎉 تم ربط واتساب بنجاح! يمكنك الآن استخدام جميع ميزات البوت.');
          await this.showDashboard(ctx);
        } else {
          // Continue polling for connection status
          this.startConnectionPolling(ctx, instanceName, telegramId, attempts + 1);
        }
      } catch (error) {
        console.error(`Error in polling for ${instanceName}:`, error);
        // Continue polling despite error (might be temporary)
        this.startConnectionPolling(ctx, instanceName, telegramId, attempts + 1);
      }
    }, 4000); // Check every 4 seconds (reduced from 6s)
  }

  // Show dashboard
  async showDashboard(ctx) {
    const user = await db.getUserByTelegramId(ctx.from.id);

    if (!user.is_connected) {
      await ctx.reply('❌ لم تقم بربط واتساب بعد!');
      await this.showMainMenu(ctx);
      return;
    }

    const stats = await db.getUserStats(user.id);

    const message = `
📊 لوحة التحكم

📱 الرقم: ${user.phone_number || 'غير متوفر'}
✅ الحالة: متصل

📈 الإحصائيات:
👥 جهات الاتصال: ${stats.totalContacts}
🤖 الردود التلقائية: ${stats.activeAutoReplies}
📢 الرسائل الجماعية: ${stats.totalBroadcasts}
    `;

    await ctx.reply(message, Markup.inlineKeyboard([
      [Markup.button.callback('⚙️ الردود التلقائية', 'auto_replies')],
      [Markup.button.callback('🤖 إعدادات الذكاء الاصطناعي', 'ai_settings')],
      [Markup.button.callback('⏰ أوقات العمل', 'working_hours')],
      [Markup.button.callback('📢 إرسال رسالة جماعية', 'broadcast')],
      [Markup.button.callback('📊 الإحصائيات التفصيلية', 'statistics')],
      [Markup.button.callback('❌ قطع الاتصال', 'disconnect')]
    ]));
  }

  // Show auto replies menu
  async showAutoRepliesMenu(ctx) {
    await ctx.reply(
      '⚙️ إدارة الردود التلقائية',
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ إضافة رد تلقائي', 'add_auto_reply')],
        [Markup.button.callback('📋 عرض جميع الردود', 'view_auto_replies')],
        [Markup.button.callback('🔙 العودة', 'back_dashboard')]
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
      await this.handleAddAutoReply(ctx, state);
    } else if (state.action === 'setup_ai') {
      await this.handleSetupAI(ctx, state);
    } else if (state.action === 'working_hours') {
      await this.handleWorkingHours(ctx, state);
    } else if (state.action === 'broadcast') {
      await this.handleBroadcastFlow(ctx, state);
    } else if (state.action === 'connect_whatsapp') {
      await this.handleManualWhatsAppConnection(ctx, state);
    }
  }



  // Handle manual WhatsApp connection data
  async handleManualWhatsAppConnection(ctx, state) {
    const text = ctx.message.text;
    const parts = text.split('*');

    if (parts.length < 4) {
      await ctx.reply('❌ الصيغة غير صحيحة. الرجاء الإرسال بالشكل التالي:\n`Name*Channel*Token*Number`');
      return;
    }

    const name = parts[0].trim();
    const token = parts[2].trim();

    if (!name || !token) {
      await ctx.reply('❌ الاسم (Name) والتوكن (Token) مطلوبان.');
      return;
    }

    // Validate instance name and token format
    if (name.length < 1 || name.length > 50) {
      await ctx.reply('❌ اسم الجلسة يجب أن يكون بين 1 و 50 حرفًا.');
      return;
    }

    if (token.length < 10) {
      await ctx.reply('❌ التوكن يجب أن يكون مكونًا من 10 أحرف على الأقل.');
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

    // Clear state and proceed
    this.userStates.delete(ctx.from.id);

    // Ensure instance name is unique
    const uniqueInstanceName = await this.getUniqueInstanceName(name);

    // Save to user object for polling/socket use
    const user = await db.getUserByTelegramId(ctx.from.id);
    user.instance_name = uniqueInstanceName;
    user.instance_token = token;

    // Connect socket if service available
    if (this.socketService) {
      await this.socketService.connectInstance(user);
    }

    await this.handleWhatsAppConnection(ctx, uniqueInstanceName, token);
  }

  // Handle adding auto reply
  async handleAddAutoReply(ctx, state) {
    if (state.step === 'keyword') {
      state.keyword = ctx.message.text;
      state.step = 'reply';
      this.userStates.set(ctx.from.id, state);
      await ctx.reply(`✅ الكلمة المفتاحية: "${state.keyword}"\n\n📝 الآن أرسل الرد التلقائي:`);
    } else if (state.step === 'reply') {
      const user = await db.getUserByTelegramId(ctx.from.id);
      await db.addAutoReply(user.id, state.keyword, ctx.message.text);
      this.userStates.delete(ctx.from.id);
      await ctx.reply(`✅ تم حفظ الرد التلقائي!\n\nالكلمة: "${state.keyword}"\nالرد: "${ctx.message.text}"`);
      await this.showAutoRepliesMenu(ctx);
    }
  }

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
      [Markup.button.callback('🔙 العودة', 'back_dashboard')]
    ]));
  }

  // Execute broadcast
  async executeBroadcast(ctx) {
    try {
      const state = this.userStates.get(ctx.from.id);
      if (!state || !state.recipients) {
        await ctx.reply('❌ حدث خطأ. الرجاء المحاولة مرة أخرى.');
        return;
      }

      const user = await db.getUserByTelegramId(ctx.from.id);

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
      await db.pool.query(
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
      await db.pool.query(
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
    if (state && state.action === 'broadcast' && state.step === 'media') {
      const handlers = require('./handlers');
      await handlers.handleBroadcastFlow(ctx, state, this);
    }
  }

  // Handle video messages
  async handleVideoMessage(ctx) {
    const state = this.userStates.get(ctx.from.id);
    if (state && state.action === 'broadcast' && state.step === 'media') {
      const handlers = require('./handlers');
      await handlers.handleBroadcastFlow(ctx, state, this);
    }
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
}

module.exports = TelegramBot;
