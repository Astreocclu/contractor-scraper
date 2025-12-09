# Fake Review Detection Plan

**Date:** 2025-12-07
**Status:** Review needed

---

## Current State

Review analysis ALREADY runs automatically during collection (not audit):
- Location: `collection_service.js` lines 938-1002
- Uses: `analyzeReviews()` from `review_analyzer.js`
- Calls: DeepSeek API with review data
- Stores: Results as `review_analysis` source

---

## What Works

- Google Maps reviews scraped and passed to DeepSeek
- BBB data included in analysis
- Fake review score returned (0-100)
- Results logged and stored

---

## What May Need Attention

1. **Yelp blocking** - Are Yelp reviews being scraped successfully?
2. **Review extraction depth** - Currently getting 5-7 reviews max from Google Maps
3. **DeepSeek prompt** - Is it catching all fake signals reliably?

---

## Decision

AI-only approach. No code-based detection layer. Keep it simple.
