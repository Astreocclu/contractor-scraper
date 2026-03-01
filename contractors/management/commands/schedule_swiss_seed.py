import csv
import json
import sys

from django.core.management.base import BaseCommand, CommandError

from contractors.models import (
    Contractor,
    ContractorVerticalRating,
    PairwiseComparison,
    Vertical,
)


class Command(BaseCommand):
    help = 'Generate Swiss-style seed pairings for a vertical leaderboard.'

    def add_arguments(self, parser):
        parser.add_argument('--vertical', required=True, help='Vertical slug to seed.')
        parser.add_argument('--target', type=int, default=10, help='Target comparisons per contractor.')
        parser.add_argument('--ids', help='Comma-separated contractor IDs to seed (subset).')
        parser.add_argument('--seed-from-score', action='store_true', help='Seed ratings from trust_score.')
        parser.add_argument('--seed-scale', type=float, default=20.0, help='Scale for trust_score → rating.')
        parser.add_argument('--seed-offset', type=float, default=500.0, help='Offset for trust_score → rating.')
        parser.add_argument('--max-gap', type=float, default=300.0, help='Max rating gap allowed for pairings.')
        parser.add_argument('--dry-run', action='store_true', help='Output pairings without inserting rows.')
        parser.add_argument('--format', choices=['json', 'csv'], default='json', help='Output format for dry-run.')

    def handle(self, *args, **options):
        slug = options['vertical']
        target = options['target']

        try:
            vertical = Vertical.objects.get(slug=slug)
        except Vertical.DoesNotExist as exc:
            raise CommandError(f'Unknown vertical: {slug}') from exc

        contractors = Contractor.objects.filter(is_active=True, verticals=vertical).distinct()
        ids_arg = options.get('ids')
        if ids_arg:
            ids = [int(x.strip()) for x in ids_arg.split(',') if x.strip()]
            contractors = contractors.filter(id__in=ids)
        if contractors.count() < 2:
            self.stdout.write('Not enough contractors to seed.')
            return

        seed_from_score = options.get('seed_from_score', False)
        seed_scale = float(options.get('seed_scale') or 20.0)
        seed_offset = float(options.get('seed_offset') or 500.0)

        rating_map = {}
        for contractor in contractors:
            if seed_from_score:
                score = contractor.trust_score or 0
                seeded_rating = seed_offset + seed_scale * float(score)
                seeded_uncertainty = 350
                seeded_rating_adj = seeded_rating - 0.7 * seeded_uncertainty
                defaults = {
                    'rating': seeded_rating,
                    'rating_adj': seeded_rating_adj,
                    'uncertainty': seeded_uncertainty,
                    'comparisons_count': 0,
                    'status': 'PROVISIONAL',
                }
            else:
                defaults = {
                    'rating': 1500,
                    'rating_adj': 1500,
                    'uncertainty': 350,
                    'comparisons_count': 0,
                    'status': 'PROVISIONAL',
                }
            rating, _ = ContractorVerticalRating.objects.get_or_create(
                contractor=contractor,
                vertical=vertical,
                defaults=defaults,
            )
            rating_map[contractor.id] = rating

        existing_pairs = set()
        existing = PairwiseComparison.objects.filter(vertical=vertical).values_list('contractor_a_id', 'contractor_b_id')
        for a_id, b_id in existing:
            existing_pairs.add(tuple(sorted((a_id, b_id))))

        counts = {cid: rating_map[cid].comparisons_count for cid in rating_map}
        blocked = set()
        pairings = []

        while True:
            candidates = [
                rating_map[cid] for cid in rating_map
                if counts[cid] < target and cid not in blocked
            ]
            if len(candidates) < 2:
                break

            candidates.sort(key=lambda r: (counts[r.contractor_id], -r.uncertainty))
            seed = candidates[0]

            opponents = []
            for opponent in candidates:
                if opponent.contractor_id == seed.contractor_id:
                    continue
                pair_key = tuple(sorted((seed.contractor_id, opponent.contractor_id)))
                if pair_key in existing_pairs:
                    continue
                max_gap = options.get('max_gap')
                if max_gap is not None:
                    if abs(seed.rating_adj - opponent.rating_adj) > float(max_gap):
                        continue
                opponents.append(opponent)

            if not opponents:
                blocked.add(seed.contractor_id)
                continue

            opponents.sort(
                key=lambda r: (
                    abs(seed.rating_adj - r.rating_adj),
                    counts[r.contractor_id],
                    -r.uncertainty,
                )
            )
            chosen = opponents[0]
            pair_key = tuple(sorted((seed.contractor_id, chosen.contractor_id)))
            existing_pairs.add(pair_key)

            pairings.append({
                'vertical_id': vertical.id,
                'contractor_a_id': seed.contractor_id,
                'contractor_b_id': chosen.contractor_id,
            })

            counts[seed.contractor_id] += 1
            counts[chosen.contractor_id] += 1

        if options['dry_run']:
            self._output_pairings(pairings, options['format'])
            return

        contractor_map = {c.id: c for c in contractors}
        comparisons = [
            PairwiseComparison(
                vertical=vertical,
                contractor_a=contractor_map[pair['contractor_a_id']],
                contractor_b=contractor_map[pair['contractor_b_id']],
                status='PENDING',
            )
            for pair in pairings
        ]
        PairwiseComparison.objects.bulk_create(comparisons)

        self.stdout.write(f'Created {len(comparisons)} pending comparisons for {vertical.slug}.')

    def _output_pairings(self, pairings, fmt):
        if fmt == 'csv':
            writer = csv.DictWriter(sys.stdout, fieldnames=['vertical_id', 'contractor_a_id', 'contractor_b_id'])
            writer.writeheader()
            for row in pairings:
                writer.writerow(row)
            return

        self.stdout.write(json.dumps(pairings, indent=2))
