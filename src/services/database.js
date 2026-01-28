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
    const query = `
      UPDATE users 
      SET is_connected = $1, phone_number = $2, updated_at = NOW()
      WHERE telegram_id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [isConnected, phoneNumber, telegramId]);
    return result.rows[0];
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

  // ============ AUTO REPLIES ============

  async getAutoReplies(userId) {
    const query = 'SELECT * FROM auto_replies WHERE user_id = $1 AND is_active = true';
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  async addAutoReply(userId, keyword, replyText) {
    const query = `
      INSERT INTO auto_replies (user_id, keyword, reply_text)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, keyword) DO UPDATE
      SET reply_text = $3, is_active = true
      RETURNING *
    `;
    const result = await pool.query(query, [userId, keyword.toLowerCase(), replyText]);
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

  async getContacts(userId, dateFrom = null, dateTo = null) {
    let query = 'SELECT * FROM contacts WHERE user_id = $1';
    const params = [userId];
    
    if (dateFrom) {
      query += ' AND first_message_at >= $2';
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ` AND first_message_at <= $${params.length + 1}`;
      params.push(dateTo);
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

  async setAISettings(userId, provider, apiKey, model, systemPrompt) {
    const query = `
      INSERT INTO ai_settings (user_id, provider, api_key, model, system_prompt, is_active)
      VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (user_id) DO UPDATE
      SET provider = $2, api_key = $3, model = $4, system_prompt = $5, is_active = true, updated_at = NOW()
      RETURNING *
    `;
    const result = await pool.query(query, [userId, provider, apiKey, model, systemPrompt]);
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
}

module.exports = new DatabaseService();
