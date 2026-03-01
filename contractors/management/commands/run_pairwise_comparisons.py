import json
import os
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from contractors.models import Contractor, ContractorRawData, PairwiseComparison, Vertical
from contractors.services.leaderboard import apply_pairwise_result
from shared.deepseek import DeepSeekClient


PAIRWISE_SYSTEM_PROMPT = (
    "You are comparing two contractors. Your job is to determine which one is MORE trustworthy.\n\n"
    "Do not assign absolute scores. Simply compare the two and decide:\n"
    "- Which contractor has better credentials?\n"
    "- Which has fewer red flags?\n"
    "- Which would you trust more with a major project?\n\n"
    "You MUST choose a winner (A or B). No ties.\n\n"
    "Output JSON only."
)

PAIRWISE_OUTPUT_FORMAT = {
    "winner": "<A|B>",
    "confidence": "<0-100>",
    "reasoning": "<2-3 sentences explaining why one is better>",
    "contractor_a_strengths": ["<strength1>"],
    "contractor_b_strengths": ["<strength1>"],
}


def build_snapshot(contractor: Contractor) -> dict:
    sources = {}
    raw_rows = ContractorRawData.objects.filter(contractor=contractor).order_by("source_name")
    for row in raw_rows:
        data = row.structured_data
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                pass
        sources[row.source_name] = {
            "status": row.fetch_status,
            "fetched_at": row.fetched_at.isoformat() if row.fetched_at else None,
            "data": data if data is not None else row.raw_text,
        }

    return {
        "contractor_id": contractor.id,
        "business_name": contractor.business_name,
        "city": contractor.city,
        "state": contractor.state,
        "verticals": list(contractor.verticals.values_list("slug", flat=True)),
        "snapshot_at": timezone.now().isoformat(),
        "sources": sources,
    }


def build_pairwise_prompt(snapshot_a: dict, snapshot_b: dict) -> str:
    return (
        "CONTRACTOR A:\n"
        f"{json.dumps(snapshot_a, indent=2)}\n\n"
        "CONTRACTOR B:\n"
        f"{json.dumps(snapshot_b, indent=2)}\n\n"
        "Which contractor is more trustworthy? Respond with JSON:\n"
        f"{json.dumps(PAIRWISE_OUTPUT_FORMAT, indent=2)}"
    )


class Command(BaseCommand):
    help = "Resolve pending pairwise comparisons with LLM + apply Elo."

    def add_arguments(self, parser):
        parser.add_argument("--vertical", required=True, help="Vertical slug to process.")
        parser.add_argument("--limit", type=int, default=0, help="Max comparisons to process.")
        parser.add_argument("--ids", help="Comma-separated contractor IDs to limit.")
        parser.add_argument("--dry-run", action="store_true", help="Do not persist results.")
        parser.add_argument("--model-version", default="deepseek-chat/pairwise_v1", help="Model version tag.")

    def handle(self, *args, **options):
        slug = options["vertical"]
        limit = options["limit"] or 0
        ids_arg = options.get("ids")
        dry_run = options.get("dry_run", False)
        model_version = options.get("model_version")

        log_dir = Path(__file__).resolve().parents[3] / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / f"pairwise_{timezone.now().strftime('%Y%m%d_%H%M%S')}.jsonl"

        def log_event(event: dict) -> None:
            event["ts"] = timezone.now().isoformat()
            with log_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(event) + "\n")

        try:
            vertical = Vertical.objects.get(slug=slug)
        except Vertical.DoesNotExist as exc:
            raise CommandError(f"Unknown vertical: {slug}") from exc

        comparisons = PairwiseComparison.objects.filter(vertical=vertical, status="PENDING")
        if ids_arg:
            ids = [int(x.strip()) for x in ids_arg.split(",") if x.strip()]
            comparisons = comparisons.filter(contractor_a_id__in=ids, contractor_b_id__in=ids)

        comparisons = comparisons.order_by("created_at")
        if limit > 0:
            comparisons = comparisons[:limit]

        total = comparisons.count()
        if total == 0:
            self.stdout.write("No pending comparisons to process.")
            return

        client = DeepSeekClient()

        self.stdout.write(f"Processing {total} comparisons for vertical={slug}...")
        log_event({"event": "start", "vertical": slug, "total": total, "dry_run": dry_run})

        processed = 0
        for comparison in comparisons:
            contractor_a = comparison.contractor_a
            contractor_b = comparison.contractor_b

            snapshot_a = build_snapshot(contractor_a)
            snapshot_b = build_snapshot(contractor_b)

            user_prompt = build_pairwise_prompt(snapshot_a, snapshot_b)

            try:
                result = client.analyze_json(user_prompt, system_prompt=PAIRWISE_SYSTEM_PROMPT)
            except Exception as exc:
                self.stdout.write(self.style.ERROR(f"[{comparison.id}] LLM error: {exc}"))
                log_event({
                    "event": "llm_error",
                    "comparison_id": comparison.id,
                    "contractor_a": contractor_a.id,
                    "contractor_b": contractor_b.id,
                    "error": str(exc),
                })
                continue

            winner_token = str(result.get("winner", "")).strip().upper()
            confidence = result.get("confidence", 50)

            if winner_token not in ("A", "B"):
                self.stdout.write(self.style.ERROR(f"[{comparison.id}] Invalid winner: {winner_token}"))
                log_event({
                    "event": "invalid_winner",
                    "comparison_id": comparison.id,
                    "contractor_a": contractor_a.id,
                    "contractor_b": contractor_b.id,
                    "winner": winner_token,
                })
                continue

            winner = contractor_a if winner_token == "A" else contractor_b

            if dry_run:
                self.stdout.write(
                    f"[{comparison.id}] {contractor_a.id} vs {contractor_b.id} -> {winner.id} (conf={confidence})"
                )
            else:
                apply_pairwise_result(comparison, winner, confidence, model_version=model_version)
                self.stdout.write(
                    f"[{comparison.id}] {contractor_a.id} vs {contractor_b.id} -> {winner.id} (conf={confidence})"
                )

            log_event({
                "event": "resolved",
                "comparison_id": comparison.id,
                "contractor_a": contractor_a.id,
                "contractor_b": contractor_b.id,
                "winner": winner.id,
                "confidence": confidence,
                "dry_run": dry_run,
                "model_version": model_version,
            })
            processed += 1

        self.stdout.write(f"Done. Processed {processed}/{total} comparisons.")
        log_event({"event": "done", "processed": processed, "total": total})
