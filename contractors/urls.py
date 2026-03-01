from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import VerticalViewSet, ContractorViewSet, CommandRunnerView, LeaderboardView

router = DefaultRouter()
router.register('verticals', VerticalViewSet, basename='vertical')
router.register('contractors', ContractorViewSet, basename='contractor')

urlpatterns = [
    path('contractors/leaderboard', LeaderboardView.as_view(), name='contractor-leaderboard'),
    path('contractors/leaderboard/', LeaderboardView.as_view(), name='contractor-leaderboard-slash'),
    path('', include(router.urls)),
    path('commands/', CommandRunnerView.as_view(), name='commands'),
]
