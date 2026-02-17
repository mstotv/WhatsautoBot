const axios = require('axios');
require('dotenv').config();

class PlisioService {
    constructor() {
        this.apiKey = process.env.PLISIO_SECRET_KEY;
        this.baseUrl = 'https://api.plisio.net/api/v1';
    }

    /**
     * Create a new invoice/payment link
     * @param {Object} params { order_number, amount, currency, order_name, callback_url, success_url }
     */
    async createInvoice({ order_number, amount, currency, order_name = 'Subscription', callback_url, success_url }) {
        try {
            const params = {
                api_key: this.apiKey,
                order_number,
                order_name,
                callback_url,
                success_url,
                source_currency: 'USD',
                source_amount: amount,
                return_existing: 1
            };

            // Only add currency if it's a specific cryptocurrency
            if (currency && currency !== 'USD') {
                params.currency = currency;
            }

            const response = await axios.get(`${this.baseUrl}/invoices/new`, { params });

            if (response.data.status === 'success') {
                return response.data.data;
            } else {
                throw new Error(response.data.data.message || 'Failed to create Plisio invoice');
            }
        } catch (error) {
            console.error('Plisio createInvoice Error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Get operation details (to check status manually if needed)
     */
    async getOperation(id) {
        try {
            const response = await axios.get(`${this.baseUrl}/operations/${id}`, {
                params: { api_key: this.apiKey }
            });

            if (response.data.status === 'success') {
                return response.data.data;
            } else {
                throw new Error(response.data.data.message || 'Failed to get Plisio operation');
            }
        } catch (error) {
            console.error('Plisio getOperation Error:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = new PlisioService();
