#!/bin/bash
# Test agent scoring variance by running the same contractor multiple times

export DEEPSEEK_API_KEY=sk-08ebac40f2c745c9abd35e2303594348
export DATABASE_URL="postgresql://contractors_user:localdev123@localhost/contractors_dev"

CONTRACTOR_ID=${1:-26}
RUNS=${2:-5}

echo "Testing scoring variance for contractor $CONTRACTOR_ID"
echo "Running $RUNS audits..."
echo "=================================================="

# Clear previous results
rm -f /tmp/variance_test.csv
echo "run,score,recommendation,risk_level,iterations,cost" > /tmp/variance_test.csv

for i in $(seq 1 $RUNS); do
  echo ""
  echo "=== Run $i of $RUNS ==="

  OUTPUT=$(node bin/run_audit.js --id $CONTRACTOR_ID 2>&1)

  SCORE=$(echo "$OUTPUT" | grep "Trust Score:" | grep -oE '[0-9]+/100' | cut -d'/' -f1)
  REC=$(echo "$OUTPUT" | grep "Recommendation:" | head -1 | awk '{print $2}')
  RISK=$(echo "$OUTPUT" | grep "Risk Level:" | awk '{print $3}')
  ITERATIONS=$(echo "$OUTPUT" | grep -c "Agent iteration")
  COST=$(echo "$OUTPUT" | grep "API cost:" | awk '{print $3}')

  echo "Score: $SCORE | Rec: $REC | Risk: $RISK | Iterations: $ITERATIONS | Cost: $COST"
  echo "$i,$SCORE,$REC,$RISK,$ITERATIONS,$COST" >> /tmp/variance_test.csv
done

echo ""
echo "=================================================="
echo "RESULTS SUMMARY"
echo "=================================================="
cat /tmp/variance_test.csv
echo ""

# Calculate stats
SCORES=$(tail -n +2 /tmp/variance_test.csv | cut -d',' -f2)
MIN=$(echo "$SCORES" | sort -n | head -1)
MAX=$(echo "$SCORES" | sort -n | tail -1)
AVG=$(echo "$SCORES" | awk '{sum+=$1} END {printf "%.1f", sum/NR}')

echo "Score Range: $MIN - $MAX (spread: $((MAX - MIN)))"
echo "Average Score: $AVG"
