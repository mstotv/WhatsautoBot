const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../services/database');
const evolutionAPI = require('../services/evolutionAPI');
const axios = require('axios');

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
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Evolution API Webhook Handler
    this.app.post('/webhook/evolution/:instanceName', async (req, res) => {
      try {
        await this.handleEvolutionWebhook(req.params.instanceName, req.body);
        res.sendStatus(200);
      } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(500);
      }
    });

    // Telegram Webhook (optional - if using webhooks instead of polling)
    this.app.post('/webhook/telegram', (req, res) => {
      this.telegramBot.getBot().handleUpdate(req.body);
      res.sendStatus(200);
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

        // Skip messages sent very recently (within last 5 seconds) - prevents broadcast loops
        const messageTimestamp = message.messageTimestamp;
        if (messageTimestamp) {
          const now = Math.floor(Date.now() / 1000);
          const messageTime = typeof messageTimestamp === 'number' ? messageTimestamp : parseInt(messageTimestamp);
          if (now - messageTime < 5) {
            console.log(`⏭️ [handleIncomingMessage] Skipping message sent within last 5 seconds (possible broadcast echo): ${messageId}`);
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

        const messageText = message.message?.conversation ||
          message.message?.extendedTextMessage?.text || '';

        console.log(`📩 Message content: "${messageText}" from ${remoteId}`);

        if (!remoteId || !messageText) {
          console.log('⚠️ Skipping: Missing remoteId or messageText', { remoteId, hasText: !!messageText });
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

      // Check working hours
      const shouldAutoReply = await this.checkWorkingHours(user);
      if (!shouldAutoReply) {
        console.log(`🕒 Outside working hours for user ${user.telegram_id}. Sending auto-response...`);
        await this.sendWorkingHoursMessage(user, remoteId);
        return;
      }

      console.log(`✅ Within working hours. Checking for auto-replies...`);

      // Check for auto-replies
      const autoReply = await this.findAutoReply(user, messageText);
      if (autoReply) {
        console.log(`🤖 Found keyword match: "${autoReply.keyword}". Sending reply to ${remoteId}...`);

        if (autoReply.media_url) {
          console.log(`🖼️ Sending media reply (${autoReply.media_type}) to ${remoteId}...`);
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

        console.log(`✅ Auto-reply sent to ${remoteId}`);
        return;
      }


      console.log(`ℹ️ No auto-reply keyword found. Checking AI settings...`);

      // Check AI settings
      const aiSettings = await db.getAISettings(user.id);
      if (aiSettings && aiSettings.is_active) {
        console.log(`🤖 AI is active (${aiSettings.provider}). Generating reply for ${remoteId}...`);
        const aiReply = await this.getAIReply(aiSettings, messageText);
        if (aiReply) {
          await evolutionAPI.sendTextMessage(user.instance_name, remoteId, aiReply);
          console.log(`✅ AI reply sent to ${remoteId}`);
        } else {
          console.log(`⚠️ AI reply was empty or failed.`);
        }
      } else {
        console.log(`ℹ️ AI is disabled or not configured for user ${user.telegram_id}`);
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

  async getAIReply(aiSettings, messageText) {
    try {
      if (aiSettings.provider === 'deepseek') {
        console.log(`🤖 Requesting DeepSeek reply for: "${messageText.substring(0, 50)}..."`);
        const response = await axios.post(
          'https://api.deepseek.com/v1/chat/completions',
          {
            model: aiSettings.model || 'deepseek-chat',
            messages: [
              { role: 'system', content: aiSettings.system_prompt || 'أنت مساعد عربي مفيد. ابرد بإجابات قصيرة ومختصرة. لا تكتب كلام كثير.' },
              { role: 'user', content: messageText }
            ],
            temperature: 0.5,
            max_tokens: 200
          },
          {
            headers: {
              'Authorization': `Bearer ${aiSettings.api_key}`,
              'Content-Type': 'application/json'
            }
          }
        );

        return response.data.choices[0].message.content;
      } else if (aiSettings.provider === 'gemini') {
        console.log(`🤖 Requesting Gemini reply for: "${messageText.substring(0, 50)}..."`);
        const genAI = new GoogleGenerativeAI(aiSettings.api_key);
        const model = genAI.getGenerativeModel({
          model: aiSettings.model || 'gemini-flash-latest',
          systemInstruction: aiSettings.system_prompt || 'أنت مساعد عربي مفيد. ابرد بإجابات قصيرة ومختصرة. لا تكتب كلام كثير.'
        });

        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: messageText }] }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 200
          }
        });
        const geminiResponse = await result.response;
        const text = geminiResponse.text();
        console.log(`✅ Gemini generated reply: "${text.substring(0, 50)}..."`);
        return text;
      }
    } catch (error) {
      console.error('❌ Error getting AI reply:', error.message);
      if (error.response) console.error('API Response Error:', JSON.stringify(error.response.data));
      return null;
    }
  }

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

  start(port) {
    this.app.listen(port, () => {
      console.log(`✅ API Server running on port ${port}`);
    });
  }
}

module.exports = APIServer;
