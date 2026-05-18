#!/bin/bash
# ==========================================================================
# AGENTE DE MONITORAMENTO - RÁDIO ATIVA CLIENTE LINUX
# Instale este script nas 13 máquinas Linux executando as rádios.
# ==========================================================================

# --- CONFIGURAÇÃO ---
# Subescreva com o endereço IP ou DNS do seu servidor Django
SERVIDOR_URL="http://10.100.230.100:8000/api/heartbeat/"
# Intervalo de envio em segundos
INTERVALO=15

echo "Iniciando agente de monitoramento da Rádio Ativa..."
echo "Servidor de Destino: $SERVIDOR_URL"

while true; do
    # 1. Obter o IP principal da máquina Linux na VPN/Rede
    # Tenta obter o IP primário do dispositivo de rede ativo
    IP_CLIENTE=$(hostname -I | awk '{print $1}')
    
    # Caso hostname -I falhe (comum em algumas distros mínimas), tenta via ip route
    if [ -z "$IP_CLIENTE" ]; then
        IP_CLIENTE=$(ip route get 1 | awk '{print $(NF-2);exit}')
    fi

    # 2. Verificar se o Navegador Firefox está aberto
    FIREFOX_STATUS="closed"
    if pgrep -x "firefox" > /dev/null || pgrep -f "firefox" > /dev/null; then
        FIREFOX_STATUS="running"
    fi

    # 3. Verificar se há áudio ativo saindo dos alto-falantes
    AUDIO_STATUS="silent"
    UNIQUE_VALUES=0
    
    # Se rodar como root (sudo ou cron), o PulseAudio bloqueia o acesso ao som.
    # Precisamos descobrir qual usuário da interface gráfica está rodando o Firefox e usar a sessão dele!
    PA_CMD=""
    if [ "$(id -u)" -eq 0 ]; then
        FF_USER=$(ps -C firefox -o user= | head -n 1 | tr -d ' ' | tr -d '\n')
        if [ -n "$FF_USER" ] && [ "$FF_USER" != "root" ]; then
            FF_UID=$(id -u "$FF_USER")
            # O parâmetro -H é vital para o PulseAudio conseguir ler o arquivo de autenticação na pasta Home do usuário!
            PA_CMD="sudo -H -u $FF_USER env XDG_RUNTIME_DIR=/run/user/$FF_UID "
        fi
    fi
    
    # Tentativa A: Medidor de Onda Sonora Real (Fidelidade Suprema - Detector de Silêncio Real)
    MONITOR_SOURCE=""
    if command -v parec >/dev/null 2>&1 && command -v pactl >/dev/null 2>&1; then
        # Obter o dispositivo de monitor de forma ultra-robusta e universal
        MONITOR_SOURCE=$(eval "$PA_CMD" pactl list short sources 2>/dev/null | grep "\.monitor" | awk '{print $2}' | head -n 1)
        
        if [ -n "$MONITOR_SOURCE" ]; then
            # O Segredo do Buffer: Ao invez de 'timeout', usamos uma taxa altíssima (44100Hz)
            # Isso enche o buffer de 4KB em 0.09s. O 'dd' lê esse bloco e fecha o cano,
            # matando o parec instantaneamente e garantindo que os dados sejam salvos!
            eval "$PA_CMD" parec -d "$MONITOR_SOURCE" --channels=1 --format=u8 --rate=44100 2>/dev/null | dd bs=4096 count=1 2>/dev/null > /tmp/audio_test.raw
            
            # Converte em decimais e conta quantos valores únicos de amplitude existem
            if [ -f /tmp/audio_test.raw ]; then
                UNIQUE_VALUES=$(od -An -v -tu1 /tmp/audio_test.raw 2>/dev/null | tr -d ' ' | sort -u | wc -l)
                rm -f /tmp/audio_test.raw
            fi
            
            # Filtro de Ruído de Fundo (Noise Floor)
            # Silêncio perfeito = 1 valor. Ruído elétrico/chiado = 5 a 20 valores.
            # Música tocando de verdade = 100 a 256 valores.
            # Se registrar mais de 30 valores únicos de oscilação, significa que há música/áudio tocando de verdade!
            if [ "$UNIQUE_VALUES" -gt 30 ]; then
                AUDIO_STATUS="playing"
            fi
        fi
    fi
    
    # Tentativa B: Fallback robusto se a gravação de onda falhar ou o parec não existir (UNIQUE_VALUES é 0)
    if [ "$UNIQUE_VALUES" -eq 0 ]; then
        # Tenta com pactl list sink-inputs. Se falhar ou não achar RUNNING, tenta no Kernel/ALSA!
        if command -v pactl >/dev/null 2>&1 && eval "$PA_CMD" pactl list sink-inputs 2>/dev/null | grep -q "state: RUNNING"; then
            AUDIO_STATUS="playing"
        elif grep -q "RUNNING" /proc/asound/card*/pcm*/sub*/status 2>/dev/null; then
            AUDIO_STATUS="playing"
        fi
    fi

    # Obter hostname para complementar os logs no Django
    HOST_NAME=$(hostname)

    # 4. Enviar os dados via POST JSON silencioso para o Django
    # Timeout de 5s para evitar que o script trave se a VPN cair temporariamente
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 \
        -X POST \
        -H "Content-Type: application/json" \
        -d "{\"ip\": \"$IP_CLIENTE\", \"firefox\": \"$FIREFOX_STATUS\", \"audio\": \"$AUDIO_STATUS\", \"hostname\": \"$HOST_NAME\"}" \
        "$SERVIDOR_URL")

    # Log local para debug
    TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
    if [ "$RESPONSE" -eq 200 ]; then
        echo "[$TIMESTAMP] Status enviado! IP: $IP_CLIENTE | Firefox: $FIREFOX_STATUS | Áudio: $AUDIO_STATUS (Oscilações: $UNIQUE_VALUES, M: ${MONITOR_SOURCE:-Nenhum})"
    else
        echo "[$TIMESTAMP] Falha ao enviar para o servidor. Erro HTTP: $RESPONSE"
    fi

    # Aguardar até o próximo ciclo
    sleep "$INTERVALO"
done
