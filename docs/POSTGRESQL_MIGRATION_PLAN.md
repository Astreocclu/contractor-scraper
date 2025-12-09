# PostgreSQL Migration Plan

**Status:** Ready to execute when prioritized
**Trigger:** After Boss deal response (or if Boss delays)

---

## Overview

Migrate from SQLite to PostgreSQL to enable:
- Parallel audit workers (SQLite locks on writes)
- 1000+ contractor scaling
- Native JSON querying (`JSONB`)
- Full-text search (`SearchVector`)

---

## Phase 1: Infrastructure (30 min)

### 1.1 Install PostgreSQL locally
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

### 1.3 Update Python dependencies
```bash
source venv/bin/activate
pip install psycopg2-binary
pip freeze > requirements.txt
```

### 1.4 Create `.env.postgres`
```bash
DATABASE_URL=postgres://contractors_user:localdev123@localhost:5432/contractors_dev
```

### 1.5 Test Django connection
```bash
# Temporarily update .env, then:
python3 manage.py check
python3 manage.py migrate
```

---

## Phase 2: Python Refactoring (2-3 hours)

**Files with `import sqlite3` that need ORM conversion:**

| File | Current Usage | Fix |
|------|---------------|-----|
| `scripts/get_unaudited_ids.py` | Direct sqlite3 queries | Django ORM |
| `clients/management/commands/import_scraper_data.py` | sqlite3 import | Django ORM |
| `run_batch_audit.sh` | Inline Python sqlite3 | Django management command |
| `run_batch_audit_seq.sh` | Inline Python sqlite3 | Django management command |

### 2.1 Pattern: Replace sqlite3 with Django ORM

**Before:**
```python
import sqlite3
conn = sqlite3.connect('db.sqlite3')
cursor = conn.execute('SELECT id FROM contractors_contractor WHERE trust_score = 0')
ids = [row[0] for row in cursor.fetchall()]
```

**After:**
```python
import django
django.setup()
from contractors.models import Contractor

ids = list(Contractor.objects.filter(trust_score=0).values_list('id', flat=True))
```

### 2.2 Create management command for batch scripts

Create `contractors/management/commands/get_unaudited.py`:
```python
from django.core.management.base import BaseCommand
from contractors.models import Contractor

class Command(BaseCommand):
    def handle(self, *args, **options):
        ids = Contractor.objects.filter(trust_score=0).values_list('id', flat=True)
        for id in ids:
            self.stdout.write(str(id))
```

Then shell scripts become:
```bash
python3 manage.py get_unaudited | while read id; do
  node audit_only.js --id "$id"
done
```

---

## Phase 3: Node.js Refactoring (1-2 hours)

**Files using `sql.js` that need `pg` conversion:**

| File | Current | Fix |
|------|---------|-----|
| `audit_only.js` | `sql.js` (async, file-based) | `pg` Pool |
| `services/orchestrator.js` | sqlite references | `pg` Pool |
| `scrape_tx_sos.js` | sqlite references | `pg` Pool |

### 3.1 Install pg
```bash
npm install pg
npm uninstall sql.js better-sqlite3  # cleanup
```

### 3.2 Create shared db connection

Create `services/db.js`:
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

module.exports = { pool };
```

### 3.3 Pattern: Replace sql.js with pg

**Before (sql.js):**
```javascript
const initSqlJs = require('sql.js');
const fs = require('fs');

const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync('db.sqlite3'));
const result = db.exec('SELECT * FROM contractors_contractor WHERE id = ?', [id]);
// ...
fs.writeFileSync('db.sqlite3', Buffer.from(db.export()));
```

**After (pg):**
```javascript
const { pool } = require('./services/db');

const result = await pool.query(
  'SELECT * FROM contractors_contractor WHERE id = $1',
  [id]
);
const contractor = result.rows[0];

// Updates are immediate, no file save needed
await pool.query(
  'UPDATE contractors_contractor SET trust_score = $1 WHERE id = $2',
  [score, id]
);
```

### 3.4 Key SQL syntax differences

| SQLite | PostgreSQL |
|--------|------------|
| `?` placeholders | `$1, $2, $3` placeholders |
| `AUTOINCREMENT` | `SERIAL` or `GENERATED` |
| `json_extract(col, '$.key')` | `col->>'key'` |
| No native JSON type | `JSONB` with indexing |

---

## Phase 4: Data Migration (30 min)

### Option A: pgloader (Recommended)
```bash
sudo apt install pgloader

pgloader sqlite:///home/reid/testhome/contractors/db.sqlite3 \
  postgresql://contractors_user:localdev123@localhost/contractors_dev
```

### Option B: Django dumpdata/loaddata
```bash
# With SQLite still active:
python3 manage.py dumpdata --natural-foreign --indent 2 > backup.json

# Switch to PostgreSQL in .env, then:
python3 manage.py migrate
python3 manage.py loaddata backup.json
```

---

## Phase 5: Verification

```bash
# Django admin should work
python3 manage.py runserver 8002

# Node audits should work
node audit_only.js --id 1524 --dry-run

# Check counts match
python3 manage.py shell -c "from contractors.models import Contractor; print(Contractor.objects.count())"
```

---

## Post-Migration Improvements (Future)

1. **Parallel workers**: Run multiple `audit_only.js` instances
2. **Connection pooling**: Already built into `pg.Pool`
3. **JSON queries**: Filter by `google_reviews_json` contents
4. **Full-text search**: Replace `icontains` with `SearchVector`

---

## Rollback Plan

Keep `db.sqlite3` untouched during migration. If anything breaks:
```bash
# In .env, revert to:
DATABASE_URL=sqlite:///db.sqlite3
```

---

## Files Checklist

### Python (need ORM conversion)
- [ ] `scripts/get_unaudited_ids.py`
- [ ] `clients/management/commands/import_scraper_data.py`
- [ ] `run_batch_audit.sh` (inline Python)
- [ ] `run_batch_audit_seq.sh` (inline Python)

### Node.js (need pg conversion)
- [ ] `audit_only.js`
- [ ] `services/orchestrator.js`
- [ ] `scrape_tx_sos.js`

### Config
- [ ] `.env` → add PostgreSQL URL
- [ ] `requirements.txt` → add psycopg2-binary
- [ ] `package.json` → add pg, remove sql.js/better-sqlite3
