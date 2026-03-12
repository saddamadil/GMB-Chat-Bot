/**
 * services/googleAuth.js
 * Persistent OAuth2 client — tokens saved to DB
 */

const { google } = require('googleapis');
const db         = require('./db');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Auto-refresh tokens and save to DB
oauth2Client.on('tokens', async (tokens) => {
  console.log('🔑 Tokens refreshed, saving to DB...');
  if (tokens.access_token)  await db.setSetting('google_access_token',  tokens.access_token);
  if (tokens.refresh_token) await db.setSetting('google_refresh_token', tokens.refresh_token);
  if (tokens.expiry_date)   await db.setSetting('google_token_expiry',  String(tokens.expiry_date));
});

// Load saved tokens from DB on startup
async function loadTokens() {
  try {
    const access_token  = await db.getSetting('google_access_token');
    const refresh_token = await db.getSetting('google_refresh_token');
    const expiry_date   = await db.getSetting('google_token_expiry');

    if (access_token && refresh_token) {
      oauth2Client.setCredentials({
        access_token,
        refresh_token,
        expiry_date: expiry_date ? parseInt(expiry_date) : undefined
      });
      console.log('✅ Google OAuth tokens loaded from database');
      return true;
    }
    console.log('⚠️  No saved Google tokens found. Visit /auth/google to connect.');
    return false;
  } catch (err) {
    console.error('❌ Failed to load tokens:', err.message);
    return false;
  }
}

// Save new tokens to DB (called after OAuth callback)
async function saveTokens(tokens) {
  oauth2Client.setCredentials(tokens);
  if (tokens.access_token)  await db.setSetting('google_access_token',  tokens.access_token);
  if (tokens.refresh_token) await db.setSetting('google_refresh_token', tokens.refresh_token);
  if (tokens.expiry_date)   await db.setSetting('google_token_expiry',  String(tokens.expiry_date));
  console.log('✅ Google tokens saved to database');
}

// Initialize on module load
loadTokens();

module.exports = oauth2Client;
module.exports.loadTokens = loadTokens;
module.exports.saveTokens = saveTokens;
