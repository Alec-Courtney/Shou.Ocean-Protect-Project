# -*- coding: utf-8 -*-
"""
文件: Scripts/convert_geojson.py
作者: [在此处填写作者姓名]
创建日期: 2025-08-15
最后修改日期: 2025-08-15
功能: 地理数据转换脚本。
      用于将用户在 `config.json` 中配置的 Shapefile (可捕鱼区数据) 转换为 GeoJSON 格式，
      并保存到前端 (`frontend/data/`) 目录中，供前端地图 (Leaflet.js) 使用。

主要功能:
- 从 `config.json` 读取 Shapefile 路径和几何简化容差。
- 使用 `geopandas` 库读取 Shapefile 数据。
- 根据配置对地理几何图形进行可选的简化处理，以优化前端加载性能。
- 将处理后的数据保存为 GeoJSON 文件。
"""

import json
import os
import geopandas as gpd

def convert_shp_to_geojson():
    """
    读取配置文件 `config.json` 中指定的 Shapefile 路径，
    将其转换为 GeoJSON 格式，并根据配置进行几何简化，
    最终保存到前端数据目录 `frontend/data/`。

    此函数不接受参数，不返回任何值。
    它会打印详细的执行信息、警告和错误到控制台。
    """
    # 动态构建 config.json 的绝对路径，确保脚本无论从何处运行都能找到配置文件
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir) # 项目根目录是 Scripts 目录的上一级
    config_path = os.path.join(project_root, 'config.json')

    print(f"信息: 正在从 {config_path} 读取配置...")

    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except FileNotFoundError:
        print(f"错误: 配置文件 '{config_path}' 未找到。请确保文件存在。")
        return
    except json.JSONDecodeError:
        print(f"错误: 配置文件 '{config_path}' 格式无效。请检查JSON语法。")
        return

    # 从配置中获取 Shapefile 的相对路径
    shp_relative_path = config.get("monitoring_parameters", {}).get("default_fishing_zones")
    if not shp_relative_path:
        print("错误: 在 config.json 中未找到 'monitoring_parameters.default_fishing_zones' 配置。")
        return

    # 构建 Shapefile 的绝对路径
    shp_abs_path = os.path.join(project_root, shp_relative_path)
    
    # --- V4.1: 增加对Shapefile配套文件的检查 ---
    # Shapefile 通常由多个文件组成 (.shp, .shx, .dbf 等)，需要同时存在
    base_path = os.path.splitext(shp_abs_path)[0]
    required_files = {
        'shp': f"{base_path}.shp",
        'shx': f"{base_path}.shx",
        'dbf': f"{base_path}.dbf"
    }

    # 检查必需文件是否缺失
    missing_files = [ext for ext, path in required_files.items() if not os.path.exists(path)]

    if missing_files:
        print("\n错误: 缺少必需的 Shapefile 组件！")
        print(f"Shapefile '{shp_relative_path}' 至少需要以下文件存在于同一目录中:")
        for ext, path in required_files.items():
            status = "✓ 已找到" if ext not in missing_files else f"✗ 未找到 (必需的)"
            print(f"  - {os.path.basename(path)}  ({status})")
        print("\n请确保将所有相关的 .shp, .shx, .dbf 等文件都复制到项目中。")
        return
    
    print(f"信息: 正在尝试读取 Shapefile: {shp_abs_path}")

    # 定义 GeoJSON 输出目录和文件路径
    frontend_dir = os.path.join(project_root, 'frontend')
    data_dir = os.path.join(frontend_dir, 'data')
    geojson_path = os.path.join(data_dir, 'fishing_zones.geojson')

    # 确保输出目录存在，如果不存在则创建
    os.makedirs(data_dir, exist_ok=True)
    print(f"信息: 确保输出目录存在: {data_dir}")

    try:
        # 使用 geopandas 读取 Shapefile 数据
        print("信息: 正在使用 geopandas 读取 Shapefile...")
        gdf = gpd.read_file(shp_abs_path)

        # 根据 config.json 中的配置进行几何简化
        # simplification_tolerance 为 0 或负数时表示不进行简化
        simplification_tolerance = config.get("monitoring_parameters", {}).get("simplification_tolerance", 0)
        if simplification_tolerance > 0:
            print(f"信息: 正在以容差 {simplification_tolerance} 简化几何图形...")
            # preserve_topology=True 尝试在简化过程中保持几何图形的拓扑关系，避免生成无效几何
            gdf.geometry = gdf.geometry.simplify(tolerance=simplification_tolerance, preserve_topology=True)
            print("信息: 几何图形简化完成。")
        else:
            print("信息: 未配置几何简化 (simplification_tolerance <= 0)，跳过此步骤。")

        # 将处理后的 GeoDataFrame 转换为 GeoJSON 格式并保存到指定路径
        print(f"信息: 正在将数据转换为 GeoJSON 并保存到: {geojson_path}")
        gdf.to_file(geojson_path, driver='GeoJSON', encoding='utf-8')

        print("\n转换成功！")
        print(f"GeoJSON 文件已保存到: {geojson_path}")

    except Exception as e:
        print(f"\n错误: 处理过程中发生意外: {e}")
        print("请确保 geopandas 及其所有依赖库已正确安装。")
        print("对于 Windows 用户，推荐使用 conda 环境来安装 geopandas，以避免依赖问题。")

if __name__ == "__main__":
    # 当脚本作为主程序直接运行时，执行转换功能
    convert_shp_to_geojson()
