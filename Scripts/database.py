# -*- coding: utf-8 -*-
"""
功能: 数据库管理模块。
      负责SQLite数据库的初始化、连接管理和所有必要表结构的创建。
      包括 `boats` (船只信息), `gps_positions` (GPS历史轨迹), 
      和 `warnings` (预警记录) 表。
      V4.2 更新: 为 `gps_positions` 和 `warnings` 表添加了索引以优化查询性能。
"""

import sqlite3
import os
import logging

# 获取项目根目录
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB_PATH = os.path.join(project_root, 'database.db')
DB_PATH_ENV_VAR = 'OCEAN_PROTECT_DB_PATH'

def resolve_db_path() -> str:
    """
    解析当前应使用的数据库路径。
    若环境变量 OCEAN_PROTECT_DB_PATH 存在，则优先使用该路径。
    """
    return os.environ.get(DB_PATH_ENV_VAR, DEFAULT_DB_PATH)

def init_db():
    """
    初始化SQLite数据库。
    如果数据库文件 `database.db` 不存在，则创建它并定义所有需要的表结构：
    - `boats`: 存储船只的基本信息，包括 `boat_id` (主键)、`boat_name` 和 `last_update_time`。
    - `gps_positions`: 存储船只的历史GPS位置点，包括 `boat_id`、`timestamp`、`latitude`、`longitude`、`speed_knots` 和 `bearing_deg`。
    - `warnings`: 存储历史预警事件，包括 `boat_id`、`timestamp`、`warning_level`、`latitude`、`longitude` 和 `details`。

    同时，为 `gps_positions` 和 `warnings` 表的 `boat_id` 和 `timestamp` 字段创建索引，
    以显著提升历史数据查询的性能。

    此函数不接受参数，不返回任何值。
    它会记录数据库初始化过程中的信息和任何错误。
    """
    db_path = resolve_db_path()
    if os.path.exists(db_path):
        logging.info(f"数据库文件已存在于: {db_path}。跳过初始化。")
        return

    logging.info(f"数据库文件不存在，将在 {db_path} 创建新的数据库...")
    conn = None # 初始化连接对象
    try:
        # 连接到数据库（如果文件不存在，会自动创建）
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # --- 创建 `boats` 表 ---
        # 存储所有渔船的基本信息，`boat_id` 作为主键
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS boats (
            boat_id TEXT PRIMARY KEY,
            boat_name TEXT,
            last_update_time DATETIME
        );
        """)
        logging.info("成功创建 'boats' 表。")

        # --- 创建 `gps_positions` 表 ---
        # 存储所有渔船的历史GPS位置点，`boat_id` 引用 `boats` 表
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS gps_positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            boat_id TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            speed_knots REAL,
            bearing_deg REAL,
            FOREIGN KEY (boat_id) REFERENCES boats (boat_id)
        );
        """)
        logging.info("成功创建 'gps_positions' 表。")

        # --- 为 `gps_positions` 表创建索引 (V4.2 新增) ---
        # 提升按船只ID和时间戳查询历史轨迹的性能
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_gps_boat_id ON gps_positions (boat_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_gps_timestamp ON gps_positions (timestamp);")
        logging.info("成功为 'gps_positions' 表创建索引。")

        # --- 创建 `warnings` 表 ---
        # 存储所有历史预警事件，`boat_id` 引用 `boats` 表
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS warnings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            boat_id TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            warning_level INTEGER NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            details TEXT,
            FOREIGN KEY (boat_id) REFERENCES boats (boat_id)
        );
        """)
        logging.info("成功创建 'warnings' 表。")

        # --- 为 `warnings` 表创建索引 (V4.2 新增) ---
        # 提升按船只ID和时间戳查询历史预警的性能
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_warnings_boat_id ON warnings (boat_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_warnings_timestamp ON warnings (timestamp);")
        logging.info("成功为 'warnings' 表创建索引。")

        # 提交所有更改到数据库
        conn.commit()
        logging.info("数据库初始化成功，所有表和索引已创建。")

    except sqlite3.Error as e:
        logging.error(f"数据库初始化过程中发生错误: {e}", exc_info=True)
    finally:
        # 确保在任何情况下都关闭数据库连接
        if conn:
            conn.close()

if __name__ == '__main__':
    # 当脚本作为主程序直接运行时，配置日志并执行数据库初始化功能
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    print("正在执行数据库初始化脚本...")
    init_db()
    print("数据库初始化脚本执行完毕。")
