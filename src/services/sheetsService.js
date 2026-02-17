const { google } = require('googleapis');

class SheetsService {

    /**
     * Get authenticated Sheets client from service account credentials JSON or OAuth tokens
     */
    getClient(credentialsOrTokens) {
        let auth;

        // Check if it's OAuth2 tokens (has access_token or token_expiry)
        if (credentialsOrTokens && (credentialsOrTokens.access_token || credentialsOrTokens.auth_type === 'oauth2')) {
            const googleAuthService = require('./googleAuthService');
            auth = googleAuthService.getOAuth2Client();
            auth.setCredentials({
                access_token: credentialsOrTokens.access_token,
                refresh_token: credentialsOrTokens.refresh_token,
                expiry_date: credentialsOrTokens.token_expiry ? new Date(credentialsOrTokens.token_expiry).getTime() : credentialsOrTokens.expiry_date
            });
        } else {
            // Fallback to Service Account
            let credentials;
            if (typeof credentialsOrTokens === 'string') {
                credentials = JSON.parse(credentialsOrTokens);
            } else {
                credentials = credentialsOrTokens;
            }

            auth = new google.auth.GoogleAuth({
                credentials: credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
        }

        return google.sheets({ version: 'v4', auth });
    }

    /**
     * Test connection to a Google Sheet
     * @returns {Promise<{success: boolean, title: string|null, error: string|null}>}
     */
    async testConnection(credentialsJson, spreadsheetId) {
        try {
            const sheets = this.getClient(credentialsJson);
            const res = await sheets.spreadsheets.get({ spreadsheetId });
            return {
                success: true,
                title: res.data.properties.title,
                error: null
            };
        } catch (error) {
            return {
                success: false,
                title: null,
                error: error.message
            };
        }
    }

    /**
     * Read data from a Google Sheet range
     * @returns {Promise<string>} Formatted text of sheet data for AI context
     */
    async readSheetData(credentialsJson, spreadsheetId, range = 'Sheet1!A:Z') {
        try {
            const sheets = this.getClient(credentialsJson);
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range
            });

            const rows = res.data.values;
            if (!rows || rows.length === 0) {
                return null;
            }

            // First row is headers, rest is data
            const headers = rows[0];
            let formattedText = `الأعمدة: ${headers.join(' | ')}\n`;
            formattedText += '---\n';

            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const rowData = headers.map((header, idx) => `${header}: ${row[idx] || '-'}`).join(' | ');
                formattedText += `${i}. ${rowData}\n`;
            }

            return formattedText;
        } catch (error) {
            console.error('Error reading sheet data:', error.message);
            return null;
        }
    }

    /**
     * Initialize required tabs and headers in a Google Sheet
     */
    async initializeSheet(credentialsJson, spreadsheetId) {
        try {
            const sheets = this.getClient(credentialsJson);

            // 1. Get existing sheets
            const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
            const existingSheetNames = spreadsheet.data.sheets.map(s => s.properties.title);

            const requests = [];

            // 2. Add "الطلبات" if missing
            if (!existingSheetNames.includes('الطلبات')) {
                requests.push({
                    addSheet: { properties: { title: 'الطلبات' } }
                });
            }

            // 3. Add "المنتجات" if missing
            if (!existingSheetNames.includes('المنتجات')) {
                requests.push({
                    addSheet: { properties: { title: 'المنتجات' } }
                });
            }

            if (requests.length > 0) {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    requestBody: { requests }
                });
            }

            // 4. Set Headers for "الطلبات"
            const orderHeaders = [
                ['التاريخ والوقت', 'اسم العميل', 'الرقم', 'العنوان', 'المشتريات', 'الكمية', 'رابط المنتج', 'ملاحظات', 'الحالة']
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: 'الطلبات!A1:I1',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: orderHeaders }
            });

            // 5. Set Headers for "المنتجات" (Optional but helpful)
            const productHeaders = [
                ['اسم المنتج', 'السعر', 'الوصف', 'الرابط/الصورة']
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: 'المنتجات!A1:D1',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: productHeaders }
            });

            return { success: true };
        } catch (error) {
            console.error('Error initializing sheet:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Write an order row to a Google Sheet
     * @param {object} orderData - {customer_name, customer_address, product, quantity, phone, product_link, notes}
     * @returns {Promise<boolean>}
     */
    async writeOrder(credentialsJson, spreadsheetId, range = 'الطلبات!A:A', orderData) {
        try {
            const sheets = this.getClient(credentialsJson);

            const now = new Date().toLocaleString('ar-EG', { timeZone: 'Asia/Baghdad' });

            // Professional Order Column Structure
            const row = [
                now,                                 // 1. التاريخ والوقت
                orderData.customer_name || '-',      // 2. اسم العميل
                orderData.phone || '-',              // 3. الرقم
                orderData.customer_address || '-',   // 4. العنوان
                orderData.product || '-',            // 5. المشتريات
                orderData.quantity || '1',           // 6. الكمية
                orderData.product_link || '-',       // 7. رابط المنتج/الصورة
                orderData.notes || '-',              // 8. ملاحظات
                'طلب جديد'                           // 9. الحالة
            ];

            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: range.includes('!') ? range : `الطلبات!A:A`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [row]
                }
            });

            return true;
        } catch (error) {
            console.error('Error writing order to sheet:', error.message);
            return false;
        }
    }
}

module.exports = new SheetsService();
