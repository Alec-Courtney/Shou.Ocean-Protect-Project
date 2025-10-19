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
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_DB_PATH = os.path.join(_PROJECT_ROOT, 'database.db')
_DB_PATH_ENV_VAR = 'OCEAN_PROTECT_DB_PATH'

def resolve_db_path() -> str:
    """
    解析当前应使用的数据库路径。
    若环境变量 OCEAN_PROTECT_DB_PATH 存在，则优先使用该路径；否则回退到默认 database.db。
    """
    return os.environ.get(_DB_PATH_ENV_VAR, _DEFAULT_DB_PATH)

def get_db_connection():
    """
    创建并返回一个SQLite数据库连接。
    配置 row_factory 以便可以通过列名访问查询结果。

    返回:
        sqlite3.Connection: 数据库连接对象。
    """
    db_path = resolve_db_path()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row # 允许通过字典键访问列
    return conn
