import { MAX_TODAY_WARNINGS } from './constants.js';
import { dom } from './domElements.js';
import { state } from './state.js';
import { fetchBoatList, fetchHistoryBoats, updateBoatData, updateBoatList, updateStatusPanel } from './boatManager.js';
import { fetchTodayWarnings } from './historyManager.js';
import { bumpNotificationBadge, showWarning, updateWarningList } from './notifications.js';
import { recordWarningTrend, setWarningCardCount, updateConnectionIndicator } from './uiControls.js';
import { buildBoatLabelHtml, normalizeWarningRecord, throttle } from './utils.js';

export function connectToBackend() {
    if (state.socket && state.socket.connected) {
        return;
    }

    if (dom.statusText) {
        dom.statusText.textContent = '正在连接服务器...';
    }

    state.socket = io('ws://localhost:8000', {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
    });

    state.socket.on('connect', async () => {
        console.log('成功连接到WebSocket服务器');
        if (dom.statusText) {
            dom.statusText.textContent = '已连接';
            dom.statusText.style.color = 'green';
        }
        updateConnectionIndicator(true);
        await fetchHistoryBoats();
        fetchBoatList();
        fetchTodayWarnings();
    });

    state.socket.on('disconnect', () => {
        console.log('与WebSocket服务器断开连接');
        if (dom.statusText) {
            dom.statusText.textContent = '已断开';
            dom.statusText.style.color = 'red';
        }
        updateConnectionIndicator(false);
    });

    state.socket.on('connect_error', (error) => {
        console.error('WebSocket连接错误:', error);
        if (dom.statusText) {
            dom.statusText.textContent = '连接错误';
            dom.statusText.style.color = 'orange';
        }
        updateConnectionIndicator(false);
    });

    const throttledUpdateBoatData = throttle(updateBoatData, 1000);

    state.socket.on('gps_update', (data) => {
        throttledUpdateBoatData(data);
        if ((data.boat_id || '').trim() === state.selectedBoatId) {
            updateStatusPanel(data);
        }
    });

    state.socket.on('today_warning_count_update', (data) => {
        const nextCount = Number(data?.count ?? 0);
        console.log('收到当日预警总数更新:', nextCount);
        state.dailyWarningCount = nextCount;
        setWarningCardCount(nextCount);
        recordWarningTrend(nextCount);
        if (!state.isHistoryView) {
            if (dom.statsTitle) dom.statsTitle.textContent = '当日预警总数';
            if (dom.statsCount) dom.statsCount.textContent = nextCount;
        }
    });

    state.socket.on('warning_created', (warning) => {
        try {
            const normalizedWarning = normalizeWarningRecord(warning);
            if (!normalizedWarning) return;

            const { id: warningId, boat_id: normalizedId, boat_name: normalizedBoatName } = normalizedWarning;
            if (normalizedBoatName) {
                state.allBoatsInfo[normalizedId] = { boat_name: normalizedBoatName };
                const cachedBoat = state.boatsData[normalizedId];
                if (cachedBoat) {
                    cachedBoat.boat_name = normalizedBoatName;
                    if (cachedBoat.label) {
                        cachedBoat.label.setIcon(L.divIcon({
                            className: 'boat-label',
                            html: buildBoatLabelHtml(normalizedId),
                            iconSize: [100, 20],
                            iconAnchor: [50, -10],
                        }));
                    }
                }
                updateBoatList();
            }

            const hasExisting = state.todaysWarningMap.has(warningId);
            state.todaysWarningMap.set(warningId, normalizedWarning);

            if (hasExisting) {
                const existingIndex = state.todaysWarnings.findIndex(w => w.id === warningId);
                if (existingIndex !== -1) {
                    state.todaysWarnings[existingIndex] = normalizedWarning;
                } else {
                    state.todaysWarnings.unshift(normalizedWarning);
                }
            } else {
                state.todaysWarnings.unshift(normalizedWarning);
                if (state.todaysWarnings.length > MAX_TODAY_WARNINGS) {
                    const removed = state.todaysWarnings.pop();
                    if (removed?.id) {
                        state.todaysWarningMap.delete(removed.id);
                    }
                }
            }

            if (!state.isHistoryView) {
                updateWarningList(state.todaysWarnings);
            }

            if (!hasExisting && normalizedWarning.warning_level <= 2) {
                const boatDisplayName = normalizedBoatName
                    || state.allBoatsInfo[normalizedId]?.boat_name
                    || normalizedId
                    || '未知船只';
                const warningTime = normalizedWarning.timestamp
                    ? new Date(normalizedWarning.timestamp).toLocaleString()
                    : new Date().toLocaleString();
                showWarning({
                    level: normalizedWarning.warning_level,
                    name: boatDisplayName,
                    id: normalizedId,
                    time: warningTime,
                    lon: normalizedWarning.longitude,
                    lat: normalizedWarning.latitude,
                });
            } else if (!hasExisting) {
                bumpNotificationBadge();
            }
        } catch (error) {
            console.error('处理 warning_created 事件失败:', error);
        }
    });
}
