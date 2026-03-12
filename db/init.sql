-- ─────────────────────────────────────────────
--  GMB AI Agent — Database Schema
--  Auto-runs when PostgreSQL container starts
-- ─────────────────────────────────────────────

-- Bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  phone         VARCHAR(20),
  email         VARCHAR(100),
  date          DATE NOT NULL,
  time          VARCHAR(20) NOT NULL,
  guests        INTEGER NOT NULL DEFAULT 2,
  occasion      VARCHAR(50) DEFAULT 'Regular Dining',
  status        VARCHAR(20) DEFAULT 'confirmed',
  source        VARCHAR(30) DEFAULT 'manual',
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- Reviews table (cache GMB reviews locally)
CREATE TABLE IF NOT EXISTS reviews (
  id              SERIAL PRIMARY KEY,
  gmb_review_id   VARCHAR(200) UNIQUE,
  reviewer_name   VARCHAR(100),
  rating          INTEGER NOT NULL,
  comment         TEXT,
  review_date     TIMESTAMP,
  reply_text      TEXT,
  reply_date      TIMESTAMP,
  reply_posted    BOOLEAN DEFAULT FALSE,
  ai_generated    BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Q&A table
CREATE TABLE IF NOT EXISTS qa (
  id              SERIAL PRIMARY KEY,
  gmb_question_id VARCHAR(200) UNIQUE,
  question        TEXT NOT NULL,
  author          VARCHAR(100),
  asked_at        TIMESTAMP,
  answer          TEXT,
  answer_posted   BOOLEAN DEFAULT FALSE,
  ai_generated    BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Chat conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id            SERIAL PRIMARY KEY,
  session_id    VARCHAR(100),
  customer_name VARCHAR(100),
  customer_phone VARCHAR(20),
  messages      JSONB DEFAULT '[]',
  resolved      BOOLEAN DEFAULT FALSE,
  booking_made  BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- Webhook events log table
CREATE TABLE IF NOT EXISTS webhook_events (
  id            SERIAL PRIMARY KEY,
  event_type    VARCHAR(50),
  payload       JSONB,
  processed     BOOLEAN DEFAULT FALSE,
  error         TEXT,
  received_at   TIMESTAMP DEFAULT NOW()
);

-- Restaurant settings table
CREATE TABLE IF NOT EXISTS restaurant_settings (
  id              SERIAL PRIMARY KEY,
  key             VARCHAR(100) UNIQUE NOT NULL,
  value           TEXT,
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- Seed default restaurant settings
INSERT INTO restaurant_settings (key, value) VALUES
  ('name',            'Spice Garden Restaurant'),
  ('address',         'SG Highway, Ahmedabad, Gujarat'),
  ('phone',           '+91 98765 43210'),
  ('hours',           'Mon-Sun: 11:00 AM – 11:00 PM'),
  ('cuisine',         'North Indian, Chinese, Gujarati'),
  ('reply_tone',      'warm'),
  ('auto_reply',      'true'),
  ('auto_qa',         'true'),
  ('auto_booking',    'true')
ON CONFLICT (key) DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bookings_date     ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_status   ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_reviews_posted    ON reviews(reply_posted);
CREATE INDEX IF NOT EXISTS idx_qa_posted         ON qa(answer_posted);
CREATE INDEX IF NOT EXISTS idx_webhook_processed ON webhook_events(processed);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bookings_updated
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_conversations_updated
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
