from django.db import models
from django.contrib.auth import get_user_model
from django.utils.text import slugify

User = get_user_model()
PASS_THRESHOLD = 50  # Bronze tier threshold

# Tier choices for contractor ranking
TIER_CHOICES = [
    ('gold', 'Gold'),      # 80+
    ('silver', 'Silver'),  # 65-79
    ('bronze', 'Bronze'),  # 50-64
    ('new', 'New Business'),
    ('unranked', 'Unranked'),  # <50
]


class Vertical(models.Model):
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)
    search_terms = models.JSONField(default=list)
    avg_job_value = models.PositiveIntegerField(default=10000)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)


class Contractor(models.Model):
    verticals = models.ManyToManyField(Vertical, related_name='contractors', blank=True)

    # Basic
    business_name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=280, unique=True, blank=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=2, default='TX')
    zip_code = models.CharField(max_length=10, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True, null=True)
    website = models.URLField(blank=True, null=True)

    # Google
    google_place_id = models.CharField(max_length=255, unique=True, null=True, blank=True)
    google_rating = models.DecimalField(max_digits=2, decimal_places=1, null=True, blank=True)
    google_review_count = models.PositiveIntegerField(default=0)
    google_reviews_json = models.JSONField(default=list, blank=True)

    # Yelp
    yelp_id = models.CharField(max_length=255, blank=True, null=True)
    yelp_url = models.URLField(blank=True, null=True)
    yelp_rating = models.DecimalField(max_digits=2, decimal_places=1, null=True, blank=True)
    yelp_review_count = models.PositiveIntegerField(default=0)

    # BBB
    bbb_rating = models.CharField(max_length=2, blank=True, null=True)
    bbb_accredited = models.BooleanField(default=False)
    bbb_complaint_count = models.PositiveIntegerField(default=0)
    bbb_years_in_business = models.PositiveIntegerField(null=True, blank=True)
    bbb_url = models.URLField(blank=True, null=True)

    # License
    license_number = models.CharField(max_length=100, blank=True, null=True)
    license_status = models.CharField(max_length=50, blank=True, null=True)
    license_type = models.CharField(max_length=100, blank=True, null=True)

    # Scores (OVERWRITTEN each audit)
    trust_score = models.PositiveIntegerField(default=0)
    passes_threshold = models.BooleanField(default=False)
    tier = models.CharField(max_length=20, choices=TIER_CHOICES, default='unranked')
    verification_score = models.PositiveIntegerField(default=0)
    reputation_score = models.PositiveIntegerField(default=0)
    credibility_score = models.PositiveIntegerField(default=0)
    red_flag_score = models.PositiveIntegerField(default=0)
    bonus_score = models.PositiveIntegerField(default=0)

    # Admin override
    admin_score_override = models.PositiveIntegerField(null=True, blank=True)
    admin_override_reason = models.TextField(blank=True)

    # AI
    ai_summary = models.TextField(blank=True)
    ai_sentiment_score = models.PositiveIntegerField(default=50)
    ai_red_flags = models.JSONField(default=list, blank=True)

    # Status
    is_claimed = models.BooleanField(default=False)
    claimed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    # Timestamps
    first_scraped_at = models.DateTimeField(auto_now_add=True)
    last_enriched_at = models.DateTimeField(null=True, blank=True)
    last_audited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-trust_score']
        unique_together = [['business_name', 'city']]

    def __str__(self):
        status = "PASS" if self.passes_threshold else "FAIL"
        return f"[{status}] {self.business_name} ({self.city}) - {self.trust_score}"

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(f"{self.business_name}-{self.city}")[:270]
            self.slug = base
            counter = 1
            while Contractor.objects.filter(slug=self.slug).exclude(pk=self.pk).exists():
                self.slug = f"{base}-{counter}"
                counter += 1

        score = self.admin_score_override or self.trust_score
        self.passes_threshold = score >= PASS_THRESHOLD
        super().save(*args, **kwargs)

    @property
    def pass_status(self):
        return "Passes" if self.passes_threshold else "Does Not Pass"


# Risk level choices for forensic audits
RISK_LEVEL_CHOICES = [
    ('CRITICAL', 'Critical'),
    ('SEVERE', 'Severe'),
    ('MODERATE', 'Moderate'),
    ('LOW', 'Low'),
    ('TRUSTED', 'Trusted'),
]

RECOMMENDATION_CHOICES = [
    ('AVOID', 'Avoid'),
    ('CAUTION', 'Caution'),
    ('VERIFY', 'Verify'),
    ('RECOMMENDED', 'Recommended'),
]

CONFIDENCE_CHOICES = [
    ('HIGH', 'High'),
    ('MEDIUM', 'Medium'),
    ('LOW', 'Low'),
]

SEVERITY_CHOICES = [
    ('CRITICAL', 'Critical'),
    ('SEVERE', 'Severe'),
    ('MODERATE', 'Moderate'),
    ('MINOR', 'Minor'),
]


class ContractorAudit(models.Model):
    contractor = models.ForeignKey(Contractor, on_delete=models.CASCADE, related_name='audits')
    audit_date = models.DateTimeField(auto_now_add=True)

    # Overall results
    trust_score = models.IntegerField(default=0)  # 0-100
    risk_level = models.CharField(max_length=20, choices=RISK_LEVEL_CHOICES, default='MODERATE')
    recommendation = models.CharField(max_length=20, choices=RECOMMENDATION_CHOICES, default='VERIFY')

    # Component scores
    verification_score = models.IntegerField(default=0)  # max 15
    reputation_score = models.FloatField(default=0)  # max 15
    credibility_score = models.IntegerField(default=0)  # max 10
    financial_score = models.IntegerField(default=0)  # max 10
    red_flag_score = models.IntegerField(default=0)  # max 10

    # Calculation metadata
    base_score = models.FloatField(default=0)
    normalized_score = models.FloatField(default=0)
    multiplier_applied = models.FloatField(default=1.0)
    multiplier_reason = models.TextField(blank=True)

    # Raw data (JSON)
    perplexity_data = models.JSONField(default=dict, blank=True)  # raw Perplexity responses
    synthesis_data = models.JSONField(default=dict, blank=True)  # full DeepSeek output

    # Narrative
    narrative_summary = models.TextField(blank=True)
    homeowner_guidance = models.JSONField(default=dict, blank=True)

    # Metadata
    data_confidence = models.CharField(max_length=10, choices=CONFIDENCE_CHOICES, default='MEDIUM')
    sources_used = models.JSONField(default=list, blank=True)
    data_gaps = models.JSONField(default=list, blank=True)

    # Legacy fields (for backward compatibility)
    total_score = models.PositiveIntegerField(default=0)
    sentiment_score = models.PositiveIntegerField(default=50)
    ai_summary = models.TextField(blank=True)
    score_breakdown = models.JSONField(default=dict)

    class Meta:
        ordering = ['-audit_date']

    def __str__(self):
        return f"Audit: {self.contractor.business_name} - {self.risk_level} ({self.trust_score}) - {self.audit_date.date()}"


class RedFlag(models.Model):
    audit = models.ForeignKey(ContractorAudit, on_delete=models.CASCADE, related_name='red_flags')
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default='MODERATE')
    category = models.CharField(max_length=50)
    description = models.TextField()
    evidence = models.TextField(blank=True)
    source = models.TextField(blank=True)
    source_url = models.URLField(blank=True)

    class Meta:
        ordering = ['severity', 'category']

    def __str__(self):
        return f"[{self.severity}] {self.category}: {self.description[:50]}"


class AuditTimeline(models.Model):
    audit = models.ForeignKey(ContractorAudit, on_delete=models.CASCADE, related_name='timeline_events')
    date = models.CharField(max_length=50)  # Can be "2015", "2023-11", "Ongoing"
    event = models.TextField()
    significance = models.TextField(blank=True)
    source = models.TextField(blank=True)

    class Meta:
        ordering = ['date']

    def __str__(self):
        return f"{self.date}: {self.event[:50]}"
