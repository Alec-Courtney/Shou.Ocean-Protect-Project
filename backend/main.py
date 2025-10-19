# -*- coding: utf-8 -*-
"""
功能: 渔船离境智能预警系统后端主服务器 (V4.6 Refactored)。
      负责处理与前端的实时通信、接收GPS数据、调用核心算法进行分析，并提供Web API服务。
"""

import os
import json
import time
import logging
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, date
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import socketio
import uvicorn

# =============================================================================
# 路径配置与模块导入
# =============================================================================
# 将项目根目录和 Scripts 目录添加到 Python 模块搜索路径中
# __file__ -> backend/main.py
# os.path.dirname(__file__) -> backend/
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(project_root)
sys.path.append(os.path.join(project_root, 'Scripts'))

from Scripts.WarningAnalysis import analyze_realtime_point
from Scripts.database import init_db
from backend.database_utils import get_db_connection
from backend.api import boats, warnings

# =============================================================================
# 日志系统配置
# =============================================================================
def setup_logging(log_level_str: str):
    log_level = getattr(logging, log_level_str.upper(), logging.INFO)
    for handler in logging.root.handlers[:]:
        logging.root.removeHandler(handler)
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(levelname)s - [%(module)s:%(lineno)d] - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    logging.info(f"日志系统已配置，级别为: {log_level_str}")

# =============================================================================
# ASGI 应用架构
# =============================================================================
fastapi_app = FastAPI()
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 包含来自其他模块的 API 路由
fastapi_app.include_router(boats.router)
fastapi_app.include_router(warnings.router)

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)

# =============================================================================
# 全局状态变量
# =============================================================================
config = {}
last_sent_times = {}
last_warning_state = {}

# =============================================================================
# 配置加载
# =============================================================================
def load_config():
    global config
    config_path = os.path.join(project_root, 'config.json')
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        logging.info(f"成功加载配置文件: {config_path}")
    except Exception as e:
        logging.error(f"加载配置文件失败: {e}", exc_info=True)
        raise

# =============================================================================
# 数据模型 (Pydantic)
# =============================================================================
class GPSData(BaseModel):
    boat_id: str
    boat_name: str | None = None
    latitude: float
    longitude: float
    speed_knots: float
    bearing_deg: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)

# =============================================================================
# 核心业务逻辑 (后台任务)
# =============================================================================
async def process_gps_data_background(data: GPSData):
    warning_payload = None
    today_warning_count = None
    try:
        logging.info(f"后台任务开始处理船只 {data.boat_id} 的数据...")

        # 1. 数据持久化
        with closing(get_db_connection()) as conn:
            try:
                if data.boat_name:
                    conn.execute(
                        """
                        INSERT INTO boats (boat_id, boat_name, last_update_time)
                        VALUES (?, ?, ?)
                        ON CONFLICT(boat_id) DO UPDATE
                            SET boat_name = excluded.boat_name,
                                last_update_time = excluded.last_update_time
                        """,
                        (data.boat_id, data.boat_name, data.timestamp)
                    )
                else:
                    conn.execute(
                        """
                        INSERT INTO boats (boat_id, last_update_time)
                        VALUES (?, ?)
                        ON CONFLICT(boat_id) DO UPDATE
                            SET last_update_time = excluded.last_update_time
                        """,
                        (data.boat_id, data.timestamp)
                    )
                conn.execute(
                    """
                    INSERT INTO gps_positions (boat_id, timestamp, latitude, longitude, speed_knots, bearing_deg)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (data.boat_id, data.timestamp, data.latitude, data.longitude, data.speed_knots, data.bearing_deg)
                )
                conn.commit()
            except sqlite3.Error as e:
                logging.error(f"后台任务数据库操作失败: {e}", exc_info=True)
                return

        # 2. 实时分析
        fishing_zones_path = os.path.join(project_root, 'frontend', 'data', 'fishing_zones.geojson')
        point_data = {'lat': data.latitude, 'lon': data.longitude, 'speed_knots': data.speed_knots, 'bearing_deg': data.bearing_deg}
        warning_level, prediction_path = analyze_realtime_point(point_data, fishing_zones_path, config)

        # 3. 存储预警 (去重逻辑)
        last_warning_level = last_warning_state.get(data.boat_id, 0)
        if warning_level != last_warning_level:
            if warning_level > 0:
                with closing(get_db_connection()) as conn:
                    try:
                        warning_id = None
                        warning_cursor = conn.execute(
                            """
                            INSERT INTO warnings (boat_id, timestamp, warning_level, latitude, longitude, details)
                            VALUES (?, ?, ?, ?, ?, ?)
                            """,
                            (data.boat_id, data.timestamp, warning_level, data.latitude, data.longitude, f"预测路径: {prediction_path}")
                        )
                        warning_id = warning_cursor.lastrowid
                        conn.commit()

                        today = date.today()
                        start_of_day = datetime.combine(today, datetime.min.time())
                        end_of_day = datetime.combine(today, datetime.max.time())
                        cursor = conn.cursor()
                        cursor.execute(
                            """
                            SELECT COUNT(*) 
                            FROM warnings 
                            WHERE timestamp BETWEEN ? AND ?
                            """,
                            (start_of_day, end_of_day)
                        )
                        today_warning_count = int(cursor.fetchone()[0])

                        boat_name = data.boat_name
                        if not boat_name:
                            name_row = conn.execute(
                                "SELECT boat_name FROM boats WHERE boat_id = ?",
                                (data.boat_id,)
                            ).fetchone()
                            boat_name = name_row["boat_name"] if name_row else None

                        warning_payload = {
                            "boat_id": data.boat_id,
                            "boat_name": boat_name,
                            "warning_level": warning_level,
                            "latitude": data.latitude,
                            "longitude": data.longitude,
                            "timestamp": data.timestamp.isoformat(),
                            "details": f"预测路径: {prediction_path}",
                            "prediction_path": prediction_path,
                            "id": warning_id,
                        }
                    except sqlite3.Error as e:
                        logging.error(f"后台任务预警信息写入数据库失败: {e}", exc_info=True)
            last_warning_state[data.boat_id] = warning_level

        # 4. 实时推送 (节流逻辑)
        current_time = time.time()
        last_sent = last_sent_times.get(data.boat_id, 0)
        send_interval = config.get('frontend_parameters', {}).get('websocket_send_interval_seconds', 0.5)
        if current_time - last_sent > send_interval:
            data_to_send = {
                "boat_id": data.boat_id, "boat_name": data.boat_name, "lat": data.latitude, "lon": data.longitude,
                "speed_knots": data.speed_knots, "bearing_deg": data.bearing_deg, "warning_level": warning_level,
                "prediction_path": prediction_path, "timestamp": data.timestamp.isoformat()
            }
            await sio.emit('gps_update', data_to_send)
            last_sent_times[data.boat_id] = current_time

        if today_warning_count is not None:
            await sio.emit('today_warning_count_update', {'count': today_warning_count})
            logging.info(f"推送当日预警总数更新: {today_warning_count}")
        if warning_payload:
            await sio.emit('warning_created', warning_payload)
    except Exception as e:
        logging.error(f"处理船只 {data.boat_id} 的后台任务发生未知错误: {e}", exc_info=True)

# =============================================================================
# 核心 API Endpoints
# =============================================================================
@fastapi_app.post("/api/gps_data")
async def receive_gps_data(data: GPSData, background_tasks: BackgroundTasks):
    background_tasks.add_task(process_gps_data_background, data)
    return {"status": "success", "message": "数据已接收，正在后台处理"}

@fastapi_app.get("/api/fishing_zones")
async def get_fishing_zones():
    geojson_path = os.path.join(project_root, 'frontend', 'data', 'fishing_zones.geojson')
    if not os.path.exists(geojson_path):
        return JSONResponse(status_code=404, content={"error": "GeoJSON file not found"})
    try:
        with open(geojson_path, 'r', encoding='utf-8') as f:
            geojson_data = json.load(f)
        return JSONResponse(content=geojson_data)
    except Exception as e:
        logging.error(f"读取或解析GeoJSON文件时出错: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="无法处理渔区数据文件")

@fastapi_app.get("/api/config")
async def get_config():
    if config:
        return JSONResponse(content=config)
    raise HTTPException(status_code=500, detail="服务器配置未加载")

# =============================================================================
# WebSocket 事件处理
# =============================================================================
@sio.event
async def connect(sid, environ):
    logging.info(f"客户端连接成功: {sid}")

@sio.event
async def disconnect(sid):
    logging.info(f"客户端断开连接: {sid}")

# =============================================================================
# 服务器生命周期事件
# =============================================================================
@fastapi_app.on_event("startup")
async def startup_event():
    logging.info("服务器正在启动...")
    load_config()
    log_level = config.get('logging', {}).get('level', 'INFO')
    setup_logging(log_level)
    init_db()
    logging.info("服务器启动完成。")

# =============================================================================
# 主程序入口
# =============================================================================
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO) # Basic config for the runner itself
    logging.info("--- 启动渔船离境智能预警系统后端服务器 (Refactored) ---")
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
