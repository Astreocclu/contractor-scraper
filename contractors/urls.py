from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import VerticalViewSet, ContractorViewSet, CommandRunnerView, ScrapePermitView

router = DefaultRouter()
router.register('verticals', VerticalViewSet, basename='vertical')
router.register('contractors', ContractorViewSet, basename='contractor')

urlpatterns = [
    path('', include(router.urls)),
    path('commands/', CommandRunnerView.as_view(), name='commands'),
    path('permits/scrape/', ScrapePermitView.as_view(), name='scrape_permit'),
]
