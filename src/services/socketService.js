const { io } = require('socket.io-client');
const { pool } = require('../database/migrate');
const db = require('./database');
const evolutionAPI = require('./evolutionAPI');

class SocketService {
    constructor(apiServer, telegramBot) {
        this.apiServer = apiServer;
        this.telegramBot = telegramBot;
        this.pollingIntervals = new Map(); // Store intervals for each instance
        this.processedMessages = new Set(); // To avoid duplicate processing
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
            // console.log(`🔄 Polling active for ${instanceName}...`);
            try {
                // Fetch latest messages from Evolution API
                if (!evolutionAPI.client) {
                    throw new Error('Evolution API client not initialized');
                }
                const response = await evolutionAPI.client.get(`/chat/findMessages/${instanceName}?limit=10`);

                // Evolution API v2 puts messages in 'records' array
                const messages = response.data?.records || response.data || [];

                if (messages.length > 0) {
                    // console.log(`🔍 Polling ${instanceName}: Found ${messages.length} message(s)`);
                }

                for (const message of messages) {
                    const messageId = message.key?.id;

                    if (!messageId) continue;

                    // Skip if message from me or already processed
                    if (message.key?.fromMe || this.processedMessages.has(messageId)) {
                        continue;
                    }

                    console.log(`📥 NEW MESSAGE [Polling]: From ${message.key.remoteJid} - ID: ${messageId}`);

                    // Process the message
                    await this.apiServer.handleIncomingMessage(user, {
                        event: 'messages.upsert',
                        instance: instanceName,
                        data: {
                            messages: [message]
                        }
                    });

                    // Mark as processed
                    this.processedMessages.add(messageId);
                    // Keep set size manageable
                    if (this.processedMessages.size > 1000) {
                        const firstItem = this.processedMessages.values().next().value;
                        this.processedMessages.delete(firstItem);
                    }
                }
            } catch (error) {
                // Silent error for polling unless critical
                if (error.response?.status !== 404) {
                    console.error(`❌ Polling error for ${instanceName}:`, error.message);
                }
            }
        }, 5000); // Check every 5 seconds

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
