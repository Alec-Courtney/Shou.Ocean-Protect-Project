/**
 * 渔船离境智能预警系统 - 前端主逻辑 (V3.3)
 * 
 * 本脚本负责处理Web前端的所有交互、地图显示和与后端的实时通信。
 * 
 * 主要功能:
 * - 初始化 Leaflet.js 地图。
 * - 从后端API获取并显示渔区范围。
 * - 通过 Socket.IO 与后端建立 WebSocket 连接。
 * - 处理用户输入的串口配置，并发送给后端。
 * - 接收后端的实时GPS和预警数据，并更新地图上的船只图标和状态面板。
 * - 根据预警等级动态更换船只图标。
 */

document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // 全局变量和 DOM 元素缓存
    // =========================================================================
    
    // 状态显示面板
    const statusText = document.getElementById('status-text');
    const lonVal = document.getElementById('lon-val');
    const latVal = document.getElementById('lat-val');
    const speedVal = document.getElementById('speed-val');
    const bearingVal = document.getElementById('bearing-val');
    const warningLevelVal = document.getElementById('warning-level-val');
    const statusPanel = document.getElementById('status-panel');

    const lockViewCheckbox = document.getElementById('lock-view-checkbox');
    const boatList = document.getElementById('boat-list');
    const queryHistoryBtn = document.getElementById('query-history-btn');
    const startTimeInput = document.getElementById('start-time');
    const endTimeInput = document.getElementById('end-time');
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    const warningList = document.getElementById('warning-list');
    const boatIdVal = document.getElementById('boat-id-val');
    const boatNameVal = document.getElementById('boat-name-val'); // 新增船只名称元素
    const toggleLabelsBtn = document.getElementById('toggle-labels-btn'); // 新增显示标签按钮

    // 新增：历史查询相关元素
    const historyBoatSelect = document.getElementById('history-boat-select');

    // 新增：侧边栏元素
    const leftSidebar = document.getElementById('left-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');
    // 修正：切换按钮现在是body的直接子元素
    const leftSidebarToggle = document.getElementById('left-sidebar-toggle');
    const rightSidebarToggle = document.getElementById('right-sidebar-toggle');


    // 地图和通信核心对象 (V4.0)
    let map = null;
    let fishingZonesLayer = null;
    let socket = null;
    let canvasRenderer = null; // Canvas渲染器实例

    // 多船数据管理
    const boatsData = {}; // key: boat_id, value: { marker, historyPolyline, predictionPolyline, label, ... }
    let selectedBoatId = null;
    let historyDisplayLayer = L.layerGroup(); // 用于显示历史查询结果的图层组
    let showLabels = false; // 控制是否显示船只标签的全局变量

    // 预加载不同预警等级的图标，避免重复创建
    const warningIcons = {
        0: L.icon({
            iconUrl: '../Toolbox/icons/warning_sign0.png',
            iconSize: [32, 32],
            iconAnchor: [16, 16], // 图标锚点，设为中心
        }),
        1: L.icon({
            iconUrl: '../Toolbox/icons/warning_sign1.png',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        }),
        2: L.icon({
            iconUrl: '../Toolbox/icons/warning_sign2.png',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        }),
        3: L.icon({
            iconUrl: '../Toolbox/icons/warning_sign3.png',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        })
    };

    // =========================================================================
    // 地图初始化与数据加载
    // =========================================================================

    /**
     * 初始化Leaflet地图。
     * 设置底图图层 (OpenStreetMap) 和初始视图中心及缩放级别。
     * 同时创建Canvas渲染器实例，并调用 `fetchFishingZones` 加载渔区数据。
     */
    function initMap() {
        canvasRenderer = L.canvas(); // 创建一个Canvas渲染器实例，供多个图层共享

        map = L.map('map', { 
            worldCopyJump: true // 允许在平移越过180度经线时，地图和标记物能无缝跳转
        }).setView([22.5, 114.0], 8); // 默认视图中心 (例如：珠江口附近)

        // 添加OpenStreetMap瓦片图层作为底图
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            noWrap: true // 禁止地图在水平方向上重复平铺，避免世界地图重复显示
        }).addTo(map);

        fetchFishingZones(); // 地图初始化后立即加载渔区数据
    }

    /**
     * 从后端API异步获取渔区GeoJSON数据并添加到地图上。
     * 如果渔区图层已存在，会先移除旧图层再添加新图层。
     * 成功加载后，地图视图将自动缩放到渔区的边界。
     */
    async function fetchFishingZones() {
        try {
            const response = await fetch('http://localhost:8000/api/fishing_zones');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const geojsonData = await response.json();
            
            // 如果已存在旧的渔区图层，先从地图上移除
            if (fishingZonesLayer) {
                map.removeLayer(fishingZonesLayer);
            }
            
            // 创建新的GeoJSON图层并设置样式
            fishingZonesLayer = L.geoJSON(geojsonData, {
                style: {
                    color: "#0000ff",   // 蓝色边框
                    weight: 2,          // 边框粗细
                    opacity: 0.65,      // 透明度
                    fillOpacity: 0.1    // 填充透明度
                },
                renderer: canvasRenderer // 使用Canvas渲染器，提高渲染性能
            }).addTo(map);

            // 将地图视图自动缩放到渔区的完整范围
            map.fitBounds(fishingZonesLayer.getBounds());

        } catch (error) {
            console.error("无法加载渔区数据:", error);
            statusText.textContent = "错误: 无法加载渔区数据，请检查后端服务和GeoJSON文件。";
        }
    }

    // =========================================================================
    // 节流函数 (Throttling)
    // =========================================================================

    /**
     * 创建一个节流函数。
     * 在指定的时间间隔 `limit` 内，`func` 最多执行一次。
     * 如果在 `limit` 期间多次调用，只有最后一次调用会在 `limit` 结束后执行。
     * 
     * @param {Function} func - 要节流的函数。
     * @param {number} limit - 时间间隔（毫秒）。
     * @returns {Function} - 新的节流函数。
     */
    function throttle(func, limit) {
        let inThrottle;  // 标记是否处于节流状态
        let lastFunc;    // 存储最后一次被调用的函数
        let lastRan;     // 存储上次函数执行的时间戳

        return function() {
            const context = this; // 保存函数执行的上下文
            const args = arguments; // 保存函数执行的参数

            if (!inThrottle) {
                // 如果不在节流状态，立即执行函数
                func.apply(context, args);
                lastRan = Date.now(); // 记录执行时间
                inThrottle = true;    // 进入节流状态
                // 在指定时间后解除节流状态
                setTimeout(() => {
                    inThrottle = false;
                    // 如果在节流期间有新的调用，则在解除节流后立即执行最后一次调用
                    if (lastFunc) {
                        lastFunc.apply(context, args);
                        lastRan = Date.now(); // 更新执行时间
                        lastFunc = null; // 清空，等待下一次节流
                    }
                }, limit);
            } else {
                // 如果在节流状态，则更新 lastFunc 为当前调用，等待下次执行
                lastFunc = func;
            }
        }
    }


    // =========================================================================
    // WebSocket 通信处理 (V4.0)
    // =========================================================================

    /**
     * 连接到后端WebSocket服务器。
     * 如果已经连接，则不执行任何操作。
     * 设置重连机制，并监听连接、断开和错误事件。
     * 实时GPS数据更新通过节流函数处理，以控制地图更新频率。
     */
    function connectToBackend() {
        // 如果socket已存在且已连接，则直接返回，避免重复连接
        if (socket && socket.connected) return;

        statusText.textContent = '正在连接服务器...'; // 更新连接状态提示

        // 初始化 Socket.IO 客户端连接
        socket = io('ws://localhost:8000', {
            reconnection: true,             // 启用自动重连
            reconnectionAttempts: Infinity, // 无限次重连尝试
            reconnectionDelay: 1000,        // 每次重连尝试的间隔（毫秒）
        });

        // 监听 'connect' 事件，表示成功连接到WebSocket服务器
        socket.on('connect', () => {
            console.log('成功连接到WebSocket服务器');
            statusText.textContent = '已连接';
            statusText.style.color = 'green';
            fetchBoatList(); // 连接成功后，立即从后端获取初始实时船只列表
            fetchHistoryBoats(); // 连接成功后，获取历史查询的船只列表
        });

        // 监听 'disconnect' 事件，表示与WebSocket服务器断开连接
        socket.on('disconnect', () => {
            console.log('与WebSocket服务器断开连接');
            statusText.textContent = '已断开';
            statusText.style.color = 'red';
        });

        // 监听 'connect_error' 事件，表示连接过程中发生错误
        socket.on('connect_error', (error) => {
            console.error('WebSocket连接错误:', error);
            statusText.textContent = '连接错误';
            statusText.style.color = 'orange'; // 错误时显示橙色
        });

        // 创建一个节流版的船只数据更新函数，限制每 1000 毫秒最多执行一次
        // 这是为了避免后端数据推送过快导致前端地图渲染卡顿
        const throttledUpdateBoatData = throttle(updateBoatData, 1000);

        // 监听 'gps_update' 事件，接收后端推送的实时GPS数据
        socket.on('gps_update', (data) => {
            // 调用节流函数来更新地图上的船只数据
            throttledUpdateBoatData(data);
            
            // 状态面板的更新频率可以更高，因为它开销较小，且需要实时反馈
            if (data.boat_id === selectedBoatId) {
                updateStatusPanel(data);
            }
        });
    }

    // =========================================================================
    // 界面更新
    // =========================================================================

    /**
     * (V4.2 Refactored) 创建或更新船只的地图图层和相关数据。
     * 此函数遵循“创建一次，持续更新”的原则，避免不必要的图层销毁和重建，
     * 从而提高地图渲染性能。
     * 
     * @param {string} boat_id - 船只的唯一标识符。
     * @param {object} initialData - 包含初始经纬度 `latLng` 和预警等级 `warning_level` 的对象。
     */
    function updateBoatData(data) {
        const { boat_id, lat, lon, bearing_deg, warning_level, prediction_path } = data;
        const latLng = [lat, lon]; // Leaflet 接受 [latitude, longitude] 格式

        // 步骤 1: 检查船只图层是否存在于 `boatsData` 中，如果不存在则为新船只创建所有图层。
        if (!boatsData[boat_id] || !boatsData[boat_id].marker) {
            createBoatLayers(boat_id, { latLng, warning_level });
        }

        // 步骤 2: 获取现有图层对象并进行属性更新。
        const boat = boatsData[boat_id];

        // 2.1 更新船只 Marker (图标) 的位置
        boat.marker.setLatLng(latLng);

        // 2.2 仅在预警等级发生变化时才更新图标，避免不必要的DOM操作和重绘
        if (boat.warning_level !== warning_level) {
            boat.marker.setIcon(warningIcons[warning_level] || warningIcons[0]); // 根据预警等级设置图标
            boat.warning_level = warning_level; // 更新缓存中的预警等级
            updateBoatList(); // 预警等级变化时，更新UI列表中的船只图标
        }

        // 2.3 更新船只标签的位置和可见性
        boat.label.setLatLng(latLng);
        if (showLabels && !map.hasLayer(boat.label)) {
            // 如果标签应显示但未添加到地图，则添加
            boat.label.addTo(map);
        } else if (!showLabels && map.hasLayer(boat.label)) {
            // 如果标签不应显示但已在地图上，则移除
            map.removeLayer(boat.label);
        }

        // 2.4 更新实时轨迹线 (historyPolyline)
        boat.historyPath.push(latLng); // 将当前点添加到历史路径
        if (boat.historyPath.length > 200) { // 限制历史轨迹线的点数，避免过长
            boat.historyPath.shift(); // 移除最旧的点
        }
        boat.historyPolyline.setLatLngs(boat.historyPath); // 更新折线几何

        // 2.5 更新预测轨迹线 (predictionPolyline)
        // 后端返回的 prediction_path 是 [lon, lat] 格式，需要转换为 Leaflet 的 [lat, lon]
        const leafletPath = prediction_path.map(p => [p[1], p[0]]);
        boat.predictionPolyline.setLatLngs(leafletPath); // 更新折线几何

        // 2.6 如果当前船只是选中状态且“锁定视角”复选框被选中，则移动地图中心到当前船只位置
        if (boat_id === selectedBoatId && lockViewCheckbox.checked) {
            map.panTo(latLng);
        }
    }

    /**
     * (V4.2 New) 为新船只创建所有必要的Leaflet图层对象，并将其存储在 `boatsData` 中。
     * 这些图层包括船只标记 (marker)、历史轨迹线 (historyPolyline)、
     * 预测轨迹线 (predictionPolyline) 和船只标签 (label)。
     * 
     * @param {string} boat_id - 船只的唯一标识符。
     * @param {object} initialData - 包含初始经纬度 `latLng` 和预警等级 `warning_level` 的对象。
     */
    function createBoatLayers(boat_id, initialData) {
        const { latLng, warning_level } = initialData;

        // 确保历史查询的船只选择器中包含此船只
        // 避免重复添加，只在不存在时添加
        if (!historyBoatSelect.querySelector(`option[value="${boat_id}"]`)) {
            const option = document.createElement('option');
            option.value = boat_id;
            option.textContent = boat_id;
            // 将新船只选项插入到“请选择船只”之前，但“所有船只”之后
            const placeholderOption = historyBoatSelect.querySelector('option[value=""]');
            if (placeholderOption) {
                historyBoatSelect.insertBefore(option, placeholderOption);
            } else {
                historyBoatSelect.appendChild(option);
            }
        }
        // 创建并存储船只相关的Leaflet图层对象
        const boat = {
            historyPath: [], // 存储历史轨迹点的数组
            marker: L.marker(latLng, {
                icon: warningIcons[warning_level] || warningIcons[0], // 根据预警等级设置初始图标
            }).addTo(map), // 将标记添加到地图
            historyPolyline: L.polyline([], { 
                color: '#666',      // 灰色
                weight: 4,          // 粗细
                opacity: 0.8,       // 透明度
                renderer: canvasRenderer // 使用Canvas渲染器
            }),
            predictionPolyline: L.polyline([], { 
                color: '#ff4500',   // 橙红色
                weight: 3,          // 粗细
                dashArray: '5, 10', // 虚线样式
                renderer: canvasRenderer // 使用Canvas渲染器
            }),
            label: L.marker(latLng, {
                icon: L.divIcon({
                    className: 'boat-label', // CSS 类名
                    html: `<div style="background-color: rgba(255,255,255,0.8); padding: 2px 5px; border-radius: 3px; font-size: 12px; white-space: nowrap;">${boat_id}</div>`,
                    iconSize: [100, 20], // 图标大小
                    iconAnchor: [50, -10] // 图标锚点，使标签位于标记上方
                })
            }),
            warning_level: warning_level // 缓存当前预警等级
        };

        boatsData[boat_id] = boat; // 将新创建的船只对象添加到全局数据管理中
        updateBoatList(); // 有新船加入，更新UI上的船只列表

        // 绑定点击事件到船只标记，点击时选中该船只
        boat.marker.on('click', () => selectBoat(boat_id));

        // 如果这是第一艘被添加的船只，则默认选中它
        if (!selectedBoatId) {
            selectBoat(boat_id);
        } else {
            // 如果不是第一艘船，默认不显示其路径，因为 selectBoat 会处理路径的显示/隐藏
            // 只有被选中的船只的路径才会被添加到地图上
        }
    }

    /**
     * 从后端API获取所有已知船只的列表，并填充到历史查询的船只选择器中。
     */
    async function fetchHistoryBoats() {
        try {
            const response = await fetch('http://localhost:8000/api/boats');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const boats = await response.json();
            // 保留“所有船只”和“请选择船只”选项
            historyBoatSelect.innerHTML = '<option value="all_boats">-- 所有船只 --</option><option value="">-- 请选择船只 --</option>';
            boats.forEach(b => {
                const option = document.createElement('option');
                option.value = b.boat_id;
                option.textContent = b.boat_id;
                historyBoatSelect.appendChild(option);
            });
        } catch (error) {
            console.error("无法获取历史船只列表:", error);
            // 可以选择更新UI状态或显示错误信息
        }
    }

    /**
     * 更新状态面板以显示当前选中船只的实时信息。
     * 
     * @param {object} data - 船只的实时GPS数据包，包含船只ID、经纬度、速度、航向和预警等级。
     */
    function updateStatusPanel(data) {
        boatIdVal.textContent = data.boat_id;
        boatNameVal.textContent = data.boat_name || '--'; // 更新船只名称，如果不存在则显示'--'
        lonVal.textContent = data.lon.toFixed(6);       // 经度保留6位小数
        latVal.textContent = data.lat.toFixed(6);       // 纬度保留6位小数
        speedVal.textContent = data.speed_knots.toFixed(2); // 速度保留2位小数
        bearingVal.textContent = data.bearing_deg.toFixed(2); // 航向保留2位小数
        warningLevelVal.textContent = data.warning_level; // 显示预警等级
        // 根据预警等级更新状态面板的CSS类，从而改变其背景颜色或边框样式
        statusPanel.className = `panel warning-level-${data.warning_level}`;
    }

    /**
     * 从后端API获取所有已知船只的列表及其最新状态，并更新本地 `boatsData` 对象。
     * 此函数在WebSocket连接成功后首次调用，以确保前端能显示所有已注册的船只。
     */
    async function fetchBoatList() {
        try {
            const response = await fetch('http://localhost:8000/api/boats');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const boats = await response.json();
            // 遍历从后端获取的船只列表
            boats.forEach(b => {
                // 如果本地 `boatsData` 中没有该船只的数据，则创建一个占位符。
                // 此时无法获取实时的 `warning_level`，暂时设为0。
                if (!boatsData[b.boat_id]) {
                    boatsData[b.boat_id] = { marker: null, warning_level: 0 }; 
                }
            });
            updateBoatList(); // 更新UI上的船只列表
        } catch (error) {
            console.error("无法获取船只列表:", error);
            statusText.textContent = "错误: 无法获取船只列表";
        }
    }

    /**
     * 根据 `boatsData` 对象的内容，重新渲染左侧的船只列表UI。
     * 此函数会清空现有列表，并为每艘船只创建一个新的列表项，
     * 包括船只ID和当前预警等级对应的图标。
     */
    function updateBoatList() {
        boatList.innerHTML = ''; // 清空当前的船只列表
        // 遍历 `boatsData` 中所有船只的ID
        Object.keys(boatsData).forEach(boat_id => {
            const li = document.createElement('li'); // 创建新的列表项
            li.dataset.boatId = boat_id; // 将船只ID存储在data属性中
            // 如果当前列表项对应的船只是选中状态，则添加 'selected' 类
            if (boat_id === selectedBoatId) {
                li.classList.add('selected');
            }
            // 为列表项绑定点击事件，点击时选中该船只
            li.addEventListener('click', () => selectBoat(boat_id));

            const boatNameSpan = document.createElement('span');
            boatNameSpan.textContent = boat_id; // 显示船只ID
            li.appendChild(boatNameSpan);

            // 添加船只状态图标 (根据预警等级显示不同图标)
            const statusImg = document.createElement('img');
            statusImg.classList.add('boat-status-icon');
            // 获取船只的预警等级，如果不存在则默认为0级
            const warningLevel = boatsData[boat_id] && boatsData[boat_id].warning_level !== undefined ? boatsData[boat_id].warning_level : 0; 
            statusImg.src = `../Toolbox/icons/warning_sign${warningLevel}.png`; // 设置图标路径
            statusImg.alt = `Warning Level ${warningLevel}`; // 设置alt文本
            li.appendChild(statusImg);

            boatList.appendChild(li); // 将列表项添加到船只列表中
        });
    }

    /**
     * 处理船只选择逻辑。
     * 当用户点击船只列表中的某个船只时，此函数会被调用。
     * 它会更新选中状态，显示/隐藏对应船只的实时轨迹和预测轨迹，并更新状态面板。
     * 
     * @param {string} boat_id - 被选中的船只的唯一标识符。
     */
    function selectBoat(boat_id) {
        // 如果点击的已经是当前选中的船只，则不执行任何操作
        if (selectedBoatId === boat_id) return;

        selectedBoatId = boat_id; // 更新当前选中船只的ID
        updateBoatList(); // 重新渲染船只列表，以高亮显示新选中的船只

        // 遍历所有船只，根据选中状态显示或隐藏其历史轨迹和预测轨迹
        Object.keys(boatsData).forEach(id => {
            const b = boatsData[id];
            // 确保船只对象和其轨迹图层存在
            if (b && b.historyPolyline && b.predictionPolyline) {
                if (id === selectedBoatId) {
                    // 如果是选中的船只，将其轨迹图层添加到地图
                    map.addLayer(b.historyPolyline);
                    map.addLayer(b.predictionPolyline);
                } else {
                    // 如果不是选中的船只，将其轨迹图层从地图移除
                    map.removeLayer(b.historyPolyline);
                    map.removeLayer(b.predictionPolyline);
                }
            }
        });

        const boat = boatsData[boat_id];
        // 如果选中的船只标记存在，则将地图视角平移到该船只的位置
        if (boat && boat.marker) {
            map.panTo(boat.marker.getLatLng());
        }
        
        // 清空状态面板的显示内容，等待该船只的下一次实时数据更新
        boatIdVal.textContent = boat_id;
        boatNameVal.textContent = '--'; // 清空船只名称
        lonVal.textContent = '--';
        latVal.textContent = '--';
        speedVal.textContent = '--'; // 清空速度显示
        bearingVal.textContent = '--'; // 清空航向显示
        warningLevelVal.textContent = '--';
        statusPanel.className = 'panel'; // 重置状态面板的CSS样式
    }

    /**
     * 查询并显示指定船只在特定时间范围内的历史轨迹和历史预警数据。
     * 数据从后端API获取，并在地图上绘制。
     */
    async function queryHistory() {
        const selectedHistoryBoatId = historyBoatSelect.value;
        const startTime = startTimeInput.value;
        const endTime = endTimeInput.value;

        if (!startTime || !endTime) {
            alert("请输入开始和结束时间！");
            return;
        }

        // 清除地图上旧的历史图层
        historyDisplayLayer.clearLayers();
        warningList.innerHTML = ''; // 清空预警信息列表

        try {
            if (selectedHistoryBoatId === 'all_boats') {
                // 查询所有警报
                const allWarningsResponse = await fetch(`http://localhost:8000/api/all_warnings?start_time=${startTime}&end_time=${endTime}`);
                if (!allWarningsResponse.ok) {
                    throw new Error(`HTTP error! status: ${allWarningsResponse.status}`);
                }
                const allWarningsData = await allWarningsResponse.json();
                updateWarningList(allWarningsData); // 只更新预警信息列表
            } else if (selectedHistoryBoatId) {
                // 查询特定船只的历史数据
                // 1. 获取历史轨迹数据
                const historyResponse = await fetch(`http://localhost:8000/api/boats/${selectedHistoryBoatId}/history?start_time=${startTime}&end_time=${endTime}`);
                if (!historyResponse.ok) {
                    throw new Error(`HTTP error! status: ${historyResponse.status}`);
                }
                const historyData = await historyResponse.json();
                
                // 2. 获取历史预警数据
                const warningsResponse = await fetch(`http://localhost:8000/api/boats/${selectedHistoryBoatId}/warnings?start_time=${startTime}&end_time=${endTime}`);
                if (!warningsResponse.ok) {
                    throw new Error(`HTTP error! status: ${warningsResponse.status}`);
                }
                const warningsData = await warningsResponse.json();

                // 3. 绘制历史轨迹线
                const historyPath = historyData.map(p => [p.latitude, p.longitude]);
                if (historyPath.length > 0) {
                    L.polyline(historyPath, { color: 'blue', weight: 3 }).addTo(historyDisplayLayer);
                } else {
                    console.log("没有找到历史轨迹数据。");
                }

                // 4. 使用预警等级图标来绘制历史预警点
                warningsData.forEach(w => {
                    L.marker([w.latitude, w.longitude], {
                        icon: warningIcons[w.warning_level] || warningIcons[0]
                    }).bindPopup(`<b>预警等级: ${w.warning_level}</b><br>${new Date(w.timestamp).toLocaleString()}`)
                      .addTo(historyDisplayLayer);
                });

                historyDisplayLayer.addTo(map); // 将包含历史轨迹和预警点的图层组添加到地图
                updateWarningList(warningsData); // 更新预警信息列表

                // 如果有历史轨迹数据，将地图视图缩放到整个历史轨迹的范围
                if (historyPath.length > 0) {
                    map.fitBounds(L.polyline(historyPath).getBounds());
                }
            } else {
                alert("请选择一艘船或选择'所有船只'进行历史查询！");
            }
        } catch (error) {
            console.error("查询历史数据失败:", error);
            statusText.textContent = "错误: 查询历史数据失败";
        }
    }

    /**
     * 清除历史查询结果。
     */
    function clearHistory() {
        historyDisplayLayer.clearLayers();
        warningList.innerHTML = ''; // 清空预警信息列表
    }

    /**
     * 更新预警信息列表。
     * @param {Array} warnings - 预警数据数组。
     */
    function updateWarningList(warnings) {
        warningList.innerHTML = ''; // 清空列表
        if (warnings.length === 0) {
            const li = document.createElement('li');
            li.textContent = '没有预警信息';
            warningList.appendChild(li);
            return;
        }
        warnings.forEach(w => {
            const li = document.createElement('li');
            const time = new Date(w.timestamp).toLocaleString();
            // 如果是查询所有警报，需要显示船只ID
            const boatIdDisplay = w.boat_id ? `<strong>船只ID:</strong> ${w.boat_id} <br>` : '';
            li.innerHTML = `${boatIdDisplay}<strong>时间:</strong> ${time} <br> <strong>等级:</strong> ${w.warning_level}`;
            warningList.appendChild(li);
        });
    }
    // =========================================================================
    // 程序入口与事件绑定
    // =========================================================================
    
    initMap();
    connectToBackend();
    queryHistoryBtn.addEventListener('click', queryHistory);
    clearHistoryBtn.addEventListener('click', clearHistory);

    // 新增：侧边栏切换事件
    leftSidebarToggle.addEventListener('click', () => {
        leftSidebar.classList.toggle('is-expanded');
        if (leftSidebar.classList.contains('is-expanded')) {
            leftSidebarToggle.style.left = leftSidebar.offsetWidth + 'px'; // 移动到侧边栏右边缘
            leftSidebarToggle.textContent = '>';
        } else {
            leftSidebarToggle.style.left = '0'; // 移回屏幕左边缘
            leftSidebarToggle.textContent = '<';
        }
    });

    rightSidebarToggle.addEventListener('click', () => {
        rightSidebar.classList.toggle('is-expanded');
        if (rightSidebar.classList.contains('is-expanded')) {
            rightSidebarToggle.style.right = rightSidebar.offsetWidth + 'px'; // 移动到侧边栏左边缘
            rightSidebarToggle.textContent = '<';
        } else {
            rightSidebarToggle.style.right = '0'; // 移回屏幕右边缘
            rightSidebarToggle.textContent = '>';
        }
    });


    // 切换标签显示事件
    toggleLabelsBtn.addEventListener('click', () => {
        showLabels = !showLabels; // 切换状态
        toggleLabelsBtn.textContent = showLabels ? '隐藏标签' : '显示标签'; // 更新按钮文本
        Object.values(boatsData).forEach(boat => {
            if (boat.label) {
                if (showLabels) {
                    boat.label.addTo(map);
                } else {
                    map.removeLayer(boat.label);
                }
            }
        });
    });
});
