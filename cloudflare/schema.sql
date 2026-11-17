-- ZhongMap on Cloudflare D1. Same tables as the NAS's SQLite, minus unused ones
-- (sentences, sentence_progress, word_images, auth_tokens, push/grammar tables).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,          -- bcrypt (from the NAS) until first login, then pbkdf2$...
  email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME,
  is_admin INTEGER DEFAULT 0,
  is_blocked INTEGER DEFAULT 0,
  can_edit_definitions INTEGER DEFAULT 1,
  can_upload_images INTEGER DEFAULT 1
);

-- Random session id per login (cookie zm_sid, or Bearer token for the mobile app).
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,                   -- the app's whole progress JSON (~600 KB)
  known_json TEXT NOT NULL DEFAULT '[]', -- known words derived from data, so hot routes skip parsing data
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS custom_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  word TEXT NOT NULL,
  pinyin TEXT,
  meanings TEXT NOT NULL,
  base_char TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, word)
);

CREATE TABLE IF NOT EXISTS word_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  word_type TEXT NOT NULL,
  edited_meanings TEXT NOT NULL,
  edited_by INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(word, word_type)
);

CREATE TABLE IF NOT EXISTS user_sentences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  chinese TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  english TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quiz_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  word TEXT NOT NULL,
  word_type TEXT NOT NULL,
  quiz_mode TEXT NOT NULL,
  quality INTEGER NOT NULL,
  is_correct INTEGER NOT NULL,
  interval_before INTEGER,
  interval_after INTEGER,
  easiness_before REAL,
  easiness_after REAL,
  score_before INTEGER,
  score_after INTEGER,
  session_id TEXT,
  created_at INTEGER NOT NULL
);

-- Word status shared by the YouTube extension and Daily Sentences.
CREATE TABLE IF NOT EXISTS pp_words (
  user_id INTEGER NOT NULL,
  word TEXT NOT NULL,
  known INTEGER NOT NULL,               -- 1 = known or ignored
  updated_at INTEGER NOT NULL,
  status TEXT,                          -- known | learning | ignored | unknown
  due INTEGER,
  reps INTEGER,
  shown_day TEXT,
  chars TEXT,                           -- JSON: ZhongMap characters listing this word as a compound
  PRIMARY KEY (user_id, word)
);

CREATE TABLE IF NOT EXISTS pump_days (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  new_words INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS pump_seen (
  user_id INTEGER NOT NULL,
  sentence_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, sentence_id)
);
