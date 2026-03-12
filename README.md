# 🍽 GMB AI Agent — Setup Guide

## What This Does
This backend server connects your **Google My Business** profile to **Claude AI** to automatically:
- ⭐ Reply to customer reviews
- ❓ Answer Q&A questions
- 💬 Handle live chat support
- 📅 Take and manage bookings

---

## 📁 File Structure
```
gmb-agent/
├── server.js          ← Main backend server
├── package.json       ← Dependencies
├── .env.example       ← Template for your credentials
├── .env               ← YOUR credentials (create from .env.example)
└── README.md          ← This file
```

---

## 🚀 Setup Steps

### Step 1 — Install Node.js
Download from: https://nodejs.org (choose LTS version)

### Step 2 — Install dependencies
```bash
cd gmb-agent
npm install
```

### Step 3 — Configure credentials
```bash
cp .env.example .env
```
Then open `.env` and fill in:

**A) Google Credentials** (from your client_secret.json):
```
GOOGLE_CLIENT_ID=1063749866199-apie30oppq4bj95n9jjbr8dchmpvpnc6.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your NEW regenerated secret>
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback
```

**B) Anthropic API Key** (from https://console.anthropic.com):
```
ANTHROPIC_API_KEY=sk-ant-...
```

### Step 4 — Fix Google Cloud Console (REQUIRED)
1. Go to https://console.cloud.google.com
2. Select project **sixth-edition-260412**
3. Go to **APIs & Services → Credentials**
4. Click your OAuth client → Add redirect URI:
   ```
   http://localhost:3001/auth/callback
   ```
5. Enable these APIs (APIs & Services → Library):
   - **My Business Account Management API**
   - **My Business Business Information API**
   - **My Business Q&A API**
   - **My Business Reviews API**

### Step 5 — Start the server
```bash
npm start
```
Server runs at: http://localhost:3001

### Step 6 — Connect your Google Account
Open browser and go to:
```
http://localhost:3001/auth/google
```
Login with the Google account that manages your restaurant GMB profile.

---

## 📡 API Endpoints

### Authentication
| Method | URL | Description |
|--------|-----|-------------|
| GET | /auth/google | Start Google OAuth login |
| GET | /auth/callback | OAuth callback (auto) |
| GET | /auth/status | Check if logged in |
| POST | /auth/logout | Logout |

### Google My Business
| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/locations | Get all your GMB locations |
| GET | /api/reviews/:accountId/:locationId | Get reviews |
| POST | /api/reviews/:accountId/:locationId/:reviewId/reply | Post reply |
| GET | /api/qa/:locationId | Get Q&A questions |
| POST | /api/qa/:locationId/:questionId/answer | Post answer |

### AI Agent
| Method | URL | Description |
|--------|-----|-------------|
| POST | /api/ai/review-reply | Generate AI review reply |
| POST | /api/ai/answer-question | Generate AI Q&A answer |
| POST | /api/ai/chat | Chat with AI agent |
| POST | /api/ai/auto-reply-all | Bulk AI reply all reviews |

### Bookings
| Method | URL | Description |
|--------|-----|-------------|
| GET | /api/bookings | Get all bookings |
| POST | /api/bookings | Create new booking |
| PATCH | /api/bookings/:id | Update booking |
| DELETE | /api/bookings/:id | Cancel booking |

---

## 🧪 Test the API

### Test AI Chat (no auth needed):
```bash
curl -X POST http://localhost:3001/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Do you have vegan options?",
    "restaurantInfo": "Spice Garden Restaurant, Ahmedabad. Open 11am-11pm. Veg and Non-veg menu."
  }'
```

### Test Review Reply Generation:
```bash
curl -X POST http://localhost:3001/api/ai/review-reply \
  -H "Content-Type: application/json" \
  -d '{
    "reviewText": "Amazing food! Loved the butter chicken.",
    "rating": 5,
    "restaurantName": "Spice Garden Restaurant"
  }'
```

---

## 🔒 Security Notes
- NEVER share your `.env` file
- NEVER commit `.env` to GitHub (it's in .gitignore)
- Regenerate your `client_secret` immediately (you shared it publicly)
- Use HTTPS in production (not localhost)

---

## 🚀 Deploy to Production (Optional)
For 24/7 operation, deploy to:
- **Railway.app** (easiest, free tier)
- **Render.com** (free tier)
- **Google Cloud Run** (integrates well with GMB)

---

## ❓ Need Help?
Contact your developer or refer to:
- Google Business Profile API: https://developers.google.com/my-business
- Anthropic Docs: https://docs.anthropic.com
