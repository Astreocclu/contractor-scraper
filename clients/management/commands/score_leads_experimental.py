"""
Experimental Lead Scoring Management Command

Uses DeepSeek AI to score leads based on "Monetization Velocity".
Separate from the main scoring system for experimentation.

Usage:
    python manage.py score_leads_experimental --limit 10 --dry-run
    python manage.py score_leads_experimental --lead-id 123
    python manage.py score_leads_experimental --report
"""

import os
import json
import tempfile
import webbrowser
from datetime import datetime

from django.core.management.base import BaseCommand
from django.conf import settings

from clients.models import Lead, Permit, Property
from clients.services.scoring_experimental import (
    SalesDirectorScorer,
    ScoringResult,
    generate_html_report
)


class Command(BaseCommand):
    help = 'Score leads using experimental DeepSeek AI scorer'

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
            '--permit-id',
            type=str,
            help='Score a specific permit by ID'
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show what would be scored without calling API'
        )
        parser.add_argument(
            '--report',
            action='store_true',
            help='Generate and open HTML report in browser'
        )
        parser.add_argument(
            '--report-file',
            type=str,
            help='Save HTML report to specific file path'
        )
        parser.add_argument(
            '--fallback-only',
            action='store_true',
            help='Use only fallback scoring (no API calls)'
        )
        parser.add_argument(
            '--json',
            action='store_true',
            help='Output results as JSON'
        )
        parser.add_argument(
            '--tier',
            type=str,
            choices=['A', 'B', 'C'],
            help='Filter to specific tier in results'
        )

    def handle(self, *args, **options):
        limit = options['limit']
        dry_run = options['dry_run']
        generate_report = options['report']
        fallback_only = options['fallback_only']
        output_json = options['json']
        tier_filter = options.get('tier')
        
        # Check for API key unless fallback only
        if not fallback_only and not dry_run:
            api_key = getattr(settings, 'DEEPSEEK_API_KEY', None) or os.getenv('DEEPSEEK_API_KEY')
            if not api_key:
                self.stderr.write(self.style.ERROR('DEEPSEEK_API_KEY not configured'))
                self.stderr.write('Set it in .env or use --fallback-only')
                return
        
        # Gather leads to score
        leads_data = self._gather_leads(options, limit)
        
        if not leads_data:
            self.stdout.write(self.style.WARNING('No leads found to score'))
            return
        
        self.stdout.write(f'\nFound {len(leads_data)} leads to score\n')
        
        if dry_run:
            self._show_dry_run(leads_data)
            return
        
        # Initialize scorer
        scorer = SalesDirectorScorer()
        
        # Score leads
        results = []
        for i, lead in enumerate(leads_data, 1):
            self.stdout.write(f'Scoring lead {i}/{len(leads_data)}... ', ending='')
            
            if fallback_only:
                # Use fallback directly
                result = scorer._fallback_score(scorer._prepare_lead_data(lead))
            else:
                result = scorer.score_lead(lead, use_fallback_on_error=True)
            
            results.append(result)
            
            # Show inline result
            tier_style = {
                'A': self.style.SUCCESS,
                'B': self.style.WARNING,
                'C': self.style.ERROR
            }.get(result.tier, self.style.NOTICE)
            
            self.stdout.write(tier_style(f'Tier {result.tier} | Score: {result.score} | {result.ideal_contractor}'))
        
        # Filter by tier if specified
        if tier_filter:
            results = [r for r in results if r.tier == tier_filter]
            self.stdout.write(f'\nFiltered to {len(results)} Tier {tier_filter} leads\n')
        
        # Output results
        if output_json:
            self._output_json(results)
        else:
            self._output_summary(results)
        
        # Generate report if requested
        if generate_report or options.get('report_file'):
            self._generate_report(results, options.get('report_file'))
    
    def _gather_leads(self, options, limit):
        """Gather leads from database based on options."""
        leads_data = []
        
        # Specific lead/permit
        if options.get('lead_id'):
            try:
                lead = Lead.objects.select_related('property').get(lead_id=options['lead_id'])
                leads_data.append(self._lead_to_dict(lead))
            except Lead.DoesNotExist:
                self.stderr.write(self.style.ERROR(f"Lead not found: {options['lead_id']}"))
            return leads_data
        
        if options.get('permit_id'):
            try:
                permit = Permit.objects.get(permit_id=options['permit_id'])
                leads_data.append(self._permit_to_dict(permit))
            except Permit.DoesNotExist:
                self.stderr.write(self.style.ERROR(f"Permit not found: {options['permit_id']}"))
            return leads_data
        
        # Get recent leads with property data
        leads = Lead.objects.select_related('property').order_by('-permit_date')[:limit]
        
        for lead in leads:
            leads_data.append(self._lead_to_dict(lead))
        
        return leads_data
    
    def _lead_to_dict(self, lead):
        """Convert Lead model to dictionary for scoring."""
        prop = lead.property
        return {
            'lead_id': lead.lead_id,
            'project_description': lead.lead_type,
            'permit_date': str(lead.permit_date) if lead.permit_date else None,
            'market_value': float(prop.market_value or 0) if prop else 0,
            'owner_name': prop.owner_name if prop else 'Unknown',
            'is_absentee': prop.is_absentee if prop else False,
            'lead_source': 'Permit',
        }
    
    def _permit_to_dict(self, permit):
        """Convert Permit model to dictionary for scoring."""
        return {
            'permit_id': permit.permit_id,
            'project_description': permit.description or permit.permit_type,
            'permit_date': str(permit.issued_date) if permit.issued_date else None,
            'market_value': 0,  # Would need enrichment
            'owner_name': permit.owner_name or 'Unknown',
            'is_absentee': False,
            'lead_source': 'Permit',
        }
    
    def _show_dry_run(self, leads_data):
        """Show what would be scored without API calls."""
        self.stdout.write(self.style.NOTICE('\n=== DRY RUN MODE ===\n'))
        
        for i, lead in enumerate(leads_data, 1):
            self.stdout.write(f'{i}. {lead.get("project_description", "Unknown")[:50]}')
            self.stdout.write(f'   Value: ${lead.get("market_value", 0):,.0f}')
            self.stdout.write(f'   Owner: {lead.get("owner_name", "Unknown")}')
            self.stdout.write(f'   Date: {lead.get("permit_date", "Unknown")}')
            self.stdout.write('')
        
        self.stdout.write(self.style.SUCCESS(f'\nWould score {len(leads_data)} leads'))
    
    def _output_json(self, results):
        """Output results as JSON."""
        output = [r.to_dict() for r in results]
        self.stdout.write(json.dumps(output, indent=2, default=str))
    
    def _output_summary(self, results):
        """Output summary of results."""
        if not results:
            return
        
        self.stdout.write('\n' + '=' * 60)
        self.stdout.write(self.style.SUCCESS('SCORING SUMMARY'))
        self.stdout.write('=' * 60 + '\n')
        
        tier_a = [r for r in results if r.tier == 'A']
        tier_b = [r for r in results if r.tier == 'B']
        tier_c = [r for r in results if r.tier == 'C']
        
        avg_score = sum(r.score for r in results) / len(results)
        
        self.stdout.write(f'Total Leads: {len(results)}')
        self.stdout.write(self.style.SUCCESS(f'Tier A (Whales): {len(tier_a)}'))
        self.stdout.write(self.style.WARNING(f'Tier B (Standard): {len(tier_b)}'))
        self.stdout.write(self.style.ERROR(f'Tier C (Low Value): {len(tier_c)}'))
        self.stdout.write(f'Average Score: {avg_score:.1f}')
        
        if tier_a:
            self.stdout.write('\n' + self.style.SUCCESS('🐋 TOP WHALES:'))
            for r in sorted(tier_a, key=lambda x: x.score, reverse=True)[:5]:
                self.stdout.write(f'  [{r.score}] {r.raw_input.get("project_description", "")[:40]} → {r.ideal_contractor}')
    
    def _generate_report(self, results, report_file=None):
        """Generate and open HTML report."""
        html = generate_html_report(results, title="Experimental Lead Scoring Report")
        
        if report_file:
            filepath = report_file
        else:
            # Create temp file
            fd, filepath = tempfile.mkstemp(suffix='.html', prefix='lead_scoring_')
            os.close(fd)
        
        with open(filepath, 'w') as f:
            f.write(html)
        
        self.stdout.write(self.style.SUCCESS(f'\nReport saved to: {filepath}'))
        
        # Open in browser unless specific file was requested
        if not report_file:
            webbrowser.open(f'file://{filepath}')
            self.stdout.write('Opening in browser...')
