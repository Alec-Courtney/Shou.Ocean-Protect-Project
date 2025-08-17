# 数据库设计文档

本文档详细说明了“渔船离境智能预警系统”使用的 SQLite 数据库 (`database.db`) 的表结构、字段定义和索引。

---

## 1. `boats` 表

*   **功能**: 存储所有船只的基本信息。
*   **SQL 定义**:
    ```sql
    CREATE TABLE IF NOT EXISTS boats (
        boat_id TEXT PRIMARY KEY,
        boat_name TEXT,
        last_update_time DATETIME
    );
    ```
*   **字段说明**:
    *   `boat_id` (TEXT, PRIMARY KEY): 船只的业务ID (例如 "BOAT-001")，作为主键，唯一标识一艘船。
    *   `boat_name` (TEXT): 船只的名称 (例如 "测试船01")，可以为空。
    *   `last_update_time` (DATETIME): 该船只最后一次上报数据的时间戳。

---

## 2. `gps_positions` 表

*   **功能**: 存储所有船只的历史GPS航行轨迹点。
*   **SQL 定义**:
    ```sql
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
    ```
*   **字段说明**:
    *   `id` (INTEGER, PRIMARY KEY AUTOINCREMENT): 记录的唯一自增ID。
    *   `boat_id` (TEXT, NOT NULL): 关联到 `boats` 表的 `boat_id`，表示该GPS点属于哪艘船。
    *   `timestamp` (DATETIME, NOT NULL): GPS数据生成时的时间戳。
    *   `latitude` (REAL, NOT NULL): 纬度。
    *   `longitude` (REAL, NOT NULL): 经度。
    *   `speed_knots` (REAL): 船只速度，单位为“节”。
    *   `bearing_deg` (REAL): 船只航向，单位为“度”。
*   **索引**:
    *   `idx_gps_boat_id`: 在 `boat_id` 字段上创建，用于加速特定船只的历史轨迹查询。
    *   `idx_gps_timestamp`: 在 `timestamp` 字段上创建，用于加速按时间范围的查询。

---

## 3. `warnings` 表

*   **功能**: 存储所有被触发的历史预警事件。
*   **SQL 定义**:
    ```sql
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
    ```
*   **字段说明**:
    *   `id` (INTEGER, PRIMARY KEY AUTOINCREMENT): 预警记录的唯一自增ID。
    *   `boat_id` (TEXT, NOT NULL): 关联到 `boats` 表的 `boat_id`，表示该预警属于哪艘船。
    *   `timestamp` (DATETIME, NOT NULL): 预警被触发时的时间戳。
    *   `warning_level` (INTEGER, NOT NULL): 预警的等级 (例如 1, 2, 3)。
    *   `latitude` (REAL, NOT NULL): 触发预警时船只的纬度。
    *   `longitude` (REAL, NOT NULL): 触发预警时船只的经度。
    *   `details` (TEXT): 预警的详细信息，例如预测的轨迹路径。
*   **索引**:
    *   `idx_warnings_boat_id`: 在 `boat_id` 字段上创建，用于加速特定船只的历史预警查询。
    *   `idx_warnings_timestamp`: 在 `timestamp` 字段上创建，用于加速按时间范围的查询。
