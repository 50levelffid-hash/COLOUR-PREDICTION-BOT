// ══════════════════════════════════════════
//   USER CACHE — node-cache, 5 min TTL
// ══════════════════════════════════════════
const NodeCache = require('node-cache');
const { User } = require('./models');

const CACHE_TTL = 300; // seconds (5 minutes)

// stdTTL = default expiry, checkperiod = cleanup sweep interval
const userCache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 60, useClones: false });

// ── Get a user, from cache if possible, else DB (and populate cache) ──
async function getCachedUser(uid) {
  const cached = userCache.get(uid);
  if (cached) return cached;

  try {
    const user = await User.findOne({ uid });
    if (user) userCache.set(uid, user);
    return user;
  } catch (e) {
    console.error('❌ getCachedUser DB error:', e.message);
    return null;
  }
}

// ── Force refresh: call this after any write to a user doc ──
function clearUserCache(uid) {
  userCache.del(uid);
}

// ── Manually push a fresh doc into cache (avoids an extra DB read after a save) ──
function setCachedUser(uid, userDoc) {
  userCache.set(uid, userDoc);
}

function getCacheStats() {
  return userCache.getStats();
}

module.exports = {
  CACHE_TTL,
  getCachedUser,
  clearUserCache,
  setCachedUser,
  getCacheStats
};
