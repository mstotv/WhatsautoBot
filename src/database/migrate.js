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

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_instance_name ON users(instance_name);
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number);
CREATE INDEX IF NOT EXISTS idx_broadcasts_user_id ON broadcasts(user_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON broadcasts(status);
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
