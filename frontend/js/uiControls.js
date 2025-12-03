import { dom } from './domElements.js';
import { state } from './state.js';

export function setActiveDrawer(target) {
    if (!dom.drawerPanels?.length) return;
    dom.drawerPanels.forEach(panel => {
        panel.classList.toggle('is-active', panel.id === `drawer-${target}`);
    });
    if (dom.drawerButtons?.length) {
        dom.drawerButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.drawerTarget === target);
        });
    }
}

export function startClock() {
    const updateClock = () => {
        if (!dom.hudClockEl) return;
        const now = new Date();
        dom.hudClockEl.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
    };
    updateClock();
    setInterval(updateClock, 1000);
}

export function recordWarningTrend(count) {
    state.warningTrend.push({ x: Date.now(), y: Number(count) || 0 });
    if (state.warningTrend.length > 60) {
        state.warningTrend.shift();
    }
    renderSparkline();
}

function renderSparkline() {
    if (!dom.sparklinePath) return;
    const width = 120;
    const height = 32;
    if (!state.warningTrend.length) {
        dom.sparklinePath.setAttribute('points', '');
        return;
    }
    const maxY = Math.max(...state.warningTrend.map(p => p.y), 1);
    const minY = Math.min(...state.warningTrend.map(p => p.y), 0);
    const rangeY = Math.max(maxY - minY, 1);
    const points = state.warningTrend.map((point, index) => {
        const x = (index / (state.warningTrend.length - 1 || 1)) * width;
        const y = height - ((point.y - minY) / rangeY) * height;
        return `${x},${y}`;
    }).join(' ');
    dom.sparklinePath.setAttribute('points', points);
}

export function setWarningCardCount(value) {
    if (!dom.statWarningCountEl) return;
    dom.statWarningCountEl.textContent = value ?? '--';
}

export function refreshSelectedBoatStat() {
    if (!dom.statSelectedBoatEl) return;
    if (state.selectedBoatId) {
        const displayName = state.boatsData[state.selectedBoatId]?.boat_name || state.selectedBoatId;
        dom.statSelectedBoatEl.textContent = displayName;
    } else {
        dom.statSelectedBoatEl.textContent = '未选择';
    }
}

export function updateQuickStats(onlineBoatIds = []) {
    if (dom.statOnlineEl) {
        dom.statOnlineEl.textContent = onlineBoatIds.length;
    }
    if (dom.statHighestRiskEl) {
        const highest = onlineBoatIds.reduce((max, id) => {
            const level = state.boatsData[id]?.warning_level ?? 0;
            return Math.max(max, level);
        }, 0);
        dom.statHighestRiskEl.textContent = highest;
    }
    refreshSelectedBoatStat();
}

export function updateConnectionIndicator(isConnected) {
    if (!dom.connectionPill) return;
    dom.connectionPill.classList.toggle('connected', Boolean(isConnected));
}
