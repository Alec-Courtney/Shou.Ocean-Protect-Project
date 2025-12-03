export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function buildBoatLabelHtml(displayText) {
    const safeText = escapeHtml(displayText ?? '');
    return `<div style="background-color: rgba(255,255,255,0.8); padding: 2px 5px; border-radius: 3px; font-size: 12px; white-space: nowrap;">${safeText}</div>`;
}

export function normalizeWarningRecord(rawWarning) {
    if (!rawWarning) {
        return null;
    }
    const boatId = (rawWarning.boat_id || '').trim();
    const timestamp = rawWarning.timestamp || new Date().toISOString();
    const fallbackIdBase = timestamp ? `${boatId}-${timestamp}` : `${boatId}-${Date.now()}`;
    const warningId = rawWarning.id !== undefined && rawWarning.id !== null
        ? String(rawWarning.id)
        : fallbackIdBase;
    const warningLevel = Number(rawWarning.warning_level ?? 0);
    const latitude = Number(rawWarning.latitude);
    const longitude = Number(rawWarning.longitude);
    const details = rawWarning.details || '';
    const boatName = (rawWarning.boat_name || '').trim();
    return {
        id: warningId,
        boat_id: boatId,
        warning_level: warningLevel,
        latitude,
        longitude,
        timestamp,
        details,
        boat_name: boatName || undefined,
    };
}

export function throttle(func, limit) {
    let inThrottle = false;
    let lastFunc = null;
    let lastRan = 0;

    return function throttled(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            lastRan = Date.now();
            inThrottle = true;
            setTimeout(() => {
                inThrottle = false;
                if (lastFunc) {
                    lastFunc.apply(this, args);
                    lastRan = Date.now();
                    lastFunc = null;
                }
            }, limit);
        } else {
            lastFunc = func;
        }
    };
}
