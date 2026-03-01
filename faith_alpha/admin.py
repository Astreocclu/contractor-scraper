from django.contrib import admin

from faith_alpha.models import Company, CompanyFiling, CompanySignal, FaithScreen


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ('ticker', 'name', 'exchange', 'market_cap_rank', 'updated_at')
    search_fields = ('ticker', 'name')
    list_filter = ('exchange',)


@admin.register(CompanyFiling)
class CompanyFilingAdmin(admin.ModelAdmin):
    list_display = ('company', 'form_type', 'filing_date', 'fetched_at')
    search_fields = ('company__ticker', 'company__name', 'accession_number')
    list_filter = ('form_type',)


@admin.register(FaithScreen)
class FaithScreenAdmin(admin.ModelAdmin):
    list_display = ('company', 'alignment_score', 'base_score', 'confidence_score', 'computed_at')
    search_fields = ('company__ticker', 'company__name')
    list_filter = ('pipeline_version',)


@admin.register(CompanySignal)
class CompanySignalAdmin(admin.ModelAdmin):
    list_display = ('company', 'source', 'signal_type', 'cycle_or_year', 'amount_usd', 'retrieved_at')
    search_fields = ('company__ticker', 'company__name', 'title', 'external_id')
    list_filter = ('source', 'signal_type')
