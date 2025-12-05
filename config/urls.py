from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('contractors.urls')),
    path('api/leads/', include('leads.urls')),
]
