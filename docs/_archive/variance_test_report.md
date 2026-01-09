# Variance Test Report

Generated: 2025-12-24T19:24:22.547Z

## Test Configuration

- **Contractors tested:** 10
- **Configurations:** 6
- **Total runs:** 60
- **Successful runs:** 60

### Configurations Tested

| Config | Seed | Temperature |
|--------|------|-------------|
| seed42_temp0 | 42 | 0 |
| seed123_temp0 | 123 | 0 |
| noseed_temp0 | none | 0 |
| seed42_temp01 | 42 | 0.1 |
| seed123_temp01 | 123 | 0.1 |
| noseed_temp01 | none | 0.1 |

## Overall Results

| Metric | Value |
|--------|-------|
| Mean Score | 75.9 |
| Std Dev | 7.84 |
| Min | 65 |
| Max | 85 |

## Temperature Impact

| Temperature | Mean | Std Dev |
|-------------|------|---------|
| 0 | 75.7 | 7.64 |
| 0.1 | 76.0 | 8.04 |

## Seed Impact (at temp=0)

| Seed | Mean | Std Dev |
|------|------|---------|
| 42 | 75.6 | 7.57 |
| 123 | 75.6 | 7.57 |
| none | 76.0 | 7.78 |

## Per-Contractor Variance

| Contractor | Min | Max | Range | Mean | StdDev |
|------------|-----|-----|-------|------|--------|
| The Complete Backyard, Inc. | 65 | 65 | 0 | 65.0 | 0.00 |
| Claffey Pools Retail | 78 | 78 | 0 | 78.0 | 0.00 |
| The Roofing Pro | 78 | 82 | 4 | 80.7 | 1.89 |
| PROCO Roofing | 85 | 85 | 0 | 85.0 | 0.00 |
| Texas Roof Masters & Construction C | 65 | 65 | 0 | 65.0 | 0.00 |
| John Wade Roofing | 85 | 85 | 0 | 85.0 | 0.00 |
| H&A Luna's Fencing | 72 | 75 | 3 | 74.0 | 1.41 |
| Advocate Construction | 82 | 85 | 3 | 83.0 | 1.41 |
| Texas Slab Leaks | 78 | 78 | 0 | 78.0 | 0.00 |
| Clearview Window Cleaning - Keller | 65 | 65 | 0 | 65.0 | 0.00 |

## Detailed Results Matrix

| Contractor | seed42_t0 | seed123_t0 | noseed_t0 | seed42_t01 | seed123_t01 | noseed_t01 |
|------------|-----------|------------|-----------|------------|-------------|------------|
| The Complete Backyard, Inc. | 65 | 65 | 65 | 65 | 65 | 65 |
| John Wade Roofing | 85 | 85 | 85 | 85 | 85 | 85 |
| Claffey Pools Retail | 78 | 78 | 78 | 78 | 78 | 78 |
| Texas Slab Leaks | 78 | 78 | 78 | 78 | 78 | 78 |
| The Roofing Pro | 78 | 78 | 82 | 82 | 82 | 82 |
| Advocate Construction | 82 | 82 | 82 | 85 | 82 | 85 |
| Texas Roof Masters & Construct | 65 | 65 | 65 | 65 | 65 | 65 |
| H&A Luna's Fencing | 75 | 75 | 75 | 75 | 72 | 72 |
| PROCO Roofing | 85 | 85 | 85 | 85 | 85 | 85 |
| Clearview Window Cleaning - Ke | 65 | 65 | 65 | 65 | 65 | 65 |
