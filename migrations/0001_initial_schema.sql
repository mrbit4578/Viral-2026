-- Faceless Forge — Neon Postgres schema for Vercel
-- Run this once in the Neon SQL Editor after connecting Neon to Vercel.

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  raw_topic TEXT NOT NULL,
  niche TEXT,
  audience TEXT,
  platform TEXT,
  language TEXT DEFAULT 'Tiếng Việt',
  tone TEXT,
  duration_sec INTEGER DEFAULT 45,
  goal TEXT,
  refined_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blueprints (
  id TEXT PRIMARY KEY,
  idea_id TEXT REFERENCES ideas(id),
  title TEXT,
  concept TEXT,
  viral_score INTEGER DEFAULT 0,
  duration_sec INTEGER DEFAULT 45,
  language TEXT,
  platform TEXT,
  data_json TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT REFERENCES blueprints(id),
  kind TEXT NOT NULL,
  shot_index INTEGER DEFAULT 0,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size BIGINT DEFAULT 0,
  prompt TEXT,
  meta_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS distributions (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL REFERENCES blueprints(id),
  platform TEXT NOT NULL,
  caption TEXT,
  hashtags TEXT,
  best_time TEXT,
  pack_json TEXT,
  status TEXT DEFAULT 'ready',
  published_at TIMESTAMPTZ,
  post_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  distribution_id TEXT,
  blueprint_id TEXT,
  platform TEXT,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  followers_gained INTEGER DEFAULT 0,
  revenue_usd DOUBLE PRECISION DEFAULT 0,
  revenue_source TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  message TEXT,
  params_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blueprints_idea ON blueprints(idea_id);
CREATE INDEX IF NOT EXISTS idx_blueprints_created ON blueprints(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_blueprint ON assets(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_dist_blueprint ON distributions(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_metrics_blueprint ON metrics(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_metrics_platform ON metrics(platform);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
