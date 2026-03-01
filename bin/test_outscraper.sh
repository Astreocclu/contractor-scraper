#!/bin/bash
# Test Outscraper Integration
# Usage: ./bin/test_outscraper.sh

set -e

echo "========================================"
echo "Outscraper Integration Test"
echo "========================================"
echo ""

# Check API key
if [ -z "$OUTSCRAPER_API_KEY" ]; then
    echo "ERROR: OUTSCRAPER_API_KEY not set"
    echo "Get your API key from https://outscraper.com and run:"
    echo "  export OUTSCRAPER_API_KEY=your_key_here"
    exit 1
fi

echo "API Key: ${OUTSCRAPER_API_KEY:0:10}..."
echo ""

# Test contractor
CONTRACTOR="Infinity Pool Contractors"
LOCATION="Dallas, TX"

echo "Testing with: $CONTRACTOR, $LOCATION"
echo ""

# Test Google Maps
echo "=== Google Maps Reviews ==="
python3 scrapers/outscraper_reviews.py "$CONTRACTOR" "$LOCATION" --source google --max-reviews 5 --json | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'error' in data:
    print(f'  Status: FAILED - {data[\"error\"]}')
else:
    print(f'  Status: SUCCESS')
    print(f'  Name: {data.get(\"name\", \"N/A\")}')
    print(f'  Rating: {data.get(\"rating\", \"N/A\")}')
    print(f'  Total Reviews: {data.get(\"total_reviews\", 0)}')
    print(f'  Fetched: {len(data.get(\"reviews\", []))} reviews')
"
echo ""

# Test Yelp
echo "=== Yelp Reviews ==="
python3 scrapers/outscraper_reviews.py "$CONTRACTOR" "$LOCATION" --source yelp --max-reviews 5 --json | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'error' in data:
    print(f'  Status: FAILED - {data[\"error\"]}')
else:
    print(f'  Status: SUCCESS')
    print(f'  Name: {data.get(\"name\", \"N/A\")}')
    print(f'  Rating: {data.get(\"rating\", \"N/A\")}')
    print(f'  Total Reviews: {data.get(\"total_reviews\", 0)}')
"
echo ""

# Test BBB
echo "=== BBB Profile ==="
python3 scrapers/outscraper_reviews.py "$CONTRACTOR" "$LOCATION" --source bbb --json | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'error' in data:
    print(f'  Status: FAILED - {data[\"error\"]}')
else:
    print(f'  Status: SUCCESS')
    print(f'  Name: {data.get(\"name\", \"N/A\")}')
    print(f'  Rating: {data.get(\"rating\", \"N/A\")}')
    print(f'  Accredited: {data.get(\"accredited\", False)}')
    print(f'  Complaints: {data.get(\"complaints_count\", 0)}')
"
echo ""

# Test Trustpilot (if domain provided)
echo "=== Trustpilot Reviews ==="
python3 scrapers/outscraper_reviews.py "$CONTRACTOR" "$LOCATION" --source trustpilot --domain infinitypools.com --max-reviews 5 --json | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'error' in data:
    print(f'  Status: FAILED - {data[\"error\"]}')
else:
    print(f'  Status: SUCCESS')
    print(f'  Name: {data.get(\"name\", \"N/A\")}')
    print(f'  Rating: {data.get(\"rating\", \"N/A\")}')
    print(f'  Trust Score: {data.get(\"trust_score\", \"N/A\")}')
"
echo ""

echo "========================================"
echo "Test Complete"
echo "========================================"
