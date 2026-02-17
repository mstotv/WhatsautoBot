const { google } = require('googleapis');
const db = require('./database');

class GoogleAuthService {
    constructor() {
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        // Use WEBHOOK_URL but strip /webhook if present to build the redirect URI
        const baseUrl = (process.env.WEBHOOK_URL || '').replace(/\/webhook$/, '');
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/auth/google/callback`;

        console.log(`📡 GoogleAuthService initialized with Redirect URI: ${this.redirectUri}`);
    }

    getOAuth2Client() {
        if (!this.clientId || !this.clientSecret) {
            console.error('❌ GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing in .env');
            return null;
        }
        return new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );
    }

    /**
     * Generate the authorization URL for Google OAuth
     */
    generateAuthUrl(telegramId) {
        const oauth2Client = this.getOAuth2Client();
        if (!oauth2Client) return null;

        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/userinfo.email'
            ],
            state: telegramId.toString(),
            prompt: 'consent' // Force to get refresh token
        });
    }

    /**
     * Exchange auth code for tokens
     */
    async getTokensFromCode(code) {
        const oauth2Client = this.getOAuth2Client();
        if (!oauth2Client) throw new Error('OAuth2 client not initialized');

        const { tokens } = await oauth2Client.getToken(code);
        return tokens;
    }

    /**
     * Get an authorized client using tokens from database
     */
    async getAuthorizedClient(userId) {
        const sheetsSettings = await db.getSheetsSettings(userId);
        if (!sheetsSettings || sheetsSettings.auth_type !== 'oauth2') {
            return null;
        }

        const oauth2Client = this.getOAuth2Client();
        if (!oauth2Client) return null;

        oauth2Client.setCredentials({
            access_token: sheetsSettings.access_token,
            refresh_token: sheetsSettings.refresh_token,
            expiry_date: sheetsSettings.token_expiry ? new Date(sheetsSettings.token_expiry).getTime() : null
        });

        // Check if token is expired or expiring soon (within 5 minutes)
        const isExpired = oauth2Client.isTokenExpiring();
        if (isExpired && sheetsSettings.refresh_token) {
            try {
                console.log('🔄 Refreshing Google OAuth token...');
                const { credentials } = await oauth2Client.refreshAccessToken();

                // Save new tokens
                await db.saveGoogleTokens(userId, {
                    access_token: credentials.access_token,
                    refresh_token: credentials.refresh_token || sheetsSettings.refresh_token,
                    expiry_date: credentials.expiry_date
                });

                oauth2Client.setCredentials(credentials);
            } catch (error) {
                console.error('❌ Error refreshing token:', error.message);
                return null;
            }
        }

        return oauth2Client;
    }
}

module.exports = new GoogleAuthService();
