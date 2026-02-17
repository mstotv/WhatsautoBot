const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const schema = `
-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  telegram_username VARCHAR(255),
  instance_name VARCHAR(255) UNIQUE,
  instance_token VARCHAR(255),
  phone_number VARCHAR(50),
  is_connected BOOLEAN DEFAULT FALSE,
  is_subscribed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Auto Replies Table
CREATE TABLE IF NOT EXISTS auto_replies (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  keyword VARCHAR(255) NOT NULL,
  reply_text TEXT NOT NULL,
  media_url TEXT,
  media_type VARCHAR(50), -- image, video, document
  sheets_enabled BOOLEAN DEFAULT FALSE, -- Deprecated in favor of capture_mode
  ai_followup BOOLEAN DEFAULT FALSE,   -- Deprecated in favor of capture_mode
  capture_mode VARCHAR(20) DEFAULT 'none', -- none, immediate, raw, ai
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, keyword)
);

-- Working Hours Table
CREATE TABLE IF NOT EXISTS working_hours (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL, -- 0=Sunday, 6=Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  outside_hours_message TEXT DEFAULT 'شكراً لتواصلك! أوقات دوامنا من {start} إلى {end}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, day_of_week)
);

-- Contacts Table (people who messaged the user)
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  phone_number VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  current_context VARCHAR(255), -- Track if user is in a special flow (e.g., 'data_capture:keyword_id')
  first_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  message_count INTEGER DEFAULT 1,
  UNIQUE(user_id, phone_number)
);

-- Broadcasts Table
CREATE TABLE IF NOT EXISTS broadcasts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  message_text TEXT,
  media_url TEXT,
  media_type VARCHAR(50), -- image, video, document
  recipients_filter JSONB, -- {date_from, date_to, etc}
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending', -- pending, sending, completed, failed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

-- Broadcast Recipients Table
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id SERIAL PRIMARY KEY,
  broadcast_id INTEGER REFERENCES broadcasts(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending', -- pending, sent, failed
  sent_at TIMESTAMP,
  error_message TEXT
);

-- AI Settings Table
CREATE TABLE IF NOT EXISTS ai_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50), -- deepseek, openai, etc
  api_key TEXT,
  model VARCHAR(100),
  system_prompt TEXT,
  language VARCHAR(10) DEFAULT 'ar', -- ar, en, fr, de
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Messages Log Table (optional - for analytics)
CREATE TABLE IF NOT EXISTS messages_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  direction VARCHAR(10), -- incoming, outgoing
  message_text TEXT,
  media_url TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Channel subscription settings
CREATE TABLE IF NOT EXISTS channel_settings (
  id INTEGER PRIMARY KEY,
  channel_name VARCHAR(255),
  channel_link VARCHAR(500),
  is_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add is_verified column to users if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_verified') THEN
    ALTER TABLE users ADD COLUMN is_verified BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'channel_username') THEN
    ALTER TABLE users ADD COLUMN channel_username VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'verified_at') THEN
    ALTER TABLE users ADD COLUMN verified_at TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'subscription_type') THEN
    ALTER TABLE users ADD COLUMN subscription_type VARCHAR(50) DEFAULT 'trial';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'subscription_expires') THEN
    ALTER TABLE users ADD COLUMN subscription_expires TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'subscription_status') THEN
    ALTER TABLE users ADD COLUMN subscription_status VARCHAR(20) DEFAULT 'active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'phone_number') THEN
    ALTER TABLE users ADD COLUMN phone_number VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'language') THEN
    ALTER TABLE users ADD COLUMN language VARCHAR(10) DEFAULT 'ar';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'trial_used') THEN
    ALTER TABLE users ADD COLUMN trial_used BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Add media_url, media_type, sheets_enabled, ai_followup, updated_at to auto_replies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'auto_replies' AND column_name = 'media_url') THEN
    ALTER TABLE auto_replies ADD COLUMN media_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'auto_replies' AND column_name = 'media_type') THEN
    ALTER TABLE auto_replies ADD COLUMN media_type VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'auto_replies' AND column_name = 'sheets_enabled') THEN
    ALTER TABLE auto_replies ADD COLUMN sheets_enabled BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'auto_replies' AND column_name = 'ai_followup') THEN
    ALTER TABLE auto_replies ADD COLUMN ai_followup BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'auto_replies' AND column_name = 'capture_mode') THEN
    ALTER TABLE auto_replies ADD COLUMN capture_mode VARCHAR(20) DEFAULT 'none';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'store_name') THEN
    ALTER TABLE users ADD COLUMN store_name VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'is_ai_paused') THEN
    ALTER TABLE contacts ADD COLUMN is_ai_paused BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'auto_replies' AND column_name = 'updated_at') THEN
    ALTER TABLE auto_replies ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'google_maps_link') THEN
    ALTER TABLE users ADD COLUMN google_maps_link TEXT;
  END IF;
END $$;

-- Add current_context to contacts
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'current_context') THEN
    ALTER TABLE contacts ADD COLUMN current_context VARCHAR(255);
  END IF;
END $$;

-- Add unique constraint on phone_number in users table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_unique') THEN
    ALTER TABLE users ADD CONSTRAINT users_phone_unique UNIQUE (phone_number);
  END IF;
END $$;

-- Add unique index on phone_number in users table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_phone') THEN
    CREATE INDEX idx_users_phone ON users(phone_number);
  END IF;
END $$;

-- Add language column to ai_settings if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'language') THEN
    ALTER TABLE ai_settings ADD COLUMN language VARCHAR(10) DEFAULT 'ar';
  END IF;
END $$;

-- Subscription plans table
CREATE TABLE IF NOT EXISTS subscription_plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  name_en VARCHAR(100),
  description TEXT,
  duration_days INTEGER NOT NULL,
  price_usd DECIMAL(10, 2) DEFAULT 0,
  price_iqd DECIMAL(15, 0) DEFAULT 0,
  features TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add unique constraint to subscription_plans name if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_name_unique') THEN
    -- First delete duplicates just in case there are any before adding the constraint
    DELETE FROM subscription_plans a USING subscription_plans b
    WHERE a.id < b.id AND a.name = b.name;
    
    ALTER TABLE subscription_plans ADD CONSTRAINT subscription_plans_name_unique UNIQUE (name);
  END IF;
END $$;

-- Insert default subscription plans
INSERT INTO subscription_plans (name, name_en, description, duration_days, price_usd, price_iqd, features, is_active) VALUES
('تجربة مجانية', 'Free Trial', 'تجربة مجانية لمدة 7 أيام', 7, 0, 0, ARRAY['جميع المميزات', 'ربط واتساب', 'ردود تلقائية', 'الذكاء الاصطناعي', 'إرسال رسائل جماعية'], true),
('شهري', 'Monthly', 'اشتراك شهري', 30, 6.99, 10000, ARRAY['جميع المميزات', 'ربط واتساب', 'ردود تلقائية', 'الذكاء الاصطناعي', 'إرسال رسائل جماعية', 'دعم فني'], true),
('سنوي', 'Annual', 'اشتراك سنوي', 365, 69.00, 90000, ARRAY['جميع المميزات', 'ربط واتساب', 'ردود تلقائية', 'الذكاء الاصطناعي', 'إرسال رسائل جماعية', 'دعم فني', 'خصم 20%'], true)
ON CONFLICT (name) DO NOTHING;

-- Set default channel subscription (mstoviral)
INSERT INTO channel_settings (id, channel_name, channel_link, is_enabled)
VALUES (1, 'القناة التعليمية', 'https://t.me/mstoviral', true)
ON CONFLICT (id) DO UPDATE SET 
  channel_name = 'القناة التعليمية',
  channel_link = 'https://t.me/mstoviral',
  is_enabled = true;

-- Conversation History Table (AI Agent memory)
CREATE TABLE IF NOT EXISTS conversation_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  contact_phone VARCHAR(50) NOT NULL,
  role VARCHAR(20) NOT NULL, -- 'user' or 'assistant'
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Google Sheets Settings Table
CREATE TABLE IF NOT EXISTS sheets_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  spreadsheet_id VARCHAR(255),
  credentials_json TEXT,
  read_range VARCHAR(255) DEFAULT 'Sheet1!A:Z',
  write_range VARCHAR(255) DEFAULT 'Sheet1!A:A',
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TIMESTAMP,
  auth_type VARCHAR(20) DEFAULT 'service_account' -- 'service_account' or 'oauth2'
);

-- Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  contact_phone VARCHAR(50) NOT NULL,
  customer_name VARCHAR(255),
  customer_address TEXT,
  product VARCHAR(255),
  quantity VARCHAR(50),
  total_price DECIMAL(15, 2),
  product_link TEXT,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- pending, completed, cancelled
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(contact_phone);

-- Add max_context_messages to ai_settings
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'max_context_messages') THEN
    ALTER TABLE ai_settings ADD COLUMN max_context_messages INTEGER DEFAULT 15;
  END IF;
END $$;

-- Add notifications_enabled to users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'notifications_enabled') THEN
    ALTER TABLE users ADD COLUMN notifications_enabled BOOLEAN DEFAULT TRUE;
  END IF;
END $$;

-- Add OAuth columns to sheets_settings if they don't exist (for existing tables)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sheets_settings' AND column_name = 'access_token') THEN
    ALTER TABLE sheets_settings ADD COLUMN access_token TEXT;
    ALTER TABLE sheets_settings ADD COLUMN refresh_token TEXT;
    ALTER TABLE sheets_settings ADD COLUMN token_expiry TIMESTAMP;
    ALTER TABLE sheets_settings ADD COLUMN auth_type VARCHAR(20) DEFAULT 'service_account';
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_instance_name ON users(instance_name);
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number);
CREATE INDEX IF NOT EXISTS idx_broadcasts_user_id ON broadcasts(user_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_conversation_history_lookup ON conversation_history(user_id, contact_phone);
CREATE INDEX IF NOT EXISTS idx_conversation_history_time ON conversation_history(created_at);

-- Payment Invoices Table
CREATE TABLE IF NOT EXISTS payment_invoices (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES subscription_plans(id) ON DELETE CASCADE,
  invoice_url TEXT NOT NULL,
  plisio_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending', -- pending, completed, expired
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_invoices_user_plan ON payment_invoices(user_id, plan_id);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running database migrations...');
    await client.query(schema);
    console.log('✅ Database migrations completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration if called directly
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { pool, migrate };
