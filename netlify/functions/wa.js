// netlify/functions/wa.js  -- demo version
const crypto = require("crypto");

const VERSION = process.env.GRAPH_VERSION || "v23.0"; // check Meta's current version
const GRAPH = `https://graph.facebook.com/${VERSION}/${process.env.PHONE_ID}/messages`;
// Netlify gives every site a URL variable. Set SITE_URL only if you want to override it.
const SITE = process.env.SITE_URL || process.env.URL || "https://yourname.netlify.app";

async function send(payload) {
  try {
    const res = await fetch(GRAPH, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    if (!res.ok) console.error("Send failed:", await res.text());
  } catch (e) {
    console.error("Send error:", e);
  }
}

// Check the request really came from Meta (needs APP_SECRET env variable)
function validSignature(event, rawBody) {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    console.warn("APP_SECRET not set - signature check skipped (demo only)");
    return true;
  }
  const header = event.headers["x-hub-signature-256"] || "";
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendGreeting(to) {
  await send({
    to,
    type: "image",
    image: {
      link: `${SITE}/parlour.jpg`,
      caption:
        "Welcome to *Your Parlour Name* 💄\n📍 Address line here\n🕘 Mon-Sat 10 AM - 8 PM\n📞 Phone number here",
    },
  });
  await send({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "How can we help you today?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "prices", title: "Services & Prices" } },
          { type: "reply", reply: { id: "book", title: "Book Appointment" } },
          { type: "reply", reply: { id: "bridal", title: "Bridal Makeup" } },
        ],
      },
    },
  });
}

const REPLIES = {
  prices:
    "*Service Price List*\n\nHaircut - Rs. 200\nFacial - Rs. 600\nThreading - Rs. 40\nManicure - Rs. 400\nBridal Makeup - Rs. 8000 onwards\n\n(Sample prices, replace with the real list)",
  book:
    "Please reply in one message with:\n1. Your name\n2. Service needed\n3. Preferred date and time\n\nWe will confirm your appointment shortly.",
  bridal:
    "Please reply in one message with:\n1. Your name\n2. Wedding date\n3. Venue and city\n4. Any package or look you have in mind\n\nOur team will contact you to confirm.",
};

exports.handler = async (event) => {
  // Meta's one-time webhook verification
  if (event.httpMethod === "GET") {
    const q = event.queryStringParameters || {};
    if (
      q["hub.mode"] === "subscribe" &&
      q["hub.verify_token"] === process.env.VERIFY_TOKEN
    ) {
      return { statusCode: 200, body: q["hub.challenge"] };
    }
    return { statusCode: 403, body: "Forbidden" };
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  if (!validSignature(event, rawBody)) {
    return { statusCode: 403, body: "Bad signature" };
  }

  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch (e) {
    return { statusCode: 200, body: "ok" }; // never make Meta retry bad payloads
  }

  // Handle every message in the payload, not just the first
  const messages = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const m of change.value?.messages || []) messages.push(m);
    }
  }

  for (const msg of messages) {
    const to = msg.from;

    if (msg.type === "text") {
      const text = (msg.text?.body || "").trim();
      if (/^(h+i+|hello+|hey+|hlo|helo|vanakkam|menu)\b/i.test(text)) {
        await sendGreeting(to);
      } else {
        await send({
          to,
          type: "text",
          text: { body: "Thank you for messaging us 😊\nType *hi* to see our menu." },
        });
      }
    } else if (msg.type === "interactive" && msg.interactive?.button_reply) {
      const reply = REPLIES[msg.interactive.button_reply.id];
      if (reply) await send({ to, type: "text", text: { body: reply } });
    }
  }

  return { statusCode: 200, body: "ok" };
};
