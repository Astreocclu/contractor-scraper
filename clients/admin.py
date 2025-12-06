from django.contrib import admin
from .models import Permit, Property, Lead, ScraperRun, NeighborhoodMedian


@admin.register(Permit)
class PermitAdmin(admin.ModelAdmin):
    list_display = ['permit_id', 'city', 'property_address', 'permit_type', 'issued_date', 'lead_type']
    list_filter = ['city', 'permit_type', 'lead_type', 'issued_date']
    search_fields = ['permit_id', 'property_address', 'description']
    date_hierarchy = 'issued_date'


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ['property_address', 'county', 'owner_name', 'market_value', 'is_absentee', 'enrichment_status']
    list_filter = ['county', 'enrichment_status', 'is_absentee', 'homestead_exempt']
    search_fields = ['property_address', 'owner_name', 'cad_account_id']


@admin.register(Lead)
class LeadAdmin(admin.ModelAdmin):
    list_display = ['lead_id', 'lead_type', 'tier', 'score', 'freshness_tier', 'status', 'created_at']
    list_filter = ['tier', 'lead_type', 'freshness_tier', 'status', 'is_high_contrast', 'is_absentee']
    search_fields = ['lead_id', 'property__property_address']
    ordering = ['-score']
    actions = ['mark_exported', 'mark_contacted']

    @admin.action(description='Mark selected leads as exported')
    def mark_exported(self, request, queryset):
        queryset.update(status='exported')

    @admin.action(description='Mark selected leads as contacted')
    def mark_contacted(self, request, queryset):
        queryset.update(status='contacted')


@admin.register(ScraperRun)
class ScraperRunAdmin(admin.ModelAdmin):
    list_display = ['city', 'started_at', 'completed_at', 'status', 'permits_found']
    list_filter = ['city', 'status']
    ordering = ['-started_at']


@admin.register(NeighborhoodMedian)
class NeighborhoodMedianAdmin(admin.ModelAdmin):
    list_display = ['neighborhood_code', 'county', 'median_value', 'property_count', 'calculated_at']
    list_filter = ['county']
    search_fields = ['neighborhood_code']
