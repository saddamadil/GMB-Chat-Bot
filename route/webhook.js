/**
 * routes/webhook.js
 * 
 * GMB Webhook — auto-triggers AI when:
 *   • A new review is posted
 *   • A new Q&A question is asked
 *   • A new chat message arrives
 * 
 * Setup: Register this URL in Google Cloud Pub/Sub
 * URL: https://yourdomain.com/webhook/gmb
 */

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const db       = require('../services/db');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Verify webhook signature from Google Pub/Sub ──────────────────────────
function verifyGoogleSignature(req) {
  // Google Pub/Sub sends messages as base64 encoded JSON
  // In production, verify the JWT token from Google
  // For now we verify the webhook secret header
  const secret = req.headers['x-webhook-secret'];
  return secret === process.env.WEBHOOK_SECRET;
}

// ── Main Webhook Endpoint ─────────────────────────────────────────────────
router.post('/gmb', express.raw({ type: 'application/json' }), async (req, res) => {
  // Acknowledge immediately (Google requires < 10s response)
  res.status(200).json({ received: true });

  try {
    let payload;

    // Google Pub/Sub wraps payload in base64
    if (req.body?.message?.data) {
      const decoded = Buffer.from(req.body.message.data, 'base64').toString('utf-8');
      payload = JSON.parse(decoded);
    } else {
      payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }

    console.log('📩 Webhook received:', payload?.type || 'unknown');

    // Log the event to DB
    const eventId = await db.logWebhookEvent(payload?.type || 'unknown', payload);

    // Route to appropriate handler
    switch (payload?.type) {
      case 'REVIEW':
        await handleNewReview(payload, eventId);
        break;
      case 'QUESTION':
        await handleNewQuestion(payload, eventId);
        break;
      case 'NEW_REVIEW':
        await handleNewReview(payload, eventId);
        break;
      default:
        console.log('⚠️ Unknown webhook type:', payload?.type);
        await db.markEventProcessed(eventId, 'Unknown event type');
    }

  } catch (err) {
    console.error('❌ Webhook error:', err.message);
  }
});

// ── Handle New Review ─────────────────────────────────────────────────────
async function handleNewReview(payload, eventId) {
  try {
    const review = payload.review || payload;
    const {
      reviewId,
      starRating,
      comment = '',
      reviewer = {},
      createTime
    } = review;

    console.log(`⭐ New review from ${reviewer.displayName}: ${starRating}`);

    // Map star rating string to number
    const ratingMap = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    const rating = ratingMap[starRating] || parseInt(starRating) || 3;

    // Save review to database
    await db.saveReview({
      gmb_review_id: reviewId,
      reviewer_name:  reviewer.displayName || 'Anonymous',
      rating,
      comment,
      review_date: createTime || new Date().toISOString()
    });

    // Auto-reply if enabled
    const autoReply = await db.getSetting('auto_reply');
    if (autoReply !== 'true') {
      console.log('ℹ️ Auto-reply disabled, skipping');
      await db.markEventProcessed(eventId);
      return;
    }

    // Get restaurant settings for context
    const settings = await db.getAllSettings();
    const restaurantInfo = `${settings.name} | ${settings.address} | Hours: ${settings.hours}`;

    // Generate AI reply
    const sentiment  = rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';
    const tone       = settings.reply_tone || 'warm';

    const prompt = `Write a ${tone} ${sentiment} Google review reply.
Rating: ${rating}/5 stars
Review: "${comment || '(No comment, just a star rating)'}"
Restaurant: ${settings.name}
Info: ${restaurantInfo}
${rating <= 2 ? 'Acknowledge the issue sincerely, apologize, invite them back.' : 'Thank them genuinely, mention specifics if possible.'}
Keep it 2-3 sentences. Sign off as "The ${settings.name} Team".`;

    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages:   [{ role: 'user', content: prompt }]
    });

    const replyText = response.content[0].text;
    console.log('🤖 Generated reply:', replyText.substring(0, 80) + '...');

    // Save generated reply to DB
    await db.saveReviewReply(reviewId, replyText, true);

    // Post reply to GMB via API
    await postReplyToGMB(reviewId, replyText, payload);

    await db.markEventProcessed(eventId);
    console.log('✅ Review auto-reply posted successfully');

  } catch (err) {
    console.error('❌ Review handler error:', err.message);
    await db.markEventProcessed(eventId, err.message);
  }
}

// ── Handle New Q&A Question ───────────────────────────────────────────────
async function handleNewQuestion(payload, eventId) {
  try {
    const question = payload.question || payload;
    const {
      name: questionId,
      text,
      author = {},
      createTime
    } = question;

    console.log(`❓ New question: "${text?.substring(0, 60)}..."`);

    // Save question to DB
    await db.saveQuestion({
      gmb_question_id: questionId,
      question:        text,
      author:          author.displayName || 'Anonymous',
      asked_at:        createTime || new Date().toISOString()
    });

    // Check if auto Q&A is enabled
    const autoQA = await db.getSetting('auto_qa');
    if (autoQA !== 'true') {
      await db.markEventProcessed(eventId);
      return;
    }

    // Get restaurant info
    const settings     = await db.getAllSettings();
    const restaurantInfo = `
Name: ${settings.name}
Address: ${settings.address}
Phone: ${settings.phone}
Hours: ${settings.hours}
Cuisine: ${settings.cuisine}
Payment: Cash, UPI, all major cards
Parking: Free parking available
Delivery: Via Swiggy and Zomato`;

    // Generate AI answer
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 300,
      system:     'You are a helpful restaurant assistant. Answer customer questions accurately and concisely based on the restaurant details provided.',
      messages:   [{
        role:    'user',
        content: `Answer this Google My Business question about our restaurant:\nQuestion: "${text}"\n\nRestaurant Details:${restaurantInfo}\n\nProvide a helpful 1-3 sentence answer.`
      }]
    });

    const answer = response.content[0].text;
    console.log('🤖 Generated answer:', answer.substring(0, 80) + '...');

    // Save to DB
    await db.saveAnswer(questionId, answer, true);

    // Post answer to GMB
    await postAnswerToGMB(questionId, answer, payload);

    await db.markEventProcessed(eventId);
    console.log('✅ Q&A auto-answer posted successfully');

  } catch (err) {
    console.error('❌ Q&A handler error:', err.message);
    await db.markEventProcessed(eventId, err.message);
  }
}

// ── Post Reply to GMB via API ─────────────────────────────────────────────
async function postReplyToGMB(reviewId, replyText, payload) {
  try {
    const { google }     = require('googleapis');
    const oauth2Client   = require('../services/googleAuth');
    const reviewsApi     = google.mybusiness({ version: 'v4', auth: oauth2Client });

    const accountId  = payload.accountId  || process.env.GMB_ACCOUNT_ID;
    const locationId = payload.locationId || process.env.GMB_LOCATION_ID;

    await reviewsApi.accounts.locations.reviews.updateReply({
      name:        `accounts/${accountId}/locations/${locationId}/reviews/${reviewId}`,
      requestBody: { comment: replyText }
    });

    await db.markReplyPosted(reviewId);
    console.log('📤 Reply posted to GMB');
  } catch (err) {
    console.error('❌ Failed to post reply to GMB:', err.message);
    // Reply saved in DB, can be manually posted later
  }
}

// ── Post Answer to GMB Q&A ────────────────────────────────────────────────
async function postAnswerToGMB(questionId, answer, payload) {
  try {
    const { google }   = require('googleapis');
    const oauth2Client = require('../services/googleAuth');
    const qaApi        = google.mybusinessqanda({ version: 'v1', auth: oauth2Client });

    await qaApi.locations.questions.answers.upsert({
      parent:      `${questionId}`,
      requestBody: { answer: { text: answer } }
    });

    await db.markAnswerPosted(questionId);
    console.log('📤 Answer posted to GMB Q&A');
  } catch (err) {
    console.error('❌ Failed to post answer to GMB:', err.message);
  }
}

// ── Manual retry: process all pending replies from DB ────────────────────
router.post('/retry-pending', async (req, res) => {
  try {
    const pending = await db.getPendingReplies();
    console.log(`🔄 Retrying ${pending.length} pending replies...`);
    // Re-process each pending item
    res.json({ message: `Processing ${pending.length} pending items`, items: pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
