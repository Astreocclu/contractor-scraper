from django.core.management.base import BaseCommand
from django.utils import timezone
from contractors.models import Contractor, ContractorAudit
from contractors.services.ai_auditor import AIAuditor
from contractors.services.scoring import TrustScoreCalculator


class Command(BaseCommand):
    help = 'Run AI audits and calculate scores'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int)
        parser.add_argument('--skip-ai', action='store_true')

    def handle(self, *args, **options):
        self.stdout.write('=== AUDITING CONTRACTORS ===')

        contractors = Contractor.objects.filter(is_active=True)
        if options['limit']:
            contractors = contractors[:options['limit']]

        calculator = TrustScoreCalculator()
        auditor = None

        if not options['skip_ai']:
            try:
                auditor = AIAuditor()
            except ValueError as e:
                self.stdout.write(self.style.WARNING(f"AI disabled: {e}"))

        passing = 0

        for c in contractors:
            self.stdout.write(f"\n{c.business_name}")

            audit_result = None
            if auditor and c.google_reviews_json:
                audit_result = auditor.audit(c.business_name, c.google_reviews_json)
                self.stdout.write(f"  Sentiment: {audit_result.sentiment_score}")

            breakdown = calculator.calculate(c, audit_result)

            # Create audit record
            ContractorAudit.objects.create(
                contractor=c,
                total_score=breakdown.total_normalized,
                sentiment_score=audit_result.sentiment_score if audit_result else 50,
                ai_summary=audit_result.summary if audit_result else '',
            )

            # Update contractor (OVERWRITE)
            c.trust_score = breakdown.total_normalized
            c.verification_score = breakdown.verification
            c.reputation_score = breakdown.reputation
            c.credibility_score = breakdown.credibility
            c.red_flag_score = breakdown.red_flags
            c.bonus_score = breakdown.bonus

            if audit_result:
                c.ai_summary = audit_result.summary
                c.ai_sentiment_score = audit_result.sentiment_score
                c.ai_red_flags = audit_result.red_flags

            c.last_audited_at = timezone.now()
            c.save()

            status = "PASSES" if c.passes_threshold else "DOES NOT PASS"
            self.stdout.write(f"  Score: {c.trust_score} - {status}")

            if c.passes_threshold:
                passing += 1

        total = contractors.count()
        self.stdout.write(f"\n\nPassing: {passing}/{total}")
