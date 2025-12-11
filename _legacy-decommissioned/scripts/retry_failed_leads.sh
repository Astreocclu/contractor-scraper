#!/bin/bash
# Retry failed leads cron script
# Run daily: 0 6 * * * /home/reid/testhome/contractors/scripts/retry_failed_leads.sh
#
# This script re-processes leads that failed scoring due to API timeouts or errors.

set -e

cd /home/reid/testhome/contractors
source venv/bin/activate
set -a && . ./.env && set +a

RETRY_FILE="exports/pending_retry/retry_queue.csv"
LOG_FILE="logs/retry_$(date +%Y%m%d_%H%M%S).log"

mkdir -p logs

if [ -f "$RETRY_FILE" ]; then
    echo "$(date): Starting retry of failed leads" >> "$LOG_FILE"

    # Count leads to retry
    LEAD_COUNT=$(tail -n +2 "$RETRY_FILE" | wc -l)
    echo "$(date): Found $LEAD_COUNT leads to retry" >> "$LOG_FILE"

    if [ "$LEAD_COUNT" -gt 0 ]; then
        # Re-score with reasoner model
        python manage.py score_leads_v2 \
            --retry-only "$RETRY_FILE" \
            --reasoner \
            --save-to-db \
            >> "$LOG_FILE" 2>&1

        echo "$(date): Retry complete" >> "$LOG_FILE"
    else
        echo "$(date): No leads to retry" >> "$LOG_FILE"
    fi
else
    echo "$(date): No retry queue file found at $RETRY_FILE" >> "$LOG_FILE"
fi
