# -*- coding: utf-8 -*-
"""
功能: 数据库辅助工具模块。
      提供创建数据库连接的函数。
"""

import sqlite3
import os

# 数据库路径现在相对于项目根目录构建
# __file__ -> backend/database_utils.py
# os.path.dirname(__file__) -> backend/
# os.path.dirname(...) -> project_root
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'database.db')

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
