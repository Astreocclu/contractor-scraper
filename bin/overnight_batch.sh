#!/bin/bash
# Overnight Batch - Source + Audit contractors sequentially
# Scheduled via cron

set -e

# Load NVM (cron doesn't have user's shell profile)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Config
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/overnight_$(date +%Y%m%d_%H%M%S).log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Change to project directory
cd "$PROJECT_DIR"

# Load environment
source venv/bin/activate
set -a && . ./.env && set +a

echo "========================================" | tee -a "$LOG_FILE"
echo "OVERNIGHT BATCH STARTED: $(date)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

# Run batch pipeline: 50 contractors, 1 at a time (sequential)
node bin/batch_full_pipeline.js --count 50 --concurrency 1 2>&1 | tee -a "$LOG_FILE"

echo "========================================" | tee -a "$LOG_FILE"
echo "OVERNIGHT BATCH COMPLETED: $(date)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

# Optional: Send notification (uncomment if you have notify-send)
# notify-send "Overnight Batch Complete" "50 contractors processed"
