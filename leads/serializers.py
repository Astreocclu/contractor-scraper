from rest_framework import serializers
from .models import Permit, Property, Lead, ScraperRun


class PermitSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permit
        fields = [
            'id', 'permit_id', 'city', 'city_name', 'property_address',
            'permit_type', 'description', 'status', 'issued_date',
            'applicant_name', 'contractor_name', 'estimated_value',
            'lead_type', 'categorization_confidence', 'scraped_at'
        ]


class PropertySerializer(serializers.ModelSerializer):
    class Meta:
        model = Property
        fields = [
            'property_address', 'county', 'cad_account_id',
            'owner_name', 'mailing_address', 'market_value',
            'year_built', 'square_feet', 'lot_size',
            'is_absentee', 'homestead_exempt', 'enrichment_status'
        ]


class LeadSerializer(serializers.ModelSerializer):
    property_address = serializers.CharField(source='property.property_address', read_only=True)
    owner_name = serializers.CharField(source='property.owner_name', read_only=True)
    market_value = serializers.DecimalField(
        source='property.market_value', max_digits=14, decimal_places=2, read_only=True
    )
    county = serializers.CharField(source='property.county', read_only=True)

    class Meta:
        model = Lead
        fields = [
            'lead_id', 'property_address', 'lead_type', 'tier', 'score',
            'freshness_tier', 'days_since_permit', 'permit_date',
            'is_high_contrast', 'contrast_ratio', 'is_absentee',
            'owner_name', 'market_value', 'county',
            'status', 'created_at', 'updated_at', 'score_breakdown'
        ]


class LeadDetailSerializer(LeadSerializer):
    property = PropertySerializer(read_only=True)

    class Meta(LeadSerializer.Meta):
        fields = LeadSerializer.Meta.fields + ['property']


class ScraperRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScraperRun
        fields = [
            'id', 'city', 'started_at', 'completed_at',
            'status', 'permits_found', 'errors'
        ]


class LeadStatsSerializer(serializers.Serializer):
    total_leads = serializers.IntegerField()
    tier_a = serializers.IntegerField()
    tier_b = serializers.IntegerField()
    tier_c = serializers.IntegerField()
    tier_d = serializers.IntegerField()
    high_contrast = serializers.IntegerField()
    absentee = serializers.IntegerField()
    hot_leads = serializers.IntegerField()
    avg_score = serializers.FloatField()
