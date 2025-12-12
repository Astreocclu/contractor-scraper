-- Database Schema Updates for Forensic Audit Expansion
-- Run this to add new tables for source tracking

-- Source coverage tracking (helps identify gaps)
CREATE TABLE IF NOT EXISTS contractors_sourcecoverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contractor_id INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  last_checked TIMESTAMP,
  status TEXT,  -- found, not_found, error, blocked
  data_quality TEXT,  -- high, medium, low, none
  response_data TEXT,  -- JSON blob of raw response

  UNIQUE(contractor_id, source_name),
  FOREIGN KEY (contractor_id) REFERENCES contractors_contractor(id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_sourcecoverage_contractor
ON contractors_sourcecoverage(contractor_id);

CREATE INDEX IF NOT EXISTS idx_sourcecoverage_source
ON contractors_sourcecoverage(source_name);

-- Add new columns to contractors_contractoraudit if they don't exist
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we check first

-- Check and add reddit_data column
-- Note: In SQLite, you'll need to handle this programmatically
-- These are the columns we want to ensure exist:
--   reddit_data TEXT
--   youtube_data TEXT
--   osha_data TEXT
--   epa_data TEXT
--   tdlr_data TEXT
--   court_data TEXT
--   porch_data TEXT
--   buildzoom_data TEXT
--   homeadvisor_data TEXT
--   nextdoor_data TEXT
--   local_news_data TEXT

-- Add detected_at to red flags if not exists
-- ALTER TABLE contractors_redflag ADD COLUMN detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
