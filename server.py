# -*- coding: utf-8 -*-
"""
功能: 渔船离境智能预警系统后端主服务器。
      负责处理与前端的实时通信、接收GPS数据、调用核心算法进行分析，并提供Web API服务。

主要职责:
- 启动 ASGI 服务器 (Uvicorn)。
- 使用 Socket.IO (基于WebSocket) 与前端进行双向实时通信。
- 提供 FastAPI 应用来处理常规 HTTP API 请求。

V4.2 更新亮点:
- 支持接收和存储船只名称 (`boat_name`)。
- 智能预警记录: 避免重复记录持续性预警，仅在等级变化时记录。
- 数据库查询优化: 为历史数据查询添加索引。
- 历史轨迹数据抽稀: 减少前端渲染压力。
- 可配置日志系统: 通过 `config.json` 控制日志级别。
"""

import os
import json
import time
import asyncio
import winsound
import uvicorn
import logging
import sqlite3
from datetime import datetime
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import socketio

# =============================================================================
# 日志系统配置 (V4.2)
# =============================================================================
# 日志配置函数，将在服务器启动时被调用
def setup_logging(log_level_str: str):
    """
    根据给定的级别字符串配置全局日志记录器。

    参数:
        log_level_str (str): 日志级别字符串，例如 "INFO", "DEBUG", "WARNING", "ERROR"。
    """
    log_level = getattr(logging, log_level_str.upper(), logging.INFO)
    
    # 移除所有现有的处理器，以避免重复记录
    for handler in logging.root.handlers[:]:
        logging.root.removeHandler(handler)
        
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(levelname)s - [%(module)s:%(lineno)d] - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    logging.info(f"日志系统已配置，级别为: {log_level_str}")

# =============================================================================
# 全局设置与路径配置
# =============================================================================
# 项目根目录，用于构建所有文件的绝对路径
project_root = os.path.dirname(os.path.abspath(__file__))

# 将 'Scripts' 目录添加到 Python 模块搜索路径中，以便导入其中的模块
import sys
sys.path.append(os.path.join(project_root, 'Scripts'))
from WarningAnalysis import analyze_realtime_point
from database import init_db, DB_PATH

# =============================================================================
# ASGI 应用架构
# =============================================================================
# 最终解决方案：采用控制反转模式，让 Socket.IO 作为主应用，FastAPI 作为子应用。
# 这种架构能从根本上解决 FastAPI 和 Socket.IO 之间因库版本不兼容而产生的路由冲突。

# 1. 创建 FastAPI 应用实例，它将专门处理所有非 WebSocket 的常规 HTTP API 请求。
fastapi_app = FastAPI()

# 2. 为 FastAPI 应用配置 CORS (跨源资源共享) 中间件，允许任何来源的请求。
#    这是为了方便在开发环境中，前端页面(通常通过 file:// 协议打开)能顺利访问后端API。
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. 创建 Socket.IO 服务器实例。
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')

# 4. 创建一个组合的 ASGI 应用。
#    - sio 是主应用，负责处理所有 /socket.io/ 路径下的 WebSocket 请求。
#    - other_asgi_app=fastapi_app 指定，所有其他路径的请求都将转发给 FastAPI 应用处理。
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

# =============================================================================
# 全局状态变量
# =============================================================================
config = {}                 # 存储从 config.json 加载的配置
SOUND_PARAMS = {}           # 存储预构建的声音警报参数
last_sent_times = {}        # 缓存每艘船上次通过WebSocket发送数据的时间戳 (V4.5新增)
last_warning_state = {}     # 缓存每艘船的最后预警等级，用于去重 (V4.3新增)
WEBSOCKET_SEND_INTERVAL = 0.5 # WebSocket数据发送最小间隔（秒），用于节流，缓解前端地图更新卡顿和不同步问题

# =============================================================================
# 配置与数据处理
# =============================================================================
def load_config():
    """
    从 config.json 文件加载并处理系统配置。
    同时预先计算并缓存声音警报的参数，避免在运行时重复计算。
    """
    global config, SOUND_PARAMS
    config_path = os.path.join(project_root, 'config.json')
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        logging.info(f"成功加载配置文件: {config_path}")
    except FileNotFoundError:
        logging.error(f"配置文件未找到: {config_path}")
        # 可以选择退出或使用默认配置
        raise
    except json.JSONDecodeError:
        logging.error(f"配置文件格式错误: {config_path}")
        raise
    
    # 预先计算并缓存声音警报的参数
    ANALYSIS_CONFIG = config.get('analysis_parameters', {})
    SOUND_FREQUENCIES = {1: 1000, 2: 700, 3: 400} # 预警等级对应的声音频率
    SOUND_DURATIONS = {1: 500, 2: 300, 3: 200}   # 预警等级对应的声音持续时间
    SOUND_INTERVALS = {int(k): v for k, v in ANALYSIS_CONFIG.get('warning_sound_intervals_seconds', {}).items()}
    SOUND_REPEATS = {int(k): v for k, v in ANALYSIS_CONFIG.get('warning_sound_repeat_counts', {}).items()}
    
    SOUND_PARAMS = {0: (0, 0, 0, 0)} # 等级0代表无警报，无声音参数
    for level in SOUND_INTERVALS.keys():
        SOUND_PARAMS[level] = (
            SOUND_FREQUENCIES.get(level, 0),
            SOUND_DURATIONS.get(level, 0),
            SOUND_INTERVALS.get(level, 0),
            SOUND_REPEATS.get(level, 1)
        )
    logging.debug("声音警报参数已缓存。")

# =============================================================================
# 数据模型 (Pydantic)
# =============================================================================
class GPSData(BaseModel):
    """
    定义接收GPS数据的数据模型。

    属性:
        boat_id (str): 船只的唯一标识符。
        boat_name (str | None): 船只的名称，可选。 (V4.4 新增)
        latitude (float): 纬度。
        longitude (float): 经度。
        speed_knots (float): 速度，单位节。
        bearing_deg (float): 航向，单位度。
        timestamp (datetime): 数据生成的时间戳，默认为当前UTC时间。
    """
    boat_id: str
    boat_name: str | None = None
    latitude: float
    longitude: float
    speed_knots: float
    bearing_deg: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)

# =============================================================================
# 数据库辅助函数
# =============================================================================
def get_db_connection():
    """
    创建并返回一个SQLite数据库连接。
    配置 row_factory 以便可以通过列名访问查询结果。

    返回:
        sqlite3.Connection: 数据库连接对象。
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row # 允许通过字典键访问列
    return conn

# =============================================================================
# HTTP API Endpoints (V4.0)
# =================================
async def process_gps_data_background(data: GPSData):
    """
    在后台异步处理GPS数据，包括数据库操作、实时分析和WebSocket推送。
    此函数作为FastAPI的BackgroundTasks运行，不阻塞主请求。

    参数:
        data (GPSData): 接收到的GPS数据模型实例。
    """
    # 在后台任务中，不能直接抛出HTTPException，只能记录错误。
    try:
        logging.info(f"后台任务开始处理船只 {data.boat_id} 的数据...")
        
        # 1. 存入数据库
        conn = get_db_connection()
        try:
            # 更新或插入船只信息 (V4.4 修改: 支持 boat_name)
            if data.boat_name:
                conn.execute(
                    """
                    INSERT INTO boats (boat_id, boat_name, last_update_time) 
                    VALUES (?, ?, ?) 
                    ON CONFLICT(boat_id) DO UPDATE SET 
                        boat_name = excluded.boat_name, 
                        last_update_time = excluded.last_update_time
                    """,
                    (data.boat_id, data.boat_name, data.timestamp)
                )
            else:
                conn.execute(
                    """
                    INSERT INTO boats (boat_id, last_update_time) 
                    VALUES (?, ?) 
                    ON CONFLICT(boat_id) DO UPDATE SET 
                        last_update_time = excluded.last_update_time
                    """,
                    (data.boat_id, data.timestamp)
                )
            # 插入GPS位置点
            conn.execute(
                """
                INSERT INTO gps_positions (boat_id, timestamp, latitude, longitude, speed_knots, bearing_deg) 
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (data.boat_id, data.timestamp, data.latitude, data.longitude, data.speed_knots, data.bearing_deg)
            )
            conn.commit()
            logging.debug(f"船只 {data.boat_id} 的GPS数据已存入数据库。")
        except sqlite3.Error as e:
            logging.error(f"后台任务数据库操作失败: {e}", exc_info=True)
            # 即使数据库操作失败，也尝试继续后续的分析和推送，避免中断整个服务
        finally:
            conn.close()

        # 2. 实时分析
        fishing_zones_path = os.path.join(project_root, 'frontend', 'data', 'fishing_zones.geojson')
        point_data = {
            'lat': data.latitude,
            'lon': data.longitude,
            'speed_knots': data.speed_knots,
            'bearing_deg': data.bearing_deg
        }
        # 调用 WarningAnalysis 模块进行实时预警分析
        warning_level, prediction_path = analyze_realtime_point(point_data, fishing_zones_path, config)

        # 3. 存储预警 (V4.3 增加去重逻辑: 仅在预警等级变化时记录)
        last_warning_level = last_warning_state.get(data.boat_id, 0) # 获取该船只上次的预警等级，默认为0 (无预警)
        
        if warning_level != last_warning_level: # 如果当前预警等级与上次不同
            logging.info(f"船只 {data.boat_id} 预警等级变化: {last_warning_level} -> {warning_level}")
            # 仅当预警开始或等级变化到非零级别时才记录
            if warning_level > 0:
                conn = get_db_connection()
                try:
                    conn.execute(
                        """
                        INSERT INTO warnings (boat_id, timestamp, warning_level, latitude, longitude, details) 
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (data.boat_id, data.timestamp, warning_level, data.latitude, data.longitude, f"预测路径: {prediction_path}")
                    )
                    conn.commit()
                    logging.info(f"已记录新的预警到数据库。船只: {data.boat_id}, 等级: {warning_level}")
                except sqlite3.Error as e:
                    logging.error(f"后台任务预警信息写入数据库失败: {e}", exc_info=True)
                finally:
                    conn.close()
            
            # 更新该船只的最后预警状态，用于下次检查
            last_warning_state[data.boat_id] = warning_level
        
        elif warning_level > 0:
            # 如果预警等级未变化且仍处于预警状态，则不重复记录，仅调试日志
            logging.debug(f"预警去重 (持续). 船只: {data.boat_id}, 等级: {warning_level}")

        # 4. 实时推送 (V4.5 增加节流逻辑: 控制WebSocket发送频率)
        current_time = time.time()
        last_sent = last_sent_times.get(data.boat_id, 0)

        if current_time - last_sent > WEBSOCKET_SEND_INTERVAL:
            # 准备要通过WebSocket发送的数据
            data_to_send = {
                "boat_id": data.boat_id,
                "boat_name": data.boat_name,
                "lat": data.latitude,
                "lon": data.longitude,
                "speed_knots": data.speed_knots,
                "bearing_deg": data.bearing_deg,
                "warning_level": warning_level,
                "prediction_path": prediction_path,
                "timestamp": data.timestamp.isoformat()
            }
            await sio.emit('gps_update', data_to_send) # 向所有连接的客户端广播GPS更新
            last_sent_times[data.boat_id] = current_time # 更新该船只的上次发送时间
            logging.info(f"后台任务已通过WebSocket推送船只 {data.boat_id} 的更新。")
        else:
            logging.debug(f"后台任务中，船只 {data.boat_id} 的数据更新被节流。")

    except Exception as e:
        logging.error(f"处理船只 {data.boat_id} 的后台任务发生未知错误: {e}", exc_info=True)


@fastapi_app.post("/api/gps_data")
async def receive_gps_data(data: GPSData, background_tasks: BackgroundTasks):
    """
    接收来自单个渔船的GPS数据。
    立即返回成功响应，并将实际的数据处理（数据库存储、分析、WebSocket推送）
    放入FastAPI的后台任务中异步执行，以确保API响应的即时性。

    参数:
        data (GPSData): 包含船只GPS信息的数据模型实例。
        background_tasks (BackgroundTasks): FastAPI提供的后台任务管理器。

    返回:
        dict: 包含处理状态和消息的字典。
    """
    logging.info(f"收到来自船只 {data.boat_id} 的GPS数据，已加入后台处理队列。")
    background_tasks.add_task(process_gps_data_background, data)
    return {"status": "success", "message": "数据已接收，正在后台处理"}

@fastapi_app.get("/api/boats")
async def get_all_boats():
    """
    获取所有已知船只的列表及其最新更新时间。

    返回:
        list[dict]: 包含每个船只ID和最后更新时间的字典列表。
    """
    conn = get_db_connection()
    try:
        boats = conn.execute("SELECT boat_id, last_update_time FROM boats ORDER BY last_update_time DESC").fetchall()
        return [dict(row) for row in boats]
    except sqlite3.Error as e:
        logging.error(f"查询所有船只失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="无法获取船只列表")
    finally:
        conn.close()

@fastapi_app.get("/api/boats/{boat_id}/history")
async def get_boat_history(boat_id: str, start_time: datetime, end_time: datetime):
    """
    查询指定船只在特定时间范围内的历史轨迹。
    对返回的数据点进行抽稀处理，以优化前端渲染性能。

    参数:
        boat_id (str): 船只的唯一标识符。
        start_time (datetime): 查询的开始时间。
        end_time (datetime): 查询的结束时间。

    返回:
        list[dict]: 包含时间戳、纬度和经度的历史位置点列表。
    """
    conn = get_db_connection()
    try:
        positions = conn.execute(
            """
            SELECT timestamp, latitude, longitude 
            FROM gps_positions 
            WHERE boat_id = ? AND timestamp BETWEEN ? AND ? 
            ORDER BY timestamp ASC
            """,
            (boat_id, start_time, end_time)
        ).fetchall()
    except sqlite3.Error as e:
        logging.error(f"查询船只 {boat_id} 历史轨迹失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="无法获取历史轨迹")
    finally:
        conn.close()

    # --- 数据抽稀逻辑 (V4.2 新增) ---
    MAX_POINTS = 1000 # 定义最大返回点数
    total_points = len(positions)
    if total_points > MAX_POINTS:
        step = total_points // MAX_POINTS # 计算采样步长
        thinned_positions = positions[::step] # 进行步长采样
        logging.info(f"历史轨迹查询: 原始点数 {total_points}, 抽稀后点数 {len(thinned_positions)}。")
        return [dict(row) for row in thinned_positions]
    
    return [dict(row) for row in positions]

@fastapi_app.get("/api/boats/{boat_id}/warnings")
async def get_boat_warnings(boat_id: str, start_time: datetime, end_time: datetime):
    """
    查询指定船只在特定时间范围内的历史预警记录。

    参数:
        boat_id (str): 船只的唯一标识符。
        start_time (datetime): 查询的开始时间。
        end_time (datetime): 查询的结束时间。

    返回:
        list[dict]: 包含时间戳、纬度、经度、预警等级和详情的历史预警列表。
    """
    conn = get_db_connection()
    try:
        warnings = conn.execute(
            """
            SELECT timestamp, latitude, longitude, warning_level, details 
            FROM warnings 
            WHERE boat_id = ? AND timestamp BETWEEN ? AND ? 
            ORDER BY timestamp ASC
            """,
            (boat_id, start_time, end_time)
        ).fetchall()
        return [dict(row) for row in warnings]
    except sqlite3.Error as e:
        logging.error(f"查询船只 {boat_id} 历史预警失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="无法获取历史预警")
    finally:
        conn.close()

@fastapi_app.get("/api/all_warnings")
async def get_all_warnings(start_time: datetime, end_time: datetime):
    """
    查询所有船只在特定时间范围内的历史预警记录。

    参数:
        start_time (datetime): 查询的开始时间。
        end_time (datetime): 查询的结束时间。

    返回:
        list[dict]: 包含时间戳、纬度、经度、预警等级和详情的历史预警列表。
    """
    conn = get_db_connection()
    try:
        warnings = conn.execute(
            """
            SELECT boat_id, timestamp, warning_level, latitude, longitude, details 
            FROM warnings 
            WHERE timestamp BETWEEN ? AND ? 
            ORDER BY timestamp ASC
            """,
            (start_time, end_time)
        ).fetchall()
        return [dict(row) for row in warnings]
    except sqlite3.Error as e:
        logging.error(f"查询所有历史预警失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="无法获取所有历史预警")
    finally:
        conn.close()

@fastapi_app.get("/api/fishing_zones")
async def get_fishing_zones():
    """
    提供可捕鱼区的 GeoJSON 文件，供前端地图加载。

    返回:
        FileResponse | dict: GeoJSON 文件响应或错误信息。
    """
    geojson_path = os.path.join(project_root, 'frontend', 'data', 'fishing_zones.geojson')
    if os.path.exists(geojson_path):
        return FileResponse(geojson_path, media_type="application/json")
    logging.error(f"GeoJSON 文件未找到: {geojson_path}")
    return JSONResponse(status_code=404, content={"error": "GeoJSON file not found"})

# =============================================================================
# WebSocket 事件处理
# =============================================================================
@sio.event
async def connect(sid, environ):
    """
    当有新的客户端通过WebSocket连接时触发。

    参数:
        sid (str): Socket.IO 会话ID。
        environ (dict): ASGI 环境字典。
    """
    logging.info(f"客户端连接成功: {sid}")

@sio.event
async def disconnect(sid):
    """
    当客户端通过WebSocket断开连接时触发。

    参数:
        sid (str): Socket.IO 会话ID。
    """
    logging.info(f"客户端断开连接: {sid}")


# =============================================================================
# 服务器生命周期事件
# =============================================================================
@fastapi_app.on_event("startup")
async def startup_event():
    """
    FastAPI 服务器启动时执行的事件。
    负责加载配置、设置日志系统和初始化数据库。
    """
    logging.info("服务器正在启动...")
    
    # 1. 加载配置文件
    load_config()
    logging.info("配置文件加载完成。")
    
    # 2. 根据配置文件设置日志系统 (V4.2 新增)
    log_level = config.get('logging', {}).get('level', 'INFO')
    setup_logging(log_level)
    
    # 3. 初始化数据库
    init_db()
    logging.info("数据库初始化完成。")

# =============================================================================
# 主程序入口
# =============================================================================
if __name__ == "__main__":
    logging.info("--- 启动渔船离境智能预警系统后端服务器 ---")
    uvicorn.run(
        "server:app", # 指定 ASGI 应用的路径
        host="0.0.0.0", # 监听所有可用的网络接口
        port=8000,      # 监听端口
        reload=True,    # 启用热重载，方便开发，代码修改后服务器会自动重启
        log_level="info" # Uvicorn 自身的日志级别
    )
