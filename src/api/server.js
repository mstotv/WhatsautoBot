const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const db = require('../services/database');
const evolutionAPI = require('../services/evolutionAPI');
const aiService = require('../services/aiService');
const sheetsService = require('../services/sheetsService');
const notificationService = require('../services/notificationService');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

class APIServer {
  constructor(telegramBot) {
    this.app = express();
    this.telegramBot = telegramBot;
    this.processedMessages = new Set(); // Global deduplication
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(helmet());
    this.app.use(cors());
    this.app.use(morgan('combined'));
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  }

  setupRoutes() {
    // Landing Page (Home)
    this.app.get('/', (req, res) => {
      const templates = require('./templates');
      const lang = req.query.lang || req.acceptsLanguages(['ar', 'en', 'de', 'fr']) || 'ar';
      res.send(templates.renderHome(lang));
    });

    // Google OAuth Callback
    this.app.get('/auth/google/callback', async (req, res) => {
      const { code, state } = req.query; // state is the telegramId
      if (!code || !state) {
        return res.status(400).send('Missing code or state');
      }

      try {
        const googleAuthService = require('../services/googleAuthService');
        const telegramId = state;
        const user = await db.getUserByTelegramId(telegramId);

        if (!user) {
          return res.status(404).send('User not found');
        }

        console.log(`🔑 Received Google Auth code for user ${telegramId}`);
        const tokens = await googleAuthService.getTokensFromCode(code);

        await db.saveGoogleTokens(user.id, {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date
        });

        console.log(`✅ Google OAuth tokens saved for user ${telegramId}`);

        // Set bot state so the user can immediately send the URL
        if (this.telegramBot) {
          this.telegramBot.userStates.set(Number(telegramId), {
            action: 'setup_sheets',
            step: 'spreadsheet_url'
          });
        }

        if (this.telegramBot) {
          await this.telegramBot.bot.telegram.sendMessage(
            telegramId,
            '✅ <b>تم ربط حساب Google بنجاح!</b>\n\nبقي خطوة واحدة أخيرة:\nأرسل الآن <b>رابط ملف الإكسل (URL)</b> الذي تريد استخدامه للطلبات لكي يتم تفعيله رسمياً.',
            { parse_mode: 'HTML' }
          );
        }

        res.send(`
          <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #f0f2f5; margin: 0; }
                .card { background: white; padding: 2.5rem; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); text-align: center; max-width: 400px; width: 90%; }
                .icon { font-size: 4rem; color: #4caf50; margin-bottom: 1rem; }
                h1 { color: #1c1e21; margin-bottom: 0.5rem; font-size: 1.5rem; }
                p { color: #606770; line-height: 1.5; margin-bottom: 2rem; }
                .btn { 
                  display: inline-block; 
                  background: #0088cc; 
                  color: white; 
                  padding: 12px 24px; 
                  border-radius: 8px; 
                  text-decoration: none; 
                  font-weight: bold;
                  transition: background 0.2s;
                }
                .btn:hover { background: #0077b3; }
              </style>
            </head>
            <body>
              <div class="card">
                <div class="icon">✅</div>
                <h1>تم الربط بنجاح!</h1>
                <p>تم ربط حساب جوجل للطلبات بنجاح. يمكنك الآن العودة إلى البوت لإكمال الإعداد.</p>
                <a href="https://t.me/Whatsautoappbot" class="btn">العودة إلى تيليجرام</a>
                <script>
                  // Try to close the window after 10 seconds if they haven't clicked
                  setTimeout(() => {
                    // window.close() usually only works on windows opened by script, 
                    // but it's a nice-to-have.
                  }, 10000);
                </script>
              </div>
            </body>
          </html>
        `);
      } catch (error) {
        console.error('❌ OAuth Error:', error);
        res.status(500).send('حدث خطأ أثناء الربط: ' + error.message);
      }
    });

    // Privacy Policy Route
    this.app.get('/privacy', (req, res) => {
      const templates = require('./templates');
      const lang = req.query.lang || req.acceptsLanguages(['ar', 'en', 'de', 'fr']) || 'ar';
      res.send(templates.renderPrivacy(lang));
    });

    // Terms of Service Route
    this.app.get('/terms', (req, res) => {
      const templates = require('./templates');
      const lang = req.query.lang || req.acceptsLanguages(['ar', 'en', 'de', 'fr']) || 'ar';
      res.send(templates.renderTerms(lang));
    });

    // Plisio Payment Webhook
    this.app.post('/api/payment/plisio-webhook', async (req, res) => {
      try {
        console.log('💎 Plisio Webhook Received:', req.body);
        await this.handlePlisioWebhook(req.body);
        res.status(200).send('OK');
      } catch (error) {
        console.error('❌ Plisio Webhook Error:', error.message);
        res.status(500).send('Error');
      }
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  async handleEvolutionWebhook(instanceName, data) {
    console.log(`📥 Webhook from ${instanceName}:`, data.event);

    // Get user by instance name
    const user = await this.getUserByInstance(instanceName);
    if (!user) {
      console.log('❌ User not found for instance:', instanceName);
      return;
    }
    console.log(`👤 Mapped to user: ${user.telegram_id} (ID: ${user.id})`);

    // Handle different event types
    switch (data.event) {
      case 'connection.update':
      case 'CONNECTION_UPDATE':
        await this.handleConnectionUpdate(user, data);
        break;

      case 'messages.upsert':
      case 'MESSAGES_UPSERT':
        await this.handleIncomingMessage(user, data);
        break;

      case 'qrcode.updated':
      case 'QRCODE_UPDATED':
        console.log('QR Code updated for:', instanceName);
        break;

      default:
        console.log('Unhandled event:', data.event);
    }
  }

  async handleConnectionUpdate(user, data) {
    try {
      const state = data.data?.state || data.state;
      console.log(`Connection state for user ${user.telegram_id}:`, state);

      if (state === 'open') {
        // Successfully connected
        try {
          const instanceInfo = await evolutionAPI.getInstanceInfo(user.instance_name);
          const phoneNumber = instanceInfo[0]?.instance?.owner || null;

          await db.updateUserConnection(user.telegram_id, true, phoneNumber);

          // Notify user on Telegram
          await this.telegramBot.getBot().telegram.sendMessage(
            user.telegram_id,
            `✅ تم الربط بنجاح!

📱 رقمك: ${phoneNumber || 'غير متوفر'}

يمكنك الآن استخدام جميع الميزات.`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📊 الذهاب للوحة التحكم', callback_data: 'dashboard' }]
                ]
              }
            }
          );
        } catch (infoError) {
          console.error('Error getting instance info:', infoError);
          await db.updateUserConnection(user.telegram_id, true, null);

          await this.telegramBot.getBot().telegram.sendMessage(
            user.telegram_id,
            `✅ تم الربط بنجاح!

📱 تم الربط ولكن لا يمكن استرجاع الرقم.

يمكنك الآن استخدام جميع الميزات.`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📊 الذهاب للوحة التحكم', callback_data: 'dashboard' }]
                ]
              }
            }
          );
        }
      } else if (state === 'close') {
        // Disconnected
        await db.updateUserConnection(user.telegram_id, false);

        await this.telegramBot.getBot().telegram.sendMessage(
          user.telegram_id,
          '❌ تم قطع الاتصال بواتساب.\n\nيمكنك إعادة الربط في أي وقت.'
        );
      }
    } catch (error) {
      console.error('Error handling connection update:', error);
    }
  }

  async handleIncomingMessage(user, data) {
    try {
      const messages = data.data?.messages || data.messages || [];
      console.log(`🔍 [handleIncomingMessage] Received ${messages.length} messages for user ${user.telegram_id}`);

      for (const message of messages) {
        const messageId = message.key?.id;

        // Skip if message has no ID, is from the user themselves, or already processed
        if (!messageId || message.key?.fromMe || this.processedMessages.has(messageId)) {
          if (this.processedMessages.has(messageId)) {
            console.log(`♻️ Skipping already processed message (Deduplication): ${messageId}`);
          }
          continue;
        }

        // Skip messages sent very recently (within last 1 second) - prevents broadcast loops
        const messageTimestamp = message.messageTimestamp;
        if (messageTimestamp) {
          const now = Math.floor(Date.now() / 1000);
          const messageTime = typeof messageTimestamp === 'number' ? messageTimestamp : parseInt(messageTimestamp);
          if (now - messageTime < 1) {
            console.log(`⏭️ [handleIncomingMessage] Skipping message sent within last 1 second: ${messageId}`);
            continue;
          }
        }

        // Mark as processed immediately
        this.processedMessages.add(messageId);

        // Keep set size manageable (last 1000 messages)
        if (this.processedMessages.size > 1000) {
          const firstValue = this.processedMessages.values().next().value;
          this.processedMessages.delete(firstValue);
        }


        // Use full JID as the identifier
        let remoteId = message.key?.remoteJid;

        // JID Resolution for Evolution API v2: 
        // If it's an @lid, prioritize remoteJidAlt if it contains the real @s.whatsapp.net JID
        if (remoteId && remoteId.endsWith('@lid') && message.key?.remoteJidAlt) {
          console.log(`🔍 [Core] Resolving @lid: ${remoteId} -> ${message.key.remoteJidAlt} (via remoteJidAlt)`);
          remoteId = message.key.remoteJidAlt;
        }

        let messageText = message.message?.conversation ||
          message.message?.extendedTextMessage?.text || '';

        // Handle Audio / Voice Message
        const audioMsg = message.message?.audioMessage;
        if (audioMsg && !messageText) {
          console.log(`🎤 Audio message detected from ${remoteId}. Transcribing...`);
          try {
            const aiSettings = await db.getAISettings(user.id);
            if (aiSettings && aiSettings.api_key) {
              // Download audio using Evolution API helper
              const audioBuffer = await evolutionAPI.downloadMedia(user.instance_name, message);

              if (audioBuffer) {
                // Transcribe
                const transcription = await aiService.transcribeAudio(
                  aiSettings.api_key,
                  audioBuffer,
                  'speech.ogg'
                );

                console.log(`📝 Transcribed text: "${transcription}"`);
                messageText = transcription;
              }
            }
          } catch (transError) {
            console.error('⚠️ Error transcribing audio:', transError.message);
          }
        }

        console.log(`📩 Message content: "${messageText}" from ${remoteId}`);

        if (!remoteId || (!messageText && !audioMsg)) {
          console.log('⚠️ Skipping: Missing remoteId or message content', { remoteId, hasText: !!messageText });
          continue;
        }

        // Use core message processor
        await this.processMessage(user, remoteId, messageText, message.pushName || null);
      }
    } catch (error) {
      console.error('Error handling incoming message:', error);
    }
  }

  // Core message processing logic
  async processMessage(user, remoteId, messageText, pushName) {
    try {
      // Save contact
      await db.addOrUpdateContact(user.id, remoteId, pushName);

      console.log(`📨 Processing message from ${remoteId} for user ${user.telegram_id}: "${messageText}"`);

      // === STEP 1: Send notification to the user on Telegram ===
      if (user.notifications_enabled !== false && this.telegramBot) {
        await notificationService.notifyNewMessage(
          this.telegramBot.bot,
          user.telegram_id,
          pushName,
          remoteId,
          messageText
        );
      }

      // === STEP 2: Check working hours ===
      const shouldAutoReply = await this.checkWorkingHours(user);
      if (!shouldAutoReply) {
        console.log(`🕒 Outside working hours for user ${user.telegram_id}. Sending auto-response...`);
        await this.sendWorkingHoursMessage(user, remoteId);
        return;
      }

      console.log(`✅ Within working hours. Checking for auto-replies...`);

      // === STEP 4: Check for keyword auto-replies ===
      const autoReply = await this.findAutoReply(user, messageText);
      if (autoReply) {
        console.log(`🤖 Found keyword match: "${autoReply.keyword}".`);

        // Send the actual reply
        if (autoReply.media_url) {
          await evolutionAPI.sendMediaMessage(
            user.instance_name,
            remoteId,
            autoReply.media_url,
            autoReply.reply_text,
            autoReply.media_type
          );
        } else {
          await evolutionAPI.sendTextMessage(user.instance_name, remoteId, autoReply.reply_text);
        }

        return;
      }

      console.log(`ℹ️ No auto-reply keyword found. Checking AI settings...`);

      // Check if AI is paused for this contact
      const isPaused = await db.getAIPauseState(user.id, remoteId);
      if (isPaused) {
        console.log(`⏸️ AI is paused for contact ${remoteId}. Skipping AI response.`);
        return;
      }

      // === STEP 5: Global AI Agent Processing ===
      const aiSettings = await db.getAISettings(user.id);
      if (!aiSettings || !aiSettings.is_active || !aiSettings.api_key) {
        console.log(`ℹ️ AI is not configured/active for user ${user.telegram_id}`);
        return;
      }

      console.log(`🧠 AI Agent active (${aiSettings.provider}). Processing with conversation memory...`);

      // Load conversation history
      const history = await db.getConversationHistory(user.id, remoteId, aiSettings.max_context_messages || 10);
      history.push({ role: 'user', content: messageText });

      // Save user message to history
      await db.saveMessage(user.id, remoteId, 'user', messageText);

      // Load Google Sheets data if configured
      let sheetsContext = null;
      try {
        const sheetsSettings = await db.getSheetsSettings(user.id);
        if (sheetsSettings && sheetsSettings.is_active && sheetsSettings.credentials_json) {
          sheetsContext = await sheetsService.readSheetData(
            sheetsSettings.credentials_json,
            sheetsSettings.spreadsheet_id,
            sheetsSettings.read_range
          );
        }
      } catch (sheetsError) {
        console.error('⚠️ Error loading sheets data:', sheetsError.message);
      }

      // Call AI Agent
      const aiResult = await aiService.getAIReply(
        aiSettings.provider,
        aiSettings.api_key,
        aiSettings.model,
        aiSettings.system_prompt,
        history,
        sheetsContext,
        aiSettings.language || user.language || 'ar'
      );

      if (aiResult && aiResult.reply) {
        // Send AI reply to WhatsApp
        await evolutionAPI.sendTextMessage(user.instance_name, remoteId, aiResult.reply);
        console.log(`✅ AI reply sent to ${remoteId}`);

        // Save AI reply to conversation history
        await db.saveMessage(user.id, remoteId, 'assistant', aiResult.reply);

        // Check for order detection
        if (aiResult.orderDetected && aiResult.orderData) {
          console.log(`🛒 Order detected from ${remoteId}!`, aiResult.orderData);

          // Save order locally
          try {
            await db.saveOrder(user.id, aiResult.orderData);
            console.log(`💾 Order saved locally for user ${user.id}`);
          } catch (localSaveError) {
            console.error('⚠️ Error saving order locally:', localSaveError.message);
          }

          // Notify user about the new order
          if (this.telegramBot) {
            await notificationService.notifyNewOrder(
              this.telegramBot.bot,
              user.telegram_id,
              aiResult.orderData,
              remoteId,
              pushName // Pass pushName as contactName
            );
          }

          // Generate and send PDF Invoice
          try {
            const storeName = await db.getUserStoreName(user.telegram_id);
            const fileName = `invoice_${Date.now()}.pdf`;
            const filePath = path.join(__dirname, '../../temp', fileName);

            const invoiceService = require('../services/invoiceService');
            await invoiceService.generateInvoice(
              aiResult.orderData,
              storeName || 'My Store',
              filePath,
              user.language || 'ar'
            );

            console.log(`📄 PDF Invoice generated: ${filePath}. Sending to WhatsApp...`);
            await evolutionAPI.sendMediaMessage(
              user.instance_name,
              remoteId,
              filePath,
              'تفضل، فاتورة طلبك مرفقة هنا.',
              'document',
              fileName
            );

            // Cleanup
            fs.unlinkSync(filePath);
          } catch (pdfError) {
            console.error('⚠️ Error generating/sending PDF:', pdfError.message);
          }
        }
      } else {
        console.log(`⚠️ AI returned empty reply for ${remoteId}`);
      }
    } catch (error) {
      console.error('Error in processMessage:', error);
    }
  }

  async checkWorkingHours(user) {
    const workingHours = await db.getWorkingHours(user.id);
    if (workingHours.length === 0) {
      console.log(`ℹ️ No working hours defined for user ${user.telegram_id}. Proceeding.`);
      return true;
    }

    // Get current time in Saudi Arabia (KSA) timezone
    const now = new Date();
    const ksaTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Riyadh',
      hour12: false,
      weekday: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(now);

    const getPart = (type) => ksaTime.find(p => p.type === type).value;

    // Intl weekday 1-7 (Sun-Sat), but we need 0-6
    let currentDay = parseInt(getPart('weekday')) % 7;
    const currentTime = `${getPart('hour')}:${getPart('minute')}`;

    console.log(`🕒 Current KSA Time: Day ${currentDay}, Time ${currentTime}`);

    const todayHours = workingHours.find(wh => wh.day_of_week === currentDay);
    if (!todayHours) {
      console.log(`❌ No working hours defined for today (Day ${currentDay}).`);
      return false;
    }

    const isWithin = currentTime >= todayHours.start_time && currentTime <= todayHours.end_time;
    console.log(`🕒 Comparing with: ${todayHours.start_time} - ${todayHours.end_time}. Result: ${isWithin}`);

    return isWithin;
  }

  async sendWorkingHoursMessage(user, remoteId) {
    const workingHours = await db.getWorkingHours(user.id);
    if (workingHours.length === 0) return;

    const message = workingHours[0].outside_hours_message ||
      'شكراً لتواصلك! نحن خارج أوقات العمل حالياً.';

    await evolutionAPI.sendTextMessage(user.instance_name, remoteId, message);
  }

  async findAutoReply(user, messageText) {
    const autoReplies = await db.getAutoReplies(user.id);
    const lowerMessage = messageText.toLowerCase().trim();

    return autoReplies.find(reply =>
      lowerMessage.includes(reply.keyword.toLowerCase())
    );
  }

  // Old getAIReply removed - now using aiService.js

  async getUserByInstance(instanceName) {
    try {
      const result = await db.pool.query(
        'SELECT * FROM users WHERE instance_name = $1',
        [instanceName]
      );
      return result.rows[0];
    } catch (error) {
      console.error('Error getting user by instance:', error);
      return null;
    }
  }

  async handlePlisioWebhook(data) {
    // Plisio sends status in 'status' field. We care about 'completed' or 'finished' or 'mismatch'
    const status = data.status;
    const orderNumber = data.order_number; // Format: "telegramId:planId"

    if (status === 'completed' || status === 'finished') {
      console.log(`✅ Payment confirmed for order: ${orderNumber}`);

      const [telegramId, planId] = orderNumber.split(':');
      if (!telegramId || !planId) {
        console.error('❌ Invalid order number format in Plisio webhook');
        return;
      }

      // Activate subscription in database
      const user = await db.activateSubscription(telegramId, planId);
      if (user) {
        console.log(`🚀 Subscription activated for user ${telegramId} (Plan: ${planId})`);

        // Mark invoice as completed
        if (data.txn_id) {
          await db.markInvoiceCompleted(data.txn_id);
        }

        // Notify user via Telegram
        try {
          const plan = await db.getSubscriptionPlan(planId);
          const lang = user.language || 'ar';
          const message = lang === 'ar'
            ? `💎 <b>تم تفعيل اشتراكك بنجاح!</b>\n\nشكراً لك! حسابك الآن نشط في خطة: <b>${plan.name}</b>\nيمكنك الآن البدء باستخدام كافة المميزات.`
            : `💎 <b>Subscription Activated!</b>\n\nThank you! Your account is now active on plan: <b>${plan.name}</b>\nYou can now start using all features.`;

          await this.telegramBot.getBot().telegram.sendMessage(telegramId, message, { parse_mode: 'HTML' });
        } catch (tgError) {
          console.error('❌ Error sending payment confirmation to Telegram:', tgError.message);
        }
      }
    } else {
      console.log(`ℹ️ Plisio payment status update: ${status} for ${orderNumber}`);
    }
  }

  start(port) {
    this.app.listen(port, () => {
      console.log(`✅ API Server running on port ${port}`);
    });
  }
}

module.exports = APIServer;
