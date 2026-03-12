/**
 * GMB AI Agent — Backend Server v2
 * ✅ PostgreSQL database
 * ✅ Persistent Google OAuth tokens
 * ✅ GMB Webhook auto-triggers
 * ✅ Claude AI integration
 */

const express    = require('express');
const session    = require('express-session');
const { google } = require('googleapis');
const Anthropic  = require('@anthropic-ai/sdk');
const cors       = require('cors');
const path       = require('path');
require('dotenv').config();

const db           = require('./services/db');
const googleAuth   = require('./services/googleAuth');
const webhookRoute = require('./routes/webhook');

// ── Auto-create all tables on startup ──────────────────────────────────────
async function initDatabase() {
  try {
    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL,
        phone VARCHAR(20), email VARCHAR(100), date DATE NOT NULL,
        time VARCHAR(20) NOT NULL, guests INTEGER DEFAULT 2,
        occasion VARCHAR(50) DEFAULT 'Regular Dining',
        status VARCHAR(20) DEFAULT 'confirmed',
        source VARCHAR(30) DEFAULT 'manual',
        notes TEXT, created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY, gmb_review_id VARCHAR(200) UNIQUE,
        reviewer_name VARCHAR(100), rating INTEGER NOT NULL,
        comment TEXT, review_date TIMESTAMP, reply_text TEXT,
        reply_date TIMESTAMP, reply_posted BOOLEAN DEFAULT FALSE,
        ai_generated BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS qa (
        id SERIAL PRIMARY KEY, gmb_question_id VARCHAR(200) UNIQUE,
        question TEXT NOT NULL, author VARCHAR(100), asked_at TIMESTAMP,
        answer TEXT, answer_posted BOOLEAN DEFAULT FALSE,
        ai_generated BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY, session_id VARCHAR(100),
        messages JSONB DEFAULT '[]', resolved BOOLEAN DEFAULT FALSE,
        booking_made BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS webhook_events (
        id SERIAL PRIMARY KEY, event_type VARCHAR(50),
        payload JSONB, processed BOOLEAN DEFAULT FALSE,
        error TEXT, received_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS restaurant_settings (
        id SERIAL PRIMARY KEY, key VARCHAR(100) UNIQUE NOT NULL,
        value TEXT, updated_at TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO restaurant_settings (key, value) VALUES
        ('name','Spice Garden Restaurant'),
        ('address','SG Highway, Ahmedabad, Gujarat'),
        ('phone','+91 98765 43210'),
        ('hours','Mon-Sun: 11:00 AM - 11:00 PM'),
        ('cuisine','North Indian, Chinese, Gujarati'),
        ('reply_tone','warm'),
        ('auto_reply','true'),
        ('auto_qa','true'),
        ('auto_booking','true')
      ON CONFLICT (key) DO NOTHING;
    `);
    console.log('✅ Database tables ready');
  } catch (err) {
    console.error('❌ Database init error:', err.message);
  }
}


const app       = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'gmb-secret-change-me',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Webhook route (raw body needed for signature verification)
app.use('/webhook', webhookRoute);

// Health check (used by Docker + Railway)
app.get('/health', async (req, res) => {
  try {
    await db.pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// OAuth Scopes
const SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/plus.business.manage'
];

// Auth Routes
app.get('/auth/google', (req, res) => {
  const url = googleAuth.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { tokens } = await googleAuth.getToken(req.query.code);
    await googleAuth.saveTokens(tokens);
    req.session.authenticated = true;
    res.redirect('/?auth=success');
  } catch (err) {
    console.error('Auth error:', err);
    res.redirect('/?auth=error');
  }
});

app.get('/auth/status', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated. Visit /auth/google to connect.' });
  }
  next();
}

// Restaurant Settings
app.get('/api/settings', async (req, res) => {
  try {
    res.json({ settings: await db.getAllSettings() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/settings', async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await db.setSetting(key, String(value));
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GMB Locations
app.get('/api/locations', requireAuth, async (req, res) => {
  try {
    const mybusiness  = google.mybusinessaccountmanagement({ version: 'v1', auth: googleAuth });
    const accounts    = await mybusiness.accounts.list();
    const accountList = accounts.data.accounts || [];
    const locations   = [];
    for (const account of accountList) {
      const locApi = google.mybusinessbusinessinformation({ version: 'v1', auth: googleAuth });
      const locs   = await locApi.accounts.locations.list({
        parent: account.name,
        readMask: 'name,title,phoneNumbers,storefrontAddress,websiteUri,regularHours'
      });
      if (locs.data.locations) locations.push(...locs.data.locations);
    }
    res.json({ locations });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reviews
app.get('/api/reviews/:accountId/:locationId', requireAuth, async (req, res) => {
  try {
    const api      = google.mybusiness({ version: 'v4', auth: googleAuth });
    const response = await api.accounts.locations.reviews.list({
      parent: `accounts/${req.params.accountId}/locations/${req.params.locationId}`
    });
    res.json({ reviews: response.data.reviews || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/reviews/:accountId/:locationId/:reviewId/reply', requireAuth, async (req, res) => {
  try {
    const { accountId, locationId, reviewId } = req.params;
    const api = google.mybusiness({ version: 'v4', auth: googleAuth });
    await api.accounts.locations.reviews.updateReply({
      name:        `accounts/${accountId}/locations/${locationId}/reviews/${reviewId}`,
      requestBody: { comment: req.body.comment }
    });
    await db.markReplyPosted(reviewId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Q&A
app.get('/api/qa/:locationId', requireAuth, async (req, res) => {
  try {
    const api      = google.mybusinessqanda({ version: 'v1', auth: googleAuth });
    const response = await api.locations.questions.list({ parent: `locations/${req.params.locationId}` });
    res.json({ questions: response.data.questions || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/qa/:locationId/:questionId/answer', requireAuth, async (req, res) => {
  try {
    const api = google.mybusinessqanda({ version: 'v1', auth: googleAuth });
    await api.locations.questions.answers.upsert({
      parent:      `locations/${req.params.locationId}/questions/${req.params.questionId}`,
      requestBody: { answer: { text: req.body.text } }
    });
    await db.markAnswerPosted(req.params.questionId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI Routes
const AGENT_SYSTEM = `You are a professional AI support agent for a restaurant on Google My Business.
Be friendly, concise (2-4 sentences), warm, and represent the restaurant professionally.`;

app.post('/api/ai/review-reply', async (req, res) => {
  try {
    const { reviewText, rating, restaurantName } = req.body;
    const sentiment = rating >= 4 ? 'grateful' : rating === 3 ? 'understanding' : 'sincerely apologetic';
    const response  = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 300,
      system: AGENT_SYSTEM,
      messages: [{ role: 'user', content: `Write a ${sentiment} reply to this ${rating}/5 star review for ${restaurantName}:\n"${reviewText}"\nSign as "The ${restaurantName} Team".` }]
    });
    res.json({ reply: response.content[0].text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ai/answer-question', async (req, res) => {
  try {
    const { question, restaurantName, restaurantInfo } = req.body;
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 300,
      system: AGENT_SYSTEM,
      messages: [{ role: 'user', content: `Answer this GMB question about ${restaurantName}:\n"${question}"\n\nRestaurant info: ${restaurantInfo}` }]
    });
    res.json({ answer: response.content[0].text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [], restaurantInfo, sessionId } = req.body;
    const settings = await db.getAllSettings();
    const info     = restaurantInfo || `${settings.name} | ${settings.address} | ${settings.hours}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 500,
      system:   `${AGENT_SYSTEM}\n\nRestaurant: ${info}`,
      messages: [...conversationHistory, { role: 'user', content: message }]
    });

    const reply = response.content[0].text;

    if (sessionId) {
      await db.appendMessage(sessionId, 'user',      message);
      await db.appendMessage(sessionId, 'assistant', reply);
    }

    res.json({
      reply,
      updatedHistory: [
        ...conversationHistory,
        { role: 'user',      content: message },
        { role: 'assistant', content: reply }
      ]
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bookings (PostgreSQL)
app.get('/api/bookings', async (req, res) => {
  try {
    res.json({ bookings: await db.getBookings(req.query.date) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const booking = await db.createBooking(req.body);
    const msg     = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 100,
      messages: [{ role: 'user', content: `Write a 1-sentence warm booking confirmation for ${booking.name}, table for ${booking.guests} on ${booking.date} at ${booking.time}.` }]
    });
    res.json({ booking, confirmationMessage: msg.content[0].text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/bookings/:id', async (req, res) => {
  try {
    res.json({ booking: await db.updateBooking(req.params.id, req.body) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    await db.deleteBooking(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Pending items from DB
app.get('/api/pending', async (req, res) => {
  try {
    const reviews   = await db.getPendingReplies();
    const questions = await db.getPendingQuestions();
    res.json({ reviews, questions });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   🍽  GMB AI Agent v2 — Running              ║
║   http://localhost:${PORT}                      ║
║                                              ║
║   🔐 Auth:     /auth/google                  ║
║   🔗 Webhook:  /webhook/gmb                  ║
║   ❤️  Health:  /health                        ║
╚══════════════════════════════════════════════╝
  `);
  await initDatabase();
});

module.exports = app;
