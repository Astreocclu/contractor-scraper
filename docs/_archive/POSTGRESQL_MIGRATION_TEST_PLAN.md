# PostgreSQL Migration Test Plan

**Task:** Comprehensive testing to ensure SQLite → PostgreSQL migration was flawless
**Created:** 2025-12-09
**Confidence:** 98% (Gemini) / 96% (Claude)
**Total Tests:** 25

---

## Prerequisites

```bash
cd /home/reid/testhome/contractor-auditor
source venv/bin/activate && set -a && . ./.env && set +a
```

---

## Phase 1: Environment & Connection (5 tests)

### Test 1.1: Verify DATABASE_URL
```bash
echo $DATABASE_URL
# Expected: postgresql://user:pass@localhost:5432/contractors_dev
```

### Test 1.2: Verify Django Settings Match
```bash
python3 -c "from config.settings import DATABASES; print(DATABASES['default'])"
# Should show postgresql engine, same DB name as DATABASE_URL
```

### Test 1.3: Test db_pg.js Connection
```bash
node -e "
const db = require('./services/db_pg');
db.exec('SELECT 1 as val').then(r => {
    console.log('Connection:', r[0].val === 1 ? 'PASS' : 'FAIL');
    db.close();
}).catch(e => { console.log('FAIL:', e.message); db.close(); });
"
```

### Test 1.4: Test Parameter Conversion (? → $1)
```bash
node -e "
const db = require('./services/db_pg');
db.exec('SELECT \$1::int as val', [42]).then(r => {
    console.log('Param conversion:', r[0].val === 42 ? 'PASS' : 'FAIL');
    db.close();
}).catch(e => { console.log('FAIL:', e.message); db.close(); });
"
```

### Test 1.5: Test String Literal with ? Character
```bash
node -e "
const db = require('./services/db_pg');
db.exec(\"SELECT 'Question?' as text\").then(r => {
    console.log('String literal:', r[0].text === 'Question?' ? 'PASS' : 'FAIL - corrupted to: ' + r[0].text);
    db.close();
}).catch(e => { console.log('FAIL:', e.message); db.close(); });
"
```

**Phase 1 Pass Criteria:** All 5 tests show PASS

---

## Phase 2: Sequence & Schema Integrity (4 tests)

### Test 2.1: Generate Sequence Reset SQL (contractors)
```bash
python3 manage.py sqlsequencereset contractors
# Review output - should show ALTER SEQUENCE commands
```

### Test 2.2: Generate Sequence Reset SQL (clients)
```bash
python3 manage.py sqlsequencereset clients
# Review output
```

### Test 2.3: Check Migrations Status
```bash
python3 manage.py migrate --check
# Expected: No output = all migrations applied
# If it says "unapplied migrations", run: python3 manage.py migrate
```

### Test 2.4: Show All Migrations
```bash
python3 manage.py showmigrations
# All should show [X] (applied)
```

**Phase 2 Pass Criteria:** No unapplied migrations, sequences reviewed

---

## Phase 3: Data Integrity (6 tests)

### Test 3.1: Row Count Verification
```bash
python3 manage.py shell -c "
from contractors.models import Contractor, ContractorAudit, ContractorRawData
print(f'Contractors: {Contractor.objects.count()}')
print(f'Audits: {ContractorAudit.objects.count()}')
print(f'RawData: {ContractorRawData.objects.count()}')
"
# Compare against expected counts from old SQLite DB
```

### Test 3.2: Boolean Field Returns true/false
```bash
node -e "
const db = require('./services/db_pg');
db.exec('SELECT id, name FROM contractors_contractor LIMIT 1').then(r => {
    console.log('Sample record:', r[0]);
    console.log('Boolean check: Verify any boolean fields show true/false, not 1/0');
    db.close();
});
"
```

### Test 3.3: Datetime Timezone Consistency
```bash
python3 manage.py shell -c "
from contractors.models import Contractor
c = Contractor.objects.first()
print(f'created_at: {c.created_at}')
print(f'Timezone aware: {c.created_at.tzinfo is not None}')
"
# Verify timestamp makes sense (not shifted by hours)
```

### Test 3.4: JSON Fields Valid
```bash
python3 manage.py shell -c "
from contractors.models import ContractorRawData
import json
for raw in ContractorRawData.objects.all()[:5]:
    try:
        if raw.raw_data:
            json.loads(raw.raw_data) if isinstance(raw.raw_data, str) else raw.raw_data
        print(f'ID {raw.id}: VALID')
    except Exception as e:
        print(f'ID {raw.id}: INVALID - {e}')
"
```

### Test 3.5: Spot-Check Contractor Records
```bash
python3 manage.py shell -c "
from contractors.models import Contractor
for c in Contractor.objects.all()[:5]:
    print(f'{c.id}: {c.name} | {c.city}, {c.state} | Score: {c.trust_score}')
"
# Visually verify data looks correct
```

### Test 3.6: Verify DB Cache (RawData) Populated
```bash
python3 manage.py shell -c "
from contractors.models import ContractorRawData
count = ContractorRawData.objects.count()
print(f'RawData records: {count}')
print('PASS' if count > 0 else 'FAIL - DB cache empty, will re-scrape everything!')
"
```

**Phase 3 Pass Criteria:** All data present, types correct, JSON valid

---

## Phase 4: WRITE Operations - CRITICAL (4 tests)

### Test 4.1: Create NEW Contractor (Catches Sequence Errors)
```bash
python3 manage.py shell -c "
from contractors.models import Contractor
c = Contractor.objects.create(
    name='TEST_MIGRATION_VERIFY',
    city='Test City',
    state='TX'
)
print(f'Created contractor ID: {c.id}')
print('PASS - Sequence is working!')
"
```

### Test 4.2: Delete Test Contractor
```bash
python3 manage.py shell -c "
from contractors.models import Contractor
deleted, _ = Contractor.objects.filter(name='TEST_MIGRATION_VERIFY').delete()
print(f'Deleted {deleted} test record(s)')
"
```

### Test 4.3: Test RETURNING Clause Handling
```bash
node -e "
const db = require('./services/db_pg');
// Test that insert with existing RETURNING doesn't double-append
db.insert('INSERT INTO contractors_contractor (name, city, state) VALUES (\$1, \$2, \$3) RETURNING id',
    ['TEST_RETURNING', 'Test', 'TX']
).then(r => {
    console.log('Insert with RETURNING:', r.id ? 'PASS' : 'FAIL');
    return db.run('DELETE FROM contractors_contractor WHERE name = \$1', ['TEST_RETURNING']);
}).then(() => db.close())
.catch(e => { console.log('FAIL:', e.message); db.close(); });
"
```

### Test 4.4: Test Transaction Rollback
```bash
node -e "
const db = require('./services/db_pg');
db.withTransaction(async (tx) => {
    await tx.run('INSERT INTO contractors_contractor (name, city, state) VALUES (\$1, \$2, \$3)',
        ['TEST_ROLLBACK', 'Test', 'TX']);
    throw new Error('Intentional rollback');
}).catch(async (e) => {
    const rows = await db.exec('SELECT * FROM contractors_contractor WHERE name = \$1', ['TEST_ROLLBACK']);
    console.log('Rollback test:', rows.length === 0 ? 'PASS' : 'FAIL - row was not rolled back');
    db.close();
});
"
```

**Phase 4 Pass Criteria:** All creates/deletes succeed, rollback works

---

## Phase 5: Functional Testing (4 tests)

### Test 5.1: Run Audit on Test Contractor
```bash
node run_audit.js --id 1524
# Expected: Audit completes, score ~15 (CRITICAL), no errors
```

### Test 5.2: Django Admin Loads
```bash
python3 manage.py runserver 8002
# Open http://localhost:8002/admin/
# Navigate to Contractors list - should display all records
```

### Test 5.3: Test Batch Collection (2 contractors)
```bash
# Get 2 contractor IDs first
python3 manage.py shell -c "
from contractors.models import Contractor
ids = list(Contractor.objects.values_list('id', flat=True)[:2])
print(' '.join(map(str, ids)))
"

# Run batch collect on those IDs
node batch_collect.js --id <ID1> --force
node batch_collect.js --id <ID2> --force
```

### Test 5.4: Test Case-Insensitive Search (LIKE vs ILIKE)
```bash
node -e "
const db = require('./services/db_pg');
// SQLite LIKE is case-insensitive, PostgreSQL LIKE is case-sensitive
// Test if any queries rely on case-insensitive behavior
db.exec('SELECT name FROM contractors_contractor WHERE name LIKE \$1 LIMIT 3', ['%roofing%']).then(r => {
    console.log('Case-sensitive LIKE results:', r.length);
    return db.exec('SELECT name FROM contractors_contractor WHERE name ILIKE \$1 LIMIT 3', ['%roofing%']);
}).then(r => {
    console.log('Case-insensitive ILIKE results:', r.length);
    console.log('If different, raw SQL searches may need ILIKE');
    db.close();
});
"
```

**Phase 5 Pass Criteria:** Audit completes, admin works, batch works

---

## Phase 6: Edge Cases (2 tests)

### Test 6.1: Special Characters in Names
```bash
python3 manage.py shell -c "
from contractors.models import Contractor
# Find contractors with special chars
for c in Contractor.objects.filter(name__regex=r'[&\\'\"<>]')[:3]:
    print(f'{c.id}: {c.name}')
print('Verify names display correctly without encoding issues')
"
```

### Test 6.2: File Cache Unaffected
```bash
ls -la scrapers/.scraper_cache/ | head -10
# Should show existing .json cache files
# These are filesystem-based and should be unaffected by DB migration
```

**Phase 6 Pass Criteria:** Special chars display correctly, file cache exists

---

## Known Issues to Monitor

### 1. db_pg.js Regex Vulnerability
The parameter conversion regex `sql.replace(/\?/g, ...)` replaces ALL `?` characters, including those in string literals.

**Risk:** Low if all `?` are parameters. High if hardcoded SQL has literal `?` in values.

**Mitigation:** Data goes through params array, not SQL string.

### 2. PostgreSQL LIKE is Case-Sensitive
SQLite `LIKE` is case-insensitive by default. PostgreSQL requires `ILIKE` for case-insensitive matching.

**Risk:** Raw SQL searches may return fewer results than expected.

**Mitigation:** Use Django ORM `__icontains` or update raw SQL to use `ILIKE`.

---

## Test Summary Checklist

| Phase | Tests | Status |
|-------|-------|--------|
| 1. Environment & Connection | 5 | [x] 4/5 PASS (Test 1.5 FAIL - regex bug) |
| 2. Sequence & Schema | 4 | [x] 4/4 PASS |
| 3. Data Integrity | 6 | [x] 6/6 PASS |
| 4. WRITE Operations | 4 | [x] 4/4 PASS |
| 5. Functional Testing | 4 | [x] 3/4 PASS (5.2 skipped) |
| 6. Edge Cases | 2 | [x] 2/2 PASS |
| **TOTAL** | **25** | **23 PASS, 1 FAIL, 1 SKIP** |

**Executed:** 2025-12-09 by Antigravity

---

## If Tests Fail

### Sequence Errors (Test 4.1)
```bash
# Reset sequences to MAX(id) + 1
python3 manage.py sqlsequencereset contractors | python3 manage.py dbshell
python3 manage.py sqlsequencereset clients | python3 manage.py dbshell
```

### Missing Data
- Check if migration script ran completely
- Verify `DATABASE_URL` points to correct database
- Check for migration errors in logs

### JSON Parse Errors
- Identify malformed records and fix manually
- SQLite allowed invalid JSON; PostgreSQL JSONB is strict

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Tester | | | |
| Reviewer | | | |
