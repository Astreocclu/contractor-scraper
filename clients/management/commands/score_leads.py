"""
Django management command to score leads using DeepSeek R1 AI.

Supports:
- Traditional (deterministic) scoring
- AI scoring with DeepSeek R1 reasoner
- Side-by-side comparison of both methods
- Export to tiered CSV files

Usage:
    # Score with AI only
    python manage.py score_leads --limit 10
    
    # Score with both and compare
    python manage.py score_leads --limit 10 --compare
    
    # Dry run to see what would be scored
    python manage.py score_leads --limit 20 --dry-run
    
    # Export results to CSV
    python manage.py score_leads --limit 50 --export
"""

import os
import json
import logging
from datetime import datetime, date

from django.core.management.base import BaseCommand
from django.conf import settings
from django.utils import timezone

from clients.models import Lead, Permit, Property
from scoring.filters import should_discard, get_freshness_penalty
from scoring.deepseek_scorer import DeepSeekScorer, ScoringResult
from scoring.exporter import export_scored_leads, export_comparison_csv

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Score leads using DeepSeek R1 AI with optional comparison to traditional scoring'

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit',
            type=int,
            default=10,
            help='Maximum number of leads to score (default: 10)'
        )
        parser.add_argument(
            '--lead-id',
            type=str,
            help='Score a specific lead by ID'
        )
        parser.add_argument(
            '--category',
            type=str,
            choices=['pool', 'outdoor_living', 'roof', 'fence', 'other'],
            help='Filter to specific lead category'
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be scored without calling API'
        )
        parser.add_argument(
            '--compare',
            action='store_true',
            help='Run both traditional and AI scoring for comparison'
        )
        parser.add_argument(
            '--export',
            action='store_true',
            help='Export results to tiered CSV files'
        )
        parser.add_argument(
            '--export-dir',
            type=str,
            default='exports',
            help='Directory for CSV exports (default: exports)'
        )
        parser.add_argument(
            '--fallback-only',
            action='store_true',
            help='Use fallback scoring only (no API calls)'
        )
        parser.add_argument(
            '--save-to-db',
            action='store_true',
            help='Save AI scores to the Lead model'
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Show detailed output including reasoning'
        )
        parser.add_argument(
            '--json',
            action='store_true',
            help='Output results as JSON'
        )

    def handle(self, *args, **options):
        limit = options['limit']
        dry_run = options['dry_run']
        compare_mode = options['compare']
        export = options['export']
        fallback_only = options['fallback_only']
        save_to_db = options['save_to_db']
        verbose = options['verbose']
        output_json = options['json']

        # Check API key
        if not fallback_only and not dry_run:
            api_key = getattr(settings, 'DEEPSEEK_API_KEY', None) or os.getenv('DEEPSEEK_API_KEY')
            if not api_key:
                self.stderr.write(self.style.ERROR(
                    'DEEPSEEK_API_KEY not configured. Set it in .env or use --fallback-only'
                ))
                return

        # Gather leads
        leads_data = self._gather_leads(options, limit)

        if not leads_data:
            self.stdout.write(self.style.WARNING('No leads found to score'))
            return

        self.stdout.write(f'\nFound {len(leads_data)} leads to score\n')

        # Apply pre-filters (Layer 1)
        filtered_leads = []
        discarded_count = 0
        discard_reasons = {}

        for lead in leads_data:
            discard, reason = should_discard(lead)
            if discard:
                discarded_count += 1
                reason_key = reason.split(':')[0] if ':' in reason else reason
                discard_reasons[reason_key] = discard_reasons.get(reason_key, 0) + 1
                if verbose:
                    self.stdout.write(f"  Discarded: {lead.get('owner_name', 'Unknown')[:30]} - {reason}")
            else:
                filtered_leads.append(lead)

        self.stdout.write(f'Filtered: {discarded_count} discarded, {len(filtered_leads)} to score')
        if discard_reasons:
            for reason, count in discard_reasons.items():
                self.stdout.write(f'  - {reason}: {count}')

        if dry_run:
            self._show_dry_run(filtered_leads)
            return

        if not filtered_leads:
            self.stdout.write(self.style.WARNING('All leads were filtered out'))
            return

        # Initialize scorer
        scorer = DeepSeekScorer()

        # Score leads
        ai_results = []
        traditional_results = []

        self.stdout.write('')
        for i, lead in enumerate(filtered_leads, 1):
            lead_id = lead.get('lead_id') or lead.get('permit_id')
            self.stdout.write(f'Scoring {i}/{len(filtered_leads)}: {lead_id}... ', ending='')

            # AI scoring
            if fallback_only:
                result = scorer._fallback_score(lead, lead_id)
            else:
                result = scorer.score_lead(lead)
            ai_results.append(result)

            # Traditional scoring for comparison
            if compare_mode:
                trad_score = self._traditional_score(lead)
                traditional_results.append(trad_score)

            # Display result
            tier_style = {
                'A': self.style.SUCCESS,
                'B': self.style.WARNING,
                'C': self.style.ERROR
            }.get(result.tier, self.style.NOTICE)

            if compare_mode and traditional_results:
                trad = traditional_results[-1]
                delta = result.score - trad['score']
                delta_str = f"+{delta}" if delta > 0 else str(delta)
                self.stdout.write(tier_style(
                    f'AI: {result.score} ({result.tier}) | Trad: {trad["score"]} ({trad["tier"]}) | Δ{delta_str}'
                ))
            else:
                self.stdout.write(tier_style(
                    f'{result.tier} | {result.score} | {result.ideal_contractor_type}'
                ))

            if verbose and result.reasoning:
                self.stdout.write(f'    Reasoning: {result.reasoning[:100]}...')
                if result.red_flags:
                    self.stdout.write(f'    Flags: {", ".join(result.red_flags)}')

        # Save to database if requested
        if save_to_db:
            self._save_to_db(ai_results)

        # Output results
        if output_json:
            self._output_json(ai_results, traditional_results if compare_mode else None)
        else:
            self._output_summary(ai_results, traditional_results if compare_mode else None)

        # Export to CSV
        if export:
            export_dir = options['export_dir']
            
            # Export AI results
            export_counts = export_scored_leads(ai_results, output_dir=export_dir)
            for path, count in export_counts.items():
                self.stdout.write(f'  {path}: {count} leads')

            # Export comparison if in compare mode
            if compare_mode and traditional_results:
                # Convert to dicts for comparison export
                ai_dicts = [r.to_dict() for r in ai_results]
                comparison_path = export_comparison_csv(
                    traditional_results, ai_dicts,
                    output_file=f'{export_dir}/score_comparison.csv'
                )
                self.stdout.write(self.style.SUCCESS(f'\nComparison exported to: {comparison_path}'))

    def _gather_leads(self, options, limit):
        """Gather leads from database based on options."""
        leads_data = []

        # Specific lead
        if options.get('lead_id'):
            try:
                lead = Lead.objects.select_related('property').get(lead_id=options['lead_id'])
                leads_data.append(self._lead_to_dict(lead))
            except Lead.DoesNotExist:
                self.stderr.write(self.style.ERROR(f"Lead not found: {options['lead_id']}"))
            return leads_data

        # Query leads
        queryset = Lead.objects.select_related('property')

        # Filter by category
        if options.get('category'):
            queryset = queryset.filter(lead_type=options['category'])

        # Get unscored by AI first, then any
        unscored = queryset.filter(ai_score__isnull=True).order_by('-permit_date')[:limit]
        
        if unscored.exists():
            leads = unscored
        else:
            leads = queryset.order_by('-permit_date')[:limit]

        for lead in leads:
            leads_data.append(self._lead_to_dict(lead))

        return leads_data

    def _lead_to_dict(self, lead):
        """Convert Lead model to dictionary for scoring."""
        prop = lead.property
        
        # Calculate days old
        days_old = 0
        if lead.permit_date:
            days_old = (date.today() - lead.permit_date).days

        return {
            'lead_id': lead.lead_id,
            'owner_name': prop.owner_name if prop else 'Unknown',
            'market_value': float(prop.market_value or 0) if prop else 0,
            'project_description': lead.lead_type or '',
            'category': lead.lead_type or '',
            'permit_date': str(lead.permit_date) if lead.permit_date else None,
            'days_old': days_old,
            'city': prop.county if prop else 'Unknown',  # Use county as proxy for city
            'is_absentee': prop.is_absentee if prop else False,
        }

    def _traditional_score(self, lead):
        """
        Traditional deterministic scoring for comparison.
        
        This replicates the existing scoring logic from scoring_v2.py
        """
        desc = (lead.get('project_description', '') or '').lower()
        value = float(lead.get('market_value', 0) or 0)
        days_old = int(lead.get('days_old', 0) or 0)
        is_absentee = lead.get('is_absentee', False)
        category = lead.get('category', '').lower()

        # Base score from project type
        if any(kw in desc for kw in ['pool', 'swim', 'spa']):
            base = 90
        elif any(kw in desc for kw in ['patio', 'deck', 'pergola', 'outdoor']):
            base = 70
        elif any(kw in desc for kw in ['roof', 'roofing']):
            base = 50
            if days_old > 14:
                base = 30
        elif any(kw in desc for kw in ['fence']):
            base = 50
        else:
            base = 40

        # Wealth multiplier
        if value >= 1_500_000:
            base += 15
        elif value >= 750_000:
            base += 10
        elif value >= 500_000:
            base += 5
        elif value < 400_000 and value > 0:
            base -= 15
        elif value == 0:
            base -= 10

        # Absentee
        if is_absentee:
            if value >= 750_000:
                base += 5
            else:
                base -= 10

        # Cap
        score = max(0, min(100, base))

        if score >= 80:
            tier = 'A'
        elif score >= 50:
            tier = 'B'
        else:
            tier = 'C'

        return {
            'lead_id': lead.get('lead_id'),
            'score': score,
            'tier': tier,
            'method': 'traditional'
        }

    def _save_to_db(self, results):
        """Save AI scores to Lead model."""
        saved = 0
        for result in results:
            if not result.lead_id:
                continue
            try:
                Lead.objects.filter(lead_id=result.lead_id).update(
                    ai_score=result.score,
                    ai_tier=result.tier,
                    ai_reasoning=result.reasoning,
                    ai_chain_of_thought=result.chain_of_thought,
                    ai_applicant_type=result.applicant_type,
                    ai_red_flags=result.red_flags,
                    ai_scored_at=timezone.now()
                )
                saved += 1
            except Exception as e:
                logger.error(f"Failed to save score for {result.lead_id}: {e}")

        self.stdout.write(self.style.SUCCESS(f'\nSaved {saved} AI scores to database'))

    def _show_dry_run(self, leads_data):
        """Show what would be scored."""
        self.stdout.write(self.style.NOTICE('\n=== DRY RUN MODE ===\n'))

        for i, lead in enumerate(leads_data, 1):
            self.stdout.write(f'{i}. {lead.get("project_description", "Unknown")[:50]}')
            self.stdout.write(f'   Value: ${lead.get("market_value", 0):,.0f}')
            self.stdout.write(f'   Owner: {lead.get("owner_name", "Unknown")}')
            self.stdout.write(f'   Age: {lead.get("days_old", 0)} days')
            self.stdout.write('')

        self.stdout.write(self.style.SUCCESS(f'\nWould score {len(leads_data)} leads'))

    def _output_json(self, ai_results, traditional_results=None):
        """Output results as JSON."""
        output = {
            'ai_scores': [r.to_dict() for r in ai_results],
            'stats': {
                'total': len(ai_results),
                'tier_a': len([r for r in ai_results if r.tier == 'A']),
                'tier_b': len([r for r in ai_results if r.tier == 'B']),
                'tier_c': len([r for r in ai_results if r.tier == 'C']),
                'avg_score': sum(r.score for r in ai_results) / len(ai_results) if ai_results else 0,
            }
        }

        if traditional_results:
            output['traditional_scores'] = traditional_results
            output['comparison'] = {
                'avg_delta': sum(ai.score - trad['score'] 
                               for ai, trad in zip(ai_results, traditional_results)) / len(ai_results)
            }

        self.stdout.write(json.dumps(output, indent=2, default=str))

    def _output_summary(self, ai_results, traditional_results=None):
        """Output summary of results."""
        if not ai_results:
            return

        self.stdout.write('\n' + '=' * 60)
        self.stdout.write(self.style.SUCCESS('SCORING SUMMARY'))
        self.stdout.write('=' * 60 + '\n')

        tier_a = [r for r in ai_results if r.tier == 'A']
        tier_b = [r for r in ai_results if r.tier == 'B']
        tier_c = [r for r in ai_results if r.tier == 'C']

        avg_score = sum(r.score for r in ai_results) / len(ai_results)
        total_cost = sum(r.cost_usd for r in ai_results)

        self.stdout.write(f'Total Leads: {len(ai_results)}')
        self.stdout.write(self.style.SUCCESS(f'Tier A (Hot): {len(tier_a)}'))
        self.stdout.write(self.style.WARNING(f'Tier B (Warm): {len(tier_b)}'))
        self.stdout.write(self.style.ERROR(f'Tier C (Cold): {len(tier_c)}'))
        self.stdout.write(f'Average Score: {avg_score:.1f}')
        self.stdout.write(f'Total API Cost: ${total_cost:.4f}')

        if traditional_results:
            self.stdout.write('\n--- Comparison with Traditional ---')
            deltas = [ai.score - trad['score'] for ai, trad in zip(ai_results, traditional_results)]
            avg_delta = sum(deltas) / len(deltas)
            self.stdout.write(f'Average Score Delta (AI - Trad): {avg_delta:+.1f}')
            
            # Show biggest differences
            by_delta = sorted(zip(ai_results, traditional_results, deltas), 
                            key=lambda x: abs(x[2]), reverse=True)
            self.stdout.write('\nBiggest Score Differences:')
            for ai, trad, delta in by_delta[:5]:
                self.stdout.write(
                    f'  {ai.lead_id}: AI {ai.score} vs Trad {trad["score"]} (Δ{delta:+d})'
                )

        if tier_a:
            self.stdout.write('\n' + self.style.SUCCESS('🔥 TOP TIER A LEADS:'))
            for r in sorted(tier_a, key=lambda x: x.score, reverse=True)[:5]:
                self.stdout.write(
                    f'  [{r.score}] {r.lead_id} → {r.ideal_contractor_type}'
                )
                if r.reasoning:
                    self.stdout.write(f'        {r.reasoning[:60]}...')
