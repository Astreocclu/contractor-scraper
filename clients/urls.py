from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import PermitViewSet, PropertyViewSet, LeadViewSet, ScraperRunViewSet

router = DefaultRouter()
router.register(r'permits', PermitViewSet)
router.register(r'properties', PropertyViewSet)
router.register(r'', LeadViewSet, basename='client')  # /api/clients/ for client list
router.register(r'scraper-runs', ScraperRunViewSet)

urlpatterns = [
    path('', include(router.urls)),
]
