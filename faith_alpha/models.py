from django.db import models


class Company(models.Model):
    ticker = models.CharField(max_length=12, unique=True, db_index=True)
    cik = models.CharField(max_length=10, blank=True, default='', db_index=True)
    name = models.CharField(max_length=255)
    exchange = models.CharField(max_length=32, blank=True, default='')
    sector = models.CharField(max_length=128, blank=True, default='')
    industry = models.CharField(max_length=128, blank=True, default='')
    sic_code = models.CharField(max_length=8, blank=True, default='')
    sic_description = models.CharField(max_length=255, blank=True, default='')
    market_cap_rank = models.PositiveIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    source_metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['ticker']

    def __str__(self):
        return f"{self.ticker} - {self.name}"


class CompanySignal(models.Model):
    SOURCE_FEC = 'fec'
    SOURCE_LDA = 'lda'
    SOURCE_OTHER = 'other'

    SIGNAL_SOURCES = (
        (SOURCE_FEC, 'FEC'),
        (SOURCE_LDA, 'Senate LDA'),
        (SOURCE_OTHER, 'Other'),
    )

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='signals')
    source = models.CharField(max_length=16, choices=SIGNAL_SOURCES, default=SOURCE_OTHER, db_index=True)
    signal_type = models.CharField(max_length=64, db_index=True)
    external_id = models.CharField(max_length=128, blank=True, default='')
    title = models.CharField(max_length=255)
    amount_usd = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    cycle_or_year = models.PositiveIntegerField(null=True, blank=True)
    evidence_text = models.TextField(blank=True, default='')
    metadata = models.JSONField(default=dict, blank=True)
    retrieved_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['company', 'source', '-cycle_or_year']),
            models.Index(fields=['company', 'signal_type']),
        ]
        unique_together = ('company', 'source', 'signal_type', 'external_id')
        ordering = ['company_id', 'source', '-cycle_or_year', '-created_at']

    def __str__(self):
        return f"{self.company.ticker} {self.source}:{self.signal_type}"


class CompanyFiling(models.Model):
    FORM_10K = '10-K'
    FORM_PROXY = 'DEF 14A'
    FORM_OTHER = 'OTHER'

    FORM_CHOICES = (
        (FORM_10K, '10-K'),
        (FORM_PROXY, 'DEF 14A'),
        (FORM_OTHER, 'OTHER'),
    )

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='filings')
    form_type = models.CharField(max_length=16, choices=FORM_CHOICES, default=FORM_OTHER)
    accession_number = models.CharField(max_length=32)
    filing_date = models.DateField(null=True, blank=True)
    primary_document = models.CharField(max_length=255, blank=True, default='')
    source_url = models.URLField(max_length=600)
    content_text = models.TextField(blank=True, default='')
    content_hash = models.CharField(max_length=64, blank=True, default='')
    source_metadata = models.JSONField(default=dict, blank=True)
    fetched_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('company', 'form_type', 'accession_number')
        indexes = [
            models.Index(fields=['company', 'form_type', '-filing_date']),
        ]
        ordering = ['company_id', '-filing_date']

    def __str__(self):
        return f"{self.company.ticker} {self.form_type} {self.filing_date or 'unknown'}"


class FaithScreen(models.Model):
    company = models.OneToOneField(Company, on_delete=models.CASCADE, related_name='faith_screen')
    alignment_score = models.PositiveSmallIntegerField(default=0)
    base_score = models.PositiveSmallIntegerField(default=0)
    confidence_score = models.PositiveSmallIntegerField(default=0)
    pipeline_version = models.CharField(max_length=32, default='v0.1')
    llm_provider = models.CharField(max_length=32, blank=True, default='')
    llm_model = models.CharField(max_length=64, blank=True, default='')
    base_findings = models.JSONField(default=dict, blank=True)
    category_details = models.JSONField(default=dict, blank=True)
    summary = models.TextField(blank=True, default='')
    raw_classification = models.JSONField(default=dict, blank=True)
    computed_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-alignment_score', 'company__ticker']

    def __str__(self):
        return f"{self.company.ticker} score={self.alignment_score}"
