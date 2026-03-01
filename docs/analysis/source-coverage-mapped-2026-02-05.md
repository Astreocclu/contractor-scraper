# Source Coverage Mapped to Ranking List (Pool-100)
Updated: 2026-02-05

Coverage JSON: `logs/pool_100_source_coverage_2026-02-05.json`
Contractor IDs: `logs/pool_100_ids_2026-02-05.txt`

## Status Update (2026-02-05 evening)
**County liens: VALIDATED.** Overnight refresh completed 48/48 remaining error IDs with 0 errors. Scraper works reliably for DFW counties (Tarrant, Dallas, Collin, Denton) with 600s timeout. Most contractors have no liens on file (expected). Log: `logs/pool_100_liens_refresh_overnight_2026-02-05.log`.

## Mapping
| Ranking Source | Mapped Source | Notes |
| --- | --- | --- |
| County liens - Tarrant County | county_liens | Aggregated to county_liens |
| County liens - Dallas County | county_liens | Aggregated to county_liens |
| TX Franchise Tax account status | tx_franchise |  |
| County liens - Collin County | county_liens | Aggregated to county_liens |
| County liens - Denton County | county_liens | Aggregated to county_liens |
| TX SOSDirect entity search | tx_sos_search |  |
| Court records - Dallas County | dallas_court |  |
| Court records - Tarrant County | tarrant_court |  |
| Court records - generic (Playwright) | court_records |  |
| BBB (primary) | bbb |  |
| Google Maps reviews (tiered) | google_maps_local |  |
| Yelp (primary) | yelp |  |
| BBB (detail fallback) | bbb | No distinct source; mapped to bbb |
| Google Maps business listing - HQ | google_maps_hq |  |
| Google Maps business listing - local | google_maps_local |  |
| Google Maps business listing - listed address | google_maps_listed |  |
| Angi | angi |  |
| Court records - Collin County | collin_court |  |
| Court records - Denton County | denton_court |  |
| CourtListener (federal) | court_listener | Requires `COURTLISTENER_API_KEY`; no pool-100 rows without key |
| Houzz | houzz |  |
| TDLR license search (currently removed) | tdlr | Mapped to tdlr source |
| TX AG complaints | tx_ag_complaints |  |
| OSHA | osha |  |
| Yelp (Yahoo fallback) | yelp_yahoo |  |
| EPA ECHO | epa_echo |  |
| Google News | google_news |  |
| Local News | local_news |  |
| OpenCorporates | open_corporates |  |
| Trustpilot | trustpilot |  |
| BuildZoom | buildzoom |  |
| Porch | porch |  |
| Reddit | reddit |  |
| Nextdoor | nextdoor_search |  |
| YouTube | youtube |  |
| Glassdoor | glassdoor |  |
| Indeed | indeed |  |
| HomeAdvisor | homeadvisor |  |

## Coverage
| Rank | Source | Importance | Launch readiness | Bucket | Success % | Success/Total | Not Found | Error | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | County liens - Tarrant County | 95 | 80 | Must | 9.1% | 8/88 | 27 | 53 | Aggregated county_liens; 20s timeout in run; Total 88 (<100) |
| 2 | County liens - Dallas County | 95 | 70 | Must | 9.1% | 8/88 | 27 | 53 | Aggregated county_liens; 20s timeout in run; Total 88 (<100) |
| 3 | TX Franchise Tax account status | 92 | 90 | Must | 38.8% | 38/98 | 60 | 0 | Total 98 (<100) |
| 4 | County liens - Collin County | 92 | 75 | Must | 9.1% | 8/88 | 27 | 53 | Aggregated county_liens; 20s timeout in run; Total 88 (<100) |
| 5 | County liens - Denton County | 92 | 70 | Must | 9.1% | 8/88 | 27 | 53 | Aggregated county_liens; 20s timeout in run; Total 88 (<100) |
| 6 | TX SOSDirect entity search | 90 | 70 | Must | 100.0% | 99/99 | 0 | 0 | Total 99 (<100) |
| 7 | Court records - Dallas County | 88 | 65 | Should | 65.7% | 65/99 | 34 | 0 | Total 99 (<100) |
| 8 | Court records - Tarrant County | 88 | 65 | Should | 9.1% | 9/99 | 90 | 0 | Total 99 (<100) |
| 9 | Court records - generic (Playwright) | 88 | 60 | Should | 0.0% | 0/99 | 99 | 0 | Total 99 (<100) |
| 10 | BBB (primary) | 86 | 85 | Must | 58.0% | 58/100 | 42 | 0 |  |
| 11 | Google Maps reviews (tiered) | 85 | 80 | Must | 100.0% | 100/100 | 0 | 0 | Mapped to google_maps_local |
| 12 | Yelp (primary) | 82 | 75 | Should | 57.0% | 57/100 | 43 | 0 |  |
| 13 | BBB (detail fallback) | 82 | 70 | Should | 58.0% | 58/100 | 42 | 0 | No distinct source; mapped to bbb |
| 14 | Google Maps business listing - HQ | 78 | 85 | Should | 99.0% | 98/99 | 1 | 0 | Total 99 (<100) |
| 15 | Google Maps business listing - local | 78 | 85 | Should | 100.0% | 100/100 | 0 | 0 |  |
| 16 | Google Maps business listing - listed address | 78 | 80 | Should | 98.7% | 77/78 | 1 | 0 | Total 78 (<100) |
| 17 | Angi | 78 | 70 | Should | 30.3% | 30/99 | 69 | 0 | Total 99 (<100) |
| 18 | Court records - Collin County | 78 | 60 | Should | 61.6% | 61/99 | 38 | 0 | Total 99 (<100) |
| 19 | Court records - Denton County | 78 | 60 | Should | 53.5% | 53/99 | 46 | 0 | Total 99 (<100) |
| 20 | CourtListener (federal) | 78 | 60 | Should | 0.0% | 0/0 | 0 | 0 | No coverage rows (API key missing) |
| 21 | Houzz | 75 | 70 | Should | 25.2% | 25/99 | 74 | 0 | Total 99 (<100) |
| 22 | TDLR license search (currently removed) | 75 | 30 | Nice | 0.0% | 0/1 | 1 | 0 | Mapped to tdlr (removed); Total 1 (<100) |
| 23 | TX AG complaints | 72 | 40 | Nice | 58.6% | 58/99 | 41 | 0 | Total 99 (<100) |
| 24 | OSHA | 70 | 70 | Should | 13.1% | 13/99 | 86 | 0 | Total 99 (<100) |
| 25 | Yelp (Yahoo fallback) | 70 | 60 | Should | 78.5% | 73/93 | 20 | 0 | Total 93 (<100) |
| 26 | EPA ECHO | 68 | 70 | Nice | 82.8% | 82/99 | 16 | 1 | Total 99 (<100) |
| 27 | Google News | 65 | 85 | Nice | 73.7% | 73/99 | 26 | 0 | Total 99 (<100) |
| 28 | Local News | 65 | 85 | Nice | 69.7% | 69/99 | 30 | 0 | Total 99 (<100) |
| 29 | OpenCorporates | 62 | 85 | Nice | 0.0% | 0/98 | 98 | 0 | Total 98 (<100) |
| 30 | Trustpilot | 60 | 70 | Nice | 46.5% | 46/99 | 53 | 0 | Total 99 (<100) |
| 31 | BuildZoom | 60 | 45 | Nice | 100.0% | 99/99 | 0 | 0 | Total 99 (<100) |
| 32 | Porch | 55 | 60 | Nice | 100.0% | 99/99 | 0 | 0 | Total 99 (<100) |
| 33 | Reddit | 55 | 55 | Nice | 14.1% | 14/99 | 85 | 0 | Total 99 (<100) |
| 34 | Nextdoor | 52 | 40 | Nice | 64.7% | 64/99 | 35 | 0 | Total 99 (<100) |
| 35 | YouTube | 50 | 55 | Nice | 100.0% | 99/99 | 0 | 0 | Total 99 (<100) |
| 36 | Glassdoor | 45 | 70 | Nice | 38.4% | 38/99 | 61 | 0 | Total 99 (<100) |
| 37 | Indeed | 45 | 70 | Nice | 36.4% | 36/99 | 63 | 0 | Total 99 (<100) |
| 38 | HomeAdvisor | 40 | 55 | Nice | 39.4% | 39/99 | 60 | 0 | Total 99 (<100) |

## Hygiene Notes
- `court_listener` requires `COURTLISTENER_API_KEY`; pool-100 has no rows until key is set.
- `tdlr` is removed from collection; expect legacy rows only.
- Raw-data sources not in ranking list: `facebook`, `google_maps` (legacy), `review_analysis`, `thumbtack`, `website`, `website_warranty`.

## Related Docs
- **Failure modes & remediation:** `docs/analysis/source-failure-modes-2026-02-05.md`
- **Source ranking:** `docs/analysis/source-ranking-2026-02-03.md`
