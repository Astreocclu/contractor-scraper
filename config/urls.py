from django.contrib import admin
from django.urls import path, include
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from django.contrib.auth.models import User
from rest_framework import status

@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    """Simple registration endpoint"""
    email = request.data.get('email')
    password = request.data.get('password')
    name = request.data.get('name', '')

    if not email or not password:
        return Response({'error': 'Email and password required'}, status=status.HTTP_400_BAD_REQUEST)

    if User.objects.filter(email=email).exists():
        return Response({'error': 'Email already registered'}, status=status.HTTP_400_BAD_REQUEST)

    user = User.objects.create_user(
        username=email,
        email=email,
        password=password,
        first_name=name.split()[0] if name else '',
        last_name=' '.join(name.split()[1:]) if name and len(name.split()) > 1 else ''
    )
    return Response({'message': 'User created', 'email': email}, status=status.HTTP_201_CREATED)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    """Get current user info"""
    user = request.user
    return Response({
        'id': user.id,
        'email': user.email,
        'name': f"{user.first_name} {user.last_name}".strip() or user.username,
        'is_staff': user.is_staff,
    })

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('contractors.urls')),
    path('api/clients/', include('clients.urls')),
    # Auth endpoints
    path('api/auth/login/', TokenObtainPairView.as_view(), name='token_obtain'),
    path('api/auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/register/', register, name='register'),
    path('api/auth/me/', me, name='me'),
]
