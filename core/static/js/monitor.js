// ==========================================================================
// MONITOR CONTROLLER - REAL-TIME ASYNC POLLING (3-STATE SYSTEM)
// ==========================================================================

const REFRESH_INTERVAL_SECONDS = 15;
let countdown = REFRESH_INTERVAL_SECONDS;
let countdownTimer = null;
let isFetching = false;
let lastStatusData = null;
// Incrementado a cada alteração de manutenção, para descartar consultas iniciadas antes dela
let maintenanceVersion = 0;
let maintenanceStationId = null;

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("maintenance-form").addEventListener("submit", submitMaintenance);

    // Initial fetch on mount
    fetchStatus();
    
    // Start countdown scheduler
    startCountdown();
});

/**
 * Starts the visible countdown scheduler.
 */
function startCountdown() {
    clearInterval(countdownTimer);
    const countdownEl = document.getElementById("countdown");
    
    countdown = REFRESH_INTERVAL_SECONDS;
    if (countdownEl) countdownEl.innerText = countdown;

    countdownTimer = setInterval(() => {
        if (isFetching) return; // Freeze countdown while actively fetching
        
        countdown--;
        if (countdownEl) countdownEl.innerText = countdown;
        
        if (countdown <= 0) {
            fetchStatus();
        }
    }, 1000);
}

/**
 * Action triggered by clicking the Manual Refresh button.
 */
function triggerManualRefresh() {
    if (isFetching) return;
    fetchStatus();
}

/**
 * AJAX requests all host pings and agent statuses from the Django API.
 */
async function fetchStatus() {
    if (isFetching) return;
    
    isFetching = true;
    toggleLoadingState(true);
    const requestVersion = maintenanceVersion;

    try {
        const response = await fetch('/api/status/');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (requestVersion === maintenanceVersion) {
            updateDashboard(data);
        }
    } catch (error) {
        console.error("Erro ao carregar o monitoramento das rádios:", error);
        handleFetchError();
    } finally {
        isFetching = false;
        toggleLoadingState(false);
        if (requestVersion !== maintenanceVersion) {
            fetchStatus(); // A manutenção mudou durante a consulta: busca de novo
        } else {
            startCountdown(); // Reset the countdown schedule
        }
    }
}

/**
 * Animates/Disables buttons and elements while fetching data.
 */
function toggleLoadingState(isLoading) {
    const btn = document.getElementById("refresh-btn");
    const icon = document.getElementById("refresh-icon");
    
    if (isLoading) {
        if (btn) btn.disabled = true;
        if (icon) icon.classList.add("spin-icon");
    } else {
        if (btn) btn.disabled = false;
        if (icon) icon.classList.remove("spin-icon");
    }
}

/**
 * Renders the incoming API statuses on the live DOM.
 */
function updateDashboard(data) {
    lastStatusData = data;

    let onlineCount = 0;
    let warningCount = 0;
    let offlineCount = 0;
    let maintenanceCount = 0;

    data.stations.forEach(station => {
        const textEl = document.getElementById(`status-text-${station.id}`);
        const dotEl = document.getElementById(`dot-${station.id}`);
        const rowEl = document.getElementById(`row-${station.id}`);
        
        if (!textEl || !dotEl) return;

        updateMaintenanceButton(station);

        // Remove prior state classes
        textEl.className = "status-text";
        dotEl.className = "status-dot";
        if (rowEl) {
            rowEl.classList.remove("station-online");
            rowEl.classList.remove("station-offline");
            rowEl.classList.remove("station-warning");
            rowEl.classList.remove("station-sem-radio");
            rowEl.classList.remove("station-sem-audio");
            rowEl.classList.remove("station-maintenance");

            // Inject the detailed log as a tooltip
            rowEl.title = station.details;
        }

        // Apply new styles based on response status
        if (station.status === "maintenance") {
            textEl.innerText = "MANUTENÇÃO";
            textEl.classList.add("text-maintenance");
            dotEl.classList.add("dot-maintenance");
            if (rowEl) rowEl.classList.add("station-maintenance");
            maintenanceCount++;
        } else if (station.status === "checking") {
            textEl.innerText = "VERIFICANDO...";
            textEl.classList.add("text-checking");
            dotEl.classList.add("dot-checking");
        } else if (station.status === "online") {
            textEl.innerText = "TOCANDO";
            textEl.classList.add("text-online");
            dotEl.classList.add("dot-online");
            if (rowEl) rowEl.classList.add("station-online");
            onlineCount++;
        } else if (station.status === "warning") {
            // Dynamic text and color based on which process has failed
            let label = "ATENÇÃO";
            let warningClass = "checking"; // default fallback (yellow/gold)
            
            if (station.firefox !== 'running' && station.audio !== 'playing') {
                label = "SEM RÁDIO";
                warningClass = "sem-radio"; // lighter yellow
            } else if (station.firefox !== 'running') {
                label = "SEM NAVEGADOR";
                warningClass = "checking";
            } else if (station.audio !== 'playing') {
                label = "SEM ÁUDIO";
                warningClass = "sem-audio"; // orange
            }
            
            textEl.innerText = label;
            textEl.classList.add(`text-${warningClass}`);
            dotEl.classList.add(`dot-${warningClass}`);
            if (rowEl) {
                rowEl.classList.add(warningClass === "checking" ? "station-warning" : `station-${warningClass}`);
            }
            warningCount++;
        } else {
            textEl.innerText = "DESLIGADA";
            textEl.classList.add("text-offline");
            dotEl.classList.add("dot-offline");
            if (rowEl) rowEl.classList.add("station-offline");
            offlineCount++;
        }
    });

    // Update statistics numbers
    const totalEl = document.getElementById("stat-total");
    const onlineEl = document.getElementById("stat-online");
    const warningEl = document.getElementById("stat-warning");
    const offlineEl = document.getElementById("stat-offline");
    const maintenanceEl = document.getElementById("stat-maintenance");

    if (totalEl) totalEl.innerText = data.stations.length;
    if (onlineEl) onlineEl.innerText = onlineCount;
    if (warningEl) warningEl.innerText = warningCount;
    if (offlineEl) offlineEl.innerText = offlineCount;
    if (maintenanceEl) maintenanceEl.innerText = maintenanceCount;

    // Update bottom metadata badges
    const speedEl = document.getElementById("speed-badge");
    
    if (speedEl) {
        speedEl.className = "speed-badge";
        speedEl.innerHTML = `<i class="fa-solid fa-bolt"></i> Latência: ${data.execution_time_seconds}s`;
    }
}

/**
 * Clean recovery UI state if the backend ping fails.
 */
function handleFetchError() {
    const speedEl = document.getElementById("speed-badge");
    if (speedEl) {
        speedEl.className = "speed-badge";
        speedEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--color-offline)"></i> Erro de Conexão`;
    }
}

/**
 * Keeps the wrench button in sync with the station state.
 */
function updateMaintenanceButton(station) {
    const btnEl = document.getElementById(`maintenance-btn-${station.id}`);
    if (!btnEl) return;

    const inMaintenance = station.status === "maintenance";
    const action = inMaintenance ? "Encerrar manutenção" : "Colocar em manutenção";
    btnEl.disabled = false;
    btnEl.classList.toggle("active", inMaintenance);
    btnEl.title = action;
    btnEl.setAttribute("aria-label", action);
}

/**
 * Opens the dialog: asks for the reason, or offers to end an active maintenance.
 */
function openMaintenanceDialog(stationId) {
    const station = lastStatusData && lastStatusData.stations.find(s => s.id === stationId);
    if (!station) return;

    maintenanceStationId = stationId;
    const inMaintenance = station.status === "maintenance";

    document.getElementById("maintenance-title").innerText =
        inMaintenance ? "Encerrar manutenção" : "Colocar em manutenção";
    document.getElementById("maintenance-station").innerText = `${station.group} · ${station.label}`;
    document.getElementById("maintenance-submit").innerText =
        inMaintenance ? "Encerrar manutenção" : "Salvar";
    document.getElementById("maintenance-error").innerText = "";

    document.getElementById("maintenance-reason-field").hidden = inMaintenance;
    document.getElementById("maintenance-current").hidden = !inMaintenance;
    document.getElementById("maintenance-reason").value = "";
    document.getElementById("maintenance-current-reason").innerText = station.maintenance_reason || "";

    document.getElementById("maintenance-dialog").showModal();
}

function closeMaintenanceDialog() {
    document.getElementById("maintenance-dialog").close();
}

/**
 * Saves or ends the maintenance, then reflects the change right away on the panel.
 */
async function submitMaintenance(event) {
    event.preventDefault();

    const stationId = maintenanceStationId;
    const ending = !document.getElementById("maintenance-current").hidden;
    const reason = document.getElementById("maintenance-reason").value.trim();
    const errorEl = document.getElementById("maintenance-error");
    const submitBtn = document.getElementById("maintenance-submit");

    if (!ending && !reason) {
        errorEl.innerText = "Informe o motivo da manutenção.";
        return;
    }

    errorEl.innerText = "";
    submitBtn.disabled = true;

    try {
        const response = await fetch(`/api/maintenance/${encodeURIComponent(stationId)}/`, {
            method: ending ? "DELETE" : "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": document.querySelector("#maintenance-form [name=csrfmiddlewaretoken]").value,
            },
            body: ending ? undefined : JSON.stringify({ reason }),
        });

        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || `Erro ${response.status} ao salvar.`);
        }

        maintenanceVersion++;
        const station = lastStatusData.stations.find(s => s.id === stationId);
        station.status = ending ? "checking" : "maintenance";
        station.maintenance_reason = ending ? "" : reason;
        station.details = ending ? "Aguardando a próxima verificação" : `Motivo: ${reason}`;
        updateDashboard(lastStatusData);

        closeMaintenanceDialog();
        fetchStatus();
    } catch (error) {
        console.error("Erro ao alterar a manutenção:", error);
        errorEl.innerText = error instanceof TypeError ? "Sem conexão com o servidor." : error.message;
    } finally {
        submitBtn.disabled = false;
    }
}
