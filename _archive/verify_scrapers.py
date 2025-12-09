#!/usr/bin/env python3
import subprocess
import json
import sys
import os
import shutil

# ANSI colors for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
RESET = '\033[0m'

def print_result(name, passed, msg=""):
    """Helper to print colored test results."""
    if passed:
        print(f"{GREEN}[PASS]{RESET} {name} {msg}")
    else:
        print(f"{RED}[FAIL]{RESET} {name} {msg}")

def validate_schema(data, required_keys, context=""):
    """Validates that the JSON data is a dict and contains all required keys."""
    if not isinstance(data, dict):
        print(f"{RED}  Error: Output is not a dictionary{RESET}")
        return False

    missing = [key for key in required_keys if key not in data]
    if missing:
        print(f"{RED}  Error: Missing keys in {context}: {missing}{RESET}")
        return False
    return True

def run_scraper_test(script_path, args, expected_keys, test_name):
    """Runs a single scraper script and validates its output."""
    print(f"\nTesting {test_name}...")

    # Construct command: python3 scrapers/script.py [args] --json
    cmd = [sys.executable, script_path] + args + ["--json"]
    print(f"  Command: {' '.join(cmd)}")

    try:
        # Run the scraper with a timeout to prevent hanging
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            timeout=120  # 2 minute timeout
        )

        try:
            data = json.loads(result.stdout)

            # 1. Validate JSON Schema
            if validate_schema(data, expected_keys, test_name):

                # 2. Check Content Quality
                if data.get('found'):
                    details = []
                    name = data.get('name') or data.get('search_term')

                    if 'rating' in data and data['rating']:
                        details.append(f"Rating: {data['rating']}")
                    if 'reviews' in data:
                        details.append(f"Reviews: {len(data['reviews'])}")
                    if 'licenses' in data:
                        details.append(f"Licenses: {len(data['licenses'])}")

                    details_str = ", ".join(details)
                    print_result(test_name, True, f"(Found: {name} | {details_str})")
                else:
                    # It is possible the scraper ran successfully but found no results.
                    # This is still a "Pass" for the software test, but worth a warning.
                    print_result(test_name, True, f"(Not found, but valid JSON returned)")
                    print(f"    {YELLOW}Note: Scraper returned 'found': false.{RESET}")
                return True
            else:
                print_result(test_name, False, "Schema validation failed")
                return False

        except json.JSONDecodeError:
            print_result(test_name, False, "Invalid JSON output")
            print(f"  Stdout start: {result.stdout[:200]}...")
            return False

    except subprocess.CalledProcessError as e:
        print_result(test_name, False, f"Process failed with exit code {e.returncode}")
        print(f"  Stderr: {e.stderr}")
        return False
    except subprocess.TimeoutExpired:
        print_result(test_name, False, "Timed out")
        return False

def main():
    base_dir = os.getcwd()
    scrapers_dir = os.path.join(base_dir, "scrapers")

    # Verify environment
    if not os.path.isdir(scrapers_dir):
        print(f"{RED}Error: 'scrapers' directory not found in {base_dir}.{RESET}")
        print("Please run this script from the project root.")
        sys.exit(1)

    # Test Configuration
    contractor = "Orange Elephant Roofing"
    city = "Fort Worth"
    state = "TX"
    location_full = f"{city}, {state}"

    # Define the tests
    tests = [
        {
            "name": "TDLR Scraper (License)",
            "script": os.path.join(scrapers_dir, "tdlr.py"),
            "args": [contractor],
            # Note: Roofing often doesn't require TDLR, so we just check schema validity
            "keys": ["found", "licenses", "search_term", "requires_license", "source"]
        },
        {
            "name": "BBB Scraper (Reputation)",
            "script": os.path.join(scrapers_dir, "bbb.py"),
            "args": [contractor, city, state, "--with-details"],
            "keys": ["found", "name", "rating", "accredited", "complaints", "source", "is_critical"]
        },
        {
            "name": "Google Maps Scraper (Reviews)",
            "script": os.path.join(scrapers_dir, "google_maps.py"),
            "args": [contractor, location_full, "--max-reviews", "3"],
            "keys": ["found", "name", "rating", "review_count", "reviews", "source"]
        }
    ]

    print(f"Running Scraper Verification for: {contractor}")
    print("=" * 70)

    failed = 0
    for test in tests:
        if not run_scraper_test(test["script"], test["args"], test["keys"], test["name"]):
            failed += 1

    print("\n" + "=" * 70)
    if failed == 0:
        print(f"{GREEN}ALL TESTS PASSED{RESET}")
    else:
        print(f"{RED}{failed} TEST(S) FAILED{RESET}")
        sys.exit(1)

if __name__ == "__main__":
    main()
