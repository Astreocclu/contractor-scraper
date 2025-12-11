#!/bin/bash
# Batch audit script - runs 5 audits at a time
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
echo ""

# Convert to array
read -ra ID_ARRAY <<< "$IDS"
TOTAL=${#ID_ARRAY[@]}
echo "Total: $TOTAL contractors to audit"

# Run in batches of 5
BATCH_SIZE=5
BATCH_NUM=0

for ((i=0; i<TOTAL; i+=BATCH_SIZE)); do
    BATCH_NUM=$((BATCH_NUM + 1))
    BATCH_IDS=("${ID_ARRAY[@]:i:BATCH_SIZE}")
    echo ""
    echo "============================================"
    echo "BATCH $BATCH_NUM: Running ${#BATCH_IDS[@]} audits (IDs: ${BATCH_IDS[*]})"
    echo "============================================"
    
    # Start each audit in background
    for id in "${BATCH_IDS[@]}"; do
        echo "Starting audit for ID $id..."
        node run_audit.js --id $id > /tmp/audit_$id.log 2>&1 &
    done
    
    # Wait for all in this batch to complete
    echo "Waiting for batch to complete..."
    wait
    
    # Check results
    echo ""
    echo "Batch $BATCH_NUM results:"
    for id in "${BATCH_IDS[@]}"; do
        SCORE=$(grep -oP "Trust Score:\s+\K\d+" /tmp/audit_$id.log 2>/dev/null || echo "FAILED")
        if [ "$SCORE" != "FAILED" ]; then
            echo "  ID $id: Score $SCORE"
        else
            # Check for error
            LAST=$(tail -5 /tmp/audit_$id.log 2>/dev/null || echo "No log")
            echo "  ID $id: FAILED - check /tmp/audit_$id.log"
        fi
    done
    
    # Show overall progress
    COMPLETED=$((i + ${#BATCH_IDS[@]}))
    echo ""
    echo "Progress: $COMPLETED / $TOTAL completed"
done

echo ""
echo "============================================"
echo "BATCH AUDIT COMPLETE"
echo "============================================"

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
