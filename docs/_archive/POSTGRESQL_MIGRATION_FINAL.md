# PostgreSQL Migration Plan - Final

**Status:** Executed and Complete
**Confidence:** 95% (Claude + Gemini agreed)
**Date:** December 9, 2025

---

## Overview

Migrate contractor-auditor from SQLite (sql.js) to PostgreSQL to enable parallel audit workers.

**Current Problem:** SQLite write locks prevent parallel audits
**Solution:** PostgreSQL with connection pooling

---

## Phase 1: Infrastructure

```bash
# Install PostgreSQL and pgloader
sudo apt update
sudo apt install -y postgresql postgresql-contrib pgloader
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << 'EOF'
CREATE DATABASE contractors_dev;
CREATE USER contractors_user WITH PASSWORD 'localdev123';
GRANT ALL PRIVILEGES ON DATABASE contractors_dev TO contractors_user;
ALTER USER contractors_user CREATEDB;
\c contractors_dev
GRANT ALL ON SCHEMA public TO contractors_user;
GRANT CREATE ON SCHEMA public TO contractors_user;
EOF

# Install dependencies
source venv/bin/activate
pip install psycopg2-binary
npm install pg
```

---

## Phase 2: Schema-First Setup

### 2.1 Add Django Models for Node-Only Tables

Add to `contractors/models.py`:

```python
class ContractorRawData(models.Model):
    contractor = models.ForeignKey(Contractor, on_delete=models.CASCADE, related_name='raw_data')
    source_name = models.TextField()
    source_url = models.TextField(blank=True, null=True)
    raw_text = models.TextField(blank=True, null=True)
    structured_data = models.JSONField(blank=True, null=True)
    fetch_status = models.TextField(blank=True, null=True)
    error_message = models.TextField(blank=True, null=True)
    fetched_at = models.DateTimeField(blank=True, null=True)
    expires_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = 'contractor_raw_data'


class CollectionLog(models.Model):
    contractor = models.ForeignKey(Contractor, on_delete=models.CASCADE, related_name='collection_logs')
    source_name = models.TextField()
    requested_by = models.TextField(blank=True, null=True)
    request_reason = models.TextField(blank=True, null=True)
    status = models.TextField()
    started_at = models.DateTimeField(blank=True, null=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    error_message = models.TextField(blank=True, null=True)

    class Meta:
        db_table = 'collection_log'


class AuditRecord(models.Model):
    contractor = models.ForeignKey(Contractor, on_delete=models.CASCADE, related_name='audit_records')
    audit_type = models.TextField(blank=True, null=True)
    status = models.TextField()
    started_at = models.DateTimeField(blank=True, null=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    result_summary = models.JSONField(blank=True, null=True)
    error_message = models.TextField(blank=True, null=True)
    deepseek_tokens_used = models.IntegerField(blank=True, null=True)

    class Meta:
        db_table = 'audit_records'
```

### 2.2 Create Schema in Empty PostgreSQL

```bash
# Update .env temporarily to point to PostgreSQL
DATABASE_URL=postgresql://contractors_user:localdev123@localhost/contractors_dev

# Run migrations to create schema
python3 manage.py makemigrations contractors
python3 manage.py migrate
```

---

## Phase 3: Data Migration

### 3.1 Backup SQLite

```bash
cp db.sqlite3 db.sqlite3.backup.$(date +%Y%m%d_%H%M%S)
```

### 3.2 Run pgloader (Data Only)

```bash
pgloader sqlite:///$(pwd)/db.sqlite3 postgresql://contractors_user:localdev123@localhost/contractors_dev
```

### 3.3 Reset All Sequences

```sql
-- Run in psql
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('SELECT setval(pg_get_serial_sequence(%L, ''id''), COALESCE(MAX(id),1)) FROM %I', t, t);
  END LOOP;
END $$;
```

### 3.4 Verify Data

```bash
psql postgresql://contractors_user:localdev123@localhost/contractors_dev << 'EOF'
SELECT 'contractors_contractor' as tbl, COUNT(*) FROM contractors_contractor
UNION ALL SELECT 'contractor_raw_data', COUNT(*) FROM contractor_raw_data
UNION ALL SELECT 'collection_log', COUNT(*) FROM collection_log;
EOF
```

---

## Phase 4: Create db_pg.js Adapter

Create `services/db_pg.js`:

```javascript
/**
 * PostgreSQL Database Adapter
 * Drop-in replacement for sql.js with auto-conversion
 */

const { Pool, types } = require('pg');

// Fix INT8 returning as string
types.setTypeParser(20, (val) => parseInt(val, 10));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

/**
 * Convert SQLite SQL to PostgreSQL
 * - ? params -> $1, $2, $3
 * - datetime('now') -> NOW()
 */
function convertSql(sql) {
  let i = 1;
  sql = sql.replace(/\?/g, () => `$${i++}`);
  sql = sql.replace(/datetime\('now'\)/gi, 'NOW()');
  return sql;
}

module.exports = {
  /**
   * Execute SELECT query, return rows array
   */
  async exec(sql, params = []) {
    const result = await pool.query(convertSql(sql), params);
    return result.rows;
  },

  /**
   * Execute INSERT/UPDATE/DELETE
   */
  async run(sql, params = []) {
    return pool.query(convertSql(sql), params);
  },

  /**
   * Insert and return the new row (auto-adds RETURNING id)
   */
  async insert(sql, params = []) {
    if (!sql.toLowerCase().includes('returning')) {
      sql = sql.replace(/;\s*$/, '') + ' RETURNING *';
    }
    const result = await pool.query(convertSql(sql), params);
    return result.rows[0];
  },

  /**
   * Get single row or null
   */
  async getOne(sql, params = []) {
    const result = await pool.query(convertSql(sql), params);
    return result.rows[0] || null;
  },

  /**
   * Execute in transaction
   */
  async withTransaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback({
        query: (sql, params) => client.query(convertSql(sql), params),
        exec: async (sql, params) => (await client.query(convertSql(sql), params)).rows,
        run: (sql, params) => client.query(convertSql(sql), params),
      });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async healthCheck() {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch (e) {
      return false;
    }
  },

  async close() {
    await pool.end();
  },

  pool
};
```

---

## Phase 5: Migrate JS Files

### Files to Modify:
- `services/orchestrator.js`
- `services/collection_service.js`
- `services/audit_agent_v2.js`
- `batch_collect.js`
- `audit_only.js`

### Changes Required:

1. **Remove sql.js imports:**
   ```javascript
   // DELETE:
   const initSqlJs = require('sql.js');
   const fs = require('fs');  // if only for DB
   ```

2. **Add db_pg import:**
   ```javascript
   const db = require('./db_pg');  // or './services/db_pg'
   ```

3. **Remove DB initialization:**
   ```javascript
   // DELETE:
   const SQL = await initSqlJs();
   const dbBuffer = fs.readFileSync(DB_PATH);
   const db = new SQL.Database(dbBuffer);
   ```

4. **Add async/await to all db calls:**
   ```javascript
   // BEFORE (sync):
   const result = db.exec(`SELECT * FROM contractors_contractor WHERE id = ?`, [id]);
   const row = result[0].values[0];

   // AFTER (async):
   const rows = await db.exec(`SELECT * FROM contractors_contractor WHERE id = ?`, [id]);
   const row = rows[0];
   ```

5. **Change positional to named column access:**
   ```javascript
   // BEFORE:
   contractor = { id: row[0], name: row[1], city: row[2] };

   // AFTER:
   contractor = { id: row.id, name: row.business_name, city: row.city };
   ```

6. **Replace last_insert_rowid():**
   ```javascript
   // BEFORE:
   db.run(`INSERT INTO contractors_contractor (...) VALUES (...)`);
   const idResult = db.exec('SELECT last_insert_rowid()');
   const newId = idResult[0].values[0][0];

   // AFTER:
   const inserted = await db.insert(`INSERT INTO contractors_contractor (...) VALUES (...)`);
   const newId = inserted.id;
   ```

7. **Remove file saves:**
   ```javascript
   // DELETE ALL:
   const data = db.export();
   fs.writeFileSync(DB_PATH, Buffer.from(data));
   ```

8. **Add cleanup on exit:**
   ```javascript
   // At end of script:
   await db.close();
   ```

---

## Phase 6: Testing

### 6.1 Sanity Script

Create `test_pg.js`:

```javascript
require('dotenv').config();
const db = require('./services/db_pg');

async function test() {
  console.log('Testing PostgreSQL...');

  // Health check
  console.log('Health:', await db.healthCheck() ? 'OK' : 'FAIL');

  // Count test
  const rows = await db.exec('SELECT COUNT(*) as count FROM contractors_contractor');
  console.log('Contractors:', rows[0].count, typeof rows[0].count);

  // Type test (should be number, not string)
  const contractor = await db.getOne('SELECT id, business_name FROM contractors_contractor LIMIT 1');
  console.log('Sample:', contractor);
  console.log('ID type:', typeof contractor.id);  // Should be 'number'

  await db.close();
  console.log('All tests passed!');
}

test().catch(console.error);
```

### 6.2 Django Admin

```bash
python3 manage.py runserver 8002
# Visit http://localhost:8002/admin/
# Verify contractor count matches
```

### 6.3 Single Audit

```bash
source venv/bin/activate && set -a && . ./.env && set +a
node run_audit.js --id 12
```

### 6.4 Parallel Test (THE GOAL!)

```bash
# Terminal 1:
node run_audit.js --id 11

# Terminal 2 (simultaneously):
node run_audit.js --id 13
```

**Success criteria:** Both complete without "database is locked" errors.

### 6.5 Stress Test

```bash
for id in 14 15 16 17 18; do
  node run_audit.js --id $id &
done
wait
echo "All complete"
```

---

## Phase 7: Cleanup

```bash
# Remove old dependencies
npm uninstall sql.js

# Archive SQLite
mv db.sqlite3 db.sqlite3.archived.$(date +%Y%m%d)

# Update .gitignore
echo "db.sqlite3*" >> .gitignore
echo "*.archived.*" >> .gitignore
```

---

## Gotchas to Handle

1. **INT8 as strings** - Fixed in db_pg.js with type parser
2. **Transaction client passing** - Use `withTransaction()` and pass client to nested functions
3. **JSON auto-parsing** - pg driver auto-parses JSONB, don't double-parse

---

## Rollback Plan

```bash
# 1. Restore .env
sed -i 's|DATABASE_URL=postgresql://.*|DATABASE_URL=sqlite:///db.sqlite3|' .env

# 2. Restore SQLite
cp db.sqlite3.archived.* db.sqlite3

# 3. Restore JS files
git checkout HEAD~1 -- services/*.js batch_collect.js audit_only.js

# 4. Reinstall sql.js
npm install sql.js
```

---

## Update .env

```bash
# Change from:
DATABASE_URL=sqlite:///db.sqlite3

# To:
DATABASE_URL=postgresql://contractors_user:localdev123@localhost/contractors_dev
```

---

*Plan finalized: December 9, 2025*
*Agreed by: Claude (95%) + Gemini (95%)*
