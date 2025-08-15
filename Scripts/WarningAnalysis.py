# -*- coding: utf-8 -*-
"""
功能: 核心预警分析模块。
      提供渔船离境智能预警系统的核心地理空间分析功能。
      完全基于 `geopandas` 和 `shapely` 库，在 WGS 84 地理坐标系下进行运算，以支持全球范围。

主要功能:
- 提供核心函数 `analyze_realtime_point`，用于分析单个GPS数据点。
- 预警逻辑:
  1. 判断船只当前位置是否已在允许的渔区之外 (越界预警)。
  2. 若在渔区内部，则根据当前速度和航向，预测未来不同时间点的位置 (预测性预警)。
  3. 判断未来位置是否会越界，从而生成相应等级的预警。
- 内置缓存机制，避免重复加载和处理渔区地理数据文件，提高性能。
"""

import os
import math
import json
import io
import geopandas as gpd
from shapely.geometry import Point

# V3.5: 配置加载逻辑已移除。
# 配置现在由主服务器 `server.py` 加载，并通过函数参数传入。
# 这遵循了“依赖注入”的设计模式，提高了模块的独立性和可测试性。

# =============================================================================
# 全局缓存
# =============================================================================
# `zones_gdf_cache`: 缓存已加载的可捕鱼区 GeoDataFrame 对象。
#   这是一个 geopandas.GeoDataFrame，包含了渔区的几何信息和属性。
#   通过缓存，避免每次分析都从磁盘重复读取和解析文件，这是非常重要的性能优化。
zones_gdf_cache = None
# `zones_path_cache`: 缓存当前加载的渔区GeoJSON文件的路径。
#   用于判断渔区文件是否已变更，如果路径不同，则需要重新加载。
zones_path_cache = None 
# `zones_spatial_index_cache`: 缓存渔区GeoDataFrame的空间索引。
#   空间索引 (如 R-tree) 能够显著加速地理空间查询，例如判断点是否在多边形内。
zones_spatial_index_cache = None 

# =============================================================================
# 地理计算辅助函数
# =============================================================================
def _calculate_destination_point(lon_deg: float, lat_deg: float, bearing_deg: float, distance_m: float) -> tuple[float, float]:
    """
    根据起点经纬度、方位角和距离，计算目标点的经纬度。
    本函数基于球面三角学（大圆航线计算），适用于 WGS 84 地理坐标系。

    参数:
        lon_deg (float): 起点经度 (单位: 度)。
        lat_deg (float): 起点纬度 (单位: 度)。
        bearing_deg (float): 航向方位角 (单位: 度, 0-360，0为正北，90为正东)。
        distance_m (float): 移动距离 (单位: 米)。

    返回:
        tuple[float, float]: 包含 (目标点经度, 目标点纬度) 的元组。
    """
    R = 6371000  # 地球平均半径（米），用于将距离转换为弧度
    
    # 将角度单位转换为弧度单位以进行三角函数计算
    lat1_rad = math.radians(lat_deg)
    lon1_rad = math.radians(lon_deg)
    bearing_rad = math.radians(bearing_deg)
    
    # 使用大圆航线公式计算目标点纬度
    lat2_rad = math.asin(math.sin(lat1_rad) * math.cos(distance_m / R) +
                         math.cos(lat1_rad) * math.sin(distance_m / R) * math.cos(bearing_rad))
    
    # 使用大圆航线公式计算目标点经度
    lon2_rad = lon1_rad + math.atan2(math.sin(bearing_rad) * math.sin(distance_m / R) * math.cos(lat1_rad),
                                     math.cos(distance_m / R) - math.sin(lat1_rad) * math.sin(lat2_rad))
    
    # 将计算结果从弧度转换回角度
    return math.degrees(lon2_rad), math.degrees(lat2_rad)

# =============================================================================
# 核心分析函数
# =============================================================================
def analyze_realtime_point(point_data: dict, fishing_zones_geojson_path: str, config: dict) -> tuple[int, list[list[float]]]:
    """
    分析单个实时GPS数据点，判断其预警等级。
    该函数会根据船只当前位置和预测轨迹，判断是否越界，并返回相应的预警等级。

    参数:
        point_data (dict): 包含GPS信息的字典，键包括:
                           'lat' (float): 当前纬度。
                           'lon' (float): 当前经度。
                           'speed_knots' (float): 当前速度，单位节。
                           'bearing_deg' (float): 当前航向，单位度。
        fishing_zones_geojson_path (str): 可捕鱼区GeoJSON文件的完整路径。
        config (dict): 从 `server.py` 传入的全局配置对象，包含分析参数。

    返回:
        tuple[int, list[list[float]]]: 包含 (预警等级, 预测路径点列表) 的元组。
               预警等级:
                   -1: 错误 (例如文件未找到或坐标无效)。
                    0: 无预警 (船只在渔区内且预测轨迹不越界)。
                    1: 最高等级预警。这通常表示船只当前已在渔区外，或预测其在配置的最短时间内即将越界。
                    2, 3, ...: 其他等级的预测性预警，具体等级和时间由 `config.json` 文件定义。
               预测路径: 一个包含 `[lon, lat]` 坐标对的列表，表示从当前点开始的预测轨迹。
    """
    global zones_gdf_cache, zones_path_cache, zones_spatial_index_cache

    try:
        # 从传入的 config 对象中获取分析参数
        ANALYSIS_CONFIG = config.get('analysis_parameters', {})
        # 预警等级与预测时间的映射 (秒)
        WARNING_LEVELS = {int(k): v for k, v in ANALYSIS_CONFIG.get('warning_levels_seconds', {}).items()}
        # 节到米/秒的转换系数，提供默认值以增强健壮性
        KNOTS_TO_MPS = ANALYSIS_CONFIG.get('knots_to_mps_conversion', 1.852 / 3.6) 

        # --- 步骤 1: 加载并缓存渔区地理数据 ---
        # 检查渔区文件路径是否发生变化，或缓存是否为空，决定是否重新加载
        if zones_path_cache != fishing_zones_geojson_path or zones_gdf_cache is None:
            if not os.path.exists(fishing_zones_geojson_path):
                # 如果文件不存在，记录错误并返回
                try:
                    import logging
                    logging.error(f"渔区文件不存在: '{fishing_zones_geojson_path}'")
                except ImportError:
                    print(f"错误: 渔区文件不存在: '{fishing_zones_geojson_path}'")
                return -1, []
            
            # 使用 geopandas 读取 GeoJSON 文件
            zones_gdf = gpd.read_file(fishing_zones_geojson_path)
            
            # 标准化坐标系为 WGS 84 (EPSG:4326)，确保所有地理计算都在同一基准下
            if zones_gdf.crs and zones_gdf.crs.to_epsg() != 4326:
                zones_gdf = zones_gdf.to_crs(epsg=4326)

            # 更新缓存
            zones_gdf_cache = zones_gdf
            zones_path_cache = fishing_zones_geojson_path
            # 立即为加载的数据创建空间索引并缓存，用于加速后续的空间查询
            zones_spatial_index_cache = zones_gdf.sindex
            try:
                import logging
                logging.info(f"已成功加载并缓存渔区文件: {zones_path_cache}")
                logging.info("已为渔区数据创建空间索引。")
            except ImportError:
                print(f"信息: 已成功加载并缓存渔区文件: {zones_path_cache}")
                print("信息: 已为渔区数据创建空间索引。")

        # --- 步骤 2: 验证并创建当前GPS点的几何对象 ---
        lon, lat = point_data['lon'], point_data['lat']
        # 验证经纬度是否在有效范围内
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            try:
                import logging
                logging.warning(f"收到无效坐标 ({lon}, {lat})，跳过分析。")
            except ImportError:
                print(f"警告: 收到无效坐标 ({lon}, {lat})，跳过分析。")
            return -1, []
        point_geom = Point(lon, lat) # 创建 Shapely Point 对象

        # --- 步骤 3: 执行预警逻辑 ---
        speed_knots = point_data.get('speed_knots', 0)
        prediction_path = [[lon, lat]] # 预测路径以当前点开始，包含当前位置
        
        # 如果速度过低（接近静止），则视为无风险，不进行预测性分析
        if speed_knots is None or speed_knots <= 0.1: 
            return 0, prediction_path

        # 检查当前位置是否在任何一个渔区多边形内 (使用空间索引优化查询效率)
        # 首先通过边界框快速筛选可能的匹配多边形
        possible_matches_index = list(zones_spatial_index_cache.intersection(point_geom.bounds))
        possible_matches = zones_gdf_cache.iloc[possible_matches_index]
        # 然后对筛选出的多边形进行精确的 `contains` 判断
        is_currently_inside = possible_matches.geometry.contains(point_geom).any()

        if not is_currently_inside:
            # 如果当前点已在渔区界外，直接返回最高等级预警 (等级1)
            return 1, prediction_path

        # 若当前在渔区内，则根据速度和航向进行“未来位置”的预测性预警判断
        speed_mps = speed_knots * KNOTS_TO_MPS # 将速度从节转换为米/秒
        bearing_deg = point_data['bearing_deg']
        current_warning = 0 # 默认无预警

        # 1. 构建完整的预测路径，用于前端显示
        # 遍历所有预警等级定义的时间点，计算并添加预测点到路径中
        # 确保按时间从小到大排序，以便路径点的顺序正确
        for level, seconds in sorted(WARNING_LEVELS.items(), key=lambda item: item[1]):
            distance_m = speed_mps * seconds # 计算预测距离
            future_lon, future_lat = _calculate_destination_point(lon, lat, bearing_deg, distance_m)
            prediction_path.append([future_lon, future_lat])

        # 2. 检查预测性预警
        #    正确逻辑：必须从最短预测时间（对应最紧急的预警等级）开始检查。
        #    一旦发现预测点越界，就确定为该预警等级并立即停止检查。
        #    这样才能确保总是返回最紧急（最优先）的预警级别。
        #    例如，如果船只在 800 秒后越界，那么 900 秒的预测会触发1级预警，循环会终止，
        #    不会错误地继续检查并返回一个更低优先级的预警。
        
        # 按预警时间（秒数）从小到大排序
        sorted_warning_levels = sorted(WARNING_LEVELS.items(), key=lambda item: item[1])

        for level, seconds in sorted_warning_levels:
            distance_m = speed_mps * seconds
            future_lon, future_lat = _calculate_destination_point(lon, lat, bearing_deg, distance_m)
            future_point_geom = Point(future_lon, future_lat)
            
            # 检查未来点是否仍在渔区内 (使用空间索引优化)
            future_possible_matches_index = list(zones_spatial_index_cache.intersection(future_point_geom.bounds))
            future_possible_matches = zones_gdf_cache.iloc[future_possible_matches_index]
            is_future_inside = future_possible_matches.geometry.contains(future_point_geom).any()
            
            if not is_future_inside:
                # 找到了最紧急的预警等级
                current_warning = level
                # 立即退出循环，不再检查更长时间（更低级别）的预警
                break
        
        return current_warning, prediction_path

    except Exception as e:
        # 捕获并记录分析过程中发生的任何异常
        try:
            import logging
            logging.critical("在执行预警分析时发生意外。", exc_info=True)
        except ImportError:
            print(f"错误: 在执行预警分析时发生意外: {e}")
            import traceback
            traceback.print_exc()
        return -1, []

# =============================================================================
# 独立测试入口
# =============================================================================
if __name__ == "__main__":
    """当脚本被直接执行时，运行此处的测试代码。"""
    print("--- 开始独立测试 WarningAnalysis.py ---")
    
    # 为了独立测试，需要手动加载 config.json 配置
    def load_test_config():
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        config_path = os.path.join(project_root, 'config.json')
        try:
            with io.open(config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            print(f"错误: 测试配置 '{config_path}' 未找到。请确保文件存在。")
            return {}
        except json.JSONDecodeError:
            print(f"错误: 测试配置 '{config_path}' 格式无效。请检查JSON语法。")
            return {}
    
    test_config = load_test_config()
    # 示例测试数据点
    test_point = {'lat': 12.0, 'lon': 177.0, 'speed_knots': 10.0, 'bearing_deg': 45.0}
    
    # 构建渔区GeoJSON文件的路径
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    zones_geojson_path = os.path.join(project_root, 'frontend', 'data', 'fishing_zones.geojson')
    
    print(f"测试数据: 点={test_point}, 渔区='{zones_geojson_path}'")
    
    # 将加载的配置传入分析函数进行测试
    warning, path = analyze_realtime_point(test_point, zones_geojson_path, test_config)
    
    print(f"--- 测试结束 --- \n最终预警等级: {warning}")
    print(f"预测路径: {path}")
