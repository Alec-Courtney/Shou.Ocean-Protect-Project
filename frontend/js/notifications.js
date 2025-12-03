import { dom } from './domElements.js';
import { state } from './state.js';
import { escapeHtml } from './utils.js';

export function toggleNotificationCenter(forceState = null) {
    if (!dom.notificationCenter) return;
    if (typeof forceState === 'boolean') {
        state.isNotificationCenterOpen = forceState;
    } else {
        state.isNotificationCenterOpen = !state.isNotificationCenterOpen;
    }
    dom.notificationCenter.classList.toggle('hidden', !state.isNotificationCenterOpen);
    if (state.isNotificationCenterOpen) {
        setNotificationBadge(0);
    }
}

export function setNotificationBadge(value) {
    if (!dom.notificationCountEl) return;
    state.unseenNotificationCount = Number(value) || 0;
    dom.notificationCountEl.textContent = state.unseenNotificationCount;
}

export function bumpNotificationBadge() {
    if (state.isNotificationCenterOpen) {
        setNotificationBadge(0);
        return;
    }
    setNotificationBadge(state.unseenNotificationCount + 1);
}

export function updateWarningList(warnings, boatIdForHistory = null) {
    if (!dom.warningList) return;
    dom.warningList.innerHTML = '';
    if (!warnings.length) {
        const li = document.createElement('li');
        li.textContent = '没有预警信息';
        dom.warningList.appendChild(li);
        return;
    }

    warnings.forEach(w => {
        const li = document.createElement('li');
        li.className = 'warning-entry';
        const time = new Date(w.timestamp).toLocaleString();
        const boatId = (w.boat_id || boatIdForHistory || '').trim();
        const boatNameRaw = (w.boat_name || '').trim();
        const boatName = boatNameRaw || state.allBoatsInfo[boatId]?.boat_name || (boatId || '未知船只');
        const lonValue = Number(w.longitude);
        const latValue = Number(w.latitude);
        const lonText = Number.isFinite(lonValue) ? lonValue.toFixed(6) : '--';
        const latText = Number.isFinite(latValue) ? latValue.toFixed(6) : '--';

        const style = getComputedStyle(document.documentElement);
        const levelColor = style.getPropertyValue(`--warning-level-${w.warning_level}-bg`).trim() || 'rgba(255,255,255,0.1)';
        const levelTextColor = style.getPropertyValue(`--warning-level-${w.warning_level}-text`).trim() || '#fff';

        li.style.borderLeftColor = levelTextColor;
        li.innerHTML = `
            <div class="warning-entry-header">
                <span class="level-pill" style="background:${levelColor};color:${levelTextColor};">L${escapeHtml(String(w.warning_level))}</span>
                <span class="boat-name">${escapeHtml(boatName)}</span>
                <span class="boat-id">${escapeHtml(boatId)}</span>
            </div>
            <div class="warning-entry-body">
                <span>${escapeHtml(time)}</span>
                <span>经度: ${escapeHtml(lonText)} / 纬度: ${escapeHtml(latText)}</span>
            </div>
        `;
        dom.warningList.appendChild(li);
    });
}

export function showWarning({ level, name, id, time, lon, lat }) {
    if (!dom.toastContainer) return;
    const normalizedLevel = Math.min(Math.max(Number(level) || 0, 0), 3);
    const lonNumber = Number(lon);
    const latNumber = Number(lat);
    const lonText = Number.isFinite(lonNumber) ? lonNumber.toFixed(6) : '--';
    const latText = Number.isFinite(latNumber) ? latNumber.toFixed(6) : '--';

    const warningEl = document.createElement('div');
    warningEl.className = `warning-toast level-${normalizedLevel}`;
    warningEl.innerHTML = `
        <div class="toast-level">${escapeHtml(String(normalizedLevel))}</div>
        <div class="toast-meta">
            <strong>${escapeHtml(name)}</strong>
            <span>${escapeHtml(id)} · ${escapeHtml(time)}</span>
            <span>经度: ${escapeHtml(lonText)} / 纬度: ${escapeHtml(latText)}</span>
        </div>
    `;

    dom.toastContainer.prepend(warningEl);
    const maxWarnings = 4;
    while (dom.toastContainer.children.length > maxWarnings) {
        dom.toastContainer.removeChild(dom.toastContainer.lastChild);
    }

    if (dom.warningSound) {
        dom.warningSound.currentTime = 0;
        dom.warningSound.play().catch(error => console.error("音频播放失败: 请确保 'frontend/sounds/warning.wav' 文件存在。", error));
    }

    bumpNotificationBadge();

    if (Number.isFinite(latNumber) && Number.isFinite(lonNumber) && state.map) {
        state.map.flyTo([latNumber, lonNumber], 12, {
            animate: true,
            duration: 1.2,
        });
    }

    setTimeout(() => {
        warningEl.classList.add('fade-out');
        warningEl.addEventListener('animationend', () => warningEl.remove(), { once: true });
    }, 5600);
}
