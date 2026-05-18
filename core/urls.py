from django.urls import path
from . import views

urlpatterns = [
    path('', views.dashboard, name='dashboard'),
    path('api/status/', views.check_statuses_api, name='status_api'),
    path('api/heartbeat/', views.receive_heartbeat, name='receive_heartbeat'),
]
