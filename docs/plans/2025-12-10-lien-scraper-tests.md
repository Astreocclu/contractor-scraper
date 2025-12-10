# Lien Scraper Test Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create comprehensive unit tests for county lien scraper logic (pairing, scoring) without hitting live portals.

**Architecture:** Python unit tests using pytest that test the orchestrator functions (`pair_liens_with_releases`, `calculate_lien_score`) with fixture data. Tests focus on business logic rather than scraping (existing `test_lien_scrapers.js` covers integration).

**Tech Stack:** Python 3, pytest, unittest.mock (for mocked scraper tests)

---

## Task 1: Create Test Fixtures Package

**Files:**
- Create: `tests/fixtures/__init__.py`
- Create: `tests/fixtures/lien_scenarios.py`

### Step 1: Create fixtures directory and __init__.py

```bash
mkdir -p tests/fixtures
```

### Step 2: Create the __init__.py file

Create `tests/fixtures/__init__.py`:

```python
"""Test fixtures for county lien scraper tests."""
```

### Step 3: Create lien scenario fixtures

Create `tests/fixtures/lien_scenarios.py`:

```python
"""
Test fixtures for lien pairing and scoring logic.
Contains scenarios covering all scoring edge cases.
"""

from datetime import date, timedelta

TODAY = date.today()

def days_ago(days: int) -> str:
    """Helper to generate ISO date strings."""
    return (TODAY - timedelta(days=days)).isoformat()


# =============================================================
# SCENARIO 1: Matched lien and release (same grantor)
# Expected: has_release=True, days_to_release calculated
# =============================================================
SCENARIO_MATCHED_RELEASE = [
    {
        'county': 'tarrant',
        'instrument_number': 'L1001',
        'document_type': 'MECH_LIEN',
        'grantor': 'ABC SUPPLIES',
        'grantee': 'XYZ CONTRACTORS',
        'filing_date': days_ago(100),
        'amount': 5000.00
    },
    {
        'county': 'tarrant',
        'instrument_number': 'R1001',
        'document_type': 'REL_LIEN',
        'grantor': 'ABC SUPPLIES',  # Same grantor = matches
        'grantee': 'XYZ CONTRACTORS',
        'filing_date': days_ago(10),  # 90 days later
        'amount': 0
    }
]


# =============================================================
# SCENARIO 2: Active mechanic's lien (no release)
# Expected: score = 7 (10 - 3 for 1 HIGH severity lien)
# =============================================================
SCENARIO_ACTIVE_LIEN = [
    {
        'county': 'dallas',
        'instrument_number': 'L2001',
        'document_type': 'MECH_LIEN',
        'grantor': 'BIG CONCRETE CO',
        'grantee': 'XYZ CONTRACTORS',
        'filing_date': days_ago(45),
        'amount': 12000.00
    }
]


# =============================================================
# SCENARIO 3: Critical tax lien (federal)
# Expected: score = 5 (10 - 5 for CRITICAL)
# =============================================================
SCENARIO_TAX_LIEN = [
    {
        'county': 'collin',
        'instrument_number': 'T3001',
        'document_type': 'FED_TAX_LIEN',
        'grantor': 'IRS',
        'grantee': 'XYZ CONTRACTORS',
        'filing_date': days_ago(200),
        'amount': 25000.00
    }
]


# =============================================================
# SCENARIO 4: Abstract of judgment (also CRITICAL)
# Expected: score = 5 (10 - 5 for CRITICAL)
# =============================================================
SCENARIO_JUDGMENT = [
    {
        'county': 'denton',
        'instrument_number': 'J4001',
        'document_type': 'ABS_JUDG',
        'grantor': 'ANGRY HOMEOWNER',
        'grantee': 'XYZ CONTRACTORS',
        'filing_date': days_ago(300),
        'amount': 15000.00
    }
]


# =============================================================
# SCENARIO 5: Multiple active liens (3+) = HIGH severity pattern
# Expected: score = 5 (10 - 5 for pattern of non-payment)
# =============================================================
SCENARIO_HIGH_RISK = [
    {
        'county': 'tarrant',
        'instrument_number': 'L5001',
        'document_type': 'MECH_LIEN',
        'grantor': 'SUPPLY CO A',
        'grantee': 'BAD BUILDERS',
        'filing_date': days_ago(20),
        'amount': 10000.00
    },
    {
        'county': 'tarrant',
        'instrument_number': 'L5002',
        'document_type': 'MECH_LIEN',
        'grantor': 'SUPPLY CO B',
        'grantee': 'BAD BUILDERS',
        'filing_date': days_ago(15),
        'amount': 5000.00
    },
    {
        'county': 'tarrant',
        'instrument_number': 'L5003',
        'document_type': 'MECH_LIEN',
        'grantor': 'SUPPLY CO C',
        'grantee': 'BAD BUILDERS',
        'filing_date': days_ago(5),
        'amount': 8000.00
    }
]


# =============================================================
# SCENARIO 6: Slow releases (>90 days to resolve)
# Expected: score = 8 (10 - 2 for 2+ slow releases)
# =============================================================
SCENARIO_SLOW_RELEASE = [
    {
        'county': 'dallas',
        'instrument_number': 'L6001',
        'document_type': 'MECH_LIEN',
        'grantor': 'ROOF SUPPLIER',
        'grantee': 'SLOW PAYERS',
        'filing_date': days_ago(200),
        'amount': 6000.00
    },
    {
        'county': 'dallas',
        'instrument_number': 'R6001',
        'document_type': 'REL_LIEN',
        'grantor': 'ROOF SUPPLIER',
        'grantee': 'SLOW PAYERS',
        'filing_date': days_ago(10),  # 190 days later
        'amount': 0
    },
    {
        'county': 'dallas',
        'instrument_number': 'L6002',
        'document_type': 'MECH_LIEN',
        'grantor': 'LUMBER CO',
        'grantee': 'SLOW PAYERS',
        'filing_date': days_ago(200),
        'amount': 4000.00
    },
    {
        'county': 'dallas',
        'instrument_number': 'R6002',
        'document_type': 'REL_LIEN',
        'grantor': 'LUMBER CO',
        'grantee': 'SLOW PAYERS',
        'filing_date': days_ago(10),  # 190 days later
        'amount': 0
    }
]


# =============================================================
# SCENARIO 7: High total amount (>$50k active)
# Expected: additional -2 penalty for amount
# =============================================================
SCENARIO_HIGH_AMOUNT = [
    {
        'county': 'tarrant',
        'instrument_number': 'L7001',
        'document_type': 'MECH_LIEN',
        'grantor': 'BIG SUPPLIER',
        'grantee': 'LARGE DEBTOR',
        'filing_date': days_ago(30),
        'amount': 60000.00  # Over $50k threshold
    }
]


# =============================================================
# SCENARIO 8: Clean contractor (no liens)
# Expected: score = 10
# =============================================================
SCENARIO_CLEAN = []


# =============================================================
# SCENARIO 9: Only releases (no active liens)
# Expected: score = 10 (releases don't count as active)
# =============================================================
SCENARIO_ONLY_RELEASES = [
    {
        'county': 'tarrant',
        'instrument_number': 'R9001',
        'document_type': 'REL_LIEN',
        'grantor': 'SOME CREDITOR',
        'grantee': 'GOOD CONTRACTOR',
        'filing_date': days_ago(30),
        'amount': 0
    }
]
```

### Step 4: Verify fixture file created

Run: `python3 -c "from tests.fixtures.lien_scenarios import *; print('Fixtures loaded OK')"`

Expected: `Fixtures loaded OK`

### Step 5: Commit

```bash
git add tests/fixtures/
git commit -m "feat: add lien test fixtures for scoring scenarios"
```

---

## Task 2: Create Lien Pairing Tests

**Files:**
- Create: `tests/test_lien_pairing.py`

### Step 1: Write the failing test file

Create `tests/test_lien_pairing.py`:

```python
"""
Unit tests for pair_liens_with_releases() function.

Tests that mechanic's liens are correctly matched with their releases
based on matching grantor (creditor) and dates.
"""

import sys
import os
import copy

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scrapers.county_liens.orchestrator import pair_liens_with_releases
from tests.fixtures.lien_scenarios import (
    SCENARIO_MATCHED_RELEASE,
    SCENARIO_ACTIVE_LIEN,
    SCENARIO_SLOW_RELEASE,
)


class TestPairLiensWithReleases:
    """Tests for the lien-release pairing logic."""

    def test_matches_lien_with_same_grantor_release(self):
        """Lien should be marked as released when same grantor files release."""
        records = copy.deepcopy(SCENARIO_MATCHED_RELEASE)

        result = pair_liens_with_releases(records)

        # Find the lien record
        lien = next(r for r in result if r['document_type'] == 'MECH_LIEN')

        assert lien.get('has_release') is True
        assert lien.get('release_date') is not None

    def test_calculates_days_to_release(self):
        """Should calculate days between filing and release."""
        records = copy.deepcopy(SCENARIO_MATCHED_RELEASE)

        result = pair_liens_with_releases(records)

        lien = next(r for r in result if r['document_type'] == 'MECH_LIEN')

        # 100 days ago filed, 10 days ago released = 90 days to release
        assert lien.get('days_to_release') == 90

    def test_active_lien_not_marked_as_released(self):
        """Lien without matching release should not have has_release."""
        records = copy.deepcopy(SCENARIO_ACTIVE_LIEN)

        result = pair_liens_with_releases(records)

        lien = result[0]

        assert lien.get('has_release') is not True
        assert lien.get('release_date') is None

    def test_multiple_liens_paired_correctly(self):
        """Each lien should be paired with its own release."""
        records = copy.deepcopy(SCENARIO_SLOW_RELEASE)

        result = pair_liens_with_releases(records)

        # Both liens should have releases
        liens = [r for r in result if r['document_type'] == 'MECH_LIEN']

        assert len(liens) == 2
        for lien in liens:
            assert lien.get('has_release') is True
            assert lien.get('days_to_release') == 190  # Both are 190 days


if __name__ == '__main__':
    import pytest
    pytest.main([__file__, '-v'])
```

### Step 2: Run test to verify it works

Run: `cd /home/reid/testhome/contractor-auditor && python3 -m pytest tests/test_lien_pairing.py -v`

Expected: All 4 tests pass (or failures show which business logic is incorrect)

### Step 3: Commit

```bash
git add tests/test_lien_pairing.py
git commit -m "test: add unit tests for lien-release pairing logic"
```

---

## Task 3: Create Lien Scoring Tests

**Files:**
- Create: `tests/test_lien_scoring.py`

### Step 1: Write the scoring test file

Create `tests/test_lien_scoring.py`:

```python
"""
Unit tests for calculate_lien_score() function.

Tests the scoring algorithm that assigns 0-10 score based on:
- CRITICAL liens (tax, judgment): -5 points
- HIGH severity liens (3+): -5 points
- HIGH severity liens (1-2): -3 points
- Slow releases (2+ over 90 days): -2 points
- High total amount (>$50k): -2 points
"""

import sys
import os
import copy

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scrapers.county_liens.orchestrator import pair_liens_with_releases, calculate_lien_score
from tests.fixtures.lien_scenarios import (
    SCENARIO_CLEAN,
    SCENARIO_ACTIVE_LIEN,
    SCENARIO_TAX_LIEN,
    SCENARIO_JUDGMENT,
    SCENARIO_HIGH_RISK,
    SCENARIO_SLOW_RELEASE,
    SCENARIO_HIGH_AMOUNT,
    SCENARIO_ONLY_RELEASES,
    SCENARIO_MATCHED_RELEASE,
)


class TestCalculateLienScore:
    """Tests for the lien scoring algorithm."""

    def test_clean_contractor_gets_perfect_score(self):
        """No liens = 10/10 score."""
        result = calculate_lien_score(SCENARIO_CLEAN)

        assert result['score'] == 10
        assert result['max_score'] == 10
        assert result['active_liens'] == 0
        assert len(result['notes']) == 0

    def test_single_active_lien_deducts_3_points(self):
        """One active mechanic's lien = 7/10."""
        records = copy.deepcopy(SCENARIO_ACTIVE_LIEN)

        result = calculate_lien_score(records)

        assert result['score'] == 7
        assert result['active_liens'] == 1
        assert "active mechanic's lien" in result['notes'][0].lower()

    def test_critical_tax_lien_deducts_5_points(self):
        """Federal tax lien = 5/10 (CRITICAL severity)."""
        records = copy.deepcopy(SCENARIO_TAX_LIEN)

        result = calculate_lien_score(records)

        assert result['score'] == 5
        assert "CRITICAL" in result['notes'][0]

    def test_judgment_is_critical_severity(self):
        """Abstract of judgment = 5/10 (CRITICAL severity)."""
        records = copy.deepcopy(SCENARIO_JUDGMENT)

        result = calculate_lien_score(records)

        assert result['score'] == 5
        assert "CRITICAL" in result['notes'][0]

    def test_three_plus_liens_is_high_severity_pattern(self):
        """3+ active liens = 5/10 (pattern of non-payment)."""
        records = copy.deepcopy(SCENARIO_HIGH_RISK)

        result = calculate_lien_score(records)

        assert result['score'] == 5
        assert result['active_liens'] == 3
        assert "HIGH severity" in result['notes'][0] or "pattern" in result['notes'][0].lower()

    def test_slow_releases_deduct_2_points(self):
        """2+ liens taking >90 days to resolve = -2 points."""
        records = copy.deepcopy(SCENARIO_SLOW_RELEASE)
        # Must pair first to calculate days_to_release
        records = pair_liens_with_releases(records)

        result = calculate_lien_score(records)

        assert result['score'] == 8  # 10 - 2 for slow releases
        assert ">90 days" in result['notes'][0]

    def test_high_total_amount_deducts_2_points(self):
        """Active liens totaling >$50k = additional -2 points."""
        records = copy.deepcopy(SCENARIO_HIGH_AMOUNT)

        result = calculate_lien_score(records)

        # Should be 7 - 2 = 5 (one lien -3, high amount -2)
        assert result['score'] == 5
        assert result['total_active_amount'] == 60000.00

    def test_only_releases_dont_count_as_active(self):
        """Release documents shouldn't count as active liens."""
        records = copy.deepcopy(SCENARIO_ONLY_RELEASES)

        result = calculate_lien_score(records)

        assert result['score'] == 10
        assert result['active_liens'] == 0

    def test_resolved_liens_dont_count_as_active(self):
        """Liens with has_release=True shouldn't count as active."""
        records = copy.deepcopy(SCENARIO_MATCHED_RELEASE)
        records = pair_liens_with_releases(records)  # Mark as released

        result = calculate_lien_score(records)

        assert result['score'] == 10
        assert result['active_liens'] == 0
        assert result['resolved_liens'] == 1

    def test_score_never_goes_below_zero(self):
        """Score should floor at 0 even with multiple penalties."""
        # Create a nightmare scenario: critical + 3 liens + high amount
        records = [
            {
                'county': 'tarrant',
                'instrument_number': 'T1',
                'document_type': 'FED_TAX_LIEN',  # -5
                'grantor': 'IRS',
                'grantee': 'BAD CO',
                'filing_date': '2024-01-01',
                'amount': 100000.00
            },
            {
                'county': 'tarrant',
                'instrument_number': 'L1',
                'document_type': 'MECH_LIEN',
                'grantor': 'A',
                'grantee': 'BAD CO',
                'filing_date': '2024-01-01',
                'amount': 10000.00
            },
            {
                'county': 'tarrant',
                'instrument_number': 'L2',
                'document_type': 'MECH_LIEN',
                'grantor': 'B',
                'grantee': 'BAD CO',
                'filing_date': '2024-01-01',
                'amount': 10000.00
            },
            {
                'county': 'tarrant',
                'instrument_number': 'L3',
                'document_type': 'MECH_LIEN',  # 3+ = -5
                'grantor': 'C',
                'grantee': 'BAD CO',
                'filing_date': '2024-01-01',
                'amount': 10000.00
            },
        ]
        # Total: -5 (critical) -5 (3+ liens) -2 (>$50k) = -12, floor at 0

        result = calculate_lien_score(records)

        assert result['score'] >= 0


if __name__ == '__main__':
    import pytest
    pytest.main([__file__, '-v'])
```

### Step 2: Run test to verify

Run: `cd /home/reid/testhome/contractor-auditor && python3 -m pytest tests/test_lien_scoring.py -v`

Expected: All 10 tests pass

### Step 3: Commit

```bash
git add tests/test_lien_scoring.py
git commit -m "test: add unit tests for lien scoring algorithm"
```

---

## Task 4: Create Mocked Scraper Parsing Test

**Files:**
- Create: `tests/test_tarrant_parser.py`

### Step 1: Write the mocked parsing test

Create `tests/test_tarrant_parser.py`:

```python
"""
Mocked unit tests for Tarrant County scraper HTML parsing.

Uses unittest.mock to mock Playwright page objects, testing that
_extract_results correctly parses table rows into LienRecord objects.
"""

import sys
import os
from unittest.mock import AsyncMock, MagicMock
from datetime import date
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from scrapers.county_liens.tarrant import TarrantCountyScraper


class TestTarrantScraperParsing:
    """Tests for TarrantCountyScraper._extract_results parsing logic."""

    @pytest.fixture
    def scraper(self):
        """Create a scraper instance for testing."""
        return TarrantCountyScraper()

    @pytest.fixture
    def mock_page(self):
        """Create a mock Playwright page object."""
        return AsyncMock()

    def create_mock_row(self, cell_values: list[str]) -> AsyncMock:
        """
        Create a mock table row with cells containing given text values.

        Args:
            cell_values: List of text values for each cell
        """
        mock_row = AsyncMock()
        mock_cells = []

        for value in cell_values:
            cell = AsyncMock()
            cell.inner_text = AsyncMock(return_value=value)
            mock_cells.append(cell)

        mock_row.query_selector_all = AsyncMock(return_value=mock_cells)
        return mock_row

    @pytest.mark.asyncio
    async def test_extracts_mechanic_lien_record(self, scraper, mock_page):
        """Should parse a mechanic's lien row into LienRecord."""
        # Simulate a table row: [Instrument, Type, Date, Grantor, Grantee, Amount]
        mock_row = self.create_mock_row([
            "D22012345",
            "MECH LIEN",
            "01/15/2025",
            "SUPPLY CO",
            "TEST BUILDER",
            "$10,000.00"
        ])
        mock_page.query_selector_all = AsyncMock(return_value=[mock_row])

        records = await scraper._extract_results(mock_page, "TEST BUILDER")

        assert len(records) == 1
        record = records[0]

        assert record.instrument_number == "D22012345"
        assert record.document_type == "MECH_LIEN"  # Normalized
        assert record.grantor == "SUPPLY CO"
        assert record.grantee == "TEST BUILDER"
        assert record.amount == Decimal("10000.00")
        assert record.filing_date == date(2025, 1, 15)

    @pytest.mark.asyncio
    async def test_extracts_release_record(self, scraper, mock_page):
        """Should parse a release of lien row."""
        mock_row = self.create_mock_row([
            "R22012346",
            "REL LIEN",
            "03/15/2025",
            "SUPPLY CO",
            "TEST BUILDER",
            "$0.00"
        ])
        mock_page.query_selector_all = AsyncMock(return_value=[mock_row])

        records = await scraper._extract_results(mock_page, "TEST BUILDER")

        assert len(records) == 1
        assert records[0].document_type == "REL_LIEN"

    @pytest.mark.asyncio
    async def test_extracts_tax_lien_record(self, scraper, mock_page):
        """Should parse a federal tax lien row."""
        mock_row = self.create_mock_row([
            "T22012347",
            "FED TAX LIEN",
            "02/01/2025",
            "IRS",
            "DELINQUENT CO",
            "$25,000.00"
        ])
        mock_page.query_selector_all = AsyncMock(return_value=[mock_row])

        records = await scraper._extract_results(mock_page, "DELINQUENT CO")

        assert len(records) == 1
        assert records[0].document_type == "FED_TAX_LIEN"
        assert records[0].amount == Decimal("25000.00")

    @pytest.mark.asyncio
    async def test_skips_non_lien_document_types(self, scraper, mock_page):
        """Should skip rows with unrecognized document types."""
        mock_row = self.create_mock_row([
            "D22012348",
            "WARRANTY DEED",  # Not a lien type
            "01/15/2025",
            "SELLER",
            "BUYER",
            "$500,000.00"
        ])
        mock_page.query_selector_all = AsyncMock(return_value=[mock_row])

        records = await scraper._extract_results(mock_page, "BUYER")

        assert len(records) == 0  # Should be filtered out

    @pytest.mark.asyncio
    async def test_handles_empty_results(self, scraper, mock_page):
        """Should return empty list when no rows found."""
        mock_page.query_selector_all = AsyncMock(return_value=[])

        records = await scraper._extract_results(mock_page, "NOBODY")

        assert len(records) == 0

    @pytest.mark.asyncio
    async def test_handles_row_with_missing_cells(self, scraper, mock_page):
        """Should skip rows that don't have enough cells."""
        # Only 3 cells instead of expected 6
        mock_row = self.create_mock_row([
            "D22012349",
            "MECH LIEN",
            "01/15/2025"
        ])
        mock_page.query_selector_all = AsyncMock(return_value=[mock_row])

        records = await scraper._extract_results(mock_page, "TEST")

        assert len(records) == 0  # Should be skipped

    @pytest.mark.asyncio
    async def test_handles_invalid_date(self, scraper, mock_page):
        """Should skip rows with unparseable dates."""
        mock_row = self.create_mock_row([
            "D22012350",
            "MECH LIEN",
            "INVALID DATE",
            "SUPPLY CO",
            "TEST BUILDER",
            "$10,000.00"
        ])
        mock_page.query_selector_all = AsyncMock(return_value=[mock_row])

        records = await scraper._extract_results(mock_page, "TEST BUILDER")

        assert len(records) == 0  # Should be skipped

    @pytest.mark.asyncio
    async def test_extracts_multiple_records(self, scraper, mock_page):
        """Should extract all valid rows from results."""
        rows = [
            self.create_mock_row([
                "L1", "MECH LIEN", "01/01/2025", "A", "BUILDER", "$1,000.00"
            ]),
            self.create_mock_row([
                "L2", "MECH LIEN", "01/02/2025", "B", "BUILDER", "$2,000.00"
            ]),
            self.create_mock_row([
                "R1", "REL LIEN", "01/15/2025", "A", "BUILDER", "$0.00"
            ]),
        ]
        mock_page.query_selector_all = AsyncMock(return_value=rows)

        records = await scraper._extract_results(mock_page, "BUILDER")

        assert len(records) == 3


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
```

### Step 2: Run the tests

Run: `cd /home/reid/testhome/contractor-auditor && python3 -m pytest tests/test_tarrant_parser.py -v`

Expected: All 9 tests pass

### Step 3: Commit

```bash
git add tests/test_tarrant_parser.py
git commit -m "test: add mocked unit tests for Tarrant scraper parsing"
```

---

## Task 5: Run Full Test Suite and Verify

### Step 1: Run all new tests together

Run: `cd /home/reid/testhome/contractor-auditor && python3 -m pytest tests/test_lien_*.py tests/test_tarrant_parser.py -v`

Expected: All tests pass

### Step 2: Run with coverage (optional)

Run: `cd /home/reid/testhome/contractor-auditor && python3 -m pytest tests/test_lien_*.py tests/test_tarrant_parser.py --cov=scrapers.county_liens --cov-report=term-missing`

Expected: Coverage report shows `pair_liens_with_releases` and `calculate_lien_score` are well-covered

### Step 3: Final commit with all tests

```bash
git add -A
git commit -m "test: complete lien scraper test suite

- Add fixtures for all scoring scenarios
- Add unit tests for lien-release pairing
- Add unit tests for scoring algorithm
- Add mocked tests for Tarrant scraper parsing

Tests run without hitting live portals."
```

---

## Summary

| Task | Files | Tests |
|------|-------|-------|
| 1 | `tests/fixtures/__init__.py`, `tests/fixtures/lien_scenarios.py` | Fixtures only |
| 2 | `tests/test_lien_pairing.py` | 4 tests |
| 3 | `tests/test_lien_scoring.py` | 10 tests |
| 4 | `tests/test_tarrant_parser.py` | 9 tests |
| 5 | Run all | 23 tests total |

**Run command:** `python3 -m pytest tests/test_lien_*.py tests/test_tarrant_parser.py -v`
