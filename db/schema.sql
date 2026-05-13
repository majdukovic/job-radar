-- job-radar Phase 1 schema
-- Run in Supabase → SQL Editor → New query → paste → run

CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────────
--  jobs — one row per scraped posting (deduped by source + source_id)
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,

  -- Ingest identity
  raw_source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT,
  raw_title TEXT,
  raw_company TEXT,
  raw_text TEXT NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Normalized fields (populated by normalize-job)
  title TEXT,
  company TEXT,
  is_actually_remote BOOLEAN,
  allowed_regions TEXT[],
  excluded_regions TEXT[],
  required_skills TEXT[],
  nice_to_have_skills TEXT[],
  seniority TEXT,
  salary_min INT,
  salary_max INT,
  salary_currency TEXT,
  visa_sponsorship TEXT,
  confidence_score NUMERIC,
  normalizer_trace_id TEXT,

  -- Embedding (filled in Phase 3+)
  embedding VECTOR(1536),

  -- Scoring (filled by score-job)
  region_fit BOOLEAN,
  skill_match_score INT,
  overall_fit_score INT,
  score_explanation TEXT,

  -- State
  state TEXT NOT NULL DEFAULT 'new',

  UNIQUE (raw_source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_jobs_scraped_at ON jobs(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_region_fit ON jobs(region_fit) WHERE region_fit IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
--  eval_labels — passive labels from thumbs UI + manual review
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS eval_labels (
  id BIGSERIAL PRIMARY KEY,
  trace_id TEXT NOT NULL,
  component TEXT NOT NULL,
  input TEXT NOT NULL,
  llm_output JSONB,
  your_label TEXT,              -- "good" | "bad" | null
  your_correction JSONB,
  your_notes TEXT,
  set_assignment TEXT,          -- "dev" | "test" | "adversarial" | null
  failure_mode_id TEXT,         -- e.g. "FM-001"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eval_labels_component ON eval_labels(component);
CREATE INDEX IF NOT EXISTS idx_eval_labels_set ON eval_labels(set_assignment);
CREATE INDEX IF NOT EXISTS idx_eval_labels_label ON eval_labels(your_label);

-- ─────────────────────────────────────────────────────────────────────
--  user_profile — single-seat config
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profile (
  id INT PRIMARY KEY DEFAULT 1,
  allowed_regions TEXT[] NOT NULL,
  excluded_regions TEXT[] DEFAULT ARRAY[]::TEXT[],
  skills JSONB NOT NULL DEFAULT '[]'::JSONB,
  seniority_target TEXT,
  min_salary_usd INT,
  blacklist_companies TEXT[] DEFAULT ARRAY[]::TEXT[],
  CHECK (id = 1)  -- single-row guard
);

-- Seed your profile. EDIT skills below to match yours.
INSERT INTO user_profile (id, allowed_regions, skills, seniority_target)
VALUES (
  1,
  ARRAY['Worldwide', 'EU', 'EMEA', 'Europe', 'Croatia'],
  '[
    {"name":"Appium","proficiency":5},
    {"name":"Cypress","proficiency":4},
    {"name":"Java","proficiency":4},
    {"name":"mobile QA","proficiency":5},
    {"name":"JUnit","proficiency":4},
    {"name":"TestNG","proficiency":3}
  ]'::JSONB,
  'mid-senior'
)
ON CONFLICT (id) DO NOTHING;
