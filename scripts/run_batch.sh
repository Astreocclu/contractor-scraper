#!/bin/bash
source venv/bin/activate
set -a && source .env && set +a

for id in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    echo ""
    echo "========================================"
    echo "=== Auditing contractor $id ==="
    echo "========================================"
    node run_audit.js --id $id 2>&1 | tail -30
done
