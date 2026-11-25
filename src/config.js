const path = require('node:path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

function num(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
function bool(name, fallback = false) {
  const raw = process.env[name];
  return raw == null ? fallback : ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN || '',
    clientId: process.env.DISCORD_CLIENT_ID || '',
    guildId: process.env.DISCORD_GUILD_ID || ''
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num('DB_PORT', 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'football_club_discord',
    connectionLimit: num('DB_CONNECTION_LIMIT', 10),
    createDatabase: bool('DB_CREATE_DATABASE', true)
  },
  admin: {
    passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
    sessionMinutes: num('ADMIN_SESSION_MINUTES', 30),
    maxAttempts: num('ADMIN_MAX_ATTEMPTS', 5),
    attemptWindowMinutes: num('ADMIN_ATTEMPT_WINDOW_MINUTES', 60),
    allowedUserIds: (process.env.ADMIN_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean)
  },
  economy: {
    startingCredits: num('STARTING_CREDITS', 5000),
    baseStock: num('SYSTEM_MARKET_BASE_STOCK', 25),
    minPriceFactor: num('MARKET_MIN_PRICE_FACTOR', 0.65),
    maxPriceFactor: num('MARKET_MAX_PRICE_FACTOR', 3.5),
    listingMinFactor: num('USER_LISTING_MIN_FACTOR', 0.5),
    listingMaxFactor: num('USER_LISTING_MAX_FACTOR', 5),
    packPrice: num('PACK_PRICE', 2400),
    packSize: num('PACK_SIZE', 3),
    packWeights: [num('PACK_BRONZE_WEIGHT', 70), num('PACK_SILVER_WEIGHT', 25), num('PACK_GOLD_WEIGHT', 5)],
    packMaxQuantity: num('PACK_MAX_QUANTITY', 5),
    packs: {
      rookie: {
        name: 'Rookie Pack',
        price: num('PACK_ROOKIE_PRICE', 1200),
        players: num('PACK_ROOKIE_PLAYERS', 3),
        weights: [num('PACK_ROOKIE_BRONZE_WEIGHT', 86), num('PACK_ROOKIE_SILVER_WEIGHT', 13), num('PACK_ROOKIE_GOLD_WEIGHT', 1)]
      },
      pro: {
        name: 'Pro Pack',
        price: num('PACK_PRO_PRICE', 2400),
        players: num('PACK_PRO_PLAYERS', 3),
        weights: [num('PACK_PRO_BRONZE_WEIGHT', 70), num('PACK_PRO_SILVER_WEIGHT', 25), num('PACK_PRO_GOLD_WEIGHT', 5)]
      },
      elite: {
        name: 'Elite Pack',
        price: num('PACK_ELITE_PRICE', 5200),
        players: num('PACK_ELITE_PLAYERS', 3),
        weights: [num('PACK_ELITE_BRONZE_WEIGHT', 45), num('PACK_ELITE_SILVER_WEIGHT', 40), num('PACK_ELITE_GOLD_WEIGHT', 15)]
      }
    },
    claimCooldownHours: num('CLAIM_COOLDOWN_HOURS', 2),
    claimWeights: [num('CLAIM_BRONZE_WEIGHT', 70), num('CLAIM_SILVER_WEIGHT', 25), num('CLAIM_GOLD_WEIGHT', 5)],
    claimPityGuarantee: num('CLAIM_PITY_GUARANTEE', 30),
    matchBaseCredits: num('MATCH_BASE_CREDITS', 65),
    matchWinBonus: num('MATCH_WIN_BONUS', 35),
    underdogCreditFactor: num('MATCH_UNDERDOG_CREDIT_FACTOR', 18),
    dailySoftCap: num('MATCH_CREDIT_DAILY_SOFT_CAP', 10),
    afterCapFactor: num('MATCH_CREDIT_AFTER_CAP_FACTOR', 0.25)
  },
  progression: {
    playerMaxLevel: num('PLAYER_MAX_LEVEL', 50),
    playerXpBase: num('PLAYER_XP_BASE', 25),
    playerXpLevelFactor: num('PLAYER_XP_LEVEL_FACTOR', 2.5),
    accountXp: {
      friendly: num('ACCOUNT_XP_FRIENDLY', 12),
      classic: num('ACCOUNT_XP_CLASSIC', 16),
      ranked: num('ACCOUNT_XP_RANKED', 30),
      performanceFactor: num('ACCOUNT_XP_PERFORMANCE_FACTOR', 0.35)
    }
  },
  match: {
    minStrengthRange: num('MATCH_MIN_STRENGTH_RANGE', 2),
    maxStrengthRange: num('MATCH_MAX_STRENGTH_RANGE', 18),
    rankK: num('MATCH_RANK_K_FACTOR', 24),
    rankScale: num('MATCH_RANK_SCALE', 10),
    minuteMs: 1000,
    visibleLogLines: Math.max(5, Math.min(10, num('MATCH_LOG_LINES_VISIBLE', 5)))
  },
  chemistry: {
    club: num('CHEM_CLUB_POINTS', 15),
    nationality: num('CHEM_NATIONALITY_POINTS', 12),
    league: num('CHEM_LEAGUE_POINTS', 10),
    position: num('CHEM_POSITION_POINTS', 13),
    pairFactor: num('CHEM_PAIR_MATCH_FACTOR', 2.5),
    pairMax: num('CHEM_PAIR_MAX', 25),
    squadFactor: num('CHEM_SQUAD_MATCH_FACTOR', 0.5),
    squadMax: num('CHEM_SQUAD_MAX', 25),
    maxAttributeBoostPercent: num('CHEM_MAX_ATTRIBUTE_BOOST_PERCENT', 10)
  }
};
