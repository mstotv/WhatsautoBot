const Queue = require('bull');
const db = require('../services/database');
const { pool } = require('../database/migrate');
const evolutionAPI = require('../services/evolutionAPI');

class BroadcastQueue {
  constructor() {
    // Use Redis if available, otherwise skip queue (for production without Redis)
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.queue = new Queue('broadcast', redisUrl);
      this.setupProcessors();
      console.log('✅ Broadcast queue initialized with Redis');
    } else {
      this.queue = null;
      console.log('⚠️ Broadcast queue disabled (no Redis URL)');
    }
  }

  // Check if queue is available
  isAvailable() {
    return this.queue !== null;
  }

  setupProcessors() {
    if (!this.queue) return;
    
    // Process broadcast jobs
    this.queue.process('send-broadcast', async (job) => {
      const { broadcastId, userId, instanceName } = job.data;
      
      console.log(`📢 Processing broadcast ${broadcastId} for user ${userId}`);
      
      try {
        // Get broadcast details
        const broadcast = await this.getBroadcast(broadcastId);
        if (!broadcast) {
          throw new Error('Broadcast not found');
        }

        // Get recipients
        const recipients = await this.getBroadcastRecipients(broadcastId);
        
        // Update status to sending
        await db.updateBroadcastStatus(broadcastId, 'sending');

        let sentCount = 0;
        let failedCount = 0;

        // Send to each recipient
        for (const recipient of recipients) {
          try {
            await this.sendBroadcastMessage(
              instanceName,
              recipient.phone_number,
              broadcast.message_text,
              broadcast.media_url,
              broadcast.media_type
            );

            await db.updateBroadcastRecipient(recipient.id, 'sent');
            sentCount++;

            // Update progress
            job.progress((sentCount / recipients.length) * 100);

            // Rate limiting - wait 2 seconds between messages
            await this.sleep(2000);
          } catch (error) {
            console.error(`Failed to send to ${recipient.phone_number}:`, error.message);
            await db.updateBroadcastRecipient(recipient.id, 'failed', error.message);
            failedCount++;
          }
        }

        // Update final status
        await db.updateBroadcastStatus(broadcastId, 'completed', sentCount, failedCount);

        console.log(`✅ Broadcast ${broadcastId} completed: ${sentCount} sent, ${failedCount} failed`);

        return { sentCount, failedCount };
      } catch (error) {
        console.error(`❌ Broadcast ${broadcastId} failed:`, error);
        await db.updateBroadcastStatus(broadcastId, 'failed');
        throw error;
      }
    });

    // Queue event handlers
    this.queue.on('completed', (job, result) => {
      console.log(`✅ Job ${job.id} completed:`, result);
    });

    this.queue.on('failed', (job, error) => {
      console.error(`❌ Job ${job.id} failed:`, error.message);
    });

    this.queue.on('progress', (job, progress) => {
      console.log(`📊 Job ${job.id} progress: ${progress}%`);
    });
  }

  async sendBroadcastMessage(instanceName, phoneNumber, text, mediaUrl, mediaType) {
    if (mediaUrl && mediaType) {
      // Send media message
      await evolutionAPI.sendMediaMessage(
        instanceName,
        phoneNumber,
        mediaUrl,
        text,
        mediaType
      );
    } else {
      // Send text message
      await evolutionAPI.sendTextMessage(instanceName, phoneNumber, text);
    }
  }

  async addBroadcastJob(broadcastId, userId, instanceName, telegramUserId) {
    if (!this.isAvailable()) {
      console.log('⚠️ Cannot add broadcast job - Redis not available');
      return null;
    }
    
    const job = await this.queue.add('send-broadcast', {
      broadcastId,
      userId,
      instanceName,
      telegramUserId
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      },
      removeOnComplete: true,
      removeOnFail: false
    });

    console.log(`📝 Broadcast job ${job.id} added to queue`);
    return job;
  }

  async getBroadcast(broadcastId) {
    const result = await pool.query(
      'SELECT * FROM broadcasts WHERE id = $1',
      [broadcastId]
    );
    return result.rows[0];
  }

  async getBroadcastRecipients(broadcastId) {
    const result = await pool.query(`
      SELECT br.id, c.phone_number, c.name
      FROM broadcast_recipients br
      JOIN contacts c ON br.contact_id = c.id
      WHERE br.broadcast_id = $1 AND br.status = 'pending'
    `, [broadcastId]);
    return result.rows;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getJobProgress(jobId) {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;

    return {
      id: job.id,
      progress: await job.progress(),
      state: await job.getState()
    };
  }
}

module.exports = BroadcastQueue;
