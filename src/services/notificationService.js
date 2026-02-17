/**
 * Notification Service
 * Sends Telegram notifications to the bot USER (not admin) 
 * when WhatsApp activity occurs.
 */

class NotificationService {
    constructor() {
        // Throttle: track last notification time per user+contact
        this.lastNotification = new Map();
        this.THROTTLE_MS = 30000; // 30 seconds between notifications per contact
    }

    /**
     * Check if we should send a notification (throttle)
     */
    shouldNotify(userTelegramId, contactPhone) {
        const key = `${userTelegramId}_${contactPhone}`;
        const now = Date.now();
        const last = this.lastNotification.get(key) || 0;

        if (now - last < this.THROTTLE_MS) {
            return false;
        }

        this.lastNotification.set(key, now);

        // Clean old entries (older than 5 minutes)
        if (this.lastNotification.size > 1000) {
            for (const [k, v] of this.lastNotification) {
                if (now - v > 300000) this.lastNotification.delete(k);
            }
        }

        return true;
    }

    /**
     * Notify user about a new incoming WhatsApp message
     */
    async notifyNewMessage(bot, userTelegramId, contactName, contactPhone, messageText) {
        if (!this.shouldNotify(userTelegramId, contactPhone)) return;

        try {
            const truncatedMsg = messageText.length > 200 ? messageText.substring(0, 200) + '...' : messageText;
            const name = contactName || 'غير معروف';

            const message =
                `📨 <b>رسالة واتساب جديدة</b>\n\n` +
                `👤 <b>من:</b> ${name}\n` +
                `📱 <b>الرقم:</b> ${contactPhone}\n` +
                `━━━━━━━━━━━━━━━\n` +
                `💬 ${truncatedMsg}\n` +
                `━━━━━━━━━━━━━━━\n` +
                `🕐 ${new Date().toLocaleString('ar-EG', { timeZone: 'Asia/Baghdad' })}`;

            await bot.telegram.sendMessage(userTelegramId, message, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⏸️ إيقاف الذكاء لهذا الرقم', callback_data: `pause_ai:${contactPhone}` }]
                    ]
                }
            });
        } catch (error) {
            console.error(`Error sending message notification to ${userTelegramId}:`, error.message);
        }
    }

    /**
     * Notify user about a new order detected by AI
     */
    async notifyNewOrder(bot, userTelegramId, orderData, contactPhone, contactName = 'غير معروف') {
        try {
            let productsList = orderData.product || 'غير محدد';
            if (orderData.products && Array.isArray(orderData.products)) {
                productsList = orderData.products.map(p => `• ${p.name} (${p.quantity || 1}) - ${p.price || 0}`).join('\n');
            }

            const message =
                `🛒 <b>طلب جديد!</b>\n\n` +
                `━━━━━━━━━━━━━━━\n` +
                `👤 <b>العميل:</b> ${orderData.customer_name || contactName}\n` +
                `📱 <b>الرقم:</b> ${contactPhone.replace('@s.whatsapp.net', '')}\n` +
                `📍 <b>العنوان:</b> ${orderData.customer_address || 'غير محدد'}\n` +
                `📦 <b>المنتجات:</b>\n${productsList}\n` +
                `� <b>التوصيل:</b> ${orderData.delivery_price || '0'}\n` +
                `� <b>الإجمالي:</b> ${orderData.total_price || 'غير محدد'}\n` +
                `📝 <b>ملاحظات:</b> ${orderData.notes || 'لا يوجد'}\n` +
                `━━━━━━━━━━━━━━━\n` +
                `🕐 ${new Date().toLocaleString('ar-EG', { timeZone: 'Asia/Baghdad' })}\n\n` +
                `✅ تم تسجيل الطلب وإرسال الفاتورة للعميل`;

            await bot.telegram.sendMessage(userTelegramId, message, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '👨‍🍳 جاري التجهيز', callback_data: `ord_st:cooking:${contactPhone}` },
                            { text: '🛵 تم الإرسال', callback_data: `ord_st:delivery:${contactPhone}` }
                        ],
                        [
                            { text: '✅ تم التسليم (مكتمل)', callback_data: `ord_st:completed:${contactPhone}` }
                        ],
                        [
                            { text: '⏸️ إيقاف الذكاء لهذا الرقم', callback_data: `pause_ai:${contactPhone}` }
                        ]
                    ]
                }
            });
        } catch (error) {
            console.error(`Error sending order notification to ${userTelegramId}:`, error.message);
        }
    }

    /**
     * Notify user about AI reply sent
     */
    async notifyAIReplied(bot, userTelegramId, contactPhone, contactName, aiReply) {
        // This is optional - only notify if there's something important
        // We don't want to spam the user with every AI reply
        // Only notify for the first message in a conversation
    }
}

module.exports = new NotificationService();
