#!/usr/bin/env python3
"""
CONTRACTOR SCRAPER ORCHESTRATOR

Runs all scrapers for a contractor and returns unified results.
Replaces collection_service.js for Python-based audits.

Usage:
  python scrapers/contractor_scraper.py "Orange Elephant Roofing" "Fort Worth, TX"
  python scrapers/contractor_scraper.py "Smith Electric" --sources tdlr,bbb
"""

import asyncio
import json
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    from scrapers.tdlr import search_tdlr, TDLRResult
    from scrapers.yelp import scrape_yelp, YelpResult
    from scrapers.bbb import scrape_bbb, BBBResult, is_critical_rating
except ImportError:
    from tdlr import search_tdlr, TDLRResult
    from yelp import scrape_yelp, YelpResult
    from bbb import scrape_bbb, BBBResult, is_critical_rating


@dataclass
class ContractorData:
    """Unified contractor data from all sources."""
    business_name: str
    location: str
    scraped_at: str = ""
    tdlr: Optional[TDLRResult] = None
    yelp: Optional[YelpResult] = None
    bbb: Optional[BBBResult] = None
    errors: list[str] = field(default_factory=list)

    def __post_init__(self):
        if not self.scraped_at:
            self.scraped_at = datetime.now().isoformat()

    def to_dict(self) -> dict:
        """Convert to JSON-serializable dict."""
        return {
            "business_name": self.business_name,
            "location": self.location,
            "scraped_at": self.scraped_at,
            "tdlr": _result_to_dict(self.tdlr) if self.tdlr else None,
            "yelp": _result_to_dict(self.yelp) if self.yelp else None,
            "bbb": _result_to_dict(self.bbb) if self.bbb else None,
            "errors": self.errors
        }

    def has_critical_flags(self) -> list[str]:
        """Check for critical red flags across all sources."""
        flags = []

        # BBB F rating
        if self.bbb and self.bbb.found and is_critical_rating(self.bbb.rating):
            flags.append(f"BBB rating: {self.bbb.rating}")

        # TDLR: Licensed trade without license
        if self.tdlr and self.tdlr.requires_license and not self.tdlr.found:
            flags.append("Licensed trade but no TDLR license found")

        # TDLR: Revoked/Expired license
        if self.tdlr and self.tdlr.licenses:
            for lic in self.tdlr.licenses:
                if lic.status.lower() in ("revoked", "suspended"):
                    flags.append(f"TDLR license {lic.license_number}: {lic.status}")
                elif lic.status.lower() == "expired":
                    flags.append(f"TDLR license {lic.license_number}: Expired")

        # Yelp very low rating with many reviews
        if self.yelp and self.yelp.found:
            if self.yelp.rating and self.yelp.review_count:
                if self.yelp.rating < 2.0 and self.yelp.review_count > 10:
                    flags.append(f"Yelp: {self.yelp.rating}/5 with {self.yelp.review_count} reviews")

        return flags

    def summary(self) -> str:
        """Generate a human-readable summary."""
        lines = [
            f"Contractor: {self.business_name}",
            f"Location: {self.location}",
            f"Scraped: {self.scraped_at}",
            "",
        ]

        # TDLR
        if self.tdlr:
            if self.tdlr.found:
                lines.append(f"TDLR: {len(self.tdlr.licenses)} license(s) found")
                for lic in self.tdlr.licenses:
                    lines.append(f"  - {lic.license_number}: {lic.status}")
            else:
                if self.tdlr.requires_license:
                    lines.append("TDLR: NO LICENSE FOUND (trade typically requires license)")
                else:
                    lines.append("TDLR: No license (not required for this trade)")
        else:
            lines.append("TDLR: Not checked")

        # BBB
        if self.bbb:
            if self.bbb.found:
                acc = " (Accredited)" if self.bbb.accredited else ""
                lines.append(f"BBB: {self.bbb.rating or 'N/R'}{acc}")
                if self.bbb.complaint_count:
                    lines.append(f"  Complaints: {self.bbb.complaint_count}")
            else:
                lines.append("BBB: Not found")
        else:
            lines.append("BBB: Not checked")

        # Yelp
        if self.yelp:
            if self.yelp.found:
                lines.append(f"Yelp: {self.yelp.rating}/5 ({self.yelp.review_count} reviews)")
            else:
                lines.append("Yelp: Not found")
        else:
            lines.append("Yelp: Not checked")

        # Critical flags
        flags = self.has_critical_flags()
        if flags:
            lines.append("")
            lines.append("*** CRITICAL FLAGS ***")
            for flag in flags:
                lines.append(f"  - {flag}")

        # Errors
        if self.errors:
            lines.append("")
            lines.append("Errors:")
            for err in self.errors:
                lines.append(f"  - {err}")

        return "\n".join(lines)


def _result_to_dict(result) -> dict:
    """Convert a result dataclass to dict, handling nested dataclasses."""
    if hasattr(result, "__dataclass_fields__"):
        d = {}
        for field_name in result.__dataclass_fields__:
            value = getattr(result, field_name)
            if isinstance(value, list):
                d[field_name] = [_result_to_dict(item) if hasattr(item, "__dataclass_fields__") else item for item in value]
            elif hasattr(value, "__dataclass_fields__"):
                d[field_name] = _result_to_dict(value)
            else:
                d[field_name] = value
        return d
    return result


async def scrape_contractor(
    business_name: str,
    location: str = "Fort Worth, TX",
    sources: Optional[list[str]] = None,
    use_cache: bool = True,
    max_concurrent: int = 3
) -> ContractorData:
    """
    Scrape all sources for a contractor.

    Args:
        business_name: Company name
        location: City, State
        sources: List of sources to scrape. Default: tdlr, bbb.
                 Options: tdlr, yelp, bbb
                 Note: Yelp often blocked by CAPTCHA, not included by default
        use_cache: Whether to use cached results
        max_concurrent: Maximum concurrent scrapers

    Returns:
        ContractorData with results from all sources
    """
    if sources is None:
        # Note: Yelp excluded by default due to DataDome blocking
        sources = ["tdlr", "bbb"]

    # Parse location
    parts = location.split(",")
    city = parts[0].strip()
    state = parts[1].strip() if len(parts) > 1 else "TX"

    result = ContractorData(business_name=business_name, location=location)

    # Build scraping tasks
    tasks = []

    if "tdlr" in sources:
        tasks.append(("tdlr", search_tdlr(business_name, use_cache=use_cache)))
    if "yelp" in sources:
        tasks.append(("yelp", scrape_yelp(business_name, location, use_cache=use_cache)))
    if "bbb" in sources:
        tasks.append(("bbb", scrape_bbb(business_name, city, state, with_details=True, use_cache=use_cache)))

    # Execute with semaphore for rate limiting
    semaphore = asyncio.Semaphore(max_concurrent)

    async def run_with_semaphore(name: str, coro):
        async with semaphore:
            try:
                return name, await coro, None
            except Exception as e:
                return name, None, str(e)

    # Run all scrapers concurrently
    print(f"\n[Scraper] Running {len(tasks)} scrapers for: {business_name}")
    completed = await asyncio.gather(*[run_with_semaphore(n, c) for n, c in tasks])

    # Collect results
    for name, data, error in completed:
        if error:
            result.errors.append(f"{name}: {error}")
        else:
            setattr(result, name, data)

    return result


async def scrape_multiple(
    contractors: list[dict],
    sources: Optional[list[str]] = None,
    use_cache: bool = True,
    max_concurrent: int = 2
) -> list[ContractorData]:
    """
    Scrape multiple contractors.

    Args:
        contractors: List of {"name": str, "location": str}
        sources: Sources to scrape
        use_cache: Whether to use cache
        max_concurrent: Max concurrent contractor scrapes

    Returns:
        List of ContractorData results
    """
    semaphore = asyncio.Semaphore(max_concurrent)

    async def scrape_one(contractor: dict) -> ContractorData:
        async with semaphore:
            return await scrape_contractor(
                contractor["name"],
                contractor.get("location", "Fort Worth, TX"),
                sources=sources,
                use_cache=use_cache
            )

    return await asyncio.gather(*[scrape_one(c) for c in contractors])


# ============================================================
# CLI
# ============================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Scrape contractor data from multiple sources")
    parser.add_argument("business_name", help="Business name to search for")
    parser.add_argument("location", nargs="?", default="Fort Worth, TX", help="City, State")
    parser.add_argument("--sources", help="Comma-separated sources: tdlr,yelp,bbb")
    parser.add_argument("--no-cache", action="store_true", help="Skip cache")
    parser.add_argument("--output", "-o", help="Output JSON file")

    args = parser.parse_args()

    sources = args.sources.split(",") if args.sources else None

    data = asyncio.run(scrape_contractor(
        args.business_name,
        args.location,
        sources=sources,
        use_cache=not args.no_cache
    ))

    print(f"\n{'='*60}")
    print(data.summary())
    print(f"{'='*60}")

    if args.output:
        output_path = Path(args.output)
        output_path.write_text(json.dumps(data.to_dict(), indent=2))
        print(f"\nSaved to: {output_path}")
