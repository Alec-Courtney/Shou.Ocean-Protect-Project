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

    // 预警统计面板元素
    const statsTitle = document.getElementById('stats-title');
    const statsCount = document.getElementById('stats-count');

    // 新增：侧边栏元素
    const leftSidebar = document.getElementById('left-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');
    // 修正：切换按钮现在是body的直接子元素
    const leftSidebarToggle = document.getElementById('left-sidebar-toggle');
    // const rightSidebarToggle = document.getElementById('right-sidebar-toggle'); // 不再需要

    // 预警弹窗容器
    const warningContainer = document.getElementById('warning-container');
    const warningSound = document.getElementById('warning-sound'); // 新增：预警声音元素


    // 地图和通信核心对象 (V4.0)
    let map = null;
    let fishingZonesLayer = null;
    let socket = null;
    let canvasRenderer = null; // Canvas渲染器实例
    let config = {}; // V4.4 新增：用于存储从后端获取的配置

    // 多船数据管理
    const boatsData = {}; // key: boat_id, value: { marker, historyPolyline, predictionPolyline, label, last_update, ... }
    const allBoatsInfo = {}; // V4.4 新增：用于存储所有船只的静态信息 (ID和名称)
    let selectedBoatId = null;
    let historyDisplayLayer = L.layerGroup(); // 用于显示历史查询结果的图层组
    let showLabels = false; // 控制是否显示船只标签的全局变量

    // V4.6 新增：用于跟踪当日预警总数的变量
    let dailyWarningCount = 0;

    // 预加载不同预警等级的图标，避免重复创建
    const warningIcons = {
        0: L.icon({
            iconUrl: '../Toolbox/icons/warning_sign0.png',
            iconSize: [28.8, 28.8],
            iconAnchor: [16, 16], // 图标锚点，设为中心
        }),
        1: L.icon({
            iconUrl: '../Toolbox/icons/warning_sign1.png',
            iconSize: [28.8, 28.8],
            iconAnchor: [16, 16],
        }),
        2: L.icon({
            iconUrl: '../Toolbox/icons/warning_sign2.png',
            iconSize: [28.8, 28.8],
            iconAnchor: [16, 16],
        }),
        3: L.icon({
            iconUrl: '../Toolbox/icons/warning_sign3.png',
            iconSize: [28.8, 28.8],
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

        // 使用 Esri World Imagery 卫星图层作为底图
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            noWrap: true
        }).addTo(map);

        fetchConfig(); // V4.5 新增：加载后端配置
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

    /**
     * V4.5 新增：从后端API异步获取配置数据。
     * 这些配置将用于控制前端行为，例如船只离线超时时间。
     */
    async function fetchConfig() {
        try {
            const response = await fetch('http://localhost:8000/api/config');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            config = await response.json();
            
            // 启动一个定时器，定期刷新船只列表以检查离线状态
            setInterval(updateBoatList, 5000); // 每5秒刷新一次

        } catch (error) {
            console.error("无法加载配置文件:", error);
            // 使用默认值以保证基本功能可用
            config = {
                frontend_parameters: {
                    offline_timeout_seconds: 60
                }
            };
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
        socket.on('connect', async () => { // V4.8 修复：改为 async 函数
            console.log('成功连接到WebSocket服务器');
            statusText.textContent = '已连接';
            statusText.style.color = 'green';
            fetchBoatList(); // 连接成功后，立即从后端获取初始实时船只列表
            
            // V4.8 修复：确保先获取船只名称缓存，再获取当天预警列表
            await fetchHistoryBoats(); // 等待船只信息加载完成
            fetchTodayWarnings();      // 然后再获取和渲染预警列表
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

        // --- 新增逻辑开始 ---
        // 监听 'today_warning_count_update' 事件，接收后端推送的当日预警总数更新
        socket.on('today_warning_count_update', (data) => {
            console.log('收到当日预警总数更新:', data.count);
            // 更新统计面板显示的预警总数
            statsCount.textContent = data.count;
            // 同时更新前端的 dailyWarningCount 变量
            dailyWarningCount = data.count;
        });
        // --- 新增逻辑结束 ---
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
        const { boat_id, boat_name, lat, lon, bearing_deg, warning_level, prediction_path, timestamp } = data;
        const latLng = [lat, lon]; // Leaflet 接受 [latitude, longitude] 格式

        // 步骤 1: 检查船只图层是否存在于 `boatsData` 中，如果不存在则为新船只创建所有图层。
        if (!boatsData[boat_id] || !boatsData[boat_id].marker) {
            createBoatLayers(boat_id, { latLng, warning_level });
        }

        // 步骤 2: 获取现有图层对象并进行属性更新。
        const boat = boatsData[boat_id];
        
        // V4.5 新增：更新船只的最后通信时间戳
        boat.last_update = Date.now();

        // 2.1 更新船只 Marker (图标) 的位置
        boat.marker.setLatLng(latLng);

        // 2.2 仅在预警等级发生变化时才更新图标和触发弹窗
        if (boat.warning_level !== warning_level) {
            boat.marker.setIcon(warningIcons[warning_level] || warningIcons[0]); // 更新图标

            // 当预警等级发生变化且大于0时，触发弹窗逻辑
            if (warning_level > 0) {
                // V4.9: 增加当日预警计数
                dailyWarningCount++;
                statsCount.textContent = dailyWarningCount; // 更新统计面板显示
                
                // 创建并显示新的预警项
                showWarning({
                    level: warning_level,
                    name: boat_name || '未知船只',
                    id: boat_id,
                    time: new Date(timestamp).toLocaleString(),
                    lon: lon,
                    lat: lat
                });
                // --- 新增逻辑开始 ---
                // 当有新的预警时，调用 clearHistory() 来刷新历史预警列表
                clearHistory();
                // --- 新增逻辑结束 ---
            }
            // 注意：预警解除时 (warning_level变为0)，我们不主动移除弹窗，让它自然被新的弹窗顶替掉

            boat.warning_level = warning_level; // 更新缓存中的预警等级
            updateBoatList(); // 更新UI列表中的船只图标
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

        // 2.5 更新预测轨迹线 (predictionPolyline) - 方案A改造
        // 实现离船只越远，轨迹越透明的效果
        boat.predictionPolyline.clearLayers(); // 清空旧的预测线段
        const leafletPath = prediction_path.map(p => [p[1], p[0]]);
        
        if (leafletPath.length > 1) {
            const totalSegments = leafletPath.length - 1;
            for (let i = 0; i < totalSegments; i++) {
                // 计算当前线段的透明度，从不透明 (1.0) 递减到接近透明 (例如 0.2)
                const opacity = 1.0 - (i / totalSegments) * 0.8;
                
                const segment = [leafletPath[i], leafletPath[i+1]];
                L.polyline(segment, {
                    color: '#ff4500',   // 橙红色
                    weight: 3,
                    dashArray: '5, 10',
                    opacity: opacity,   // 应用动态计算的透明度
                    renderer: canvasRenderer
                }).addTo(boat.predictionPolyline);
            }
        }

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
            // 方案A改造：预测轨迹不再是单一折线，而是一个图层组，用于容纳多个不同透明度的线段
            predictionPolyline: L.layerGroup(),
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
            // 清空并填充 allBoatsInfo 对象
            Object.keys(allBoatsInfo).forEach(key => delete allBoatsInfo[key]);
            boats.forEach(b => {
                allBoatsInfo[b.boat_id] = { boat_name: b.boat_name || b.boat_id };
            });

            // 保留“所有船只”和“请选择船只”选项
            historyBoatSelect.innerHTML = '<option value="all_boats">-- 所有船只 --</option><option value="">-- 请选择船只 --</option>';
            boats.forEach(b => {
                const option = document.createElement('option');
                option.value = b.boat_id;
                // 下拉列表中显示船只名称，如果名称不存在则显示ID
                option.textContent = b.boat_name || b.boat_id;
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
                // 如果本地 `boatsData` 中没有该船只的数据，则创建一个包含最后更新时间的对象。
                if (!boatsData[b.boat_id]) {
                    boatsData[b.boat_id] = { 
                        marker: null, 
                        warning_level: 0,
                        // V4.5 修正：将API返回的ISO格式时间字符串转换为毫秒时间戳
                        last_update: new Date(b.last_update_time).getTime() 
                    };
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
        const now = Date.now();
        const offlineTimeout = (config.frontend_parameters?.offline_timeout_seconds || 60) * 1000;

        // V4.5 修改：只显示在线的船只
        const onlineBoats = Object.keys(boatsData).filter(boat_id => {
            const boat = boatsData[boat_id];
            // V4.5 修正：船只必须有 last_update 时间戳，并且该时间戳在超时范围内，才视为在线
            return boat.last_update && (now - boat.last_update < offlineTimeout);
        });

        if (onlineBoats.length === 0) {
            boatList.innerHTML = '<li>没有在线的船只</li>';
            return;
        }

        onlineBoats.forEach(boat_id => {
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

        // 遍历所有船只，根据选中状态显示或隐藏其预测轨迹
        Object.keys(boatsData).forEach(id => {
            const b = boatsData[id];
            // 确保船只对象和其轨迹图层存在
            if (b && b.predictionPolyline) {
                if (id === selectedBoatId) {
                    // 如果是选中的船只，将其预测轨迹图层添加到地图
                    map.addLayer(b.predictionPolyline);
                } else {
                    // 如果不是选中的船只，将其预测轨迹图层从地图移除
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
    function queryHistory() {
        const selectedHistoryBoatId = historyBoatSelect.value;
        // 修复：将本地时间转换为ISO格式字符串，并确保包含秒
        const startTime = startTimeInput.value ? new Date(startTimeInput.value + ':00').toISOString() : null;
        const endTime = endTimeInput.value ? new Date(endTimeInput.value + ':00').toISOString() : null;

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
                const allWarningsResponse = fetch(`http://localhost:8000/api/all_warnings?start_time=${startTime}&end_time=${endTime}`);
                allWarningsResponse.then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.json();
                }).then(allWarningsData => {
                    updateWarningList(allWarningsData); // 只更新预警信息列表
                    // V4.9: 更新当日预警总数，因为查询历史可能不影响当日总数，但为了UI一致性，我们不在这里更新它
                    // statsTitle.textContent = '当前查询预警数';
                    // statsCount.textContent = allWarningsData.length;
                }).catch(error => {
                    console.error("无法获取所有历史预警:", error);
                    statusText.textContent = "错误: 无法获取所有历史预警";
                });
            } else if (selectedHistoryBoatId) {
                // 查询特定船只的历史数据
                // 1. 获取历史轨迹数据
                const historyResponse = fetch(`http://localhost:8000/api/boats/${selectedHistoryBoatId}/history?start_time=${startTime}&end_time=${endTime}`);
                // 2. 获取历史预警数据
                const warningsResponse = fetch(`http://localhost:8000/api/boats/${selectedHistoryBoatId}/warnings?start_time=${startTime}&end_time=${endTime}`);

                Promise.all([historyResponse, warningsResponse])
                    .then(responses => Promise.all(responses.map(res => {
                        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
                        return res.json();
                    })))
                    .then(([historyData, warningsData]) => {
                        // 更新统计面板
                        statsTitle.textContent = '当前查询预警数';
                        statsCount.textContent = warningsData.length;

                        // 3. 绘制历史轨迹线
                        const historyPath = historyData.map(p => [p.latitude, p.longitude]);
                        if (historyPath.length > 0) {
                            L.polyline(historyPath, { color: 'blue', weight: 3 }).addTo(historyDisplayLayer);
                        } else {
                            console.log("没有找到历史轨迹数据。");
                        }

                        // 4. 恢复功能：在地图上绘制历史预警点
                        warningsData.forEach(w => {
                            const warningLatLng = [w.latitude, w.longitude];
                            const warningIcon = warningIcons[w.warning_level] || warningIcons[0];
                            L.marker(warningLatLng, { icon: warningIcon })
                                .bindPopup(`<b>预警等级: ${w.warning_level}</b><br>时间: ${new Date(w.timestamp).toLocaleString()}<br>经度: ${w.longitude.toFixed(6)}<br>纬度: ${w.latitude.toFixed(6)}`)
                                .addTo(historyDisplayLayer);
                        });

                        historyDisplayLayer.addTo(map); // 将包含历史轨迹和预警点的图层组添加到地图
                        updateWarningList(warningsData, selectedHistoryBoatId); // 更新预警信息列表

                        // 如果有历史轨迹数据，将地图视图缩放到整个历史轨迹的范围
                        if (historyPath.length > 0) {
                            map.fitBounds(L.polyline(historyPath).getBounds());
                        }
                    })
                    .catch(error => {
                        console.error("查询历史数据失败:", error);
                        statusText.textContent = "错误: 查询历史数据失败";
                    });
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
        // V4.9: 恢复显示当日预警总数和列表
        updateTodayWarningCount(); 
        fetchTodayWarnings(); 
    }

    /**
     * V4.6 新增：获取并更新当天的预警总数。
     */
    async function updateTodayWarningCount() {
        try {
            const response = await fetch('http://localhost:8000/api/warnings/today_count');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            statsTitle.textContent = '当日预警总数';
            statsCount.textContent = data.count;
            // V4.9: 初始化 dailyWarningCount
            dailyWarningCount = data.count;
        } catch (error) {
            console.error("无法获取当天预警总数:", error);
            statsCount.textContent = '错误';
            dailyWarningCount = 0; // 发生错误时重置计数
        }
    }

    /**
     * V4.7 新增：获取并显示当天的预警列表。
     */
    async function fetchTodayWarnings() {
        try {
            const response = await fetch('http://localhost:8000/api/warnings/today');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const warnings = await response.json();
            updateWarningList(warnings);
        } catch (error) {
            console.error("无法获取当天预警列表:", error);
            warningList.innerHTML = '<li>无法加载当天预警</li>';
        }
    }

    /**
     * 更新预警信息列表。
     * @param {Array} warnings - 预警数据数组。
     * @param {string | null} boatIdForHistory - (可选) 当查询单个船只历史时，传入其ID。
     */
    function updateWarningList(warnings, boatIdForHistory = null) {
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
            const boatId = w.boat_id || boatIdForHistory;
            const boatName = allBoatsInfo[boatId]?.boat_name || '未知船只';

            // 获取颜色
            const levelColor = getComputedStyle(document.documentElement).getPropertyValue(`--warning-level-${w.warning_level}-bg`).trim();
            const levelTextColor = getComputedStyle(document.documentElement).getPropertyValue(`--warning-level-${w.warning_level}-text`).trim();

            li.innerHTML = `
                <div class="warning-popup">
                    <div class="warning-popup-level" style="background-color: ${levelColor}; color: ${levelTextColor};">
                        <span>${w.warning_level}</span>
                    </div>
                    <div class="warning-popup-info">
                        <div class="boat-info">
                            <span class="boat-name">${boatName}</span>
                            <span class="boat-id">${boatId}</span>
                        </div>
                        <div class="time-info">${time}</div>
                        <div class="location-info">经度: ${w.longitude.toFixed(6)}, 纬度: ${w.latitude.toFixed(6)}</div>
                    </div>
                </div>
            `;
            warningList.appendChild(li);
        });
    }
    // =========================================================================
    // 程序入口与事件绑定
    // =========================================================================
    
    initMap();
    connectToBackend();
    updateTodayWarningCount(); // 页面加载时获取当天预警总数
    // V4.8 修复：移除此处的调用，已移至 'connect' 事件回调中，以避免竞态条件
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

    // 右侧侧边栏切换逻辑已移除


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

    /**
     * 创建并显示一个新的预警弹窗项。
     * @param {object} data - 包含预警信息的对象。
     */
    function showWarning(data) {
        const { level, name, id, time, lon, lat } = data;

        // 1. 创建新的弹窗元素
        const warningEl = document.createElement('div');
        warningEl.className = 'warning-popup';

        // 2. 获取颜色
        const levelColor = getComputedStyle(document.documentElement).getPropertyValue(`--warning-level-${level}-bg`).trim();
        const levelTextColor = getComputedStyle(document.documentElement).getPropertyValue(`--warning-level-${level}-text`).trim();

        // 3. 填充内容
        warningEl.innerHTML = `
            <div class="warning-popup-level" style="background-color: ${levelColor}; color: ${levelTextColor};">
                <span>${level}</span>
            </div>
            <div class="warning-popup-info">
                <div class="boat-info">
                    <span class="boat-name">${name}</span>
                    <span class="boat-id">${id}</span>
                </div>
                <div class="time-info">${time}</div>
                <div class="location-info">经度: ${lon.toFixed(6)}, 纬度: ${lat.toFixed(6)}</div>
            </div>
        `;

        // 4. 将新弹窗添加到容器顶部
        warningContainer.prepend(warningEl);

        // 5. 限制最大显示数量，例如最多显示5个
        const maxWarnings = 5;
        while (warningContainer.children.length > maxWarnings) {
            warningContainer.removeChild(warningContainer.lastChild);
        }

        // 新增功能：播放提示音
        if (warningSound) {
            warningSound.play().catch(error => console.error("音频播放失败: 请确保 'frontend/sounds/warning.mp3' 文件存在。", error));
        }

        // 新增功能：平滑移动地图视角到预警船只
        const targetLatLng = [lat, lon];
        map.flyTo(targetLatLng, 12, { // 飞到目标坐标，缩放级别设为12
            animate: true,
            duration: 1.5 // 动画持续时间1.5秒
        });
    }
});
