from django.contrib import admin
from .models import Vertical, Contractor, ContractorAudit, RedFlag, AuditTimeline


@admin.register(Vertical)
class VerticalAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug', 'is_active']
    prepopulated_fields = {'slug': ('name',)}


@admin.register(Contractor)
class ContractorAdmin(admin.ModelAdmin):
    list_display = ['business_name', 'city', 'trust_score', 'passes_threshold', 'google_rating']
    list_filter = ['passes_threshold', 'city', 'verticals']
    search_fields = ['business_name', 'city']
    filter_horizontal = ['verticals']
    readonly_fields = ['slug', 'first_scraped_at', 'last_enriched_at', 'last_audited_at']

    fieldsets = (
        ('Basic Info', {
            'fields': ('business_name', 'slug', 'verticals', 'address', 'city', 'state', 'zip_code', 'phone', 'email', 'website')
        }),
        ('Google Data', {
            'fields': ('google_place_id', 'google_rating', 'google_review_count'),
            'classes': ('collapse',)
        }),
        ('Yelp Data', {
            'fields': ('yelp_id', 'yelp_rating', 'yelp_review_count'),
            'classes': ('collapse',)
        }),
        ('BBB Data', {
            'fields': ('bbb_rating', 'bbb_accredited', 'bbb_complaint_count', 'bbb_years_in_business', 'bbb_url'),
            'classes': ('collapse',)
        }),
        ('License', {
            'fields': ('license_number', 'license_status', 'license_type'),
            'classes': ('collapse',)
        }),
        ('Trust Scores', {
            'fields': ('trust_score', 'passes_threshold', 'verification_score', 'reputation_score', 'credibility_score', 'red_flag_score', 'bonus_score')
        }),
        ('Admin Override', {
            'fields': ('admin_score_override', 'admin_override_reason'),
            'classes': ('collapse',)
        }),
        ('AI Analysis', {
            'fields': ('ai_summary', 'ai_sentiment_score', 'ai_red_flags'),
            'classes': ('collapse',)
        }),
        ('Status', {
            'fields': ('is_claimed', 'claimed_by', 'is_active')
        }),
        ('Timestamps', {
            'fields': ('first_scraped_at', 'last_enriched_at', 'last_audited_at'),
            'classes': ('collapse',)
        }),
    )


class RedFlagInline(admin.TabularInline):
    model = RedFlag
    extra = 0
    fields = ['severity', 'category', 'description', 'source']


class AuditTimelineInline(admin.TabularInline):
    model = AuditTimeline
    extra = 0
    fields = ['date', 'event', 'significance', 'source']


@admin.register(ContractorAudit)
class ContractorAuditAdmin(admin.ModelAdmin):
    list_display = ['contractor', 'audit_date', 'trust_score', 'risk_level', 'recommendation', 'data_confidence']
    list_filter = ['risk_level', 'recommendation', 'data_confidence', 'audit_date']
    search_fields = ['contractor__business_name']
    readonly_fields = ['audit_date']
    inlines = [RedFlagInline, AuditTimelineInline]

    fieldsets = (
        ('Overview', {
            'fields': ('contractor', 'audit_date', 'trust_score', 'risk_level', 'recommendation')
        }),
        ('Component Scores', {
            'fields': ('verification_score', 'reputation_score', 'credibility_score', 'financial_score', 'red_flag_score')
        }),
        ('Calculation Metadata', {
            'fields': ('base_score', 'normalized_score', 'multiplier_applied', 'multiplier_reason'),
            'classes': ('collapse',)
        }),
        ('Narrative', {
            'fields': ('narrative_summary', 'homeowner_guidance')
        }),
        ('Data Quality', {
            'fields': ('data_confidence', 'sources_used', 'data_gaps'),
            'classes': ('collapse',)
        }),
        ('Raw Data', {
            'fields': ('perplexity_data', 'synthesis_data'),
            'classes': ('collapse',)
        }),
        ('Legacy Fields', {
            'fields': ('total_score', 'sentiment_score', 'ai_summary', 'score_breakdown'),
            'classes': ('collapse',)
        }),
    )


@admin.register(RedFlag)
class RedFlagAdmin(admin.ModelAdmin):
    list_display = ['audit', 'severity', 'category', 'description_short']
    list_filter = ['severity', 'category']
    search_fields = ['description', 'evidence', 'audit__contractor__business_name']

    def description_short(self, obj):
        return obj.description[:60] + '...' if len(obj.description) > 60 else obj.description
    description_short.short_description = 'Description'


@admin.register(AuditTimeline)
class AuditTimelineAdmin(admin.ModelAdmin):
    list_display = ['audit', 'date', 'event_short', 'source']
    list_filter = ['date']
    search_fields = ['event', 'audit__contractor__business_name']

    def event_short(self, obj):
        return obj.event[:60] + '...' if len(obj.event) > 60 else obj.event
    event_short.short_description = 'Event'
