#!/bin/bash
# Compare normal vs strict scoring for 20 contractors

export DEEPSEEK_API_KEY=sk-08ebac40f2c745c9abd35e2303594348
export DATABASE_URL="postgresql://contractors_user:localdev123@localhost/contractors_dev"

IDS="1 2 3 4 5 6 7 8 9 10 18 19 20 21 22 23 24 25 26 27"
MODE=$1  # "normal" or "strict"

RESULTS_FILE="/tmp/scoring_${MODE}.csv"
echo "id,name,score,recommendation" > $RESULTS_FILE

for id in $IDS; do
  echo "=== Auditing contractor $id ($MODE mode) ==="

  if [ "$MODE" = "strict" ]; then
    OUTPUT=$(node bin/run_audit.js --id $id --strict 2>&1)
  else
    OUTPUT=$(node bin/run_audit.js --id $id 2>&1)
  fi

  # Extract results
  SCORE=$(echo "$OUTPUT" | grep "Trust Score:" | grep -oE '[0-9]+/100' | cut -d'/' -f1)
  REC=$(echo "$OUTPUT" | grep "Recommendation:" | awk '{print $2}')
  NAME=$(echo "$OUTPUT" | grep "📋 Contractor:" | sed 's/.*Contractor: //')

  echo "$id,$NAME,$SCORE,$REC" >> $RESULTS_FILE
  echo "  Score: $SCORE, Rec: $REC"
  echo ""
done

echo "Results saved to $RESULTS_FILE"
cat $RESULTS_FILE
