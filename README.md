# Monitor Rádio Ativa

Painel web que mostra, em tempo real, se as rádios internas das unidades da Ativa estão tocando.

Cada rádio é uma máquina Ubuntu ligada à VPN, com o Firefox aberto na transmissão. O painel acompanha 12 máquinas em 7 unidades e atualiza a cada 15 segundos.

**Neste guia:**

- [Como funciona](#como-funciona)
- [Subir o painel](#subir-o-painel)
- [Instalar uma nova rádio](#instalar-uma-nova-rádio)
- [Instalar o agente: `instalar_radio_agent.sh`](#instalar-o-agente-instalar_radio_agentsh)
- [Trocar a VPN: `trocar_vpn.sh`](#trocar-a-vpn-trocar_vpnsh)
- [Cadastrar ou alterar uma rádio no painel](#cadastrar-ou-alterar-uma-rádio-no-painel)
- [Problemas comuns](#problemas-comuns)

## Como funciona

O painel cruza duas informações sobre cada rádio:

```
 Máquina da rádio (Ubuntu)                     Servidor (Django + Docker)
┌───────────────────────────┐                 ┌──────────────────────────┐
│ radio_client_agent.sh     │  POST a cada    │ /api/heartbeat/          │
│ - Firefox está aberto?    │ ──── 15 s ────► │   grava o status no      │
│ - Está saindo áudio?      │     (VPN)       │   SQLite                 │
│                           │                 │                          │
│                           │ ◄─── ping ───── │ /api/status/             │
└───────────────────────────┘                 │   consultado pelo painel │
                                              └──────────────────────────┘
```

- **Ping:** o servidor testa se a máquina responde pela VPN.
- **Heartbeat:** o agente instalado na máquina informa o estado do Firefox e do áudio. Para detectar áudio, ele grava um trecho curto da saída de som e mede a variação do sinal, então uma transmissão muda é detectada mesmo com o Firefox aberto.

### O que cada status significa

| Status no painel | Significado | Por onde começar |
|---|---|---|
| **TOCANDO** | Firefox aberto e áudio saindo | Nada a fazer |
| **SEM ÁUDIO** | Firefox aberto, mas sem som há 4 envios seguidos (cerca de 1 minuto) | Transmissão, aba do navegador, saída de som |
| **SEM NAVEGADOR** | Saindo áudio, mas o Firefox não foi encontrado | Firefox na máquina |
| **SEM RÁDIO** | Firefox fechado e sem áudio, **ou** o agente não envia dados há mais de 45 s | Firefox e serviço do agente |
| **DESLIGADA** | A máquina não responde ao ping | Energia, rede, VPN |

### Estrutura do repositório

| Caminho | Conteúdo |
|---|---|
| `core/views.py` | Lista de rádios (`RADIO_STATIONS`) e endpoints do painel |
| `core/ping_utils.py` | Ping usado para testar as máquinas |
| `core/models.py` | Último status recebido de cada máquina |
| `core/templates/`, `core/static/` | Interface do painel |
| `radio_client_agent.sh` | Agente que roda em cada rádio |
| `Dockerfile`, `docker-compose.yml` | Execução do servidor |

Os scripts `instalar_radio_agent.sh` e `trocar_vpn.sh` não estão versionados neste repositório.

## Subir o painel

No servidor, que precisa ter rota para a VPN das rádios:

```bash
touch db.sqlite3          # só na primeira vez
docker compose up -d --build
```

O painel fica em `http://<ip-do-servidor>:8000/`.

> ⚠️ Crie o `db.sqlite3` antes do primeiro `up`. Sem o arquivo, o Docker cria uma **pasta** com esse nome e o banco não funciona.

O código é copiado para a imagem, então toda alteração exige repetir `docker compose up -d --build`.

Para ver os heartbeats chegando:

```bash
docker compose logs -f web
```

Para rodar localmente, em desenvolvimento:

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

## Instalar uma nova rádio

O processo replica a máquina piloto a partir da **imagem master**, usando o Rescuezilla, e depois ajusta a identidade de cada estação. Sistema: Ubuntu 24.04.3 LTS.

**Você vai precisar de:**

- Pen drive do Rescuezilla
- HD externo com a imagem master
- Acesso físico à máquina nas etapas 1 e 2
- Pasta da VPN da unidade e usuário e senha da VPN

### 1. Restaurar a imagem

> ⚠️ A restauração apaga todos os dados do disco interno.

1. Conecte o pen drive e o HD externo.
2. Ligue o PC e abra o menu de boot (`F12`, `F11` ou `F10`).
3. Selecione **Restore (Restaurar)**.
4. Escolha o HD externo e a pasta da imagem master.
5. Selecione o SSD/HD interno como destino e confirme.
6. Ao terminar, desligue a máquina e remova os dispositivos USB.

### 2. Configurar a BIOS/UEFI

A BIOS não é clonada, então este ajuste é feito em cada computador. Entre com `DEL` ou `F2` e procure as abas **Power Management** e **Advanced**.

| Habilitar | Desabilitar |
|---|---|
| `Wake-on-LAN` | `ErP Mode` |
| `Remote Wake Up` | `Deep Sleep` |
| `Power On by PCI-E` | `Eco Mode` |

Salve e saia com `F10`. Com *ErP* ou *Deep Sleep* ativos, o computador não acorda pela rede.

### 3. Individualizar a máquina

Defina o nome da máquina:

```bash
sudo hostnamectl set-hostname radio-unidade-XX
```

Gere um novo Machine-ID, executando os comandos nesta ordem:

```bash
sudo rm -f /etc/machine-id
sudo dbus-uuidgen --ensure=/etc/machine-id
sudo systemd-machine-id-setup
```

Abra o `/etc/hosts` e troque o nome antigo pelo novo hostname:

```bash
sudo nano /etc/hosts
```

### 4. Ativar o Wake-on-LAN

Veja o nome da conexão e da interface de rede, e o estado atual:

```bash
nmcli connection show
sudo ethtool <interface> | grep Wake
```

Se aparecer `Wake-on: d`, ative usando o nome de conexão mostrado pelo primeiro comando:

```bash
sudo nmcli c modify "Wired connection 1" 802-3-ethernet.wake-on-lan magic
sudo nmcli c up "Wired connection 1"
```

Repita o `ethtool`: o resultado esperado é `Wake-on: g`. Depois, teste de outra máquina na mesma rede, com a rádio desligada:

```bash
wakeonlan 00:11:22:33:44:55    # MAC da rádio
```

### 5. Configurar a VPN

Copie a pasta da VPN e crie o arquivo de credenciais:

```bash
sudo cp -r /home/ativa/Downloads/<PASTA_VPN> /etc/openvpn/client/
cd /etc/openvpn/client/
sudo nano pass.txt
```

No `pass.txt`, coloque o usuário na primeira linha e a senha na segunda. Depois proteja o arquivo:

```bash
sudo chmod 600 pass.txt
```

No arquivo `.ovpn`, ajuste estas linhas para caminhos absolutos:

```
auth-user-pass /etc/openvpn/client/pass.txt
pkcs12 /etc/openvpn/client/<PASTA_VPN>/<ARQUIVO_VPN>.p12
tls-auth /etc/openvpn/client/<PASTA_VPN>/<ARQUIVO_VPN>.key 1
```

Crie o serviço com `sudo nano /etc/systemd/system/openvpn-legacy.service`:

```ini
[Unit]
Description=OpenVPN Legacy Connection for Radio <UNIDADE>
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/sbin/openvpn --config /etc/openvpn/client/<PASTA_VPN>/<ARQUIVO_VPN>.ovpn --providers default legacy
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Ative o serviço:

```bash
sudo systemctl daemon-reload
sudo systemctl enable openvpn-legacy.service
sudo systemctl start openvpn-legacy.service
```

### 6. Configurar o HDMI virtual

Esta etapa cria um monitor virtual de 1920x1080. Instale o driver:

```bash
sudo apt install xserver-xorg-video-dummy
```

Crie o arquivo com `sudo nano /etc/X11/xorg.conf`:

```
Section "Device"
    Identifier  "Configured Video Device"
    Driver      "dummy"
EndSection

Section "Monitor"
    Identifier  "Configured Monitor"
    HorizSync   31.5-48.5
    VertRefresh 50-70
EndSection

Section "Screen"
    Identifier  "Default Screen"
    Monitor     "Configured Monitor"
    Device      "Configured Video Device"
    DefaultDepth 24
    SubSection "Display"
        Depth 24
        Modes "1920x1080"
    EndSubSection
EndSection
```

Desative o Wayland: em `sudo nano /etc/gdm3/custom.conf`, descomente a linha `WaylandEnable=false`. Reinicie a máquina para aplicar.

### 7. Instalar o agente

Siga a seção [Instalar o agente](#instalar-o-agente-instalar_radio_agentsh).

### 8. Cadastrar a rádio no painel

Siga a seção [Cadastrar ou alterar uma rádio no painel](#cadastrar-ou-alterar-uma-rádio-no-painel).

## Instalar o agente: `instalar_radio_agent.sh`

Este script transforma o `radio_client_agent.sh` em um serviço do sistema, que sobe no boot e reinicia se cair. Ele também aponta o agente para o servidor atual (`http://10.100.250.6:8000/api/heartbeat/`).

### Passo a passo

1. Copie os dois scripts para a máquina da rádio, por exemplo para a pasta do usuário.
2. Coloque o agente no lugar esperado e prepare o instalador:

   ```bash
   sudo cp radio_client_agent.sh /usr/local/bin/
   sed -i 's/\r$//' instalar_radio_agent.sh    # remove quebras de linha do Windows
   chmod +x instalar_radio_agent.sh
   ```

3. Execute a instalação:

   ```bash
   sudo ./instalar_radio_agent.sh
   ```

4. Confira o resultado: a saída deve trazer `OK: radio-client-agent está rodando` e `Servidor respondeu (HTTP 200)`.
5. Abra o painel e confirme o status da rádio. O teste do instalador envia um heartbeat vazio, então a rádio pode aparecer como **SEM RÁDIO** até o próximo envio do agente, em até 15 s.

### O que o script faz

- Corrige as quebras de linha do agente e dá permissão de execução.
- Troca o `SERVIDOR_URL` do agente, guardando um backup em `/usr/local/bin/radio_client_agent.sh.bak-<data>`.
- Encerra uma instância antiga do agente iniciada com `nohup`.
- Cria o serviço `radio-client-agent`, habilita no boot e reinicia.
- Testa se o servidor responde.

Pode ser executado de novo sem problema. Se o servidor mudar de endereço, altere a variável `SERVIDOR_NOVO` no início do script e execute novamente.

### Comandos

| Comando | O que faz |
|---|---|
| `sudo ./instalar_radio_agent.sh` | Instala e inicia o serviço |
| `sudo ./instalar_radio_agent.sh status` | Mostra se está rodando |
| `sudo ./instalar_radio_agent.sh reiniciar` | Reinicia o serviço |
| `sudo ./instalar_radio_agent.sh parar` | Para o serviço |
| `sudo ./instalar_radio_agent.sh log` | Mostra os erros em tempo real (`Ctrl+C` para sair) |

### Mensagens do instalador

| Mensagem | O que fazer |
|---|---|
| `ERRO: ... não existe` | Copie o agente para `/usr/local/bin/` (passo 2) |
| `O servidor ... não respondeu` | O serviço está ativo, mas sem rota até o servidor. Verifique a VPN |
| `parece usar 'nohup' ou '&'` | Remova o `nohup` ou `&` do agente: como serviço, ele precisa ficar em primeiro plano |
| `FALHOU` | Leia os erros exibidos logo abaixo da mensagem |

## Trocar a VPN: `trocar_vpn.sh`

Este script migra a máquina da VPN antiga (porta 1195) para a nova (porta 1194) sem risco de perder o acesso remoto. Se a VPN nova não conectar em 90 s, ou se a troca não for confirmada em 10 minutos, a máquina volta sozinha para a VPN antiga.

> Máquinas instaladas diretamente na VPN nova não precisam deste script.

### Antes de começar

- A pasta da VPN nova, com `UDP4-1194` no nome, deve estar extraída em `Downloads` ou em `/etc/openvpn/client/`.
- O arquivo `/etc/openvpn/client/pass.txt` deve existir.
- O serviço da VPN antiga precisa citar um caminho com `-1195-`. É assim que o script o encontra.
- Se o script veio do Windows, prepare-o:

  ```bash
  sed -i 's/\r$//' trocar_vpn.sh
  chmod +x trocar_vpn.sh
  ```

### Passo a passo

1. **Teste a VPN nova.** O teste não derruba a conexão atual e mostra o IP que a máquina vai receber:

   ```bash
   sudo ./trocar_vpn.sh testar
   ```

   Anote o IP. Se aparecer `FALHOU`, corrija o problema antes de continuar: a conexão atual não foi afetada.

2. **Inicie a troca.** A sua sessão vai cair neste momento:

   ```bash
   sudo ./trocar_vpn.sh trocar
   ```

3. **Reconecte.** Aguarde 1 a 2 minutos e conecte o RDP pelo **IP novo**.

4. **Confirme em até 10 minutos**, já conectado pela VPN nova:

   ```bash
   sudo ./trocar_vpn.sh confirmar
   ```

   A VPN nova passa a subir no boot. A antiga é desabilitada, mas os arquivos são mantidos.

5. **Atualize o painel.** Troque o IP da máquina em `core/views.py` e publique, conforme [Cadastrar ou alterar uma rádio no painel](#cadastrar-ou-alterar-uma-rádio-no-painel). Até lá, a rádio aparece como **DESLIGADA**.

**Se o IP novo não conectar:** aguarde o prazo terminar e reconecte pelo **IP antigo**.

### Comandos

| Comando | O que faz | Derruba a conexão? |
|---|---|---|
| `sudo ./trocar_vpn.sh preparar` | Copia e ajusta os arquivos da VPN nova. `testar` e `trocar` já fazem isso | Não |
| `sudo ./trocar_vpn.sh testar` | Testa a VPN nova e mostra o IP novo | Não |
| `sudo ./trocar_vpn.sh trocar` | Troca para a VPN nova, com volta automática | Sim |
| `sudo ./trocar_vpn.sh confirmar` | Torna a VPN nova definitiva | Não |
| `sudo ./trocar_vpn.sh voltar` | Volta para a VPN antiga a qualquer momento | Sim |
| `sudo ./trocar_vpn.sh status` | Mostra as duas VPNs, os túneis e o log | Não |

O histórico fica em `/var/log/troca-vpn.log`. O `.ovpn` sem alterações fica salvo ao lado do arquivo ajustado, com a extensão `.ovpn.original`.

### Opções

Passe as variáveis depois do `sudo`:

```bash
sudo PASS=/etc/openvpn/client/pass-nova.txt ./trocar_vpn.sh testar
```

| Variável | Uso |
|---|---|
| `PASS` | Arquivo de usuário e senha, se a VPN nova usar outro |
| `ORIGEM` | Pasta da VPN nova, se estiver em outro lugar |
| `PORTA_ANTIGA`, `PORTA_NOVA` | Portas diferentes de 1195 e 1194 |

> ⚠️ Repita as mesmas variáveis em `preparar`, `testar` e `trocar`. Cada um desses comandos ajusta o `.ovpn` de novo e, sem a variável, volta a usar o valor padrão.

> ⚠️ **Não conte com `TEMPO_CONFIRMAR_MIN` nem `TEMPO_CONECTAR_S` no `trocar`.** A troca roda em um processo separado (`systemd-run`) que não recebe essas variáveis, então os prazos reais continuam sendo 10 minutos e 90 s, mesmo que a mensagem na tela mostre outro valor.

## Cadastrar ou alterar uma rádio no painel

A lista de rádios fica em `RADIO_STATIONS`, em [core/views.py](core/views.py):

```python
{"id": "cb_lavador", "name": "atv.radiocb.lavador", "ip": "10.100.250.5", "group": "Cuiabá", "label": "Lavador"},
```

- `id`: identificador único
- `ip`: IP da máquina **na VPN**, usado no ping e para localizar o heartbeat
- `group`: unidade em que a rádio aparece no painel
- `label`: local dentro da unidade

Depois de editar, publique no servidor:

```bash
docker compose up -d --build
```

## Problemas comuns

| Sintoma | Causa provável | Como verificar |
|---|---|---|
| **SEM RÁDIO** com Firefox aberto | Agente parado, ou servidor inacessível | `sudo ./instalar_radio_agent.sh status` e `log` |
| **SEM RÁDIO** com o agente rodando | O IP cadastrado é diferente do IP que chega no heartbeat | `docker compose logs -f web` mostra `Recebido de <ip>`. Compare com `core/views.py` |
| **DESLIGADA** logo após trocar a VPN | IP antigo ainda cadastrado no painel | Atualize `core/views.py` e publique |
| **DESLIGADA** com a máquina ligada | VPN fora do ar | `sudo ./trocar_vpn.sh status` ou `systemctl status openvpn-legacy` |
| **SEM ÁUDIO** com som tocando | Agente não conseguiu medir a saída de som | Veja se o Firefox roda com usuário comum, não `root`. O agente usa a sessão de áudio desse usuário |
| Máquina não acorda pela rede | *ErP* ou *Deep Sleep* ativos, ou `Wake-on: d` | Etapas 2 e 4 da instalação |
| `trocar_vpn.sh`: `não achei o serviço da VPN antiga` | Serviço antigo sem `-1195-` no caminho | `grep -l 1195 /etc/systemd/system/*.service` |
| `trocar_vpn.sh`: `não achei a pasta da VPN nova` | Zip não extraído, ou pasta com outro nome | Extraia o zip ou use `ORIGEM=/caminho` |
