# WhatsApp Pharmacy Bot: Setup Guide

## What the bot does

1. **The customer sends any message.** The bot greets them in English and Hindi and asks for their prescription.
2. **The customer sends a photo or PDF.** The bot asks for their full delivery address. If they send more pages first, the bot keeps those too.
3. **The customer sends their address,** either typed or as a 📍 location. The bot thanks them.
4. **You get the order on your personal WhatsApp:** the customer's name, phone number, a link to their chat, their address, and the prescription file(s).

If a customer sends text when the bot needs a photo, or sends an address that's too short, the bot politely asks again. When a customer messages after finishing an order, the bot starts a new order.

---

## Step 1: Set up WhatsApp Cloud API (about 30 min, one time only)

1. Go to **business.facebook.com** and create a **Meta Business Account** for your store, if you don't have one yet.
2. Go to **developers.facebook.com**, then **My Apps**, then **Create App**. Choose the **Business** type and add the **WhatsApp** product.
3. Open **WhatsApp → API Setup** and **add your store's phone number**.
   - ⚠️ This number **cannot** also be logged in to the normal WhatsApp or WhatsApp Business app. You can use a new SIM, or delete the WhatsApp account on that number first.
4. Copy the **Phone number ID** from that page.
5. Create a **permanent access token**:
   1. Go to **Business Settings → Users → System Users → Add** and create an Admin user.
   2. Click **Generate token**, select your app, and tick `whatsapp_business_messaging` and `whatsapp_business_management`.
   3. Copy the token. (The temporary token on the API Setup page expires in 24 hours.)
6. Copy the **App Secret** from **App settings → Basic**.
7. Add a payment method under **WhatsApp → Settings**. When a customer messages you first, those replies are free.

## Step 2: Put the bot online

The bot needs a public `https://` web address. The easiest options are:

- **Railway.app or Render.com:** Push this folder to a GitHub repo and click "New → Deploy from GitHub". Use `npm start` as the start command. Then add the values from `.env.example` under **Environment Variables**.
  - Render's free plan goes to sleep when idle, so the first reply can take about 50 seconds. A paid plan of about $7/month, or Railway at about $5/month, keeps the bot awake.
- **Your own VPS:** Install Node 18+, run `npm install`, copy `.env.example` to `.env`, fill in the values, and run `npm start`. Use `pm2` to keep it running, and put it behind https.

## Step 3: Connect the webhook

1. In the Meta app, go to **WhatsApp → Configuration → Webhook → Edit**.
2. Set **Callback URL** to `https://YOUR-APP-URL/webhook`.
3. Set **Verify token** to the same word you put in `VERIFY_TOKEN`.
4. Click **Verify and save**, then **subscribe** to the `messages` field.

## Step 4: Test it

Send "Hi" to your store number from a different phone and go through the whole flow.

---

## ⚠️ Important: how forwarding to your number works

WhatsApp only lets a business send free-form messages to someone who has **messaged that business number in the last 24 hours**. That applies to you (the owner) too. So, to make sure order alerts reach you:

- **Simple fix:** Send any message (like "ok") from your personal WhatsApp to the store number once a day. The bot ignores messages from the owner number.
- **Permanent fix (recommended once you're live):**
  1. In WhatsApp Manager, create an approved **Utility message template** (for example, `new_order` with a text like "New order from {{1}}, address: {{2}}").
  2. Ask me, and I'll switch the alert to use that template. Templates can be sent at any time, and each one costs about ₹0.12.

Even if an alert fails, nothing is lost. The customer's chat and prescription are still in the conversation. See the server logs for any errors.

## Files

| File | Purpose |
|---|---|
| `server.js` | The bot: webhook, conversation flow, forwarding to the owner |
| `.env.example` | Settings template. Copy it to `.env` and fill it in |
| `sessions.json` | Created automatically. Records where each customer is in the conversation |

To change the wording of any message, edit the `MSG` section at the top of `server.js`.
