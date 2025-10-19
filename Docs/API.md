# API 文档

本文档详细说明了“渔船离境智能预警系统”后端提供的所有 HTTP API 接口。

---

## 1. 数据接收

### `POST /api/gps_data`

*   **功能**: 接收来自船载终端或模拟器发送的单一GPS数据点。此接口会立即响应，并将数据处理（入库、分析、推送）放入后台任务执行。
*   **请求方法**: `POST`
*   **请求体格式**: `application/json`
*   **请求体 (Pydantic 模型: `GPSData`)**:
    ```json
    {
      "boat_id": "BOAT-001",
      "boat_name": "测试船01",
      "latitude": 22.5,
      "longitude": 118.5,
      "speed_knots": 5.2,
      "bearing_deg": 180.0,
      "timestamp": "2025-08-17T12:30:00Z"
    }
    ```
    *   `boat_name` 和 `timestamp` 是可选字段。
*   **成功响应 (`200 OK`)**:
    ```json
    {
      "status": "success",
      "message": "数据已接收，正在后台处理"
    }
    ```

---

## 2. 船只信息查询

### `GET /api/boats`

*   **功能**: 获取数据库中所有已知船只的列表，按最后更新时间降序排列。
*   **请求方法**: `GET`
*   **成功响应 (`200 OK`)**:
    ```json
    [
      {
        "boat_id": "BOAT-001",
        "boat_name": "测试船01",
        "last_update_time": "2025-08-17 12:30:00"
      },
      {
        "boat_id": "BOAT-002",
        "boat_name": "测试船02",
        "last_update_time": "2025-08-17 12:28:00"
      }
    ]
    ```

---

## 3. 历史数据查询

### `GET /api/boats/{boat_id}/history`

*   **功能**: 查询指定船只在特定时间范围内的历史轨迹。返回的数据点会进行抽稀处理（最多1000点）以优化前端性能。
*   **请求方法**: `GET`
*   **URL 参数**:
    *   `boat_id` (string, required): 船只的业务ID。
*   **Query 参数**:
    *   `start_time` (string, required): 查询开始时间 (ISO 8601 格式, e.g., `2025-08-17T00:00:00Z`)。
    *   `end_time` (string, required): 查询结束时间 (ISO 8601 格式, e.g., `2025-08-17T12:00:00Z`)。
*   **成功响应 (`200 OK`)**:
    ```json
    [
      {
        "timestamp": "2025-08-17 09:00:00",
        "latitude": 22.1,
        "longitude": 118.1
      },
      ...
    ]
    ```

### `GET /api/boats/{boat_id}/warnings`

*   **功能**: 查询指定船只在特定时间范围内的历史预警记录。
*   **请求方法**: `GET`
*   **URL 参数**:
    *   `boat_id` (string, required): 船只的业务ID。
*   **Query 参数**:
    *   `start_time` (string, required): 查询开始时间。
    *   `end_time` (string, required): 查询结束时间。
*   **成功响应 (`200 OK`)**:
    ```json
    [
      {
        "id": 123,
        "timestamp": "2025-08-17 10:15:00",
        "latitude": 22.5,
        "longitude": 118.9,
        "warning_level": 2,
        "details": "预测路径: ...",
        "boat_name": "测试船01"
      },
      ...
    ]
    ```

### `GET /api/all_warnings`

*   **功能**: 查询所有船只在特定时间范围内的历史预警记录。
*   **请求方法**: `GET`
*   **Query 参数**:
    *   `start_time` (string, required): 查询开始时间。
    *   `end_time` (string, required): 查询结束时间。
*   **成功响应 (`200 OK`)**:
    ```json
    [
      {
        "id": 456,
        "boat_id": "BOAT-001",
        "timestamp": "2025-08-17 10:15:00",
        "warning_level": 2,
        "latitude": 22.5,
        "longitude": 118.9,
        "details": "预测路径: ...",
        "boat_name": "测试船01"
      },
      ...
    ]
    ```

---

## 4. 当日预警统计

### `GET /api/warnings/today_count`

*   **功能**: 获取当天（服务器本地时间）所有船只触发的预警总次数。
*   **请求方法**: `GET`
*   **成功响应 (`200 OK`)**:
    ```json
    {
      "count": 5
    }
    ```

### `GET /api/warnings/today`

*   **功能**: 获取当天（服务器本地时间）所有船只的预警记录列表，按时间降序排列。
*   **请求方法**: `GET`
*   **成功响应 (`200 OK`)**:
    ```json
    [
      {
        "id": 789,
        "boat_id": "BOAT-001",
        "timestamp": "2025-08-17 11:00:00",
        "warning_level": 1,
        "latitude": 22.6,
        "longitude": 119.0,
        "details": "...",
        "boat_name": "测试船01"
      },
      ...
    ]
    ```

---

## 5. 系统资源

### `GET /api/fishing_zones`

*   **功能**: 提供可捕鱼区的 GeoJSON 文件，供前端地图加载。
*   **请求方法**: `GET`
*   **成功响应 (`200 OK`)**: 返回 `application/json` 类型的 GeoJSON 文件内容。
*   **失败响应 (`404 Not Found`)**: 如果文件不存在。

### `GET /api/config`

*   **功能**: 提供服务器的 `config.json` 内容，供前端动态加载配置。
*   **请求方法**: `GET`
*   **成功响应 (`200 OK`)**: 返回 `config.json` 的完整内容。
*   **失败响应 (`500 Internal Server Error`)**: 如果服务器配置未加载。

---

## 6. WebSocket 事件

后端通过 Socket.IO 向前端实时推送数据，主要事件如下：

### `gps_update`
* **触发条件**：收到新的 GPS 数据点并通过节流校验后推送。
* **载荷示例**：
    ```json
    {
      "boat_id": "BOAT-001",
      "boat_name": "测试船01",
      "lat": 22.5031,
      "lon": 118.9452,
      "speed_knots": 4.8,
      "bearing_deg": 182.0,
      "warning_level": 1,
      "prediction_path": [[118.9452, 22.5031], ...],
      "timestamp": "2025-08-17T11:05:12.345678"
    }
    ```

### `today_warning_count_update`
* **触发条件**：写入新的预警记录后，重新统计当天预警次数。
* **载荷示例**：
    ```json
    {
      "count": 6
    }
    ```

### `warning_created`
* **触发条件**：产生新的预警记录时推送（包含数据库自增 `id`，用于前端去重）。
* **载荷示例**：
    ```json
    {
      "id": 789,
      "boat_id": "BOAT-001",
      "boat_name": "测试船01",
      "warning_level": 1,
      "latitude": 22.6,
      "longitude": 119.0,
      "timestamp": "2025-08-17T11:00:00",
      "details": "预测路径: ...",
      "prediction_path": [[119.0, 22.6], ...]
    }
    ```
