// Pro-user detection via HMAC-signed cookies.
//
// Flow:
//   1. User completes Stripe Checkout → redirected to /success?session_id=xxx
//   2. /api/verify-session fetches the session from Stripe, confirms payment
//   3. Server signs an HMAC token (email + expiry) and sets it as an httpOnly cookie
//   4. Future /api/humanize calls verify the token and skip rate limits if valid
//
// The webhook (Stripe → /api/webhook) is the source of truth for subscription
// status and writes to Redis. Tokens expire after 35 days, so a cancelled
// subscription loses Pro access within a month even without a refresh.

import crypto from "crypto";

const APP_SECRET = process.env.APP_SECRET || "dev-only-secret-change-in-prod";
const TOKEN_TTL_MS = 35 * 24 * 60 * 60 * 1000; // 35 days — one billing cycle + grace

export function signProToken(email) {
  const expires = Date.now() + TOKEN_TTL_MS;
  const payload = `${email}:${expires}`;
  const sig = crypto
    .createHmac("sha256", APP_SECRET)
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${sig}`, "utf8").toString("base64url");
}

export function verifyProToken(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 3) return null;
    const [email, expiresStr, sig] = parts;
    const expires = parseInt(expiresStr, 10);
    if (!email || !expires || !sig) return null;
    if (Date.now() > expires) return null;

    const payload = `${email}:${expires}`;
    const expected = crypto
      .createHmac("sha256", APP_SECRET)
      .update(payload)
      .digest("hex");

    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    return { email, expires };
  } catch {
    return null;
  }
}

// Check Pro status from a NextRequest's cookies.
// Also confirms the user hasn't been marked cancelled in Redis (if configured).
export async function isPro(req) {
  const token = req.cookies.get("pro_token")?.value;
  const payload = verifyProToken(token);
  if (!payload) return false;

  // Optional Redis check — if webhook has marked the sub as cancelled,
  // revoke Pro access immediately rather than waiting for token expiry.
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && redisToken) {
    try {
      const res = await fetch(`${url}/get/pro:${encodeURIComponent(payload.email)}`, {
        headers: { Authorization: `Bearer ${redisToken}` },
      });
      const data = await res.json();
      // "1" = active, "0" or missing = cancelled/unknown
      // If the key was explicitly set to "0" by webhook, deny.
      if (data.result === "0") return false;
    } catch {
      // If Redis is unreachable, fall back to trusting the token (available > strict)
    }
  }

  return true;
}
