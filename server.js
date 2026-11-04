// WhatsApp Pharmacy Bot — Meta WhatsApp Cloud API
// Flow: greet -> ask prescription -> ask address -> thank you -> forward order to owner
require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  WHATSAPP_TOKEN,          // Permanent access token (System User token)
  PHONE_NUMBER_ID,         // Business phone number ID from Meta dashboard
  VERIFY_TOKEN,            // Any secret string you choose, used once for webhook verification
  APP_SECRET,              // Optional but recommended: Meta App Secret, verifies requests really come from Meta
  OWNER_WHATSAPP,          // Owner's number with country code, digits only, e.g. 919876543210
  STORE_NAME = "Our Medical Store",
  PORT = 3000,
  GRAPH_VERSION = "v21.0",
  GRAPH_BASE = "https://graph.facebook.com",
} = process.env;

for (const [k, v] of Object.entries({ WHATSAPP_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN, OWNER_WHATSAPP })) {
  if (!v) { console.error(`Missing ${k} in .env`); process.exit(1); }
}

const GRAPH = `${GRAPH_BASE}/${GRAPH_VERSION}`;

// ---------------------------------------------------------------- messages (English + Hindi)
const MSG = {
  greeting: () =>
    `🙏 Welcome to *${STORE_NAME}*!\n` +
    `Please upload a clear photo or PDF of your *medical prescription*.\n\n` +
    `🙏 *${STORE_NAME}* में आपका स्वागत है!\n` +
    `कृपया अपने *डॉक्टर के पर्चे (प्रिस्क्रिप्शन)* की साफ़ फ़ोटो या PDF भेजें।`,
  needPrescription: () =>
    `📄 Please send your prescription as a *photo* or *PDF* to continue.\n\n` +
    `📄 आगे बढ़ने के लिए कृपया अपना प्रिस्क्रिप्शन *फ़ोटो* या *PDF* के रूप में भेजें।`,
  askAddress: () =>
    `✅ Prescription received, thank you!\n` +
    `Please type your *complete delivery address* (house/flat no., street, landmark, area, city, PIN code). You can also share your 📍 location.\n\n` +
    `✅ प्रिस्क्रिप्शन मिल गया, धन्यवाद!\n` +
    `कृपया अपना *पूरा डिलीवरी पता* लिखें (मकान/फ़्लैट नं., गली, लैंडमार्क, इलाका, शहर, पिन कोड)। आप अपनी 📍 लोकेशन भी भेज सकते हैं।`,
  addressTooShort: () =>
    `🏠 That address looks incomplete. Please include house no., street, landmark, city and PIN code.\n\n` +
    `🏠 यह पता अधूरा लग रहा है। कृपया मकान नं., गली, लैंडमार्क, शहर और पिन कोड लिखें।`,
  thankYou: () =>
    `🎉 *Thank you!* We have received your prescription and address. Our team will contact you shortly with the price and delivery details.\n\n` +
    `🎉 *धन्यवाद!* हमें आपका प्रिस्क्रिप्शन और पता मिल गया है। हमारी टीम जल्द ही दाम और डिलीवरी की जानकारी के लिए आपसे संपर्क करेगी।`,
};

// ---------------------------------------------------------------- tiny persistent session store
const STORE_FILE = path.join(__dirname, "sessions.json");
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(STORE_FILE, "utf8")); } catch { sessions = {}; }
const save = () => fs.writeFile(STORE_FILE, JSON.stringify(sessions, null, 2), () => {});

const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // stale half-finished chats restart after 24h
const seenIds = new Set(); // Meta may deliver the same webhook twice

// ---------------------------------------------------------------- WhatsApp API helpers
async function graph(pathname, body) {
  const res = await fetch(`${GRAPH}/${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) console.error("WhatsApp API error:", res.status, JSON.stringify(data));
  return data;
}

const sendText = (to, text) =>
  graph(`${PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: false },
  });

// Download customer's media and re-upload it so it can be forwarded to the owner.
async function forwardMedia(mediaId, kind, to, caption, filename) {
  const meta = await (await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  })).json();
  if (!meta.url) throw new Error("Could not get media URL: " + JSON.stringify(meta));

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
  const buf = Buffer.from(await fileRes.arrayBuffer());
  const mime = meta.mime_type || (kind === "image" ? "image/jpeg" : "application/pdf");

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([buf], { type: mime }), filename || (kind === "image" ? "prescription.jpg" : "prescription.pdf"));
  const up = await (await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/media`, {
    method: "POST", headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, body: form,
  })).json();
  if (!up.id) throw new Error("Media upload failed: " + JSON.stringify(up));

  const payload = kind === "image"
    ? { id: up.id, caption }
    : { id: up.id, caption, filename: filename || "prescription.pdf" };
  return graph(`${PHONE_NUMBER_ID}/messages`, { messaging_product: "whatsapp", to, type: kind, [kind]: payload });
}

async function notifyOwner(customer, s) {
  const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const summary =
    `🛒 *NEW ORDER*\n` +
    `👤 Name: ${s.name || "-"}\n` +
    `📞 Phone: +${customer}\n` +
    `💬 Chat: https://wa.me/${customer}\n` +
    `🏠 Address: ${s.address}\n` +
    `🕒 ${when}`;
  await sendText(OWNER_WHATSAPP, summary);
  for (const p of s.prescriptions) {
    try {
      await forwardMedia(p.id, p.kind, OWNER_WHATSAPP, `Prescription from +${customer}`, p.filename);
    } catch (e) {
      console.error("Forward failed:", e.message);
      await sendText(OWNER_WHATSAPP, `⚠️ Could not forward prescription from +${customer}. Please open the chat to view it.`);
    }
  }
}

// ---------------------------------------------------------------- conversation logic
async function handleMessage(msg, contactName) {
  const from = msg.from;
  if (from === OWNER_WHATSAPP) return; // don't run the customer flow on the owner

  let s = sessions[from];
  if (!s || s.step === "DONE" || Date.now() - s.updatedAt > SESSION_TIMEOUT_MS) {
    s = sessions[from] = { step: "AWAITING_PRESCRIPTION", prescriptions: [], name: contactName, updatedAt: Date.now() };
    // If the very first message already is a prescription, accept it straight away.
    if (msg.type !== "image" && msg.type !== "document") {
      save();
      return sendText(from, MSG.greeting());
    }
  }
  s.updatedAt = Date.now();

  if (s.step === "AWAITING_PRESCRIPTION") {
    if (msg.type === "image" || msg.type === "document") {
      const m = msg[msg.type];
      s.prescriptions.push({ kind: msg.type, id: m.id, filename: m.filename });
      s.step = "AWAITING_ADDRESS";
      save();
      return sendText(from, MSG.askAddress());
    }
    save();
    return sendText(from, MSG.needPrescription());
  }

  if (s.step === "AWAITING_ADDRESS") {
    // Extra prescription pages sent before the address: keep them, don't re-prompt.
    if (msg.type === "image" || msg.type === "document") {
      const m = msg[msg.type];
      s.prescriptions.push({ kind: msg.type, id: m.id, filename: m.filename });
      save();
      return;
    }
    let address = null;
    if (msg.type === "text") {
      const t = msg.text.body.trim();
      if (t.length < 15) { save(); return sendText(from, MSG.addressTooShort()); }
      address = t;
    } else if (msg.type === "location") {
      const l = msg.location;
      address = [l.name, l.address].filter(Boolean).join(", ") +
        ` 📍 https://maps.google.com/?q=${l.latitude},${l.longitude}`;
    } else {
      save();
      return sendText(from, MSG.addressTooShort());
    }
    s.address = address;
    s.step = "DONE";
    save();
    await sendText(from, MSG.thankYou());
    return notifyOwner(from, s);
  }
}

// ---------------------------------------------------------------- web server
const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Webhook verification (Meta calls this once when you save the webhook URL)
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  if (APP_SECRET) {
    const sig = req.get("x-hub-signature-256") || "";
    const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody || "").digest("hex");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.sendStatus(401);
    }
  }
  res.sendStatus(200); // acknowledge fast so Meta doesn't retry

  try {
    for (const entry of req.body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        const names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile?.name]));
        for (const msg of v.messages || []) {
          if (seenIds.has(msg.id)) continue;
          seenIds.add(msg.id);
          if (seenIds.size > 5000) seenIds.clear();
          await handleMessage(msg, names[msg.from]);
        }
      }
    }
  } catch (e) {
    console.error("Handler error:", e);
  }
});

app.get("/", (_req, res) => res.send("WhatsApp pharmacy bot is running ✅"));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Bot listening on port ${PORT}`));
}
module.exports = app;
