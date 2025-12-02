from django.contrib import admin
from .models import Vertical, Contractor, ContractorAudit


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


@admin.register(ContractorAudit)
class ContractorAuditAdmin(admin.ModelAdmin):
    list_display = ['contractor', 'audit_date', 'total_score']
    list_filter = ['audit_date']
    search_fields = ['contractor__business_name']
