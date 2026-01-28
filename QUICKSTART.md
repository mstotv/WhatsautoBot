# 🚀 دليل البدء السريع

## 📦 التنصيب والنشر في 5 دقائق

### 1️⃣ التحضير
```bash
# استنساخ المشروع
git clone YOUR_REPO_URL
cd whatsapp-bot-project

# نسخ ملف البيئة
cp .env.example .env
```

### 2️⃣ تعديل الإعدادات
افتح `.env` وعدّل:
```env
TELEGRAM_BOT_TOKEN=8343716709:AAGDR50O1DHC6ipTqIEVPSeb--Fkfp5iuhk
TELEGRAM_CHANNEL_USERNAME=@mstoviral
EVOLUTION_API_URL=https://evo.magicaikrd.com
EVOLUTION_API_KEY=WHgLsQ9TA3tjEHr1hLMc64RB5t4yBgB6
WEBHOOK_URL=https://your-domain.com/webhook
```

### 3️⃣ النشر على Coolify

#### **خيار أ: عبر Git**
1. رفع المشروع إلى GitHub/GitLab
2. في Coolify: New Resource → Git Repository
3. أدخل URL و Branch
4. إضافة Environment Variables من `.env`
5. تعيين Domain
6. Deploy! 🚀

#### **خيار ب: Docker Compose مباشرة**
```bash
# على الـ VPS
cd /path/to/project
docker-compose up -d
```

### 4️⃣ التحقق من التشغيل
```bash
# عرض الـ Logs
docker-compose logs -f

# التحقق من الـ Services
docker-compose ps
```

### 5️⃣ اختبار البوت
1. افتح تليجرام
2. ابحث عن بوتك
3. `/start`
4. اشترك في القناة
5. اربط واتساب
6. ✅ جاهز!

---

## 🔧 الأوامر المهمة

### إعادة التشغيل:
```bash
docker-compose restart
```

### تحديث الكود:
```bash
git pull
docker-compose up -d --build
```

### عرض Logs:
```bash
docker-compose logs -f app
```

### إيقاف:
```bash
docker-compose down
```

### حذف كل شيء (احتياط):
```bash
docker-compose down -v
```

---

## 📊 بنية المشروع

```
whatsapp-bot-project/
├── src/
│   ├── bot/              # Telegram Bot
│   │   ├── telegram.js   # Main bot logic
│   │   └── handlers.js   # Additional handlers
│   ├── api/              # Express API
│   │   └── server.js     # API + Webhooks
│   ├── services/         # Business logic
│   │   ├── evolutionAPI.js
│   │   ├── database.js
│   │   └── broadcastQueue.js
│   ├── database/         # Database
│   │   └── migrate.js    # Schema & migrations
│   └── index.js          # Entry point
├── docker-compose.yml    # Docker setup
├── Dockerfile           # App container
├── package.json         # Dependencies
├── .env.example         # Environment template
└── README.md           # Documentation
```

---

## 🎯 الميزات الرئيسية

### 1. ربط واتساب
- QR Code من Evolution API
- Multi-instance (كل مستخدم له instance)
- Webhooks للإشعارات الفورية

### 2. الردود التلقائية
- كلمات مفتاحية مخصصة
- ردود فورية

### 3. الذكاء الاصطناعي
- ربط DeepSeek API
- ردود ذكية تلقائية
- System prompts مخصصة

### 4. أوقات العمل
- تحديد أوقات الدوام
- رسائل تلقائية خارج الأوقات

### 5. البرودكاست
- نص / صورة / فيديو
- فلترة حسب التاريخ
- Queue system للإرسال المنظم

### 6. الإحصائيات
- عدد جهات الاتصال
- الرسائل المرسلة
- معدلات التفاعل

---

## ❓ الأسئلة الشائعة

### Q: كيف أحصل على Telegram Bot Token؟
A: ابحث عن @BotFather في تليجرام → `/newbot` → اتبع التعليمات

### Q: Evolution API لا تعمل؟
A: تحقق من:
- API URL صحيح
- API Key صحيح
- Evolution API تعمل: `curl https://evo.magicaikrd.com`

### Q: Database connection error؟
A: انتظر 30 ثانية حتى يبدأ PostgreSQL، أو تحقق من Logs

### Q: QR Code لا يظهر؟
A: تحقق من Evolution API Logs وتأكد من الإعدادات صحيحة

### Q: كيف أضيف مستخدمين للقناة؟
A: اجعل البوت Admin في القناة مع صلاحية "Invite Users"

---

## 🔒 الأمان

✅ استخدم كلمات مرور قوية  
✅ لا تشارك `.env`  
✅ فعّل Firewall  
✅ استخدم HTTPS فقط  
✅ احفظ نسخ احتياطية من Database  

---

## 📞 الدعم

واجهت مشكلة؟ تحقق من:
1. Logs: `docker-compose logs -f`
2. Environment Variables في `.env`
3. Evolution API تعمل
4. Database connection
5. Telegram Bot Token صحيح

---

## 🎉 استمتع!

البوت جاهز! ابدأ بإضافة الردود التلقائية وتجربة الميزات 🚀
