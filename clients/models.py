from django.db import models
from django.utils import timezone


class Permit(models.Model):
    """Raw scraped permit data from city permit systems."""

    permit_id = models.CharField(max_length=100)
    city = models.CharField(max_length=100, db_index=True)
    property_address = models.CharField(max_length=500)
    property_address_normalized = models.CharField(max_length=500, blank=True, null=True)
    city_name = models.CharField(max_length=100, blank=True, null=True)
    zip_code = models.CharField(max_length=20, blank=True, null=True)
    permit_type = models.CharField(max_length=100, blank=True, null=True, db_index=True)
    description = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=50, blank=True, null=True)
    issued_date = models.DateField(blank=True, null=True, db_index=True)
    applicant_name = models.CharField(max_length=200, blank=True, null=True)
    contractor_name = models.CharField(max_length=200, blank=True, null=True)
    estimated_value = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    scraped_at = models.DateTimeField(default=timezone.now)

    # AI categorization
    lead_type = models.CharField(max_length=50, blank=True, null=True)
    lead_subtypes = models.JSONField(blank=True, null=True)
    categorization_confidence = models.FloatField(blank=True, null=True)

    class Meta:
        db_table = 'leads_permit'  # Keep old table name for data continuity
        unique_together = ['city', 'permit_id']
        indexes = [
            models.Index(fields=['property_address_normalized']),
        ]

    def __str__(self):
        return f"{self.permit_id} - {self.property_address}"


class Property(models.Model):
    """Enriched property data from County Appraisal Districts."""

    property_address = models.CharField(max_length=500, primary_key=True)
    property_address_normalized = models.CharField(max_length=500, blank=True, null=True)

    # CAD identifiers
    cad_account_id = models.CharField(max_length=100, blank=True, null=True)
    county = models.CharField(max_length=100, blank=True, null=True, db_index=True)

    # Owner info
    owner_name = models.CharField(max_length=300, blank=True, null=True)
    mailing_address = models.CharField(max_length=500, blank=True, null=True)
    mailing_address_normalized = models.CharField(max_length=500, blank=True, null=True)

    # Valuation
    market_value = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    land_value = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    improvement_value = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)

    # Property details
    year_built = models.IntegerField(blank=True, null=True)
    square_feet = models.IntegerField(blank=True, null=True)
    lot_size = models.DecimalField(max_digits=10, decimal_places=4, blank=True, null=True)
    property_type = models.CharField(max_length=100, blank=True, null=True)

    # Neighborhood
    neighborhood_code = models.CharField(max_length=50, blank=True, null=True, db_index=True)
    neighborhood_median = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)

    # Flags
    is_absentee = models.BooleanField(null=True, blank=True, db_index=True)  # NULL = unknown
    homestead_exempt = models.BooleanField(default=False)

    # Enrichment status
    ENRICHMENT_STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('success', 'Success'),
        ('failed', 'Failed'),
    ]
    enrichment_status = models.CharField(max_length=20, choices=ENRICHMENT_STATUS_CHOICES, default='pending')
    enriched_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = 'leads_property'  # Keep old table name for data continuity

    def __str__(self):
        return self.property_address


class Lead(models.Model):
    """Scored leads ready for outreach."""

    TIER_CHOICES = [
        ('A', 'Tier A'),
        ('B', 'Tier B'),
        ('C', 'Tier C'),
        ('D', 'Tier D'),
    ]

    FRESHNESS_CHOICES = [
        ('hot', 'Hot'),
        ('warm', 'Warm'),
        ('moderate', 'Moderate'),
        ('cool', 'Cool'),
        ('cold', 'Cold'),
        ('stale', 'Stale'),
    ]

    STATUS_CHOICES = [
        ('new', 'New'),
        ('exported', 'Exported'),
        ('contacted', 'Contacted'),
        ('converted', 'Converted'),
    ]

    lead_id = models.CharField(max_length=100, primary_key=True)
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name='leads')

    # Categorization
    lead_type = models.CharField(max_length=50, blank=True, null=True, db_index=True)
    lead_subtypes = models.JSONField(blank=True, null=True)

    # Signals
    is_high_contrast = models.BooleanField(default=False)
    contrast_ratio = models.FloatField(blank=True, null=True)
    is_absentee = models.BooleanField(null=True, blank=True)  # NULL = unknown

    # Traditional Scoring (deterministic/rule-based)
    score = models.FloatField(blank=True, null=True, db_index=True)
    score_breakdown = models.JSONField(blank=True, null=True)
    tier = models.CharField(max_length=1, choices=TIER_CHOICES, blank=True, null=True, db_index=True)

    # AI Scoring (DeepSeek R1 reasoner)
    ai_score = models.FloatField(blank=True, null=True, db_index=True)
    ai_tier = models.CharField(max_length=1, choices=TIER_CHOICES, blank=True, null=True)
    ai_reasoning = models.TextField(blank=True, null=True)
    ai_chain_of_thought = models.TextField(blank=True, null=True)  # R1's reasoning_content
    ai_applicant_type = models.CharField(max_length=50, blank=True, null=True)
    ai_red_flags = models.JSONField(blank=True, null=True)
    ai_scored_at = models.DateTimeField(blank=True, null=True)

    # Freshness
    permit_date = models.DateField(blank=True, null=True)
    days_since_permit = models.IntegerField(blank=True, null=True)
    freshness_tier = models.CharField(max_length=20, choices=FRESHNESS_CHOICES, blank=True, null=True, db_index=True)

    # Metadata
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='new', db_index=True)

    class Meta:
        db_table = 'leads_lead'  # Keep old table name for data continuity
        ordering = ['-score']

    def __str__(self):
        return f"{self.lead_id} - {self.tier} ({self.score})"


class ScraperRun(models.Model):
    """Track scraping execution history."""

    STATUS_CHOICES = [
        ('running', 'Running'),
        ('success', 'Success'),
        ('failed', 'Failed'),
    ]

    city = models.CharField(max_length=100, db_index=True)
    started_at = models.DateTimeField()
    completed_at = models.DateTimeField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='running', db_index=True)
    permits_found = models.IntegerField(default=0)
    errors = models.JSONField(blank=True, null=True)
    log_file = models.CharField(max_length=500, blank=True, null=True)

    class Meta:
        db_table = 'leads_scraperrun'  # Keep old table name for data continuity
        ordering = ['-started_at']

    def __str__(self):
        return f"{self.city} - {self.started_at.strftime('%Y-%m-%d %H:%M')}"


class NeighborhoodMedian(models.Model):
    """Pre-calculated neighborhood median values for scoring."""

    neighborhood_code = models.CharField(max_length=50, primary_key=True)
    county = models.CharField(max_length=100, blank=True, null=True)
    median_value = models.DecimalField(max_digits=14, decimal_places=2, blank=True, null=True)
    property_count = models.IntegerField(blank=True, null=True)
    calculated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = 'leads_neighborhoodmedian'  # Keep old table name for data continuity

    def __str__(self):
        return f"{self.neighborhood_code} - ${self.median_value:,.0f}"


class ScoredLead(models.Model):
    """
    AI-scored leads from the V2 scoring system.

    Every permit gets scored and stored here, organized by trade group and category.
    This is the source of truth for all scored leads.
    """

    TIER_CHOICES = [
        ('A', 'Tier A - Premium'),
        ('B', 'Tier B - Good'),
        ('C', 'Tier C - Low Priority'),
        ('RETRY', 'Pending Retry'),
    ]

    CONTACT_PRIORITY_CHOICES = [
        ('call', 'Call Today'),
        ('email', 'Email'),
        ('skip', 'Skip'),
    ]

    SCORING_METHOD_CHOICES = [
        ('ai', 'AI (DeepSeek Chat)'),
        ('ai-reasoner', 'AI (DeepSeek Reasoner)'),
        ('pending_retry', 'Pending Retry'),
    ]

    STATUS_CHOICES = [
        ('new', 'New'),
        ('exported', 'Exported'),
        ('sold', 'Sold to Contractor'),
        ('contacted', 'Homeowner Contacted'),
        ('converted', 'Converted'),
        ('dead', 'Dead Lead'),
    ]

    # Link to source permit
    permit = models.OneToOneField(
        Permit,
        on_delete=models.CASCADE,
        related_name='scored_lead'
    )
    cad_property = models.ForeignKey(
        Property,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='scored_leads'
    )

    # Categorization
    category = models.CharField(max_length=50, db_index=True)  # pool, hvac, roof, etc.
    trade_group = models.CharField(max_length=50, db_index=True)  # luxury_outdoor, home_systems, etc.
    is_commercial = models.BooleanField(default=False, db_index=True)

    # Scoring
    score = models.IntegerField(db_index=True)  # 0-100, or -1 for pending retry
    tier = models.CharField(max_length=5, choices=TIER_CHOICES, db_index=True)
    reasoning = models.TextField()
    chain_of_thought = models.TextField(blank=True)  # DeepSeek reasoner's thinking

    # Flags and recommendations
    flags = models.JSONField(default=list)
    ideal_contractor = models.CharField(max_length=200, blank=True)
    contact_priority = models.CharField(
        max_length=20,
        choices=CONTACT_PRIORITY_CHOICES,
        default='email'
    )

    # Scoring metadata
    scoring_method = models.CharField(
        max_length=20,
        choices=SCORING_METHOD_CHOICES,
        default='ai'
    )
    scored_at = models.DateTimeField(default=timezone.now, db_index=True)

    # Sales tracking
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='new',
        db_index=True
    )
    sold_to = models.CharField(max_length=200, blank=True)  # Contractor who bought the lead
    sold_at = models.DateTimeField(null=True, blank=True)
    sold_price = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = 'clients_scoredlead'
        ordering = ['-score', '-scored_at']
        indexes = [
            models.Index(fields=['trade_group', 'category', 'tier']),
            models.Index(fields=['status', 'tier']),
            models.Index(fields=['category', 'score']),
        ]

    def __str__(self):
        return f"[{self.tier}:{self.score}] {self.category} - {self.permit.property_address}"

    @property
    def is_sellable(self):
        """Check if lead is sellable (not unsellable category and not already sold)."""
        return (
            self.trade_group != 'unsellable' and
            self.tier != 'RETRY' and
            self.status in ('new', 'exported')
        )
