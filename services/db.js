/**
 * services/db.js
 * PostgreSQL connection & query helpers
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }  // Required for Railway/Render
    : false
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection error:', err.message);
  } else {
    console.log('✅ PostgreSQL connected');
    release();
  }
});

// ── Bookings ──────────────────────────────────────────────────────────────

async function getBookings(date = null) {
  const q = date
    ? 'SELECT * FROM bookings WHERE date = $1 ORDER BY time ASC'
    : 'SELECT * FROM bookings ORDER BY date DESC, time ASC';
  const params = date ? [date] : [];
  const { rows } = await pool.query(q, params);
  return rows;
}

async function createBooking({ name, phone, email, date, time, guests, occasion, source, notes }) {
  const { rows } = await pool.query(
    `INSERT INTO bookings (name, phone, email, date, time, guests, occasion, source, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [name, phone, email, date, time, guests || 2, occasion || 'Regular Dining', source || 'manual', notes]
  );
  return rows[0];
}

async function updateBooking(id, fields) {
  const keys = Object.keys(fields);
  const vals = Object.values(fields);
  const set  = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE bookings SET ${set} WHERE id = $1 RETURNING *`,
    [id, ...vals]
  );
  return rows[0];
}

async function deleteBooking(id) {
  await pool.query('DELETE FROM bookings WHERE id = $1', [id]);
}

// ── Reviews ───────────────────────────────────────────────────────────────

async function saveReview({ gmb_review_id, reviewer_name, rating, comment, review_date }) {
  const { rows } = await pool.query(
    `INSERT INTO reviews (gmb_review_id, reviewer_name, rating, comment, review_date)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (gmb_review_id) DO UPDATE
     SET reviewer_name=$2, rating=$3, comment=$4
     RETURNING *`,
    [gmb_review_id, reviewer_name, rating, comment, review_date]
  );
  return rows[0];
}

async function saveReviewReply(gmb_review_id, reply_text, ai_generated = true) {
  const { rows } = await pool.query(
    `UPDATE reviews SET reply_text=$2, reply_date=NOW(), ai_generated=$3
     WHERE gmb_review_id=$1 RETURNING *`,
    [gmb_review_id, reply_text, ai_generated]
  );
  return rows[0];
}

async function markReplyPosted(gmb_review_id) {
  await pool.query(
    'UPDATE reviews SET reply_posted=TRUE WHERE gmb_review_id=$1',
    [gmb_review_id]
  );
}

async function getPendingReplies() {
  const { rows } = await pool.query(
    'SELECT * FROM reviews WHERE reply_posted=FALSE ORDER BY review_date DESC'
  );
  return rows;
}

// ── Q&A ───────────────────────────────────────────────────────────────────

async function saveQuestion({ gmb_question_id, question, author, asked_at }) {
  const { rows } = await pool.query(
    `INSERT INTO qa (gmb_question_id, question, author, asked_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (gmb_question_id) DO NOTHING
     RETURNING *`,
    [gmb_question_id, question, author, asked_at]
  );
  return rows[0];
}

async function saveAnswer(gmb_question_id, answer, ai_generated = true) {
  const { rows } = await pool.query(
    `UPDATE qa SET answer=$2, ai_generated=$3 WHERE gmb_question_id=$1 RETURNING *`,
    [gmb_question_id, answer, ai_generated]
  );
  return rows[0];
}

async function markAnswerPosted(gmb_question_id) {
  await pool.query(
    'UPDATE qa SET answer_posted=TRUE WHERE gmb_question_id=$1',
    [gmb_question_id]
  );
}

async function getPendingQuestions() {
  const { rows } = await pool.query(
    'SELECT * FROM qa WHERE answer_posted=FALSE ORDER BY asked_at DESC'
  );
  return rows;
}

// ── Conversations ─────────────────────────────────────────────────────────

async function createConversation(session_id) {
  const { rows } = await pool.query(
    `INSERT INTO conversations (session_id) VALUES ($1)
     ON CONFLICT DO NOTHING RETURNING *`,
    [session_id]
  );
  return rows[0];
}

async function appendMessage(session_id, role, content) {
  const { rows } = await pool.query(
    `UPDATE conversations
     SET messages = messages || $2::jsonb
     WHERE session_id = $1
     RETURNING *`,
    [session_id, JSON.stringify([{ role, content, ts: new Date().toISOString() }])]
  );
  return rows[0];
}

async function getConversation(session_id) {
  const { rows } = await pool.query(
    'SELECT * FROM conversations WHERE session_id=$1',
    [session_id]
  );
  return rows[0];
}

// ── Webhook Events ────────────────────────────────────────────────────────

async function logWebhookEvent(event_type, payload) {
  const { rows } = await pool.query(
    `INSERT INTO webhook_events (event_type, payload) VALUES ($1,$2) RETURNING id`,
    [event_type, JSON.stringify(payload)]
  );
  return rows[0].id;
}

async function markEventProcessed(id, error = null) {
  await pool.query(
    'UPDATE webhook_events SET processed=TRUE, error=$2 WHERE id=$1',
    [id, error]
  );
}

// ── Settings ──────────────────────────────────────────────────────────────

async function getSetting(key) {
  const { rows } = await pool.query(
    'SELECT value FROM restaurant_settings WHERE key=$1',
    [key]
  );
  return rows[0]?.value;
}

async function getAllSettings() {
  const { rows } = await pool.query('SELECT key, value FROM restaurant_settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO restaurant_settings (key, value)
     VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
    [key, value]
  );
}

module.exports = {
  pool,
  getBookings, createBooking, updateBooking, deleteBooking,
  saveReview, saveReviewReply, markReplyPosted, getPendingReplies,
  saveQuestion, saveAnswer, markAnswerPosted, getPendingQuestions,
  createConversation, appendMessage, getConversation,
  logWebhookEvent, markEventProcessed,
  getSetting, getAllSettings, setSetting
};
