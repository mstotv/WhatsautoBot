-- =====================================================
-- WhatsApp Bot - Simple Database Setup for Supabase
-- =====================================================

-- 1. Create Users Table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  telegram_username VARCHAR(255),
  instance_name VARCHAR(255) UNIQUE,
  instance_token VARCHAR(255),
  phone_number VARCHAR(50),
  is_connected BOOLEAN DEFAULT FALSE,
  is_subscribed BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  channel_username VARCHAR(255),
  verified_at TIMESTAMP,
  subscription_type VARCHAR(50) DEFAULT 'trial',
  subscription_expires TIMESTAMP,
  subscription_status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create Auto Replies Table
CREATE TABLE IF NOT EXISTS auto_replies (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  keyword VARCHAR(255) NOT NULL,
  reply_text TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, keyword)
);

-- 3. Create Working Hours Table
CREATE TABLE IF NOT EXISTS working_hours (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  outside_hours_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, day_of_week)
);

-- 4. Create Contacts Table
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  phone_number VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  first_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  message_count INTEGER DEFAULT 1,
  UNIQUE(user_id, phone_number)
);

-- 5. Create Broadcasts Table
CREATE TABLE IF NOT EXISTS broadcasts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  message_text TEXT,
  media_url TEXT,
  media_type VARCHAR(50),
  recipients_filter JSONB,
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- 6. Create Broadcast Recipients Table
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id SERIAL PRIMARY KEY,
  broadcast_id INTEGER REFERENCES broadcasts(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending',
  sent_at TIMESTAMP,
  error_message TEXT
);

-- 7. Create AI Settings Table
CREATE TABLE IF NOT EXISTS ai_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50),
  api_key TEXT,
  model VARCHAR(100),
  system_prompt TEXT,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Create Messages Log Table
CREATE TABLE IF NOT EXISTS messages_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  direction VARCHAR(10),
  message_text TEXT,
  media_url TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Create Channel Settings Table
CREATE TABLE IF NOT EXISTS channel_settings (
  id INTEGER PRIMARY KEY,
  channel_name VARCHAR(255),
  channel_link VARCHAR(500),
  is_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 10. Create Subscription Plans Table
CREATE TABLE IF NOT EXISTS subscription_plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  name_en VARCHAR(100),
  description TEXT,
  duration_days INTEGER NOT NULL,
  price_usd DECIMAL(10, 2) DEFAULT 0,
  price_iqd DECIMAL(15, 0) DEFAULT 0,
  features TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. Insert Default Subscription Plans
INSERT INTO subscription_plans (name, name_en, description, duration_days, price_usd, price_iqd, features, is_active) VALUES
('تجربة مجانية', 'Free Trial', 'تجربة مجانية لمدة 7 أيام', 7, 0, 0, ARRAY['جميع المميزات', 'ربط واتساب', 'ردود تلقائية', 'الذكاء الاصطناعي', 'إرسال رسائل جماعية'], true),
('شهري', 'Monthly', 'اشتراك شهري', 30, 6.99, 10000, ARRAY['جميع المميزات', 'ربط واتساب', 'ردود تلقائية', 'الذكاء الاصطناعي', 'إرسال رسائل جماعية', 'دعم فني'], true),
('سنوي', 'Annual', 'اشتراك سنوي', 365, 69.00, 90000, ARRAY['جميع المميزات', 'ربط واتساب', 'ردود تلقائية', 'الذكاء الاصطناعي', 'إرسال رسائل جماعية', 'دعم فني', 'خصم 20%'], true);

-- 12. Insert Default Channel Settings
INSERT INTO channel_settings (id, channel_name, channel_link, is_enabled)
VALUES (1, 'القناة التعليمية', 'https://t.me/mstoviral', true)
ON CONFLICT (id) DO UPDATE SET 
  channel_name = 'القناة التعليمية',
  channel_link = 'https://t.me/mstoviral',
  is_enabled = true;

-- 13. Create Indexes
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number);
CREATE INDEX IF NOT EXISTS idx_broadcasts_user_id ON broadcasts(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_log_user_id ON messages_log(user_id);

-- Done!
SELECT '✅ Database tables created successfully!' as result;
