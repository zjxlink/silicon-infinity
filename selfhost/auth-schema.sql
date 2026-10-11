CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0, 1)),
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires);
CREATE TABLE IF NOT EXISTS auth_invites (
  token_hash TEXT PRIMARY KEY NOT NULL,
  created_by TEXT NOT NULL REFERENCES auth_users(id),
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT REFERENCES auth_users(id)
);
CREATE INDEX IF NOT EXISTS auth_invites_expiry ON auth_invites(expires);
