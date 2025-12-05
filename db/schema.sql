-- Agentic Audit System Schema
-- Run this to add new tables to existing db.sqlite3
-- SQLite syntax

-- Raw scraped data (one row per source per contractor)
CREATE TABLE IF NOT EXISTS contractor_raw_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contractor_id INTEGER,
    source_name TEXT NOT NULL,           -- 'bbb', 'yelp', 'tdlr', etc.
    source_url TEXT,
    raw_text TEXT,                       -- Extracted text content
    structured_data TEXT,                -- JSON if API source
    fetch_status TEXT DEFAULT 'pending', -- 'success', 'blocked', 'not_found', 'error'
    error_message TEXT,
    fetched_at TEXT,                     -- ISO timestamp
    expires_at TEXT,                     -- When to re-fetch
    FOREIGN KEY (contractor_id) REFERENCES contractors_contractor(id)
);

-- Collection log (audit trail - who requested what and why)
CREATE TABLE IF NOT EXISTS collection_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contractor_id INTEGER,
    source_name TEXT NOT NULL,
    requested_by TEXT NOT NULL,          -- 'initial', 'audit_agent', 'manual'
    request_reason TEXT,                 -- Why agent requested this
    status TEXT DEFAULT 'pending',       -- 'pending', 'running', 'success', 'error'
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT
);

-- Audit records with full reasoning trace
CREATE TABLE IF NOT EXISTS audit_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contractor_id INTEGER,
    audit_version INTEGER DEFAULT 1,
    
    -- Scores
    trust_score INTEGER,
    risk_level TEXT,                     -- 'CRITICAL', 'SEVERE', 'MODERATE', 'LOW', 'TRUSTED'
    recommendation TEXT,                 -- 'AVOID', 'CAUTION', 'VERIFY', 'RECOMMENDED'
    
    -- Component scores (for breakdown)
    verification_score INTEGER,
    reputation_score REAL,
    credibility_score INTEGER,
    financial_score INTEGER,
    red_flag_score INTEGER,
    
    -- Agent reasoning (THE GOLD - this is what makes it auditable)
    reasoning_trace TEXT,                -- Full chain of thought from agent
    red_flags TEXT,                      -- JSON array of detected issues
    positive_signals TEXT,               -- JSON array of good signs
    gaps_identified TEXT,                -- JSON array of what couldn't be verified
    
    -- Metadata
    sources_used TEXT,                   -- JSON array of sources that had data
    sources_missing TEXT,                -- JSON array of sources that failed/empty
    collection_rounds INTEGER DEFAULT 1, -- How many collect→analyze cycles
    total_cost REAL DEFAULT 0,           -- API costs for this audit (DeepSeek)
    
    created_at TEXT,
    finalized_at TEXT,
    
    FOREIGN KEY (contractor_id) REFERENCES contractors_contractor(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_raw_data_contractor ON contractor_raw_data(contractor_id);
CREATE INDEX IF NOT EXISTS idx_raw_data_source ON contractor_raw_data(source_name);
CREATE INDEX IF NOT EXISTS idx_raw_data_expires ON contractor_raw_data(expires_at);
CREATE INDEX IF NOT EXISTS idx_collection_log_contractor ON collection_log(contractor_id);
CREATE INDEX IF NOT EXISTS idx_audit_contractor ON audit_records(contractor_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_records(created_at);

-- View: Latest audit per contractor
CREATE VIEW IF NOT EXISTS v_latest_audits AS
SELECT 
    ar.*,
    cc.business_name,
    cc.city,
    cc.state
FROM audit_records ar
INNER JOIN contractors_contractor cc ON ar.contractor_id = cc.id
WHERE ar.id = (
    SELECT MAX(ar2.id) 
    FROM audit_records ar2 
    WHERE ar2.contractor_id = ar.contractor_id
);

-- View: Data coverage per contractor (how many sources collected)
CREATE VIEW IF NOT EXISTS v_data_coverage AS
SELECT 
    contractor_id,
    COUNT(*) as total_sources,
    SUM(CASE WHEN fetch_status = 'success' THEN 1 ELSE 0 END) as successful_sources,
    SUM(CASE WHEN fetch_status = 'error' THEN 1 ELSE 0 END) as failed_sources,
    SUM(CASE WHEN fetch_status = 'not_found' THEN 1 ELSE 0 END) as not_found_sources,
    SUM(CASE WHEN datetime(expires_at) > datetime('now') THEN 1 ELSE 0 END) as fresh_sources,
    MAX(fetched_at) as last_fetch
FROM contractor_raw_data
GROUP BY contractor_id;
