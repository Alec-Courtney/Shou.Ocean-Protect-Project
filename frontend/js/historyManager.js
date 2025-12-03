import { MAX_TODAY_WARNINGS, warningIcons } from './constants.js';
import { dom } from './domElements.js';
import { state } from './state.js';
import { normalizeWarningRecord } from './utils.js';
import { recordWarningTrend, setWarningCardCount } from './uiControls.js';
import { setNotificationBadge, updateWarningList } from './notifications.js';

export function queryHistory() {
    if (!dom.historyBoatSelect) return;
    const selectedHistoryBoatId = dom.historyBoatSelect.value;
    const startTime = dom.startTimeInput?.value ? new Date(`${dom.startTimeInput.value}:00`).toISOString() : null;
    const endTime = dom.endTimeInput?.value ? new Date(`${dom.endTimeInput.value}:00`).toISOString() : null;

    if (!startTime || !endTime) {
        alert('请输入开始和结束时间！');
        return;
    }

    state.historyDisplayLayer.clearLayers();
    if (dom.warningList) {
        dom.warningList.innerHTML = '';
    }

    if (selectedHistoryBoatId === 'all_boats') {
        state.isHistoryView = true;
        fetch(`http://localhost:8000/api/all_warnings?start_time=${startTime}&end_time=${endTime}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                updateWarningList(data);
                if (dom.statsTitle) dom.statsTitle.textContent = '当前查询预警数';
                if (dom.statsCount) dom.statsCount.textContent = data.length;
            })
            .catch(error => {
                state.isHistoryView = false;
                console.error('无法获取所有历史预警:', error);
                if (dom.statusText) {
                    dom.statusText.textContent = '错误: 无法获取所有历史预警';
                }
            });
    } else if (selectedHistoryBoatId) {
        state.isHistoryView = true;
        const historyPromise = fetch(`http://localhost:8000/api/boats/${selectedHistoryBoatId}/history?start_time=${startTime}&end_time=${endTime}`);
        const warningsPromise = fetch(`http://localhost:8000/api/boats/${selectedHistoryBoatId}/warnings?start_time=${startTime}&end_time=${endTime}`);

        Promise.all([historyPromise, warningsPromise])
            .then(responses => Promise.all(responses.map(res => {
                if (!res.ok) {
                    throw new Error(`HTTP error! status: ${res.status}`);
                }
                return res.json();
            })))
            .then(([historyData, warningsData]) => {
                if (dom.statsTitle) dom.statsTitle.textContent = '当前查询预警数';
                if (dom.statsCount) dom.statsCount.textContent = warningsData.length;

                const historyPath = historyData.map(p => [p.latitude, p.longitude]);
                if (historyPath.length) {
                    L.polyline(historyPath, { color: 'blue', weight: 3 }).addTo(state.historyDisplayLayer);
                }

                warningsData.forEach(w => {
                    const warningLatLng = [w.latitude, w.longitude];
                    const warningIcon = warningIcons[w.warning_level] || warningIcons[0];
                    L.marker(warningLatLng, { icon: warningIcon })
                        .bindPopup(`<b>预警等级: ${w.warning_level}</b><br>时间: ${new Date(w.timestamp).toLocaleString()}<br>经度: ${w.longitude.toFixed(6)}<br>纬度: ${w.latitude.toFixed(6)}`)
                        .addTo(state.historyDisplayLayer);
                });

                state.historyDisplayLayer.addTo(state.map);
                updateWarningList(warningsData, selectedHistoryBoatId);

                if (historyPath.length) {
                    state.map.fitBounds(L.polyline(historyPath).getBounds());
                }
            })
            .catch(error => {
                state.isHistoryView = false;
                console.error('查询历史数据失败:', error);
                if (dom.statusText) {
                    dom.statusText.textContent = '错误: 查询历史数据失败';
                }
            });
    } else {
        alert("请选择一艘船或选择'所有船只'进行历史查询！");
    }
}

export function clearHistory() {
    state.isHistoryView = false;
    state.historyDisplayLayer.clearLayers();
    if (dom.warningList) {
        dom.warningList.innerHTML = '';
    }
    updateTodayWarningCount();
    fetchTodayWarnings();
}

export async function updateTodayWarningCount() {
    try {
        const response = await fetch('http://localhost:8000/api/warnings/today_count');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (!state.isHistoryView) {
            if (dom.statsTitle) dom.statsTitle.textContent = '当日预警总数';
            if (dom.statsCount) dom.statsCount.textContent = data.count;
        }
        state.dailyWarningCount = data.count;
        setWarningCardCount(state.dailyWarningCount);
        recordWarningTrend(state.dailyWarningCount);
    } catch (error) {
        console.error('无法获取当天预警总数:', error);
        if (!state.isHistoryView && dom.statsCount) {
            dom.statsCount.textContent = '错误';
        }
        state.dailyWarningCount = 0;
        setWarningCardCount('--');
    }
}

export async function fetchTodayWarnings() {
    try {
        const response = await fetch('http://localhost:8000/api/warnings/today');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const warnings = await response.json();
        state.todaysWarningMap.clear();
        state.todaysWarnings = [];

        for (const rawWarning of warnings) {
            const normalized = normalizeWarningRecord(rawWarning);
            if (!normalized || state.todaysWarningMap.has(normalized.id)) {
                continue;
            }
            state.todaysWarningMap.set(normalized.id, normalized);
            state.todaysWarnings.push(normalized);
            if (state.todaysWarnings.length >= MAX_TODAY_WARNINGS) {
                break;
            }
        }

        if (!state.isHistoryView) {
            updateWarningList(state.todaysWarnings);
        }
        if (!state.isNotificationCenterOpen) {
            setNotificationBadge(0);
        }
    } catch (error) {
        console.error('无法获取当天预警列表:', error);
        if (dom.warningList) {
            dom.warningList.innerHTML = '<li>无法加载当天预警</li>';
        }
    }
}
