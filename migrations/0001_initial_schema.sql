-- Faceless Forge — schema (Cloudflare D1)

-- 1. Ý tưởng thô người dùng nhập + bản cải tiến của AI
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
  refined_json TEXT,            -- JSON: các phương án ý tưởng đã cải tiến
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. Blueprint (kịch bản + shot list + SEO + monetization)
CREATE TABLE IF NOT EXISTS blueprints (
  id TEXT PRIMARY KEY,
  idea_id TEXT,
  title TEXT,
  concept TEXT,
  viral_score INTEGER DEFAULT 0,
  duration_sec INTEGER DEFAULT 45,
  language TEXT,
  platform TEXT,
  data_json TEXT NOT NULL,      -- JSON blueprint đầy đủ
  status TEXT DEFAULT 'draft',  -- draft | assets_ready | rendered | published
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (idea_id) REFERENCES ideas(id)
);

-- 3. Media assets (ảnh / audio / video) — nội dung nằm trên R2
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT,
  kind TEXT NOT NULL,           -- image | audio | video | srt
  shot_index INTEGER DEFAULT 0,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size INTEGER DEFAULT 0,
  prompt TEXT,
  meta_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (blueprint_id) REFERENCES blueprints(id)
);

-- 4. Gói phân phối cho từng nền tảng MXH
CREATE TABLE IF NOT EXISTS distributions (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL,
  platform TEXT NOT NULL,       -- tiktok | facebook | instagram | x | youtube
  caption TEXT,
  hashtags TEXT,
  best_time TEXT,
  pack_json TEXT,
  status TEXT DEFAULT 'ready',  -- ready | scheduled | published
  published_at TEXT,
  post_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (blueprint_id) REFERENCES blueprints(id)
);

-- 5. Số liệu hiệu suất + doanh thu thụ động (nhập tay / cập nhật)
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
  revenue_usd REAL DEFAULT 0,
  revenue_source TEXT,          -- creator_fund | affiliate | brand | product | adsense
  recorded_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 6. Job theo dõi tiến trình dài
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending | running | done | error
  progress INTEGER DEFAULT 0,
  message TEXT,
  params_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 7. Kho key-value thay cho Cloudflare KV (hosted deploy không hỗ trợ KV)
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blueprints_idea ON blueprints(idea_id);
CREATE INDEX IF NOT EXISTS idx_blueprints_created ON blueprints(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_blueprint ON assets(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_dist_blueprint ON distributions(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_metrics_blueprint ON metrics(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_metrics_platform ON metrics(platform);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
