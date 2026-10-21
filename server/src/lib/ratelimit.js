/* Rate limiter in-memory (sliding window). Cukup untuk 1 instance Render free:
   tujuannya mencegah satu orang membanjiri Drive/kamera, bukan proteksi DDoS. */

export function createRateLimiter({ windowMs, max, label }) {
  const hits = new Map(); /* key -> array timestamp */

  function prune(now) {
    for (const [key, list] of hits) {
      const kept = list.filter((t) => now - t < windowMs);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }

  const timer = setInterval(() => prune(Date.now()), Math.max(windowMs, 60_000));
  if (typeof timer.unref === "function") timer.unref();

  return {
    /** @returns {{ ok: boolean, retryAfterSec: number, remaining: number }} */
    check(key) {
      const now = Date.now();
      const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (list.length >= max) {
        const oldest = list[0];
        hits.set(key, list);
        return {
          ok: false,
          retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
          remaining: 0,
        };
      }
      list.push(now);
      hits.set(key, list);
      return { ok: true, retryAfterSec: 0, remaining: max - list.length };
    },
    label,
    windowMs,
    max,
    size: () => hits.size,
  };
}

/** Express middleware: tolak dengan 429 + header Retry-After bila kuota habis. */
export function rateLimit(limiter, keyFn) {
  return function (req, res, next) {
    const key = keyFn(req);
    const result = limiter.check(key);
    res.setHeader("x-ratelimit-limit", String(limiter.max));
    res.setHeader("x-ratelimit-remaining", String(result.remaining));
    if (!result.ok) {
      res.setHeader("Retry-After", String(result.retryAfterSec));
      return res.status(429).json({
        error: "terlalu banyak permintaan untuk " + limiter.label + ", coba lagi dalam " + result.retryAfterSec + " detik",
      });
    }
    return next();
  };
}

/** IP asli klien (Express dengan trust proxy aktif). */
export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}
