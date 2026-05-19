import platform
import subprocess
import time

def ping_host(host, timeout_ms=2000, retries=2):
    """
    Pings a host and returns True if reachable (online), False otherwise (offline).
    Automatically adjusts arguments based on whether it runs on Windows or Linux.
    Includes a retry mechanism to handle intermittent packet drops or VPN hiccups.
    """
    is_windows = platform.system().lower() == 'windows'
    
    # -n 1 (Windows) / -c 1 (Linux/macOS) sends exactly 1 packet per attempt
    count_param = '-n' if is_windows else '-c'
    
    # -w (Windows, in milliseconds) / -W (Linux/macOS, in seconds)
    timeout_param = '-w' if is_windows else '-W'
    timeout_value = str(timeout_ms) if is_windows else str(max(1, timeout_ms // 1000))
    
    # Envia 2 pacotes para evitar que avisos de roteamento (como ICMP Redirect Host)
    # matem o processo antes de receber a resposta da rádio.
    command = ['ping', count_param, '2', timeout_param, timeout_value, host]
    
    for attempt in range(retries):
        try:
            # Run standard system ping command, keeping it silent
            result = subprocess.run(
                command,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=(timeout_ms / 1000.0) + 1.0  # Buffer timeout to prevent hung processes
            )
            
            # If ping is successful, return True immediately
            if result.returncode == 0:
                return True
                
        except OSError as e:
            # Captura se o comando 'ping' não existir no container (ex: FileNotFoundError)
            print(f"[ERRO DE REDE] O comando 'ping' não está instalado ou falhou: {str(e)}")
            return False
        except (subprocess.SubprocessError, subprocess.TimeoutExpired):
            pass
            
        # If it failed and we have more retries, wait briefly before trying again
        if attempt < retries - 1:
            time.sleep(0.5)
            
    # All retries exhausted
    return False
