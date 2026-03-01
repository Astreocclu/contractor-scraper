-- Migration: Add location tracking for review searches
-- Run: psql -d contractors_dev -f migrations/002_location_tracking.sql

BEGIN;

-- Core tracking columns on contractor_raw_data
ALTER TABLE contractor_raw_data
  ADD COLUMN IF NOT EXISTS search_tier INTEGER,
  ADD COLUMN IF NOT EXISTS search_confidence DECIMAL(3,2),
  ADD COLUMN IF NOT EXISTS location_searched VARCHAR(100),
  ADD COLUMN IF NOT EXISTS search_attempts JSONB;

-- Manual review queue for low-confidence matches
CREATE TABLE IF NOT EXISTS review_queue (
  id SERIAL PRIMARY KEY,
  contractor_id INTEGER REFERENCES contractors_contractor(id),
  scraped_data JSONB,
  confidence_score DECIMAL(3,2),
  validation_details JSONB,
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMP,
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Search failures for pattern analysis
CREATE TABLE IF NOT EXISTS search_failures (
  id SERIAL PRIMARY KEY,
  contractor_id INTEGER REFERENCES contractors_contractor(id),
  attempts JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- A/B test results
CREATE TABLE IF NOT EXISTS ab_test_results (
  id SERIAL PRIMARY KEY,
  test_name VARCHAR(50),
  contractor_id INTEGER REFERENCES contractors_contractor(id),
  variant VARCHAR(20),
  result_json JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Search metrics (daily aggregates)
CREATE TABLE IF NOT EXISTS search_metrics_daily (
  date DATE PRIMARY KEY,
  tier1_success INTEGER DEFAULT 0, tier1_fail INTEGER DEFAULT 0,
  tier2_success INTEGER DEFAULT 0, tier2_fail INTEGER DEFAULT 0,
  tier3_success INTEGER DEFAULT 0, tier3_fail INTEGER DEFAULT 0,
  tier4_success INTEGER DEFAULT 0, tier4_fail INTEGER DEFAULT 0,
  tier5_success INTEGER DEFAULT 0, tier5_fail INTEGER DEFAULT 0,
  avg_confidence DECIMAL(3,2),
  total_searches INTEGER DEFAULT 0
);

-- Contractor extensions for manual search and franchise tracking
ALTER TABLE contractors_contractor
  ADD COLUMN IF NOT EXISTS needs_manual_search BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS search_notes TEXT,
  ADD COLUMN IF NOT EXISTS is_franchise BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_areas TEXT[];

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_contractor ON review_queue(contractor_id);
CREATE INDEX IF NOT EXISTS idx_search_failures_contractor ON search_failures(contractor_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_results_test ON ab_test_results(test_name, contractor_id);
CREATE INDEX IF NOT EXISTS idx_raw_data_search_tier ON contractor_raw_data(search_tier);

COMMIT;

-- Verify migration
SELECT 'Migration 002_location_tracking complete' as status;
