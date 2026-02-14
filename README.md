# 🤖 WhatsApp Automation Bot with Telegram

نظام كامل لإدارة واتساب تلقائياً عبر تليجرام مع ميزات متقدمة.

## 🎯 الميزات

✅ **ربط واتساب** - QR Code من Evolution API  
✅ **ردود تلقائية** - كلمات مفتاحية مخصصة  
✅ **ذكاء اصطناعي** - ربط DeepSeek API للردود الذكية  
✅ **أوقات العمل** - رسائل تلقائية خارج أوقات الدوام  
✅ **برودكاست** - إرسال رسائل جماعية (نص/صورة/فيديو)  
✅ **فلترة متقدمة** - اختيار المستلمين حسب التاريخ  
✅ **إحصائيات** - تتبع جهات الاتصال والرسائل  

---

## 📋 المتطلبات

- ✅ VPS مع Coolify
- ✅ Evolution API منصبة (عندك: https://evo.magicaikrd.com)
- ✅ Telegram Bot Token
- ✅ قناة تليجرام للاشتراك الإجباري

---

## 🚀 خطوات النشر على Coolify

### الخطوة 1: إعداد المتغيرات

انسخ ملف `.env.example` إلى `.env` وعدّل القيم:

```bash
cp .env.example .env
nano .env
```

املأ المتغيرات التالية:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=8343716709:AAGDR50O1DHC6ipTqIEVPSeb--Fkfp5iuhk
TELEGRAM_CHANNEL_USERNAME=@mstoviral

# Evolution API
EVOLUTION_API_URL=https://evo.magicaikrd.com
EVOLUTION_API_KEY=WHgLsQ9TA3tjEHr1hLMc64RB5t4yBgB6

# Database (سيتم إنشاؤها تلقائياً)
POSTGRES_USER=whatsapp_user
POSTGRES_PASSWORD=YOUR_SECURE_PASSWORD_HERE
POSTGRES_DB=whatsapp_bot

# Server
PORT=3000
WEBHOOK_URL=https://YOUR-BOT-DOMAIN.com/webhook

# Optional: DeepSeek AI
DEEPSEEK_API_URL=https://api.deepseek.com
```

---

### الخطوة 2: النشر على Coolify

#### **الطريقة الأولى: عبر Docker Compose (موصى به)**

1. **رفع المشروع إلى Git Repository** (GitHub/GitLab)
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_REPO_URL
   git push -u origin main
   ```

2. **في Coolify Dashboard:**
   - اضغط "New Resource"
   - اختر "Docker Compose"
   - أدخل Git Repository URL
   - في "Environment Variables" أضف جميع المتغيرات من `.env`
   - اختر Domain (مثال: `bot.magicaikrd.com`)
   - اضغط "Deploy"

#### **الطريقة الثانية: رفع مباشر**

1. **ضغط المشروع:**
   ```bash
   tar -czf whatsapp-bot.tar.gz *
   ```

2. **رفع عبر Coolify:**
   - New Resource → Upload
   - رفع الملف المضغوط
   - ضبط Environment Variables
   - Deploy

---

### الخطوة 3: إعداد Domain و SSL

في Coolify:
1. اذهب إلى "Domains"
2. أضف Domain: `bot.magicaikrd.com`
3. Coolify سيحصل تلقائياً على SSL Certificate من Let's Encrypt

---

### الخطوة 4: تحديث WEBHOOK_URL

بعد النشر، عدّل `.env`:
```env
WEBHOOK_URL=https://bot.magicaikrd.com/webhook
```

وأعد نشر التطبيق.

---

### الخطوة 5: اختبار البوت

1. افتح تليجرام وابحث عن بوتك
2. ابدأ المحادثة: `/start`
3. اشترك في القناة وتحقق
4. اربط واتساب عبر QR Code
5. ابدأ الاستخدام! 🎉

---

## 🔧 الأوامر المفيدة

### تشغيل محلياً للتطوير:

```bash
# تنصيب المكتبات
npm install

# تشغيل Database عبر Docker
docker-compose up -d postgres redis

# تشغيل البوت
npm run dev
```

### عرض Logs في Coolify:

```bash
docker-compose logs -f app
```

### إعادة تشغيل التطبيق:

في Coolify Dashboard → Restart

---

## 📊 بنية قاعدة البيانات

- **users** - بيانات المستخدمين
- **auto_replies** - الردود التلقائية
- **working_hours** - أوقات العمل
- **contacts** - جهات الاتصال
- **broadcasts** - الرسائل الجماعية
- **ai_settings** - إعدادات AI

---

## 🛠️ استكشاف الأخطاء

### المشكلة: QR Code لا يظهر

**الحل:**
- تأكد من Evolution API Key صحيح
- تأكد من Evolution API تعمل
- تحقق من Logs

### المشكلة: Webhook لا يعمل

**الحل:**
- تأكد من WEBHOOK_URL صحيح وبـ HTTPS
- تحقق من أن Evolution API تستطيع الوصول للـ URL
- راجع Logs للأخطاء

### المشكلة: Database connection error

**الحل:**
- تأكد من PostgreSQL يعمل: `docker ps`
- تحقق من DATABASE_URL صحيح
- انتظر حتى تكتمل Migrations

---

## 📞 الدعم

في حال واجهت أي مشاكل:
1. راجع Logs في Coolify
2. تحقق من Environment Variables
3. تأكد من جميع الخدمات تعمل

---

## 🔐 الأمان

⚠️ **مهم:**
- لا تشارك `.env` أبداً
- احفظ API Keys في مكان آمن
- استخدم كلمات مرور قوية للـ Database
- فعّل Firewall على VPS

---

## 🎉 تم!

البوت الآن جاهز للاستخدام! استمتع بإدارة واتساب تلقائياً 🚀

للأسئلة أو الاقتراحات، تواصل معنا.
"rebuild" 
"rebuild" 
