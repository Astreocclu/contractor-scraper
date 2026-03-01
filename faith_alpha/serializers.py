from rest_framework import serializers

from faith_alpha.models import Company, CompanyFiling, CompanySignal, FaithScreen
from faith_alpha.services.scoring import compute_faith_alignment, parse_profile_overrides_from_query


class CompanyFilingSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyFiling
        fields = ['id', 'form_type', 'filing_date', 'source_url', 'primary_document', 'fetched_at']


class CompanySignalSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanySignal
        fields = [
            'id',
            'source',
            'signal_type',
            'title',
            'amount_usd',
            'cycle_or_year',
            'evidence_text',
            'retrieved_at',
        ]


class FaithScreenSerializer(serializers.ModelSerializer):
    scenario = serializers.SerializerMethodField()

    class Meta:
        model = FaithScreen
        fields = [
            'alignment_score',
            'base_score',
            'confidence_score',
            'pipeline_version',
            'llm_provider',
            'llm_model',
            'summary',
            'base_findings',
            'category_details',
            'scenario',
            'computed_at',
        ]

    def get_scenario(self, obj):
        request = self.context.get('request')
        if request is None:
            return None

        profile = request.query_params.get('profile', 'consensus')
        overrides = parse_profile_overrides_from_query(request.query_params)
        if profile == 'consensus' and not overrides:
            return None

        categories = obj.raw_classification.get('categories', {}) if obj.raw_classification else {}
        if not categories:
            return None

        scenario = compute_faith_alignment(
            category_findings=categories,
            profile_name=profile,
            profile_overrides=overrides,
        )

        return {
            'profile': profile,
            'overrides': overrides,
            'alignment_score': scenario.alignment_score,
            'base_score': scenario.base_score,
            'confidence_score': scenario.confidence_score,
            'deductions': scenario.deductions,
        }


class CompanyListSerializer(serializers.ModelSerializer):
    faith_screen = FaithScreenSerializer(read_only=True)

    class Meta:
        model = Company
        fields = [
            'id',
            'ticker',
            'name',
            'exchange',
            'sector',
            'industry',
            'sic_code',
            'sic_description',
            'market_cap_rank',
            'faith_screen',
        ]


class CompanyDetailSerializer(CompanyListSerializer):
    filings = CompanyFilingSerializer(many=True, read_only=True)
    signals = CompanySignalSerializer(many=True, read_only=True)

    class Meta(CompanyListSerializer.Meta):
        fields = CompanyListSerializer.Meta.fields + ['cik', 'source_metadata', 'filings', 'signals', 'updated_at']
