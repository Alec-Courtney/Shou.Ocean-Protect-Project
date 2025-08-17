# -*- coding: utf-8 -*-
"""
功能: 提供与预警信息相关的 API Endpoints。
"""

import sqlite3
import logging
from datetime import datetime, date
from fastapi import APIRouter, HTTPException
from backend.database_utils import get_db_connection

router = APIRouter()

@router.get("/api/boats/{boat_id}/warnings")
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

@router.get("/api/all_warnings")
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

@router.get("/api/warnings/today_count")
async def get_today_warning_count():
    """
    获取当天所有船只的预警总数。
    """
    conn = get_db_connection()
    try:
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
        count = cursor.fetchone()[0]
        return {"count": count}
    except sqlite3.Error as e:
        logging.error(f"查询当天预警总数失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="无法获取当天预警总数")
    finally:
        conn.close()

@router.get("/api/warnings/today")
async def get_today_warnings():
    """
    获取当天所有船只的预警记录列表。
    """
    conn = get_db_connection()
    try:
        today = date.today()
        start_of_day = datetime.combine(today, datetime.min.time())
        end_of_day = datetime.combine(today, datetime.max.time())

        warnings = conn.execute(
            """
            SELECT boat_id, timestamp, warning_level, latitude, longitude, details 
            FROM warnings 
            WHERE timestamp BETWEEN ? AND ? 
            ORDER BY timestamp DESC
            """,
            (start_of_day, end_of_day)
        ).fetchall()
        return [dict(row) for row in warnings]
    except sqlite3.Error as e:
        logging.error(f"查询当天预警列表失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="无法获取当天预警列表")
    finally:
        conn.close()
