CREATE TABLE IF NOT EXISTS players_catalog (
  player_id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  primary_position VARCHAR(8) NOT NULL,
  overall TINYINT UNSIGNED NOT NULL,
  potential TINYINT UNSIGNED NOT NULL,
  nationality_json LONGTEXT NOT NULL,
  positions_json LONGTEXT NOT NULL,
  position_ratings_json LONGTEXT NOT NULL,
  role_json LONGTEXT NOT NULL,
  skills_json LONGTEXT NOT NULL,
  stats_json LONGTEXT NOT NULL,
  club_json LONGTEXT NOT NULL,
  raw_json LONGTEXT NOT NULL,
  market_value_eur BIGINT NOT NULL DEFAULT 0,
  rarity ENUM('bronze','silver','gold') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_catalog_position (primary_position),
  INDEX idx_catalog_overall (overall),
  INDEX idx_catalog_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  discord_id VARCHAR(25) NOT NULL UNIQUE,
  username VARCHAR(100) NOT NULL,
  avatar_url VARCHAR(255) NULL,
  credits BIGINT NOT NULL DEFAULT 5000,
  account_level INT NOT NULL DEFAULT 1,
  account_xp BIGINT NOT NULL DEFAULT 0,
  rank_points DECIMAL(12,3) NOT NULL DEFAULT 1000.000,
  last_claim_at DATETIME(3) NULL,
  last_claim_at_ms BIGINT UNSIGNED NULL,
  claim_pity_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_rank_points (rank_points)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_player_cards (
  card_instance_id CHAR(36) PRIMARY KEY,
  public_id VARCHAR(16) NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  player_id VARCHAR(32) NOT NULL,
  level TINYINT UNSIGNED NOT NULL DEFAULT 1,
  xp BIGINT UNSIGNED NOT NULL DEFAULT 0,
  current_stats_json LONGTEXT NOT NULL,
  acquired_source VARCHAR(32) NOT NULL DEFAULT 'starter',
  season_id INT NOT NULL DEFAULT 1,
  acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cards_user (user_id, acquired_at),
  INDEX idx_cards_player (player_id),
  CONSTRAINT fk_cards_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cards_catalog FOREIGN KEY (player_id) REFERENCES players_catalog(player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_squads (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  formation VARCHAR(16) NOT NULL DEFAULT '4-3-3',
  squad_matches INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_squad_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS squad_slots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  slot_key VARCHAR(8) NOT NULL,
  card_instance_id CHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_slot (user_id, slot_key),
  UNIQUE KEY uq_user_card (user_id, card_instance_id),
  INDEX idx_squad_slots_card (card_instance_id),
  CONSTRAINT fk_slots_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_slots_card FOREIGN KEY (card_instance_id) REFERENCES user_player_cards(card_instance_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS market_stock (
  player_id VARCHAR(32) PRIMARY KEY,
  stock INT NOT NULL DEFAULT 25,
  base_stock INT NOT NULL DEFAULT 25,
  purchases_24h INT NOT NULL DEFAULT 0,
  sales_24h INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stock_catalog FOREIGN KEY (player_id) REFERENCES players_catalog(player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_market_listings (
  listing_id VARCHAR(20) NOT NULL PRIMARY KEY,
  player_id VARCHAR(32) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_system_listing_player FOREIGN KEY (player_id) REFERENCES players_catalog(player_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS market_activity (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  player_id VARCHAR(32) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  action_type ENUM('system_buy','system_sell','user_list','user_trade','pack','claim') NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  price BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_market_activity_player_time (player_id, created_at),
  INDEX idx_market_activity_user_time (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_market_listings (
  listing_id CHAR(36) PRIMARY KEY,
  public_listing_id VARCHAR(20) NULL UNIQUE,
  seller_user_id BIGINT UNSIGNED NOT NULL,
  buyer_user_id BIGINT UNSIGNED NULL,
  card_instance_id CHAR(36) NOT NULL UNIQUE,
  asking_price BIGINT NOT NULL,
  status ENUM('active','sold','cancelled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_listings_status_price (status, asking_price),
  CONSTRAINT fk_listing_seller FOREIGN KEY (seller_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_listing_buyer FOREIGN KEY (buyer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_listing_card FOREIGN KEY (card_instance_id) REFERENCES user_player_cards(card_instance_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chemistry_pair_history (
  user_id BIGINT UNSIGNED NOT NULL,
  card_a CHAR(36) NOT NULL,
  card_b CHAR(36) NOT NULL,
  matches_together INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, card_a, card_b),
  CONSTRAINT fk_pair_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matches (
  match_id CHAR(36) PRIMARY KEY,
  mode ENUM('ranked','classic','friendly') NOT NULL,
  status ENUM('running','completed','cancelled') NOT NULL DEFAULT 'running',
  home_user_id BIGINT UNSIGNED NULL,
  away_user_id BIGINT UNSIGNED NULL,
  home_name VARCHAR(100) NOT NULL,
  away_name VARCHAR(100) NOT NULL,
  home_strength DECIMAL(8,3) NOT NULL,
  away_strength DECIMAL(8,3) NOT NULL,
  home_score INT NOT NULL DEFAULT 0,
  away_score INT NOT NULL DEFAULT 0,
  winner_user_id BIGINT UNSIGNED NULL,
  home_snapshot_json LONGTEXT NOT NULL,
  away_snapshot_json LONGTEXT NOT NULL,
  home_stats_json LONGTEXT NOT NULL,
  away_stats_json LONGTEXT NOT NULL,
  events_json LONGTEXT NOT NULL,
  reward_json LONGTEXT NOT NULL,
  seed BIGINT NOT NULL,
  channel_id VARCHAR(25) NULL,
  message_id VARCHAR(25) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_matches_home (home_user_id, created_at),
  INDEX idx_matches_away (away_user_id, created_at),
  INDEX idx_matches_mode (mode, created_at),
  INDEX idx_matches_status (status, created_at),
  CONSTRAINT fk_matches_home_user FOREIGN KEY (home_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_matches_away_user FOREIGN KEY (away_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_invitations (
  invitation_id CHAR(36) PRIMARY KEY,
  from_user_id BIGINT UNSIGNED NOT NULL,
  to_user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending','accepted','declined','expired') NOT NULL DEFAULT 'pending',
  match_id CHAR(36) NULL,
  channel_id VARCHAR(25) NULL,
  message_id VARCHAR(25) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  INDEX idx_invite_to_status (to_user_id, status, created_at),
  CONSTRAINT fk_invite_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_invite_to FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  reason VARCHAR(80) NOT NULL,
  reference_id VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_credit_user_time (user_id, created_at),
  CONSTRAINT fk_credit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_daily_activity (
  user_id BIGINT UNSIGNED NOT NULL,
  activity_date DATE NOT NULL,
  rewarded_matches INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, activity_date),
  CONSTRAINT fk_daily_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seasonal_formations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  season_id INT NOT NULL,
  formation_snapshot_json LONGTEXT NOT NULL,
  archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_archive_user (user_id, season_id),
  CONSTRAINT fk_archive_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS discord_admin_sessions (
  discord_id VARCHAR(25) PRIMARY KEY,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_session_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  discord_id VARCHAR(25) NOT NULL,
  succeeded TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_attempts (discord_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_meta (
  meta_key VARCHAR(80) PRIMARY KEY,
  meta_value LONGTEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
