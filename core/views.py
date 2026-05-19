from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from concurrent.futures import ThreadPoolExecutor
from .ping_utils import ping_host
from .models import MachineHeartbeat
import json
import time

# Pre-defined list of the 14 radio Linux machines with VPN IPs and groups.
RADIO_STATIONS = [
    {"id": "cb_lavador", "name": "atv.radiocb.lavador", "ip": "10.100.230.230", "group": "CB", "label": "Lavador"},
    {"id": "cb_almoxarifado", "name": "atv.radiocb.almoxarifado", "ip": "10.100.230.231", "group": "CB", "label": "Almoxarifado"},
    
    {"id": "ub_lavador", "name": "atv.radioub.lavador", "ip": "10.100.230.232", "group": "UB", "label": "Lavador"},
    {"id": "ub_almoxarifado", "name": "atv.radioub.almoxarifado", "ip": "10.100.230.233", "group": "UB", "label": "Almoxarifado"},
    
    {"id": "lm_lavador", "name": "atv.radiolm.lavador", "ip": "10.100.230.234", "group": "LM", "label": "Lavador"},
    {"id": "lm_almoxarifado", "name": "atv.radiolm.almoxarifado", "ip": "10.100.230.235", "group": "LM", "label": "Almoxarifado"},
    
    {"id": "cg_lavador", "name": "atv.radiocg.lavador", "ip": "10.100.230.236", "group": "CG", "label": "Lavador"},
    {"id": "cg_almoxarifado", "name": "atv.radiocg.almoxarifado", "ip": "10.100.230.237", "group": "CG", "label": "Almoxarifado"},
    
    {"id": "ar_lavador", "name": "atv.radioar.lavador", "ip": "10.100.230.238", "group": "AR", "label": "Lavador"},
    {"id": "ar_almoxarifado", "name": "atv.radioar.almoxarifado", "ip": "10.100.230.239", "group": "AR", "label": "Almoxarifado"},
    
    {"id": "ld_lavador", "name": "atv.radiold.lavador", "ip": "10.100.230.240", "group": "LD", "label": "Lavador"},
    {"id": "ld_almoxarifado", "name": "atv.radiold.almoxarifado", "ip": "10.100.230.241", "group": "LD", "label": "Almoxarifado"},
    
    {"id": "rp_lavador", "name": "atv.radiorp.lavador", "ip": "10.100.230.242", "group": "RP", "label": "Lavador"},
    {"id": "rp_almoxarifado", "name": "atv.radiorp.almoxarifado", "ip": "10.100.230.243", "group": "RP", "label": "Almoxarifado"},
]

def dashboard(request):
    """
    Renders the beautiful glassmorphic home page containing the radio stations layout.
    """
    # Group the radios to allow structured cards by site/branch on the initial load.
    grouped_stations = {}
    for station in RADIO_STATIONS:
        group = station['group']
        if group not in grouped_stations:
            grouped_stations[group] = []
        grouped_stations[group].append(station)
        
    context = {
        'grouped_stations': grouped_stations,
        'all_stations': RADIO_STATIONS,
    }
    return render(request, 'core/dashboard.html', context)

@csrf_exempt
def receive_heartbeat(request):
    """
    HTTP API endpoint for the Linux client machines to report their Firefox and Audio status.
    Expected JSON: { "ip": "10.100.230.230", "firefox": "running|closed", "audio": "playing|silent", "hostname": "..." }
    """
    if request.method != 'POST':
        return JsonResponse({"error": "Method not allowed"}, status=405)
        
    try:
        data = json.loads(request.body)
        
        # 1. FAIL-SAFE: Auto-resolve the client IP from the network TCP socket first
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        remote_ip = x_forwarded_for.split(',')[0].strip() if x_forwarded_for else request.META.get('REMOTE_ADDR')
        
        payload_ip = data.get('ip')
        
        # Determine the definitive IP to register (prefer VPN IP range)
        final_ip = payload_ip
        if remote_ip and (remote_ip.startswith("10.100.") or not payload_ip):
            final_ip = remote_ip
            
        if not final_ip:
            print("[DEBUG] Falha no Heartbeat: IP não identificado.")
            return JsonResponse({"error": "IP parameter is required and could not be determined"}, status=400)
            
        firefox = data.get('firefox', 'unknown')
        audio = data.get('audio', 'unknown')
        hostname = data.get('hostname', '')
        
        # Print diagnostic logs straight to the Django server console so the admin sees it
        print(f"\n[HTTP HEARTBEAT] Recebido de {final_ip} ({hostname or 'sem-nome'})")
        print(f" -> Firefox: {firefox} | Áudio: {audio}")
        
        # Create or update reported status
        heartbeat, created = MachineHeartbeat.objects.get_or_create(ip=final_ip)
        heartbeat.firefox_status = firefox
        
        # Sistema de Debounce de Silêncio (Tolerância de 4 requisições no Servidor)
        if audio == 'silent':
            # Incrementa o contador de silêncios consecutivos
            heartbeat.silent_streak += 1
        elif audio == 'playing':
            # Se voltou a tocar, zera o contador imediatamente
            heartbeat.silent_streak = 0
            
        # Determina o status final do áudio que será exibido no monitor web
        if audio == 'silent':
            if heartbeat.silent_streak >= 4:
                heartbeat.audio_status = 'silent'
            else:
                heartbeat.audio_status = 'playing'  # Mascarado como tocando até dar 4 tentativas
        elif audio == 'playing':
            heartbeat.audio_status = 'playing'
        else:
            heartbeat.audio_status = audio  # Fallback para unknown ou outro valor
            
        if hostname:
            heartbeat.hostname = hostname
        heartbeat.last_seen = timezone.now()
        heartbeat.save()
        
        # Log verboso no console do servidor para acompanhamento do admin
        streak_info = f" (Silêncios Consecutivos: {heartbeat.silent_streak}/4)" if audio == 'silent' else ""
        print(f" -> Firefox: {firefox} | Áudio Exibido: {heartbeat.audio_status} (Reportado: {audio}){streak_info}")
        
        return JsonResponse({"status": "success", "message": "Heartbeat registered successfully."})
    except json.JSONDecodeError:
        print("[DEBUG] Falha no Heartbeat: JSON inválido recebido.")
        return JsonResponse({"error": "Invalid JSON format"}, status=400)
    except Exception as e:
        print(f"\n[ERRO GRAVE NO HEARTBEAT] Detalhes: {str(e)}")
        print(" -> DICA: Certifique-se de que rodou os comandos: python manage.py makemigrations core && python manage.py migrate\n")
        return JsonResponse({"error": str(e)}, status=500)

def check_statuses_api(request):
    """
    Asynchronous status endpoint that runs pings in parallel.
    Cross-references each online ping with the database heartbeats to verify audio & browser state.
    """
    start_time = time.time()
    
    def check_single_station(station):
        # 1. First verify connection via ping
        is_online = ping_host(station['ip'])
        
        if not is_online:
            return {
                "id": station['id'],
                "name": station['name'],
                "ip": station['ip'],
                "group": station['group'],
                "label": station['label'],
                "status": "offline",
                "firefox": "unknown",
                "audio": "unknown",
                "details": "Fora do Ar (Sem conexão VPN / Ping falhou)"
            }
            
        # 2. Ping succeeded. Now look up reported local agent status (Firefox & Audio)
        try:
            heartbeat = MachineHeartbeat.objects.get(ip=station['ip'])
            
            # Check if reported data is stale
            if heartbeat.is_stale:
                return {
                    "id": station['id'],
                    "name": station['name'],
                    "ip": station['ip'],
                    "group": station['group'],
                    "label": station['label'],
                    "status": "warning",
                    "firefox": "unknown",
                    "audio": "unknown",
                    "details": f"Máquina Ligada, mas sem reporte de áudio/navegador há mais de 45 segundos. Último sinal: {heartbeat.last_seen.strftime('%H:%M:%S')}"
                }
            
            firefox = heartbeat.firefox_status
            audio = heartbeat.audio_status
            
            # If everything is running perfectly
            if firefox == 'running' and audio == 'playing':
                return {
                    "id": station['id'],
                    "name": station['name'],
                    "ip": station['ip'],
                    "group": station['group'],
                    "label": station['label'],
                    "status": "online",
                    "firefox": firefox,
                    "audio": audio,
                    "details": "Tudo OK (Navegador aberto e áudio ativo tocando na rádio)"
                }
            else:
                # Host is up, but has an issue
                issues = []
                if firefox != 'running':
                    issues.append("Navegador Firefox fechado")
                if audio != 'playing':
                    issues.append("Sem sinal de áudio saindo (rádio muda)")
                    
                return {
                    "id": station['id'],
                    "name": station['name'],
                    "ip": station['ip'],
                    "group": station['group'],
                    "label": station['label'],
                    "status": "warning",
                    "firefox": firefox,
                    "audio": audio,
                    "details": "Atenção: " + ", ".join(issues)
                }
                
        except MachineHeartbeat.DoesNotExist:
            # Ping responded but the agent script hasn't reported anything yet
            return {
                "id": station['id'],
                "name": station['name'],
                "ip": station['ip'],
                "group": station['group'],
                "label": station['label'],
                "status": "warning",
                "firefox": "unknown",
                "audio": "unknown",
                "details": "Máquina Ligada, aguardando primeiro sinal do monitor de áudio"
            }

    # Ping the stations concurrently. Since we are running in Linux (Docker),
    # we can run all 14 pings fully in parallel without OS-level limitations.
    with ThreadPoolExecutor(max_workers=len(RADIO_STATIONS)) as executor:
        results = list(executor.map(check_single_station, RADIO_STATIONS))
        
    execution_duration = time.time() - start_time
    
    return JsonResponse({
        "stations": results,
        "execution_time_seconds": round(execution_duration, 2),
        "timestamp": time.strftime("%H:%M:%S")
    })
