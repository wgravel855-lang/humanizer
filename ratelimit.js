// Rate limiter — hybrid Upstash Redis + in-memory fallback.
// Uses Redis if UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set.
// Otherwise falls back to an in-memory Map (resets on deploy — fine for MVP).

const FREE_DAILY_LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || "5", 10);
const WINDOW_SECONDS = 24 * 60 * 60; // 24 hours
const WINDOW_MS = WINDOW_SECONDS * 1000;

// ───── In-memory store ─────────────────────────────────────────────
const memoryStore = new Map();

// Opportunistic cleanup to prevent unbounded memory growth
function cleanupMemory() {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (now > entry.reset) memoryStore.delete(key);
  }
}

function memoryRateLimit(key) {
  if (Math.random() < 0.01) cleanupMemory();

  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now > entry.reset) {
    memoryStore.set(key, { count: 1, reset: now + WINDOW_MS });
    return {
      success: true,
      remaining: FREE_DAILY_LIMIT - 1,
      reset: now + WINDOW_MS,
      limit: FREE_DAILY_LIMIT,
    };
  }

  if (entry.count >= FREE_DAILY_LIMIT) {
    return {
      success: false,
      remaining: 0,
      reset: entry.reset,
      limit: FREE_DAILY_LIMIT,
    };
  }

  entry.count++;
  return {
    success: true,
    remaining: FREE_DAILY_LIMIT - entry.count,
    reset: entry.reset,
    limit: FREE_DAILY_LIMIT,
  };
}

// ───── Upstash Redis (REST) ────────────────────────────────────────
async function redisRateLimit(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const redisKey = `rl:${key}`;

  // Pipeline: INCR + EXPIRE (NX = only set TTL if no TTL exists) + TTL
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["EXPIRE", redisKey, WINDOW_SECONDS, "NX"],
      ["TTL", redisKey],
    ]),
  });

  if (!res.ok) throw new Error(`Upstash error: ${res.status}`);
  const results = await res.json();
  const count = results[0].result;
  const ttl = results[2].result;

  const remaining = Math.max(0, FREE_DAILY_LIMIT - count);
  const reset = Date.now() + (ttl > 0 ? ttl * 1000 : WINDOW_MS);

  return {
    success: count <= FREE_DAILY_LIMIT,
    remaining,
    reset,
    limit: FREE_DAILY_LIMIT,
  };
}

// ───── Public API ──────────────────────────────────────────────────
export async function rateLimit(key) {
  const useRedis =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;

  if (useRedis) {
    try {
      return await redisRateLimit(key);
    } catch (e) {
      console.error("Redis rate limit failed, using in-memory fallback:", e);
      return memoryRateLimit(key);
    }
  }
  return memoryRateLimit(key);
}
