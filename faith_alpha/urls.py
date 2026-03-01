from django.urls import include, path
from rest_framework.routers import DefaultRouter

from faith_alpha.views import CompanyFaithViewSet

router = DefaultRouter()
router.register('companies', CompanyFaithViewSet, basename='faith-company')

urlpatterns = [
    path('', include(router.urls)),
]
