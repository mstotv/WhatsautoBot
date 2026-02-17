const { pool } = require('../database/migrate');

class DatabaseService {
  // ============ USERS ============

  async createUser(telegramId, username) {
    const query = `
      INSERT INTO users (telegram_id, telegram_username)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id) DO UPDATE 
      SET telegram_username = $2
      RETURNING *
    `;
    const result = await pool.query(query, [telegramId, username]);
    return result.rows[0];
  }

  async getUserByTelegramId(telegramId) {
    const query = 'SELECT * FROM users WHERE telegram_id = $1';
    const result = await pool.query(query, [telegramId]);
    return result.rows[0];
  }

  async updateUserInstance(telegramId, instanceName, instanceToken) {
    const query = `
      UPDATE users 
      SET instance_name = $1, instance_token = $2, updated_at = NOW()
      WHERE telegram_id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [instanceName, instanceToken, telegramId]);
    return result.rows[0];
  }

  async updateUserConnection(telegramId, isConnected, phoneNumber = null) {
    // Check if phone number is already used by another user
    if (phoneNumber && isConnected) {
      // First check via query
      const existingUser = await pool.query(
        'SELECT telegram_id, telegram_username FROM users WHERE phone_number = $1 AND telegram_id != $2',
        [phoneNumber, telegramId]
      );

      if (existingUser.rows.length > 0) {
        throw new Error('PHONE_NUMBER_IN_USE');
      }
    }

    try {
      const query = `
        UPDATE users 
        SET is_connected = $1, phone_number = $2, updated_at = NOW()
        WHERE telegram_id = $3
        RETURNING *
      `;
      const result = await pool.query(query, [isConnected, phoneNumber, telegramId]);
      return result.rows[0];
    } catch (error) {
      // Check for unique constraint violation
      if (error.code === '23505' && error.constraint === 'users_phone_unique') {
        throw new Error('PHONE_NUMBER_IN_USE');
      }
      throw error;
    }
  }

  async updateUserSubscription(telegramId, isSubscribed) {
    const query = `
      UPDATE users 
      SET is_subscribed = $1, updated_at = NOW()
      WHERE telegram_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [isSubscribed, telegramId]);
    return result.rows[0];
  }

  async setUserLanguage(userId, language) {
    const query = `
      UPDATE users 
      set language = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [language, userId]);
    return result.rows[0];
  }

  // ============ AUTO REPLIES ============

  async getAutoReplies(userId) {
    const query = 'SELECT * FROM auto_replies WHERE user_id = $1 AND is_active = true';
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  async addAutoReply(userId, keyword, replyText, mediaUrl = null, mediaType = null, captureMode = 'none') {
    const query = `
      INSERT INTO auto_replies (user_id, keyword, reply_text, media_url, media_type, capture_mode)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, keyword) 
      DO UPDATE SET reply_text = $3, media_url = $4, media_type = $5, capture_mode = $6, is_active = true, updated_at = NOW()
      RETURNING *
    `;
    const result = await pool.query(query, [userId, keyword, replyText, mediaUrl, mediaType, captureMode]);
    return result.rows[0];
  }


  async deleteAutoReply(userId, keyword) {
    const query = 'DELETE FROM auto_replies WHERE user_id = $1 AND keyword = $2';
    await pool.query(query, [userId, keyword.toLowerCase()]);
  }

  // ============ WORKING HOURS ============

  async getWorkingHours(userId) {
    const query = 'SELECT * FROM working_hours WHERE user_id = $1 AND is_active = true ORDER BY day_of_week';
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  async setWorkingHours(userId, dayOfWeek, startTime, endTime, message) {
    const query = `
      INSERT INTO working_hours (user_id, day_of_week, start_time, end_time, outside_hours_message)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, day_of_week) DO UPDATE
      SET start_time = $3, end_time = $4, outside_hours_message = $5, is_active = true
      RETURNING *
    `;
    const result = await pool.query(query, [userId, dayOfWeek, startTime, endTime, message]);
    return result.rows[0];
  }

  async deleteWorkingHours(userId, dayOfWeek) {
    const query = 'UPDATE working_hours SET is_active = false WHERE user_id = $1 AND day_of_week = $2';
    await pool.query(query, [userId, dayOfWeek]);
  }

  // ============ CONTACTS ============

  async addOrUpdateContact(userId, phoneNumber, name = null) {
    const query = `
      INSERT INTO contacts (user_id, phone_number, name, message_count)
      VALUES ($1, $2, $3, 1)
      ON CONFLICT (user_id, phone_number) DO UPDATE
      SET last_message_at = NOW(), message_count = contacts.message_count + 1, name = COALESCE($3, contacts.name)
      RETURNING *
    `;
    const result = await pool.query(query, [userId, phoneNumber, name]);
    return result.rows[0];
  }

  async setContactContext(userId, phoneNumber, context) {
    const query = 'UPDATE contacts SET current_context = $1 WHERE user_id = $2 AND phone_number = $3';
    await pool.query(query, [context, userId, phoneNumber]);
  }

  async getContactContext(userId, phoneNumber) {
    const query = 'SELECT current_context FROM contacts WHERE user_id = $1 AND phone_number = $2';
    const result = await pool.query(query, [userId, phoneNumber]);
    return result.rows[0]?.current_context;
  }

  async getContacts(userId, dateFrom = null, dateTo = null) {
    let query = 'SELECT * FROM contacts WHERE user_id = $1';
    const params = [userId];

    if (dateFrom) {
      // Add time to include full day
      const fromDate = dateFrom.includes(' ') ? dateFrom : dateFrom + ' 00:00:00';
      query += ' AND first_message_at >= $2';
      params.push(fromDate);
    }
    if (dateTo) {
      // Add time to include full day (end of day)
      const toDate = dateTo.includes(' ') ? dateTo : dateTo + ' 23:59:59';
      query += ` AND first_message_at <= $${params.length + 1}`;
      params.push(toDate);
    }

    query += ' ORDER BY last_message_at DESC';

    const result = await pool.query(query, params);
    return result.rows;
  }

  async getContactsCount(userId) {
    const query = 'SELECT COUNT(*) as count FROM contacts WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return parseInt(result.rows[0].count);
  }

  // ============ BROADCASTS ============

  async createBroadcast(userId, messageText, mediaUrl, mediaType, recipientsFilter) {
    const query = `
      INSERT INTO broadcasts (user_id, message_text, media_url, media_type, recipients_filter)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await pool.query(query, [
      userId,
      messageText,
      mediaUrl,
      mediaType,
      JSON.stringify(recipientsFilter)
    ]);
    return result.rows[0];
  }

  async updateBroadcastStatus(broadcastId, status, sentCount = null, failedCount = null) {
    let query = 'UPDATE broadcasts SET status = $1';
    const params = [status, broadcastId];

    if (sentCount !== null) {
      query += ', sent_count = $3';
      params.splice(2, 0, sentCount);
    }
    if (failedCount !== null) {
      query += `, failed_count = $${params.length + 1}`;
      params.push(failedCount);
    }

    if (status === 'completed') {
      query += ', completed_at = NOW()';
    }

    query += ` WHERE id = $2 RETURNING *`;
    const result = await pool.query(query, params);
    return result.rows[0];
  }

  async addBroadcastRecipient(broadcastId, contactId) {
    const query = `
      INSERT INTO broadcast_recipients (broadcast_id, contact_id)
      VALUES ($1, $2)
      RETURNING *
    `;
    const result = await pool.query(query, [broadcastId, contactId]);
    return result.rows[0];
  }

  async updateBroadcastRecipient(recipientId, status, errorMessage = null) {
    const query = `
      UPDATE broadcast_recipients 
      SET status = $1, sent_at = NOW(), error_message = $2
      WHERE id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [status, errorMessage, recipientId]);
    return result.rows[0];
  }

  // ============ AI SETTINGS ============

  async getAISettings(userId) {
    const query = 'SELECT * FROM ai_settings WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  async setAISettings(userId, provider, apiKey, model, systemPrompt, language = 'ar') {
    const query = `
      INSERT INTO ai_settings (user_id, provider, api_key, model, system_prompt, language, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, true)
      ON CONFLICT (user_id) DO UPDATE
      SET provider = $2, api_key = $3, model = $4, system_prompt = $5, language = $6, is_active = true, updated_at = NOW()
      RETURNING *
    `;
    const result = await pool.query(query, [userId, provider, apiKey, model, systemPrompt, language]);
    return result.rows[0];
  }

  async toggleAI(userId, isActive) {
    const query = 'UPDATE ai_settings SET is_active = $1 WHERE user_id = $2 RETURNING *';
    const result = await pool.query(query, [isActive, userId]);
    return result.rows[0];
  }

  // ============ STATS ============

  async getUserStats(userId) {
    const queries = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM contacts WHERE user_id = $1', [userId]),
      pool.query('SELECT COUNT(*) as count FROM broadcasts WHERE user_id = $1', [userId]),
      pool.query('SELECT COUNT(*) as count FROM auto_replies WHERE user_id = $1 AND is_active = true', [userId]),
    ]);

    return {
      totalContacts: parseInt(queries[0].rows[0].count),
      totalBroadcasts: parseInt(queries[1].rows[0].count),
      activeAutoReplies: parseInt(queries[2].rows[0].count)
    };
  }

  // ============ CHANNEL SUBSCRIPTION ============

  async getChannelSettings() {
    const query = 'SELECT * FROM channel_settings WHERE id = 1';
    const result = await pool.query(query);
    return result.rows[0] || null;
  }

  async setChannelSettings(channelName, channelLink, isEnabled = true) {
    const query = `
      INSERT INTO channel_settings (id, channel_name, channel_link, is_enabled)
      VALUES (1, $1, $2, $3)
      ON CONFLICT (id) DO UPDATE 
      SET channel_name = $1, channel_link = $2, is_enabled = $3
      RETURNING *
    `;
    const result = await pool.query(query, [channelName, channelLink, isEnabled]);
    return result.rows[0];
  }

  async toggleChannelSubscription(enabled) {
    const query = `
      UPDATE channel_settings 
      SET is_enabled = $1
      WHERE id = 1
      RETURNING *
    `;
    const result = await pool.query(query, [enabled]);
    return result.rows[0];
  }

  async updateUserVerification(telegramId, isVerified, channelUsername = null) {
    const query = `
      UPDATE users 
      SET is_verified = $1, channel_username = $2, verified_at = NOW()
      WHERE telegram_id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [isVerified, channelUsername, telegramId]);
    return result.rows[0];
  }

  // ============ SUBSCRIPTION ============

  async getSubscriptionPlans() {
    const query = "SELECT * FROM subscription_plans WHERE is_active = true AND name != 'تجربة مجانية' ORDER BY price_usd ASC";
    const result = await pool.query(query);
    return result.rows;
  }

  async getSubscriptionPlan(planId) {
    const query = 'SELECT * FROM subscription_plans WHERE id = $1';
    const result = await pool.query(query, [planId]);
    return result.rows[0];
  }

  async activateSubscription(telegramId, planId) {
    const plan = await this.getSubscriptionPlan(planId);
    if (!plan) return null;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.duration_days);

    const query = `
      UPDATE users 
      SET subscription_type = $1, 
          subscription_expires = $2,
          subscription_status = 'active'
      WHERE telegram_id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [plan.name, expiresAt, telegramId]);
    return result.rows[0];
  }

  async activateTrial(telegramId) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const query = `
      UPDATE users 
      SET subscription_type = 'تجربة مجانية', 
          subscription_expires = $1,
          subscription_status = 'active',
          trial_used = true
      WHERE telegram_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [expiresAt, telegramId]);
    return result.rows[0];
  }

  async checkSubscriptionStatus(telegramId) {
    const query = 'SELECT subscription_type, subscription_expires, subscription_status FROM users WHERE telegram_id = $1';
    const result = await pool.query(query, [telegramId]);
    const user = result.rows[0];

    if (!user) return { active: false, reason: 'not_found' };

    if (user.subscription_status !== 'active') {
      return { active: false, reason: 'inactive' };
    }

    if (new Date(user.subscription_expires) < new Date()) {
      // Update status to expired
      await pool.query("UPDATE users SET subscription_status = 'expired' WHERE telegram_id = $1", [telegramId]);
      return { active: false, reason: 'expired' };
    }

    return {
      active: true,
      type: user.subscription_type,
      expires: user.subscription_expires
    };
  }

  async getUserSubscription(telegramId) {
    const query = 'SELECT subscription_type, subscription_expires, subscription_status FROM users WHERE telegram_id = $1';
    const result = await pool.query(query, [telegramId]);
    return result.rows[0];
  }

  async addSubscriptionPlan(name, nameEn, description, durationDays, priceUsd, priceIqd, features) {
    const query = `
      INSERT INTO subscription_plans (name, name_en, description, duration_days, price_usd, price_iqd, features)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const result = await pool.query(query, [name, nameEn, description, durationDays, priceUsd, priceIqd, features]);
    return result.rows[0];
  }

  async deleteSubscriptionPlan(planId) {
    const query = 'DELETE FROM subscription_plans WHERE id = $1 RETURNING *';
    const result = await pool.query(query, [planId]);
    return result.rows[0];
  }

  async updateSubscriptionPlan(planId, name, nameEn, description, durationDays, priceUsd, priceIqd, features) {
    const query = `
      UPDATE subscription_plans 
      SET name = $1, name_en = $2, description = $3, duration_days = $4, 
          price_usd = $5, price_iqd = $6, features = $7
      WHERE id = $8
      RETURNING *
    `;
    const result = await pool.query(query, [name, nameEn, description, durationDays, priceUsd, priceIqd, features, planId]);
    return result.rows[0];
  }

  async getPendingInvoice(telegramId, planId) {
    const query = `
      SELECT * FROM payment_invoices 
      WHERE user_id = $1 AND plan_id = $2 AND status = 'pending' AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1
    `;
    const result = await pool.query(query, [telegramId, planId]);
    return result.rows[0];
  }

  async savePaymentInvoice(telegramId, planId, invoiceUrl, plisioId, expiresAt) {
    const query = `
      INSERT INTO payment_invoices (user_id, plan_id, invoice_url, plisio_id, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const result = await pool.query(query, [telegramId, planId, invoiceUrl, plisioId, expiresAt]);
    return result.rows[0];
  }

  async markInvoiceCompleted(plisioId) {
    const query = "UPDATE payment_invoices SET status = 'completed' WHERE plisio_id = $1";
    await pool.query(query, [plisioId]);
  }

  // ==================== Conversation History ====================

  async saveMessage(userId, contactPhone, role, content) {
    const query = `
      INSERT INTO conversation_history (user_id, contact_phone, role, content)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const result = await pool.query(query, [userId, contactPhone, role, content]);
    return result.rows[0];
  }

  async getConversationHistory(userId, contactPhone, limit = 15) {
    const query = `
      SELECT role, content, created_at
      FROM conversation_history
      WHERE user_id = $1 AND contact_phone = $2
      ORDER BY created_at DESC
      LIMIT $3
    `;
    const result = await pool.query(query, [userId, contactPhone, limit]);
    // Reverse to get chronological order
    return result.rows.reverse();
  }

  async clearConversation(userId, contactPhone) {
    await pool.query(
      'DELETE FROM conversation_history WHERE user_id = $1 AND contact_phone = $2',
      [userId, contactPhone]
    );
  }

  async clearAllConversations(userId) {
    await pool.query('DELETE FROM conversation_history WHERE user_id = $1', [userId]);
  }

  // ==================== Google Sheets Settings ====================

  async getSheetsSettings(userId) {
    const query = 'SELECT * FROM sheets_settings WHERE user_id = $1';
    const result = await pool.query(query, [userId]);
    return result.rows[0] || null;
  }

  async setSheetsSettings(userId, spreadsheetId, credentialsJson, readRange, writeRange) {
    const query = `
      INSERT INTO sheets_settings (user_id, spreadsheet_id, credentials_json, read_range, write_range, is_active, updated_at)
      VALUES ($1, $2, $3, $4, $5, true, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        spreadsheet_id = COALESCE($2, sheets_settings.spreadsheet_id),
        credentials_json = COALESCE($3, sheets_settings.credentials_json),
        read_range = COALESCE($4, sheets_settings.read_range),
        write_range = COALESCE($5, sheets_settings.write_range),
        is_active = true,
        updated_at = NOW()
      RETURNING *
    `;
    const result = await pool.query(query, [userId, spreadsheetId, credentialsJson, readRange, writeRange]);
    return result.rows[0];
  }

  async toggleSheets(userId, isActive) {
    const query = 'UPDATE sheets_settings SET is_active = $1, updated_at = NOW() WHERE user_id = $2';
    await pool.query(query, [isActive, userId]);
  }

  async saveGoogleTokens(userId, { access_token, refresh_token, expiry_date }) {
    const query = `
      INSERT INTO sheets_settings (user_id, access_token, refresh_token, token_expiry, auth_type, is_active, updated_at)
      VALUES ($1, $2, $3, $4, 'oauth2', true, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        access_token = $2,
        refresh_token = COALESCE($3, sheets_settings.refresh_token),
        token_expiry = $4,
        auth_type = 'oauth2',
        is_active = true,
        updated_at = NOW()
      RETURNING *
    `;
    const result = await pool.query(query, [
      userId,
      access_token,
      refresh_token,
      expiry_date ? new Date(expiry_date) : null
    ]);
    return result.rows[0];
  }

  // ==================== Notification Settings ====================

  async toggleNotifications(telegramId, enabled) {
    await pool.query(
      'UPDATE users SET notifications_enabled = $1 WHERE telegram_id = $2',
      [enabled, telegramId]
    );
  }
  async updateUserStoreName(userId, storeName) {
    const query = 'UPDATE users SET store_name = $1 WHERE telegram_id = $2';
    await pool.query(query, [storeName, userId]);
  }

  async setAIPauseState(userId, phoneNumber, isPaused) {
    const query = 'UPDATE contacts SET is_ai_paused = $1 WHERE user_id = $2 AND phone_number = $3';
    await pool.query(query, [isPaused, userId, phoneNumber]);
  }

  async getAIPauseState(userId, phoneNumber) {
    const query = 'SELECT is_ai_paused FROM contacts WHERE user_id = $1 AND phone_number = $2';
    const result = await pool.query(query, [userId, phoneNumber]);
    return result.rows[0]?.is_ai_paused || false;
  }

  async getUserStoreName(telegramId) {
    const query = 'SELECT store_name FROM users WHERE telegram_id = $1';
    const result = await pool.query(query, [telegramId]);
    return result.rows[0]?.store_name;
  }

  // ==================== Order Management ====================

  async saveOrder(userId, orderData) {
    // Handle products array for backward compatibility with the table schema
    let productName = orderData.product || '';
    let quantityText = orderData.quantity || '1';

    if (orderData.products && Array.isArray(orderData.products)) {
      productName = orderData.products.map(p => p.name).join(', ');
      quantityText = orderData.products.map(p => `${p.name}: ${p.quantity}`).join(' | ');
    }

    const query = `
      INSERT INTO orders (
        user_id, contact_phone, customer_name, customer_address, 
        product, quantity, total_price, product_link, notes, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
      RETURNING *
    `;
    const result = await pool.query(query, [
      userId,
      orderData.phone,
      orderData.customer_name,
      orderData.customer_address,
      productName,
      quantityText,
      orderData.total_price || null,
      orderData.product_link,
      orderData.notes
    ]);
    return result.rows[0];
  }

  async setUserGoogleMapsLink(userId, link) {
    const query = 'UPDATE users SET google_maps_link = $1 WHERE telegram_id = $2';
    await pool.query(query, [link, userId]);
  }

  async getUserGoogleMapsLink(telegramId) {
    const query = 'SELECT google_maps_link FROM users WHERE telegram_id = $1';
    const result = await pool.query(query, [telegramId]);
    return result.rows[0]?.google_maps_link;
  }

  async getOrders(userId) {
    const query = `
      SELECT * FROM orders 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  async getOrdersByTimeRange(userId, range) {
    let interval = '';
    if (range === '24h') {
      interval = "interval '24 hours'";
    } else if (range === 'month') {
      interval = "interval '30 days'"; // Or use date_trunc for exact month
    } else {
      return this.getOrders(userId);
    }

    const query = `
      SELECT * FROM orders 
      WHERE user_id = $1 
      AND created_at >= NOW() - ${interval}
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return result.rows;
  }
}

module.exports = new DatabaseService();
