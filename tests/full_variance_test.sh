#!/bin/bash
export DEEPSEEK_API_KEY=sk-08ebac40f2c745c9abd35e2303594348
export DATABASE_URL="postgresql://contractors_user:localdev123@localhost/contractors_dev"

CONTRACTORS="1456 600 253 108 128"
RUNS=5

echo "FULL VARIANCE TEST"
echo "=================="
echo "Testing: $CONTRACTORS"
echo "Runs per contractor: $RUNS"
echo ""

# Results file
RESULTS="/tmp/full_variance.csv"
echo "contractor_id,name,category,run,score,recommendation" > $RESULTS

for CID in $CONTRACTORS; do
  # Get contractor name
  NAME=$(node -e "
    const db = require('./services/db_pg');
    (async () => {
      const r = await db.exec('SELECT business_name, trust_score FROM contractors_contractor WHERE id = ?', [$CID]);
      console.log(r[0]?.business_name || 'Unknown');
      await db.close();
    })();
  " 2>/dev/null)

  # Determine category
  PREV_SCORE=$(node -e "
    const db = require('./services/db_pg');
    (async () => {
      const r = await db.exec('SELECT trust_score FROM contractors_contractor WHERE id = ?', [$CID]);
      console.log(r[0]?.trust_score || 0);
      await db.close();
    })();
  " 2>/dev/null)

  if [ "$PREV_SCORE" -le 30 ]; then
    CAT="TERRIBLE"
  elif [ "$PREV_SCORE" -ge 80 ]; then
    CAT="GREAT"
  else
    CAT="NEUTRAL"
  fi

  echo ""
  echo "=========================================="
  echo "Contractor $CID: $NAME"
  echo "Category: $CAT (previous score: $PREV_SCORE)"
  echo "=========================================="

  SCORES=""
  for i in $(seq 1 $RUNS); do
    echo -n "  Run $i: "
    OUTPUT=$(node bin/run_audit.js --id $CID 2>&1)
    SCORE=$(echo "$OUTPUT" | grep "Trust Score:" | grep -oE '[0-9]+/100' | cut -d'/' -f1)
    REC=$(echo "$OUTPUT" | grep "Recommendation:" | head -1 | awk '{print $2}')
    echo "$SCORE ($REC)"
    echo "$CID,\"$NAME\",$CAT,$i,$SCORE,$REC" >> $RESULTS
    SCORES="$SCORES $SCORE"
  done

  # Calculate spread for this contractor
  MIN=$(echo $SCORES | tr ' ' '\n' | grep -v '^$' | sort -n | head -1)
  MAX=$(echo $SCORES | tr ' ' '\n' | grep -v '^$' | sort -n | tail -1)
  echo "  --> Range: $MIN - $MAX (spread: $((MAX - MIN)))"
done

echo ""
echo "=========================================="
echo "FINAL RESULTS"
echo "=========================================="
cat $RESULTS

echo ""
echo "=========================================="
echo "VARIANCE SUMMARY BY CATEGORY"
echo "=========================================="
for CAT in TERRIBLE NEUTRAL GREAT; do
  SCORES=$(grep "$CAT" $RESULTS | cut -d',' -f5 | tr '\n' ' ')
  if [ -n "$SCORES" ]; then
    MIN=$(echo $SCORES | tr ' ' '\n' | grep -v '^$' | sort -n | head -1)
    MAX=$(echo $SCORES | tr ' ' '\n' | grep -v '^$' | sort -n | tail -1)
    AVG=$(echo $SCORES | tr ' ' '\n' | grep -v '^$' | awk '{sum+=$1} END {printf "%.1f", sum/NR}')
    echo "$CAT: Range $MIN-$MAX (spread: $((MAX-MIN))), Avg: $AVG"
  fi
done
