from django.db.models import Count, Avg, Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Permit, Property, Lead, ScraperRun
from .serializers import (
    PermitSerializer, PropertySerializer, LeadSerializer,
    LeadDetailSerializer, ScraperRunSerializer, LeadStatsSerializer
)


class PermitViewSet(viewsets.ReadOnlyModelViewSet):
    """API endpoint for viewing permits."""
    queryset = Permit.objects.all().order_by('-issued_date')
    serializer_class = PermitSerializer
    filterset_fields = ['city', 'permit_type', 'lead_type']
    search_fields = ['permit_id', 'property_address', 'description']


class PropertyViewSet(viewsets.ReadOnlyModelViewSet):
    """API endpoint for viewing properties."""
    queryset = Property.objects.all()
    serializer_class = PropertySerializer
    filterset_fields = ['county', 'enrichment_status', 'is_absentee']
    search_fields = ['property_address', 'owner_name']


class LeadViewSet(viewsets.ReadOnlyModelViewSet):
    """API endpoint for viewing leads."""
    queryset = Lead.objects.select_related('property').all()
    serializer_class = LeadSerializer
    filterset_fields = ['tier', 'lead_type', 'freshness_tier', 'status', 'is_absentee', 'is_high_contrast']
    search_fields = ['lead_id', 'property__property_address']

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return LeadDetailSerializer
        return LeadSerializer

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Get aggregate statistics for leads."""
        leads = Lead.objects.filter(status='new')

        stats = {
            'total_leads': leads.count(),
            'tier_a': leads.filter(tier='A').count(),
            'tier_b': leads.filter(tier='B').count(),
            'tier_c': leads.filter(tier='C').count(),
            'tier_d': leads.filter(tier='D').count(),
            'high_contrast': leads.filter(is_high_contrast=True).count(),
            'absentee': leads.filter(is_absentee=True).count(),
            'hot_leads': leads.filter(freshness_tier='hot').count(),
            'avg_score': leads.aggregate(avg=Avg('score'))['avg'] or 0,
        }

        serializer = LeadStatsSerializer(stats)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def top(self, request):
        """Get top 10 leads by score."""
        leads = Lead.objects.filter(status='new').order_by('-score')[:10]
        serializer = LeadSerializer(leads, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def by_tier(self, request):
        """Get leads grouped by tier."""
        tier = request.query_params.get('tier', 'A')
        leads = Lead.objects.filter(tier=tier, status='new').order_by('-score')[:50]
        serializer = LeadSerializer(leads, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def mark_exported(self, request, pk=None):
        """Mark a lead as exported."""
        lead = self.get_object()
        lead.status = 'exported'
        lead.save()
        return Response({'status': 'exported'})

    @action(detail=True, methods=['post'])
    def mark_contacted(self, request, pk=None):
        """Mark a lead as contacted."""
        lead = self.get_object()
        lead.status = 'contacted'
        lead.save()
        return Response({'status': 'contacted'})


class ScraperRunViewSet(viewsets.ReadOnlyModelViewSet):
    """API endpoint for viewing scraper runs."""
    queryset = ScraperRun.objects.all().order_by('-started_at')
    serializer_class = ScraperRunSerializer
    filterset_fields = ['city', 'status']
