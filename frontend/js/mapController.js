import { DEFAULT_VIEW } from './constants.js';
import { dom } from './domElements.js';
import { state } from './state.js';

const BASE_LAYER_LABELS = {
    coastline: '海疆轮廓底图',
    satellite: '卫星影像',
};

const BASE_LAYER_ORDER = ['coastline', 'satellite'];

export function initMap() {
    state.canvasRenderer = L.canvas();
    state.map = L.map('map', { worldCopyJump: true }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
    state.baseLayers = {
        coastline: createCoastlineLayer(),
        satellite: createSatelliteLayer(),
    };
    state.baseLayerOrder = BASE_LAYER_ORDER.filter(key => Boolean(state.baseLayers[key]));
    state.currentBaseLayerKey = null;
    switchBaseLayer('coastline');
}

export async function fetchFishingZones() {
    try {
        const response = await fetch('http://localhost:8000/api/fishing_zones');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const geojsonData = await response.json();

        if (state.fishingZonesLayer) {
            state.map.removeLayer(state.fishingZonesLayer);
        }

        state.fishingZonesLayer = L.geoJSON(geojsonData, {
            style: {
                color: '#0000ff',
                weight: 2,
                opacity: 0.65,
                fillOpacity: 0.1,
            },
            renderer: state.canvasRenderer,
        }).addTo(state.map);

        state.map.fitBounds(state.fishingZonesLayer.getBounds());
    } catch (error) {
        console.error('无法加载渔区数据:', error);
        if (dom.statusText) {
            dom.statusText.textContent = '错误: 无法加载渔区数据，请检查后端服务和GeoJSON文件。';
        }
    }
}

export function toggleBaseLayer() {
    if (!state.map || !state.baseLayerOrder?.length) return;
    const nextKey = getNextBaseLayerKey();
    switchBaseLayer(nextKey);
}

function switchBaseLayer(nextKey) {
    if (!state.map || !nextKey) return;
    const nextLayer = state.baseLayers[nextKey];
    if (!nextLayer) return;
    if (state.currentBaseLayerKey && state.baseLayers[state.currentBaseLayerKey]) {
        state.map.removeLayer(state.baseLayers[state.currentBaseLayerKey]);
    }
    nextLayer.addTo(state.map);
    state.currentBaseLayerKey = nextKey;
    updateBaseLayerButtonLabel();
}

function getNextBaseLayerKey() {
    if (!state.baseLayerOrder?.length) return null;
    const currentIndex = state.baseLayerOrder.indexOf(state.currentBaseLayerKey);
    if (currentIndex === -1) {
        return state.baseLayerOrder[0];
    }
    return state.baseLayerOrder[(currentIndex + 1) % state.baseLayerOrder.length];
}

function updateBaseLayerButtonLabel() {
    if (!dom.toggleStyleBtn) return;
    const currentLabel = BASE_LAYER_LABELS[state.currentBaseLayerKey] ?? '底图';
    const nextKey = getNextBaseLayerKey();
    const nextLabel = nextKey ? BASE_LAYER_LABELS[nextKey] ?? '下一底图' : '下一底图';
    dom.toggleStyleBtn.setAttribute('title', `当前: ${currentLabel} · 切换为 ${nextLabel}`);
}

export function recenterMap() {
    if (!state.map) return;
    if (state.selectedBoatId && state.boatsData[state.selectedBoatId]?.marker) {
        const target = state.boatsData[state.selectedBoatId].marker.getLatLng();
        state.map.flyTo(target, state.map.getZoom(), { duration: 1 });
    } else {
        state.map.flyTo(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom, { duration: 1.2 });
    }
}

export function toggleLabels(forceValue = null) {
    if (!state.map) return;
    if (typeof forceValue === 'boolean') {
        state.showLabels = forceValue;
    } else {
        state.showLabels = !state.showLabels;
    }
    const labelText = state.showLabels ? '隐藏标签' : '显示标签';
    if (dom.toggleLabelsBtn) {
        dom.toggleLabelsBtn.textContent = labelText;
    }
    if (dom.mapLabelsToggleBtn) {
        dom.mapLabelsToggleBtn.setAttribute('title', state.showLabels ? '隐藏标签' : '显示标签');
    }
    Object.values(state.boatsData).forEach(boat => {
        if (!boat?.label) return;
        if (state.showLabels) {
            boat.label.addTo(state.map);
        } else {
            state.map.removeLayer(boat.label);
        }
    });
}

function createCoastlineLayer() {
    const oceanBase = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: '海洋底图 &copy; Esri, GEBCO, NOAA, Garmin, HERE, and other contributors',
        noWrap: true,
    });
    const coastlineOverlay = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}', {
        attribution: '海岸线数据 &copy; Esri, GEBCO, NOAA, Garmin, HERE, and other contributors',
        className: 'coastline-only-tiles',
        noWrap: true,
    });
    return L.layerGroup([oceanBase, coastlineOverlay]);
}

function createSatelliteLayer() {
    return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri and partners',
        noWrap: true,
    });
}
