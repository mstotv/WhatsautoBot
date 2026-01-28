const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const db = require('../services/database');
const evolutionAPI = require('../services/evolutionAPI');
const axios = require('axios');

class APIServer {
  constructor(telegramBot) {
    this.app = express();
    this.telegramBot = telegramBot;
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
      console.log('User not found for instance:', instanceName);
      return;
    }

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

      for (const message of messages) {
        // Skip if message is from the user themselves
        if (message.key?.fromMe) continue;

        const from = message.key?.remoteJid;
        const messageText = message.message?.conversation ||
          message.message?.extendedTextMessage?.text || '';

        if (!from || !messageText) continue;

        // Clean phone number
        const phoneNumber = from.replace('@s.whatsapp.net', '');

        // Use core message processor
        await this.processMessage(user, phoneNumber, messageText, message.pushName || null);
      }
    } catch (error) {
      console.error('Error handling incoming message:', error);
    }
  }

  // Core message processing logic (Shared between Webhook and WebSocket)
  async processMessage(user, phoneNumber, messageText, pushName) {
    try {
      // Save contact
      await db.addOrUpdateContact(user.id, phoneNumber, pushName);

      console.log(`📨 Processing from ${phoneNumber} for user ${user.telegram_id}: ${messageText}`);

      // Check working hours first
      const shouldAutoReply = await this.checkWorkingHours(user);
      if (!shouldAutoReply) {
        await this.sendWorkingHoursMessage(user, phoneNumber);
        return;
      }

      // Check for auto-replies
      const autoReply = await this.findAutoReply(user, messageText);
      if (autoReply) {
        console.log(`🤖 Auto-reply [${autoReply.keyword}] triggered for ${phoneNumber}`);
        await evolutionAPI.sendTextMessage(user.instance_name, phoneNumber, autoReply.reply_text);
        return;
      }

      // Check AI settings
      const aiSettings = await db.getAISettings(user.id);
      if (aiSettings && aiSettings.is_active) {
        console.log(`🧠 AI processing request for ${phoneNumber}...`);
        const aiReply = await this.getAIReply(aiSettings, messageText);
        if (aiReply) {
          await evolutionAPI.sendTextMessage(user.instance_name, phoneNumber, aiReply);
          console.log(`🦾 AI reply sent to ${phoneNumber}`);
        }
      } else {
        console.log(`ℹ️ No matching auto-reply or active AI for ${phoneNumber}`);
      }
    } catch (error) {
      console.error('Error in processMessage:', error);
    }
  }

  async checkWorkingHours(user) {
    const workingHours = await db.getWorkingHours(user.id);
    if (workingHours.length === 0) return true; // No restrictions

    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const todayHours = workingHours.find(wh => wh.day_of_week === currentDay);
    if (!todayHours) return false; // Not a working day

    return currentTime >= todayHours.start_time && currentTime <= todayHours.end_time;
  }

  async sendWorkingHoursMessage(user, phoneNumber) {
    const workingHours = await db.getWorkingHours(user.id);
    if (workingHours.length === 0) return;

    const message = workingHours[0].outside_hours_message ||
      'شكراً لتواصلك! نحن خارج أوقات العمل حالياً.';

    await evolutionAPI.sendTextMessage(user.instance_name, phoneNumber, message);
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
        const response = await axios.post(
          'https://api.deepseek.com/v1/chat/completions',
          {
            model: aiSettings.model || 'deepseek-chat',
            messages: [
              { role: 'system', content: aiSettings.system_prompt },
              { role: 'user', content: messageText }
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

        return response.data.choices[0].message.content;
      }
    } catch (error) {
      console.error('Error getting AI reply:', error.response?.data || error.message);
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
