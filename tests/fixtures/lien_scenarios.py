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
        'grantor': 'ABC SUPPLIES',
        'grantee': 'XYZ CONTRACTORS',
        'filing_date': days_ago(10),
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
        'filing_date': days_ago(10),
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
        'filing_date': days_ago(10),
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
        'amount': 60000.00
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
