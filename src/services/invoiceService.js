const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const ArabicReshaper = require('arabic-reshaper');
const bidiFactory = require('bidi-js');
const bidi = bidiFactory();

class InvoiceService {
    constructor() {
        // Path to a Unicode font that supports Arabic (and others)
        // On Windows, Arial is a safe bet.
        this.fontPath = 'C:\\Windows\\Fonts\\arial.ttf';

        // Check if font exists, otherwise use default (Arabic will be broken without a Unicode font)
        if (!fs.existsSync(this.fontPath)) {
            console.warn('⚠️ Arabic font (Arial) not found at C:\\Windows\\Fonts\\arial.ttf. Arabic text might not render correctly.');
            this.fontPath = null;
        }
    }

    // Reshape and reorder Arabic text for PDF
    processArabic(text) {
        if (!text) return '';
        // Check if contains Arabic characters
        const arabicPattern = /[\u0600-\u06FF]/;
        if (!arabicPattern.test(text)) return text;

        try {
            const reshaped = ArabicReshaper.reshape(text);
            const bidiText = bidi.getReorderedText(reshaped);
            return bidiText;
        } catch (e) {
            console.error('Error reshaping Arabic:', e.message);
            return text;
        }
    }

    async generateInvoice(orderData, storeName, filePath, lang = 'ar') {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 50 });
                const stream = fs.createWriteStream(filePath);
                doc.pipe(stream);

                // Load font if available
                if (this.fontPath) {
                    doc.font(this.fontPath);
                }

                const isRTL = lang === 'ar';
                const align = isRTL ? 'right' : 'left';

                // Translations
                const labels = {
                    ar: { invoice: 'الفاتورة', customer: 'العميل', phone: 'الهاتف', address: 'العنوان', details: 'تفاصيل الطلب', subtotal: 'المجموع الفرعي', delivery: 'التوصيل', total: 'الإجمالي الكلي', note: 'شكراً لتعاملك معنا!', item: 'المنتج', qty: 'الكمية', price: 'السعر' },
                    en: { invoice: 'Invoice', customer: 'Customer', phone: 'Phone', address: 'Address', details: 'Order Details', subtotal: 'Subtotal', delivery: 'Delivery', total: 'Total Price', note: 'Thank you for your business!', item: 'Item', qty: 'Qty', price: 'Price' },
                    fr: { invoice: 'Facture', customer: 'Client', phone: 'Téléphone', address: 'Adresse', details: 'Détails de la commande', subtotal: 'Sous-total', delivery: 'Livraison', total: 'Prix Total', note: 'Merci pour votre confiance!', item: 'Article', qty: 'Qté', price: 'Prix' },
                    de: { invoice: 'Rechnung', customer: 'Kunde', phone: 'Telefon', address: 'Adresse', details: 'Bestelldetails', subtotal: 'Zwischensumme', delivery: 'Lieferung', total: 'Gesamtpreis', note: 'Vielen Dank für Ihren Besuch!', item: 'Artikel', qty: 'Menge', price: 'Preis' }
                };

                const l = labels[lang] || labels.en;

                // Header
                doc
                    .fillColor('#444444')
                    .fontSize(20)
                    .text(this.processArabic(storeName || 'Store Invoice'), 0, 57, { align: isRTL ? 'right' : 'left' })
                    .fontSize(10)
                    .text(new Date().toLocaleString(), 0, 65, { align: isRTL ? 'left' : 'right' })
                    .moveDown();

                // Horizontal Line
                doc.strokeColor('#aaaaaa').lineWidth(1).moveTo(50, 90).lineTo(550, 90).stroke();

                // Customer Info
                doc.fontSize(12).moveDown(2);
                doc.text(`${this.processArabic(l.customer)}: ${this.processArabic(orderData.customer_name || 'N/A')}`, { align });
                doc.text(`${this.processArabic(l.phone)}: ${orderData.phone || 'N/A'}`, { align });
                doc.text(`${this.processArabic(l.address)}: ${this.processArabic(orderData.customer_address || 'N/A')}`, { align });

                // Order Details Header
                doc.fontSize(14).moveDown().text(this.processArabic(l.details), { align, underline: true }).moveDown();

                // Table Header
                doc.fontSize(10).fillColor('#333333');
                const startY = doc.y;
                if (isRTL) {
                    doc.text(this.processArabic(l.item), 250, startY, { width: 200, align: 'right' });
                    doc.text(this.processArabic(l.qty), 150, startY, { width: 50, align: 'center' });
                    doc.text(this.processArabic(l.price), 50, startY, { width: 100, align: 'left' });
                } else {
                    doc.text(this.processArabic(l.item), 50, startY, { width: 250, align: 'left' });
                    doc.text(this.processArabic(l.qty), 300, startY, { width: 50, align: 'center' });
                    doc.text(this.processArabic(l.price), 350, startY, { width: 100, align: 'right' });
                }
                doc.moveDown(0.5);
                doc.strokeColor('#eeeeee').lineWidth(0.5).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
                doc.moveDown(0.5);

                // Items
                doc.fontSize(11).fillColor('#000000');
                let itemsSubtotal = 0;

                if (orderData.products && Array.isArray(orderData.products)) {
                    orderData.products.forEach((product) => {
                        const rowY = doc.y;
                        const price = parseFloat(product.price) || 0;
                        const qty = parseInt(product.quantity) || 1;
                        const lineTotal = price * qty;
                        itemsSubtotal += lineTotal;

                        if (isRTL) {
                            doc.text(this.processArabic(product.name), 250, rowY, { width: 200, align: 'right' });
                            doc.text(qty.toString(), 150, rowY, { width: 50, align: 'center' });
                            doc.text(`${price}`, 50, rowY, { width: 100, align: 'left' });
                        } else {
                            doc.text(this.processArabic(product.name), 50, rowY, { width: 250, align: 'left' });
                            doc.text(qty.toString(), 300, rowY, { width: 50, align: 'center' });
                            doc.text(`${price}`, 350, rowY, { width: 100, align: 'right' });
                        }
                        doc.moveDown(0.5);
                    });
                } else {
                    // Fallback for single product
                    const name = orderData.product || 'N/A';
                    const qty = parseInt(orderData.quantity) || 1;
                    const price = parseFloat(orderData.price) || 0;
                    itemsSubtotal = price * qty;

                    const rowY = doc.y;
                    if (isRTL) {
                        doc.text(this.processArabic(name), 250, rowY, { width: 200, align: 'right' });
                        doc.text(qty.toString(), 150, rowY, { width: 50, align: 'center' });
                        doc.text(`${price}`, 50, rowY, { width: 100, align: 'left' });
                    } else {
                        doc.text(this.processArabic(name), 50, rowY, { width: 250, align: 'left' });
                        doc.text(qty.toString(), 300, rowY, { width: 50, align: 'center' });
                        doc.text(`${price}`, 350, rowY, { width: 100, align: 'right' });
                    }
                }

                doc.moveDown();
                doc.strokeColor('#aaaaaa').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
                doc.moveDown(0.5);

                // Calculations
                const deliveryPrice = parseFloat(orderData.delivery_price) || 0;
                const totalPrice = orderData.total_price ? parseFloat(orderData.total_price) : (itemsSubtotal + deliveryPrice);

                doc.fontSize(11).fillColor('#333333');

                // Subtotal
                let calcY = doc.y;
                if (isRTL) {
                    doc.text(this.processArabic(l.subtotal), 150, calcY, { width: 100, align: 'right' });
                    doc.text(`${itemsSubtotal}`, 50, calcY, { width: 100, align: 'left' });
                    doc.moveDown(0.8);

                    calcY = doc.y;
                    doc.text(this.processArabic(l.delivery), 150, calcY, { width: 100, align: 'right' });
                    doc.text(`${deliveryPrice}`, 50, calcY, { width: 100, align: 'left' });
                    doc.moveDown(1);

                    calcY = doc.y;
                    doc.fontSize(14).fillColor('#000000').font(this.fontPath ? this.fontPath : 'Helvetica-Bold');
                    doc.text(this.processArabic(l.total), 150, calcY, { width: 100, align: 'right' });
                    doc.text(`${totalPrice}`, 50, calcY, { width: 100, align: 'left' });
                } else {
                    doc.text(this.processArabic(l.subtotal), 300, calcY, { width: 100, align: 'left' });
                    doc.text(`${itemsSubtotal}`, 400, calcY, { width: 100, align: 'right' });
                    doc.moveDown(0.8);

                    calcY = doc.y;
                    doc.text(this.processArabic(l.delivery), 300, calcY, { width: 100, align: 'left' });
                    doc.text(`${deliveryPrice}`, 400, calcY, { width: 100, align: 'right' });
                    doc.moveDown(1);

                    calcY = doc.y;
                    doc.fontSize(14).fillColor('#000000').font(this.fontPath ? this.fontPath : 'Helvetica-Bold');
                    doc.text(this.processArabic(l.total), 300, calcY, { width: 100, align: 'left' });
                    doc.text(`${totalPrice}`, 400, calcY, { width: 100, align: 'right' });
                }

                // Reset font for footer
                if (this.fontPath) doc.font(this.fontPath);

                // Footer
                doc.fontSize(10).fillColor('#444444')
                    .text(this.processArabic(l.note), 50, 700, { align: 'center', width: 500 });

                doc.end();

                stream.on('finish', () => resolve(filePath));
                stream.on('error', (err) => reject(err));
            } catch (error) {
                reject(error);
            }
        });
    }
}

module.exports = new InvoiceService();
