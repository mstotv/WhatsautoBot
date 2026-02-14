const axios = require('axios');

class EvolutionAPIService {
  constructor() {
    this.baseUrl = process.env.EVOLUTION_API_URL;
    this.apiKey = process.env.EVOLUTION_API_KEY;

    // Validate that required environment variables are present
    if (!this.baseUrl || !this.apiKey) {
      console.warn('⚠️ Warning: EVOLUTION_API_URL or EVOLUTION_API_KEY not set in environment variables');
      this.client = null;
      return;
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
  }

  /**
   * Create a new WhatsApp instance
   */
  async createInstance(instanceName, token) {
    if (!this.client) {
      throw new Error('Evolution API client not initialized. Check EVOLUTION_API_URL and EVOLUTION_API_KEY environment variables.');
    }

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
    if (!this.client) {
      throw new Error('Evolution API client not initialized. Check EVOLUTION_API_URL and EVOLUTION_API_KEY environment variables.');
    }

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
    if (!this.client) {
      throw new Error('Evolution API client not initialized. Check EVOLUTION_API_URL and EVOLUTION_API_KEY environment variables.');
    }

    try {
      const response = await this.client.get(`/instance/connectionState/${instanceName}`);
      return response.data;
    } catch (error) {
      console.error('Error getting instance status:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Check if a number is on WhatsApp and get its real JID
   */
  async checkNumber(instanceName, number) {
    if (!this.client) {
      throw new Error('Evolution API client not initialized.');
    }

    try {
      // In v2, this is often under /chat/checkNumberStatus/instanceName
      const response = await this.client.post(`/chat/checkNumberStatus/${instanceName}`, {
        numbers: [number]
      });
      return response.data;
    } catch (error) {
      console.error('Error checking number status:', error.response?.data || error.message);
      return null;
    }
  }

  /**
   * Logout and delete instance
   */
  async deleteInstance(instanceName) {
    if (!this.client) {
      throw new Error('Evolution API client not initialized. Check EVOLUTION_API_URL and EVOLUTION_API_KEY environment variables.');
    }

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
  async sendTextMessage(instanceName, remoteId, text) {
    if (!this.client) {
      throw new Error('Evolution API client not initialized.');
    }

    try {
      const payload = {
        number: remoteId,
        text: text
      };

      const response = await this.client.post(`/message/sendText/${instanceName}`, payload);
      return response.data;
    } catch (error) {
      console.error('Error sending text message:', error.response?.data || error.message);
      throw error;
    }
  }


  async sendMediaMessage(instanceName, phoneNumber, mediaUrl, caption, mediaType = 'image') {
    if (!this.client) {
      throw new Error('Evolution API client not initialized.');
    }

    try {
      console.log(`📡 Sending ${mediaType} to ${phoneNumber} via ${instanceName}...`);

      const payload = {
        number: phoneNumber,
        mediatype: mediaType === 'document' ? 'document' : (mediaType === 'video' ? 'video' : 'image'),
        media: mediaUrl,
        caption: caption || ''
      };

      // v2 often requires mimetype for videos and documents
      if (mediaType === 'video') {
        payload.mimetype = 'video/mp4';
      } else if (mediaType === 'image') {
        payload.mimetype = 'image/jpeg';
      } else if (mediaType === 'document') {
        payload.mimetype = 'application/octet-stream';
      }

      // Try to refine mimetype if URL has extension
      const lowerUrl = mediaUrl.toLowerCase();
      if (lowerUrl.includes('.png')) payload.mimetype = mediaType === 'image' ? 'image/png' : payload.mimetype;
      if (lowerUrl.includes('.webp')) payload.mimetype = mediaType === 'image' ? 'image/webp' : payload.mimetype;
      if (lowerUrl.includes('.gif')) payload.mimetype = 'video/mp4'; // GIFs are often better as videos
      if (lowerUrl.includes('.pdf')) payload.mimetype = 'application/pdf';

      // If document, we can add a fileName
      if (mediaType === 'document') {
        payload.fileName = payload.fileName || 'File';
      }

      console.log(`📦 Media Payload:`, JSON.stringify(payload));
      const response = await this.client.post(`/message/sendMedia/${instanceName}`, payload);
      console.log(`✅ Media send success:`, JSON.stringify(response.data));
      return response.data;
    } catch (error) {
      console.error('❌ Error sending media:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }

  /**
   * Set webhook for instance
   */
  async setWebhook(instanceName, webhookUrl) {
    if (!this.client) {
      throw new Error('Evolution API client not initialized. Check EVOLUTION_API_URL and EVOLUTION_API_KEY environment variables.');
    }

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
    if (!this.client) {
      throw new Error('Evolution API client not initialized. Check EVOLUTION_API_URL and EVOLUTION_API_KEY environment variables.');
    }

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
