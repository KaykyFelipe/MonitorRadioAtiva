// ==========================================================================
// MONITOR CONTROLLER - REAL-TIME ASYNC POLLING (3-STATE SYSTEM)
// ==========================================================================

const REFRESH_INTERVAL_SECONDS = 15;
let countdown = REFRESH_INTERVAL_SECONDS;
let countdownTimer = null;
let isFetching = false;

document.addEventListener("DOMContentLoaded", () => {
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

    try {
        const response = await fetch('/api/status/');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        updateDashboard(data);
    } catch (error) {
        console.error("Erro ao carregar o monitoramento das rádios:", error);
        handleFetchError();
    } finally {
        isFetching = false;
        toggleLoadingState(false);
        startCountdown(); // Reset the countdown schedule
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
    let onlineCount = 0;
    let warningCount = 0;
    let offlineCount = 0;
    
    data.stations.forEach(station => {
        const textEl = document.getElementById(`status-text-${station.id}`);
        const dotEl = document.getElementById(`dot-${station.id}`);
        const rowEl = document.getElementById(`row-${station.id}`);
        
        if (!textEl || !dotEl) return;
        
        // Remove prior state classes
        textEl.className = "status-text";
        dotEl.className = "status-dot";
        if (rowEl) {
            rowEl.classList.remove("station-online");
            rowEl.classList.remove("station-offline");
            rowEl.classList.remove("station-warning");
            rowEl.classList.remove("station-sem-radio");
            rowEl.classList.remove("station-sem-audio");
            
            // Inject the detailed log as a tooltip
            rowEl.title = station.details;
        }

        // Apply new styles based on response status
        if (station.status === "online") {
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
    
    if (totalEl) totalEl.innerText = data.stations.length;
    if (onlineEl) onlineEl.innerText = onlineCount;
    if (warningEl) warningEl.innerText = warningCount;
    if (offlineEl) offlineEl.innerText = offlineCount;

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
