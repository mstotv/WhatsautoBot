const axios = require('axios');

class EvolutionAPIService {
  constructor() {
    this.baseUrl = process.env.EVOLUTION_API_URL;
    this.apiKey = process.env.EVOLUTION_API_KEY;
    this.client = null;

    this.init();
  }

  /**
   * Initialize the Axios client
   */
  init() {
    this.baseUrl = process.env.EVOLUTION_API_URL;
    this.apiKey = process.env.EVOLUTION_API_KEY;

    if (!this.baseUrl || !this.apiKey) {
      console.warn('⚠️ Warning: EVOLUTION_API_URL or EVOLUTION_API_KEY not set in environment variables');
      return false;
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.apiKey,
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json'
      }
    });
    return true;
  }

  /**
   * Ensure client is initialized before any request
   */
  ensureClient() {
    if (!this.client) {
      this.init();
    }

    if (!this.client) {
      const missing = [];
      if (!process.env.EVOLUTION_API_URL) missing.push('EVOLUTION_API_URL');
      if (!process.env.EVOLUTION_API_KEY) missing.push('EVOLUTION_API_KEY');

      throw new Error(`Evolution API client not initialized. Missing: ${missing.join(', ')}. Please check your environment variables.`);
    }
  }

  /**
   * Create a new WhatsApp instance
   */
  async createInstance(instanceName, token) {
    this.ensureClient();

    try {
      const response = await this.client.post('/instance/create', {
        instanceName: instanceName,
        token: token,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        shouldStoreMessages: true,
        shouldStoreState: true,
        shouldStoreContacts: true,
        shouldStoreChats: true
      });

      return response.data;
    } catch (error) {
      console.error('Error creating instance:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          baseURL: error.config?.baseURL
        }
      });
      throw error;
    }
  }

  /**
   * Get QR Code for an instance
   */
  async getQRCode(instanceName) {
    this.ensureClient();

    try {
      const response = await this.client.get(`/instance/connect/${instanceName}`);
      return response.data;
    } catch (error) {
      console.error('Error getting QR code:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Check instance connection status
   */
  async getInstanceStatus(instanceName) {
    this.ensureClient();

    try {
      const response = await this.client.get(`/instance/connectionState/${instanceName}`);
      return response.data;
    } catch (error) {
      console.error('Error getting instance status:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Logout and delete instance
   */
  async deleteInstance(instanceName) {
    this.ensureClient();

    try {
      await this.client.delete(`/instance/logout/${instanceName}`);
      await this.client.delete(`/instance/delete/${instanceName}`);
      return true;
    } catch (error) {
      console.error('Error deleting instance:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send text message
   */
  async sendTextMessage(instanceName, phoneNumber, text) {
    this.ensureClient();

    try {
      const response = await this.client.post(`/message/sendText/${instanceName}`, {
        number: phoneNumber,
        text: text
      });
      return response.data;
    } catch (error) {
      console.error('Error sending message:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send media message (image/video)
   */
  async sendMediaMessage(instanceName, phoneNumber, mediaUrl, caption, mediaType = 'image') {
    this.ensureClient();

    try {
      const endpoint = mediaType === 'image' ? 'sendMedia' : 'sendMedia';
      const response = await this.client.post(`/message/${endpoint}/${instanceName}`, {
        number: phoneNumber,
        mediatype: mediaType,
        media: mediaUrl,
        caption: caption || ''
      });
      return response.data;
    } catch (error) {
      console.error('Error sending media:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Set webhook for instance
   */
  async setWebhook(instanceName, webhookUrl) {
    this.ensureClient();

    try {
      const response = await this.client.post(`/webhook/set/${instanceName}`, {
        enabled: true,
        url: webhookUrl,
        webhook_by_events: false,
        webhook_base64: false,
        events: [
          'QRCODE_UPDATED',
          'CONNECTION_UPDATE',
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'SEND_MESSAGE'
        ]
      });
      return response.data;
    } catch (error) {
      console.error('Error setting webhook:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get instance info including phone number
   */
  async getInstanceInfo(instanceName) {
    this.ensureClient();

    try {
      const response = await this.client.get(`/instance/fetchInstances?instanceName=${instanceName}`);
      return response.data;
    } catch (error) {
      console.error('Error getting instance info:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new EvolutionAPIService();
