from rest_framework import serializers
from .models import Vertical, Contractor


class VerticalSerializer(serializers.ModelSerializer):
    class Meta:
        model = Vertical
        fields = ['id', 'name', 'slug', 'description', 'avg_job_value']


class ContractorListSerializer(serializers.ModelSerializer):
    verticals = serializers.SlugRelatedField(many=True, read_only=True, slug_field='slug')
    pass_status = serializers.CharField(read_only=True)

    class Meta:
        model = Contractor
        fields = [
            'id', 'slug', 'business_name', 'city', 'state',
            'phone', 'website', 'verticals',
            'trust_score', 'passes_threshold', 'pass_status',
            'google_rating', 'google_review_count',
        ]


class ContractorDetailSerializer(serializers.ModelSerializer):
    verticals = VerticalSerializer(many=True, read_only=True)
    pass_status = serializers.CharField(read_only=True)

    class Meta:
        model = Contractor
        fields = '__all__'
