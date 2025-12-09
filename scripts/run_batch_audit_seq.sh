#!/bin/bash
# Sequential batch audit script - runs 1 audit at a time to avoid DB conflicts
set -e

cd /home/reid/testhome/contractors
source venv/bin/activate
set -a && source .env && set +a
export DEEPSEEK_API_KEY

# Get list of unaudited IDs (trust_score = 0)
IDS=$(python3 -c "
import sqlite3
conn = sqlite3.connect('db.sqlite3')
cursor = conn.execute('SELECT id FROM contractors_contractor WHERE trust_score = 0 ORDER BY id LIMIT 100')
print(' '.join(str(r[0]) for r in cursor.fetchall()))
")

echo "Found IDs to audit: $IDS"

# Convert to array
read -ra ID_ARRAY <<< "$IDS"
TOTAL=${#ID_ARRAY[@]}
echo "Total: $TOTAL contractors to audit"
echo ""

COMPLETED=0
FAILED=0

for id in "${ID_ARRAY[@]}"; do
    COMPLETED=$((COMPLETED + 1))
    echo "[$COMPLETED/$TOTAL] Auditing ID $id..."
    
    # Run audit and capture output
    if node run_audit.js --id $id > /tmp/audit_$id.log 2>&1; then
        # Check if score was saved
        SCORE=$(python3 -c "
import sqlite3
conn = sqlite3.connect('db.sqlite3')
r = conn.execute('SELECT trust_score FROM contractors_contractor WHERE id = ?', ($id,)).fetchone()
print(r[0] if r else 'N/A')
")
        if [ "$SCORE" != "0" ] && [ "$SCORE" != "N/A" ]; then
            echo "  ✓ Score: $SCORE"
        else
            FAILED=$((FAILED + 1))
            echo "  ✗ Score not saved (check /tmp/audit_$id.log)"
        fi
    else
        FAILED=$((FAILED + 1))
        echo "  ✗ Audit failed (check /tmp/audit_$id.log)"
    fi
done

echo ""
echo "============================================"
echo "BATCH AUDIT COMPLETE"
echo "============================================"
echo "Completed: $COMPLETED"
echo "Failed: $FAILED"

# Final summary
echo ""
echo "Final score distribution:"
python3 -c "
import sqlite3
conn = sqlite3.connect('db.sqlite3')
cursor = conn.execute('''
    SELECT 
        CASE 
            WHEN trust_score = 0 THEN 'UNAUDITED'
            WHEN trust_score <= 15 THEN 'CRITICAL'
            WHEN trust_score <= 35 THEN 'SEVERE'
            WHEN trust_score <= 60 THEN 'MODERATE'
            WHEN trust_score <= 75 THEN 'LOW'
            ELSE 'TRUSTED'
        END as level,
        COUNT(*) 
    FROM contractors_contractor
    GROUP BY level
    ORDER BY level
''')
for row in cursor:
    print(f'  {row[0]}: {row[1]}')
"
