const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

class ExcelService {
    /**
     * Generate an Excel file for orders
     * @param {Array} orders List of order objects
     * @param {string} fileName Name of the file to be generated
     * @returns {string} Absolute path to the generated file
     */
    async generateOrdersExport(orders, fileName = 'orders_export.xlsx') {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Orders');

        // Set column headers
        worksheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'تاريخ الطلب', key: 'created_at', width: 20 },
            { header: 'رقم الهاتف', key: 'contact_phone', width: 15 },
            { header: 'اسم العميل', key: 'customer_name', width: 20 },
            { header: 'العنوان', key: 'customer_address', width: 30 },
            { header: 'المنتج', key: 'product', width: 25 },
            { header: 'الكمية', key: 'quantity', width: 10 },
            { header: 'السعر الإجمالي', key: 'total_price', width: 15 },
            { header: 'رابط المنتج', key: 'product_link', width: 30 },
            { header: 'ملاحظات', key: 'notes', width: 30 },
            { header: 'الحالة', key: 'status', width: 15 }
        ];

        // Style the header
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // Add rows
        orders.forEach(order => {
            worksheet.addRow({
                id: order.id,
                created_at: new Date(order.created_at).toLocaleString('ar-EG', { timeZone: 'Asia/Baghdad' }),
                contact_phone: order.contact_phone,
                customer_name: order.customer_name,
                customer_address: order.customer_address,
                product: order.product,
                quantity: order.quantity,
                total_price: order.total_price,
                product_link: order.product_link,
                notes: order.notes,
                status: order.status
            });
        });

        // Ensure temp directory exists
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        const filePath = path.join(tempDir, `${Date.now()}_${fileName}`);
        await workbook.xlsx.writeFile(filePath);

        return filePath;
    }
}

module.exports = new ExcelService();
