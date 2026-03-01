# Source Ranking and Launch Readiness (DFW pool-100)
Updated: 2026-02-03

Scope: DFW pool-100 contractor audits and trust scoring.

Scoring:
- Importance (0-100): signal strength for trust risk, coverage for DFW pool contractors, and resistance to gaming.
- Launch readiness (0-100): access friction, scraper stability, cost/rate limits, and current pipeline reliability.

Buckets:
- Must: importance >= 85 and readiness >= 70
- Should: importance >= 70 and readiness >= 55
- Nice: everything else

| Rank | Source | Importance | Launch readiness | Bucket | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | County liens - Tarrant County | 95 | 80 | Must | OPR liens |
| 2 | County liens - Dallas County | 95 | 70 | Must | OPR liens |
| 3 | TX Franchise Tax account status | 40 | 90 | Nice | Right to transact (deprioritized 02/05) |
| 4 | County liens - Collin County | 92 | 75 | Must | OPR liens |
| 5 | County liens - Denton County | 92 | 70 | Must | OPR liens |
| 6 | TX SOSDirect entity search | 90 | 70 | Must | Official filings |
| 7 | Court records - Dallas County | 88 | 65 | Should | Civil records |
| 8 | Court records - Tarrant County | 88 | 65 | Should | Civil records |
| 9 | Court records - generic (Playwright) | 88 | 60 | Should | Civil records |
| 10 | BBB (primary) | 86 | 85 | Must | Complaints + rating |
| 11 | Google Maps reviews (tiered) | 85 | 80 | Must | Reviews |
| 12 | Yelp (primary) | 82 | 75 | Should | Reviews |
| 13 | BBB (detail fallback) | 82 | 70 | Should | Detail scrape |
| 14 | Google Maps business listing - HQ | 78 | 85 | Should | Presence + contact |
| 15 | Google Maps business listing - local | 78 | 85 | Should | Presence + contact |
| 16 | Google Maps business listing - listed address | 78 | 80 | Should | Presence + contact |
| 17 | Angi | 78 | 70 | Should | Reviews |
| 18 | Court records - Collin County | 78 | 60 | Should | Civil records |
| 19 | Court records - Denton County | 78 | 60 | Should | Civil records |
| 20 | CourtListener (federal) | 78 | 60 | Should | Federal cases |
| 21 | Houzz | 75 | 70 | Should | Reviews |
| 22 | TDLR license search (currently removed) | 75 | 30 | Nice | Trade licensing |
| 23 | TX AG complaints | 72 | 40 | Nice | Consumer protection |
| 24 | OSHA | 70 | 70 | Should | Safety enforcement |
| 25 | Yelp (Yahoo fallback) | 70 | 60 | Should | Reviews |
| 26 | EPA ECHO | 68 | 70 | Nice | Environmental compliance |
| 27 | Google News | 65 | 85 | Nice | Press |
| 28 | Local News | 65 | 85 | Nice | Press |
| 29 | OpenCorporates | 62 | 85 | Nice | Alt entity data |
| 30 | Trustpilot | 60 | 70 | Nice | Reviews |
| 31 | BuildZoom | 60 | 45 | Nice | Aggregator |
| 32 | Porch | 55 | 60 | Nice | Aggregator |
| 33 | Reddit | 55 | 55 | Nice | Social |
| 34 | Nextdoor | 52 | 40 | Nice | Social |
| 35 | YouTube | 50 | 55 | Nice | Social |
| 36 | Glassdoor | 45 | 70 | Nice | Employee reviews |
| 37 | Indeed | 45 | 70 | Nice | Employee reviews |
| 38 | HomeAdvisor | 40 | 55 | Nice | Aggregator |
