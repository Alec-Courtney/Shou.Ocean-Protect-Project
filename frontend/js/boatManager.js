import { warningIcons } from './constants.js';
import { dom } from './domElements.js';
import { state } from './state.js';
import { buildBoatLabelHtml } from './utils.js';
import { refreshSelectedBoatStat, updateQuickStats } from './uiControls.js';

export function updateBoatData(data) {
    let { boat_id, boat_name, lat, lon, bearing_deg, warning_level, prediction_path, timestamp } = data;
    boat_id = (boat_id || '').trim();
    const latLng = [lat, lon];
    const cleanedBoatName = (boat_name || '').trim();

    if (!state.boatsData[boat_id] || !state.boatsData[boat_id].marker) {
        createBoatLayers(boat_id, { latLng, warning_level, boat_name: cleanedBoatName || boat_id });
    }

    const boat = state.boatsData[boat_id];
    if (cleanedBoatName) {
        boat.boat_name = cleanedBoatName;
        state.allBoatsInfo[boat_id] = { boat_name: cleanedBoatName };
        if (boat.label) {
            boat.label.setIcon(L.divIcon({
                className: 'boat-label',
                html: buildBoatLabelHtml(boat_id),
                iconSize: [100, 20],
                iconAnchor: [50, -10],
            }));
        }
        if (state.selectedBoatId === boat_id) {
            refreshSelectedBoatStat();
        }
    } else if (!boat.boat_name) {
        boat.boat_name = boat_id;
    }

    boat.last_update = Date.now();
    boat.marker.setLatLng(latLng);

    if (boat.warning_level !== warning_level) {
        boat.marker.setIcon(warningIcons[warning_level] || warningIcons[0]);
        boat.warning_level = warning_level;
        updateBoatList();
    }

    boat.label.setLatLng(latLng);
    if (state.showLabels && !state.map.hasLayer(boat.label)) {
        boat.label.addTo(state.map);
    } else if (!state.showLabels && state.map.hasLayer(boat.label)) {
        state.map.removeLayer(boat.label);
    }

    boat.historyPath.push(latLng);
    if (boat.historyPath.length > 200) {
        boat.historyPath.shift();
    }
    boat.historyPolyline.setLatLngs(boat.historyPath);

    boat.predictionPolyline.clearLayers();
    const leafletPath = Array.isArray(prediction_path) ? prediction_path.map(p => [p[1], p[0]]) : [];
    if (leafletPath.length > 1) {
        const totalSegments = leafletPath.length - 1;
        for (let i = 0; i < totalSegments; i++) {
            const opacity = 1.0 - (i / totalSegments) * 0.8;
            const segment = [leafletPath[i], leafletPath[i + 1]];
            L.polyline(segment, {
                color: '#ff4500',
                weight: 3,
                dashArray: '5, 10',
                opacity,
                renderer: state.canvasRenderer,
            }).addTo(boat.predictionPolyline);
        }
    }

    if (boat_id === state.selectedBoatId && dom.lockViewCheckbox?.checked) {
        state.map.panTo(latLng);
    }
}

function createBoatLayers(boat_id, initialData) {
    const { latLng, warning_level, boat_name } = initialData;
    const cleanedBoatId = boat_id.trim();
    const cleanedBoatName = (boat_name || '').trim();
    const displayName = cleanedBoatName || cleanedBoatId;

    if (dom.historyBoatSelect && !dom.historyBoatSelect.querySelector(`option[value="${cleanedBoatId}"]`)) {
        const option = document.createElement('option');
        option.value = cleanedBoatId;
        option.textContent = cleanedBoatName ? `${cleanedBoatName} (${cleanedBoatId})` : cleanedBoatId;
        const placeholderOption = dom.historyBoatSelect.querySelector('option[value=""]');
        if (placeholderOption) {
            dom.historyBoatSelect.insertBefore(option, placeholderOption);
        } else {
            dom.historyBoatSelect.appendChild(option);
        }
    }

    const boat = {
        historyPath: [],
        marker: L.marker(latLng, {
            icon: warningIcons[warning_level] || warningIcons[0],
        }).addTo(state.map),
        historyPolyline: L.polyline([], {
            color: '#666',
            weight: 4,
            opacity: 0.8,
            renderer: state.canvasRenderer,
        }),
        predictionPolyline: L.layerGroup(),
        label: L.marker(latLng, {
            icon: L.divIcon({
                className: 'boat-label',
                html: buildBoatLabelHtml(cleanedBoatId),
                iconSize: [100, 20],
                iconAnchor: [50, -10],
            }),
        }),
        warning_level,
        boat_name: displayName,
    };

    state.boatsData[cleanedBoatId] = boat;
    if (!state.allBoatsInfo[cleanedBoatId] || state.allBoatsInfo[cleanedBoatId].boat_name === cleanedBoatId) {
        state.allBoatsInfo[cleanedBoatId] = { boat_name: displayName };
    }
    updateBoatList();

    boat.marker.on('click', () => selectBoat(cleanedBoatId));
    if (!state.selectedBoatId) {
        selectBoat(cleanedBoatId);
    }
}

export async function fetchHistoryBoats() {
    try {
        const response = await fetch('http://localhost:8000/api/boats');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const boats = await response.json();
        Object.keys(state.allBoatsInfo).forEach(key => delete state.allBoatsInfo[key]);
        boats.forEach(b => {
            const cleanedBoatId = (b.boat_id || '').trim();
            const cleanedBoatName = (b.boat_name || '').trim();
            state.allBoatsInfo[cleanedBoatId] = { boat_name: cleanedBoatName || cleanedBoatId };
        });

        if (dom.historyBoatSelect) {
            dom.historyBoatSelect.innerHTML = '<option value="all_boats">-- 所有船只 --</option><option value="">-- 请选择船只 --</option>';
            boats.forEach(b => {
                const option = document.createElement('option');
                const cleanedBoatId = (b.boat_id || '').trim();
                const cleanedBoatName = (b.boat_name || '').trim();
                option.value = cleanedBoatId;
                option.textContent = cleanedBoatName ? `${cleanedBoatName} (${cleanedBoatId})` : cleanedBoatId;
                dom.historyBoatSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('无法获取历史船只列表:', error);
    }
}

export function updateStatusPanel(data) {
    const cleanedBoatId = (data.boat_id || '').trim();
    if (dom.boatIdVal) {
        dom.boatIdVal.textContent = cleanedBoatId || data.boat_id || '--';
    }
    const cleanedBoatName = (data.boat_name || '').trim();
    const cachedBoatName = state.boatsData[cleanedBoatId]?.boat_name;
    if (dom.boatNameVal) {
        dom.boatNameVal.textContent = cleanedBoatName || cachedBoatName || '--';
    }
    if (dom.lonVal) {
        dom.lonVal.textContent = Number(data.lon).toFixed(6);
    }
    if (dom.latVal) {
        dom.latVal.textContent = Number(data.lat).toFixed(6);
    }
    if (dom.speedVal) {
        dom.speedVal.textContent = Number(data.speed_knots).toFixed(2);
    }
    if (dom.bearingVal) {
        dom.bearingVal.textContent = Number(data.bearing_deg).toFixed(2);
    }
    if (dom.warningLevelVal) {
        dom.warningLevelVal.textContent = data.warning_level;
    }
    if (dom.statusPanel) {
        ['warning-level-0', 'warning-level-1', 'warning-level-2', 'warning-level-3'].forEach(cls => dom.statusPanel.classList.remove(cls));
        dom.statusPanel.classList.add(`warning-level-${data.warning_level}`);
    }
}

export async function fetchBoatList() {
    try {
        const response = await fetch('http://localhost:8000/api/boats');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const boats = await response.json();
        boats.forEach(b => {
            const cleanedBoatId = (b.boat_id || '').trim();
            const cleanedBoatName = (b.boat_name || '').trim();
            const lastUpdateTime = b.last_update_time ? new Date(b.last_update_time).getTime() : Date.now();
            const existingBoat = state.boatsData[cleanedBoatId];

            if (!existingBoat) {
                state.boatsData[cleanedBoatId] = {
                    marker: null,
                    warning_level: 0,
                    last_update: lastUpdateTime,
                    boat_name: cleanedBoatName || cleanedBoatId,
                };
            } else {
                existingBoat.last_update = lastUpdateTime;
                if (cleanedBoatName) {
                    existingBoat.boat_name = cleanedBoatName;
                    if (existingBoat.label) {
                        existingBoat.label.setIcon(L.divIcon({
                            className: 'boat-label',
                            html: buildBoatLabelHtml(cleanedBoatId),
                            iconSize: [100, 20],
                            iconAnchor: [50, -10],
                        }));
                    }
                } else if (!existingBoat.boat_name) {
                    existingBoat.boat_name = cleanedBoatId;
                }
            }
            state.allBoatsInfo[cleanedBoatId] = { boat_name: cleanedBoatName || cleanedBoatId };
        });
        updateBoatList();
    } catch (error) {
        console.error('无法获取船只列表:', error);
        if (dom.statusText) {
            dom.statusText.textContent = '错误: 无法获取船只列表';
        }
    }
}

export function updateBoatList() {
    if (!dom.boatList) return;
    dom.boatList.innerHTML = '';
    const now = Date.now();
    const offlineTimeout = (state.config.frontend_parameters?.offline_timeout_seconds || 60) * 1000;

    const onlineBoats = Object.keys(state.boatsData).filter(boatId => {
        const boat = state.boatsData[boatId];
        return boat.last_update && now - boat.last_update < offlineTimeout;
    });

    updateQuickStats(onlineBoats);

    if (!onlineBoats.length) {
        dom.boatList.innerHTML = '<li>没有在线的船只</li>';
        return;
    }

    onlineBoats.forEach(boatId => {
        const li = document.createElement('li');
        li.dataset.boatId = boatId;
        if (boatId === state.selectedBoatId) {
            li.classList.add('selected');
        }
        li.addEventListener('click', () => selectBoat(boatId));

        const boatNameSpan = document.createElement('span');
        const displayName = state.boatsData[boatId]?.boat_name || boatId;
        boatNameSpan.textContent = displayName === boatId ? displayName : `${displayName} (${boatId})`;
        li.appendChild(boatNameSpan);

        const statusImg = document.createElement('img');
        statusImg.classList.add('boat-status-icon');
        const warningLevel = state.boatsData[boatId]?.warning_level ?? 0;
        statusImg.src = `icons/warning_sign${warningLevel}.png`;
        statusImg.alt = `Warning Level ${warningLevel}`;
        li.appendChild(statusImg);

        dom.boatList.appendChild(li);
    });
}

export function selectBoat(boatId) {
    if (state.selectedBoatId === boatId) return;
    state.selectedBoatId = boatId;
    refreshSelectedBoatStat();
    updateBoatList();

    Object.keys(state.boatsData).forEach(id => {
        const boat = state.boatsData[id];
        if (!boat?.predictionPolyline) return;
        if (id === state.selectedBoatId) {
            state.map.addLayer(boat.predictionPolyline);
        } else {
            state.map.removeLayer(boat.predictionPolyline);
        }
    });

    const boat = state.boatsData[boatId];
    if (boat?.marker) {
        state.map.panTo(boat.marker.getLatLng());
    }

    if (dom.boatIdVal) {
        dom.boatIdVal.textContent = boatId;
    }
    if (dom.boatNameVal) {
        dom.boatNameVal.textContent = boat?.boat_name || '--';
    }
    if (dom.lonVal) dom.lonVal.textContent = '--';
    if (dom.latVal) dom.latVal.textContent = '--';
    if (dom.speedVal) dom.speedVal.textContent = '--';
    if (dom.bearingVal) dom.bearingVal.textContent = '--';
    if (dom.warningLevelVal) dom.warningLevelVal.textContent = '--';
    if (dom.statusPanel) {
        ['warning-level-0', 'warning-level-1', 'warning-level-2', 'warning-level-3'].forEach(cls => dom.statusPanel.classList.remove(cls));
    }
}
