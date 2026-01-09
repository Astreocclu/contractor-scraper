# PostgreSQL Migration Plan

**Status:** Ready to execute
**Estimated Time:** 5-6 hours
**Confidence:** 95% (validated with Gemini)

---

## Overview

Migrate from SQLite to PostgreSQL to enable:
- Parallel audit workers (SQLite locks on writes)
- 1000+ contractor scaling
- Native JSON querying (JSONB)
- Connection pooling

---

## Phase 1: Infrastructure (20 min)

### 1.1 Install PostgreSQL
```bash
sudo apt update && sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### 1.2 Create database and user
```bash
sudo -u postgres psql << 'EOF'
CREATE DATABASE contractors_dev;
CREATE USER contractors_user WITH PASSWORD 'localdev123';
GRANT ALL PRIVILEGES ON DATABASE contractors_dev TO contractors_user;
ALTER USER contractors_user CREATEDB;
\c contractors_dev
GRANT ALL ON SCHEMA public TO contractors_user;
EOF
```

### 1.3 Python dependencies
```bash
source venv/bin/activate
pip install psycopg2-binary
pip freeze > requirements.txt
```

### 1.4 Node dependencies
```bash
npm install pg
```

### 1.5 Update .env
```bash
DATABASE_URL=postgres://contractors_user:localdev123@localhost:5432/contractors_dev
```

### 1.6 Test Django connection
```bash
python3 manage.py check
```

---

## Phase 2: Create DB Module (30 min)

Create `services/db_pg.js`:

```javascript
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = {
  /**
   * Execute a query and return result
   */
  async query(text, params) {
    return pool.query(text, params);
  },

  /**
   * Get a single row
   */
  async getOne(text, params) {
    const result = await pool.query(text, params);
    return result.rows[0] || null;
  },

  /**
   * Execute multiple statements in a transaction
   */
  async withTransaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  pool
};
```

---

## Phase 3: Migrate Core Files (2-3 hours)

### Files to migrate (in order):

| # | File | DB Operations | Notes |
|---|------|---------------|-------|
| 1 | `services/collection_service.js` | SELECT, INSERT, UPDATE | Most DB ops, make class methods async |
| 2 | `services/audit_agent_v2.js` | SELECT, INSERT, UPDATE | Needs transaction for finalizeResult |
| 3 | `batch_collect.js` | SELECT, UPDATE | Entry point for collection |
| 4 | `services/orchestrator.js` | SELECT, INSERT, UPDATE | Main audit orchestration |
| 5 | `audit_only.js` | SELECT, UPDATE | Simplified audit entry |

### Conversion pattern for each file:

**Step 1: Update imports**
```javascript
// REMOVE:
const initSqlJs = require('sql.js');
const fs = require('fs');  // if only used for DB

// ADD:
const db = require('./services/db_pg');
```

**Step 2: Convert queries**
```javascript
// BEFORE (sql.js):
const result = db.exec(`SELECT * FROM contractors_contractor WHERE id = ?`, [id]);
const contractor = result[0]?.values[0];

// AFTER (pg):
const result = await db.query(`SELECT * FROM contractors_contractor WHERE id = $1`, [id]);
const contractor = result.rows[0];
```

**Step 3: Convert writes**
```javascript
// BEFORE:
db.run(`UPDATE contractors_contractor SET trust_score = ? WHERE id = ?`, [score, id]);

// AFTER:
await db.query(`UPDATE contractors_contractor SET trust_score = $1 WHERE id = $2`, [score, id]);
```

**Step 4: Remove file saves**
```javascript
// REMOVE (no longer needed):
fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
```

**Step 5: Add async/await up the chain**
- Any function calling a DB method must be `async`
- All DB calls must use `await`

**Step 6: Wrap multi-statement writes in transactions**
```javascript
// For operations like finalizeResult that do INSERT + UPDATE:
await db.withTransaction(async (client) => {
  await client.query(`INSERT INTO contractor_audits ...`, [...]);
  await client.query(`UPDATE contractors_contractor SET trust_score = $1 ...`, [...]);
});
```

---

## Phase 4: SQL Syntax Conversion

| SQLite | PostgreSQL | Example |
|--------|------------|---------|
| `?` placeholders | `$1, $2, $3...` | `WHERE id = ?` → `WHERE id = $1` |
| `datetime('now')` | `NOW()` | Or pass `new Date().toISOString()` from JS |
| `last_insert_rowid()` | `RETURNING id` | `INSERT ... RETURNING id` |
| `json_extract(col, '$.key')` | `col->>'key'` | Not currently used |

### Placeholder conversion helper:
```javascript
// Manual conversion is safest - count params in order
// Before: (?, ?, ?)
// After:  ($1, $2, $3)
```

---

## Phase 5: Data Migration (30 min)

### 5.1 Backup from SQLite (while still on SQLite)
```bash
python3 manage.py dumpdata --natural-foreign --indent 2 > backup.json
```

### 5.2 Switch DATABASE_URL to Postgres in .env

### 5.3 Create tables
```bash
python3 manage.py migrate
```

### 5.4 Load data
```bash
python3 manage.py loaddata backup.json
```

### 5.5 Verify counts
```bash
python3 manage.py shell -c "
from contractors.models import Contractor
from django.contrib.auth.models import User
print(f'Contractors: {Contractor.objects.count()}')
print(f'Users: {User.objects.count()}')
"
```

---

## Phase 6: Testing (1 hour)

### 6.1 Django admin
```bash
python3 manage.py runserver 8002
# Browse to http://localhost:8002/admin/
```

### 6.2 Collection test
```bash
source venv/bin/activate && set -a && . ./.env && set +a
node batch_collect.js --id 12 --force
```

### 6.3 Audit test
```bash
node run_audit.js --id 12
```

### 6.4 Parallel test (the whole point!)
```bash
# Terminal 1:
node run_audit.js --id 11

# Terminal 2 (simultaneously):
node run_audit.js --id 13
```

Both should complete without locking errors.

---

## Phase 7: Cleanup

### 7.1 Remove old dependencies
```bash
npm uninstall sql.js better-sqlite3
```

### 7.2 Archive SQLite database
```bash
mv db.sqlite3 db.sqlite3.bak
```

### 7.3 Update package.json scripts (if any reference sqlite)

### 7.4 Update this document to mark complete

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Data loss during migration | Low | High | Keep db.sqlite3 untouched until verified |
| Async chain breaks | Medium | Medium | Test each file individually after migration |
| Transaction race conditions | Low | Medium | Use `withTransaction()` for multi-statement writes |
| Type mismatches (string vs int) | Medium | Low | Test with known contractors (ID 12, 1524) |
| Connection pool exhaustion | Low | Medium | pg.Pool defaults are sane; monitor in production |

---

## Rollback Plan

If anything breaks after migration:

```bash
# 1. Revert .env to SQLite
DATABASE_URL=sqlite:///db.sqlite3

# 2. Revert Node files from git
git checkout -- services/collection_service.js batch_collect.js ...

# 3. Restore SQLite backup if needed
mv db.sqlite3.bak db.sqlite3
```

---

## Post-Migration Benefits

Once complete, you can:

1. **Run parallel workers**: Multiple `node run_audit.js` instances
2. **Use connection pooling**: Already built into pg.Pool
3. **Query JSON fields**: `SELECT * WHERE collected_data->>'bbb_rating' = 'F'`
4. **Full-text search**: Replace `icontains` with `SearchVector` (future)
5. **Scale to 10,000+ contractors**: No more file locking

---

## Files Checklist

### Node.js (need pg conversion)
- [ ] `services/db_pg.js` (CREATE NEW)
- [ ] `services/collection_service.js`
- [ ] `services/audit_agent_v2.js`
- [ ] `batch_collect.js`
- [ ] `services/orchestrator.js`
- [ ] `audit_only.js`

### Python (already uses Django ORM - just verify)
- [ ] `scripts/get_unaudited_ids.py` → convert to Django ORM

### Config
- [ ] `.env` → add PostgreSQL DATABASE_URL
- [ ] `requirements.txt` → add psycopg2-binary
- [ ] `package.json` → add pg, remove sql.js/better-sqlite3

---

*Plan validated: December 9, 2025*
*Gemini confidence: 95% | Claude confidence: 95%*
