import importlib
import os
import sys
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _ensure_syspath():
    root = str(_project_root())
    if root not in sys.path:
        sys.path.insert(0, root)


def _reload_modules():
    """
    Reload modules that depend on database path overrides so tests pick up the temporary DB.
    """
    import backend.database_utils as db_utils
    import Scripts.database as scripts_db
    import backend.main as backend_main

    importlib.reload(db_utils)
    importlib.reload(scripts_db)
    importlib.reload(backend_main)

    return db_utils, scripts_db, backend_main


@pytest.fixture()
def test_client(tmp_path, monkeypatch):
    """
    Provide a FastAPI TestClient wired to a temporary SQLite数据库.
    """
    _ensure_syspath()

    db_path = tmp_path / "test.db"
    monkeypatch.setenv("OCEAN_PROTECT_DB_PATH", str(db_path))

    db_utils, scripts_db, backend_main = _reload_modules()

    # 初始化全新的数据库
    scripts_db.init_db()

    with TestClient(backend_main.fastapi_app) as client:
        yield client, db_utils


def _seed_warning(db_utils, boat_id: str, boat_name: str, warning_level: int = 1):
    now = datetime.utcnow()
    with closing(db_utils.get_db_connection()) as conn:
        conn.execute("DELETE FROM warnings")
        conn.execute("DELETE FROM boats")
        conn.execute(
            """
            INSERT INTO boats (boat_id, boat_name, last_update_time)
            VALUES (?, ?, ?)
            """,
            (boat_id, boat_name, now),
        )
        conn.execute(
            """
            INSERT INTO warnings (boat_id, timestamp, warning_level, latitude, longitude, details)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (boat_id, now, warning_level, 22.6, 119.0, "测试详情"),
        )
        conn.commit()
    return now


def test_today_warnings_include_id_and_boat_name(test_client):
    client, db_utils = test_client
    _seed_warning(db_utils, "BOAT-001", "测试船01", warning_level=2)

    response = client.get("/api/warnings/today")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    warning = payload[0]
    assert warning["boat_id"] == "BOAT-001"
    assert warning["boat_name"] == "测试船01"
    assert warning["warning_level"] == 2
    assert "id" in warning and isinstance(warning["id"], int)


def test_boat_warnings_endpoint_returns_joined_name(test_client):
    client, db_utils = test_client
    timestamp = _seed_warning(db_utils, "BOAT-XYZ", "蓝海号", warning_level=3)

    start_time = (timestamp - timedelta(hours=1)).isoformat()
    end_time = (timestamp + timedelta(hours=1)).isoformat()
    response = client.get(
        "/api/boats/BOAT-XYZ/warnings",
        params={"start_time": start_time, "end_time": end_time},
    )

    assert response.status_code == 200
    warnings = response.json()
    assert len(warnings) == 1
    warning = warnings[0]
    assert warning["boat_name"] == "蓝海号"
    assert warning["warning_level"] == 3
    assert "id" in warning and isinstance(warning["id"], int)
