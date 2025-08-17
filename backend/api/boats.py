# -*- coding: utf-8 -*-
"""
功能: 提供与船只信息相关的 API Endpoints。
"""

import sqlite3
import logging
from datetime import datetime
from fastapi import APIRouter, HTTPException
from backend.database_utils import get_db_connection

router = APIRouter()

@router.get("/api/boats")
async def get_all_boats():
    """
    获取所有已知船只的列表及其最新更新时间。

    返回:
        list[dict]: 包含每个船只ID和最后更新时间的字典列表。
    """
    conn = get_db_connection()
    try:
        boats = conn.execute("SELECT boat_id, boat_name, last_update_time FROM boats ORDER BY last_update_time DESC").fetchall()
        return [dict(row) for row in boats]
    except sqlite3.Error as e:
        logging.error(f"查询所有船只失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="无法获取船只列表")
    finally:
        conn.close()

@router.get("/api/boats/{boat_id}/history")
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
