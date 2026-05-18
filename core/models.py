from django.db import models
from django.utils import timezone

class MachineHeartbeat(models.Model):
    """
    Stores the status reported directly by each Linux client machine.
    """
    ip = models.GenericIPAddressField(unique=True)
    hostname = models.CharField(max_length=150, blank=True, null=True)
    firefox_status = models.CharField(
        max_length=20, 
        choices=[('running', 'Executando'), ('closed', 'Fechado'), ('unknown', 'Desconhecido')],
        default='unknown'
    )
    audio_status = models.CharField(
        max_length=20, 
        choices=[('playing', 'Tocando'), ('silent', 'Sem Áudio'), ('unknown', 'Desconhecido')],
        default='unknown'
    )
    silent_streak = models.IntegerField(default=0)
    last_seen = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.ip} - Firefox: {self.firefox_status} | Áudio: {self.audio_status}"

    @property
    def is_stale(self):
        """
        Consider the heartbeat stale if we haven't heard from the client in over 45 seconds.
        """
        return (timezone.now() - self.last_seen).total_seconds() > 45
