const { io } = require('socket.io-client');
const { pool } = require('../database/migrate');
const db = require('./database');
const evolutionAPI = require('./evolutionAPI');

class SocketService {
    constructor(apiServer, telegramBot) {
        this.apiServer = apiServer;
        this.telegramBot = telegramBot;
        this.pollingIntervals = new Map(); // Store intervals for each instance
        this.startTime = Math.floor(Date.now() / 1000); // Store bot startup time in seconds
    }

    /**
     * Initialize socket connections for all connected users
     */
    async init() {
        try {
            // Get all connected users from DB
            const result = await pool.query('SELECT * FROM users WHERE instance_name IS NOT NULL');
            const users = result.rows;

            console.log(`� Initializing Message Polling for ${users.length} users...`);

            for (const user of users) {
                this.startPolling(user);
            }
        } catch (error) {
            console.error('Error initializing polling:', error);
        }
    }

    /**
     * Start polling for a specific instance
     */
    async startPolling(user) {
        const instanceName = user.instance_name;

        if (this.pollingIntervals.has(instanceName)) {
            console.log(`ℹ️ Polling already active for ${instanceName}, skipping.`);
            return;
        }

        console.log(`📡 Starting Message Polling for ${instanceName}...`);

        const interval = setInterval(async () => {
            try {
                // Fetch latest messages from Evolution API v2 using POST
                const response = await evolutionAPI.client.post(`/chat/findMessages/${instanceName}`, {
                    "paging": {
                        "limit": 10,
                        "offset": 0
                    }
                });

                // Evolution API v2 puts messages in 'messages.records' array
                const messages = response.data?.messages?.records || response.data?.records || response.data || [];

                if (messages.length > 0) {
                    // console.log(`🔍 [Polling] ${instanceName}: Found ${messages.length} message(s)`);
                }

                for (const message of messages) {
                    const messageId = message.key?.id;

                    if (!messageId) {
                        console.log(`⚠️ [Polling] Message missing key.id`, message);
                        continue;
                    }

                    // Skip if from me or already processed globally
                    if (message.key?.fromMe || this.apiServer.processedMessages.has(messageId)) {
                        continue;
                    }

                    // Skip if message received before bot started
                    const messageTimestamp = message.messageTimestamp || message.timestamp;
                    if (messageTimestamp && messageTimestamp < this.startTime) {
                        console.log(`⏭️ [Polling] Skipping old message: ${messageId}`);
                        continue;
                    }

                    console.log(`📥 NEW MESSAGE [Polling]: From ${message.key.remoteJid} - ID: ${messageId}`);
                    // APIServer.handleIncomingMessage will now handle deduplication globally
                    await this.apiServer.handleIncomingMessage(user, { messages: [message] });
                }
            } catch (error) {
                // Silent error for polling unless critical
                if (error.response?.status !== 404) {
                    console.error(`❌ Polling error for ${instanceName}:`, error.message);
                }
            }
        }, 1000); // Check every 1 second for instant response

        this.pollingIntervals.set(instanceName, interval);
    }

    /**
     * Disconnect/Stop polling
     */
    stopPolling(instanceName) {
        const interval = this.pollingIntervals.get(instanceName);
        if (interval) {
            clearInterval(interval);
            this.pollingIntervals.delete(instanceName);
            console.log(`� Polling stopped for ${instanceName}`);
        }
    }

    // Compatibility method for existing calls
    async connectInstance(user) {
        return this.startPolling(user);
    }
}

module.exports = SocketService;
