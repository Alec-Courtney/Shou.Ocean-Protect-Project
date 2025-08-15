# -*- coding: utf-8 -*-
"""
功能: 自动GPS轨迹模拟器。
      本脚本作为一个独立的命令行工具，用于模拟GPS设备，
      通过虚拟串行端口定时发送预定义的、硬编码的渔船轨迹数据。

主要功能:
- 从硬编码的数据列表中读取GPS轨迹点。
- 将每个轨迹点格式化为符合NMEA 0183标准的 $GPRMC 语句，并包含校验和。
- 通过指定的虚拟串行端口，定时发送这些NMEA语句。

此模拟器适用于进行可重复的、自动化的系统测试。
"""

import time
import serial
import os
import datetime
from utils import create_gprmc_sentence

# =============================================================================
# 模拟器主函数
# =============================================================================
def run_simulator(port: str, baud_rate: int, interval_seconds: int = 1):
    """
    运行自动GPS轨迹模拟器。
    该函数通过指定的虚拟串行端口，定时发送预定义的渔船轨迹数据。

    参数:
        port (str): 要使用的虚拟串行端口号 (例如 'COM7')。
        baud_rate (int): 串行通信的波特率。
        interval_seconds (int, optional): 发送每条NMEA语句之间的时间间隔（秒）。默认为1秒。
    """
    print("--- 自动GPS模拟器已启动 ---")
    print("配置信息:")
    print(f"  - 虚拟端口: {port}")
    print(f"  - 波特率: {baud_rate}")
    print("  - 数据源: 脚本内硬编码的轨迹数据 (源自 412200078.csv)")
    print(f"  - 发送间隔: {interval_seconds} 秒")
    print("\n提示: 按 Ctrl+C 停止模拟器。")

    # 硬编码的轨迹数据，用于提供一个固定的、可重复的测试场景。
    # 这些数据点模拟了渔船在不同时间和位置的移动。
    hardcoded_data = [
        {'dataTime': '2020-04-01 22:16:12', 'lng': 175.54633, 'lat': 11.52798, 'speed': 9.2, 'dir': 0},
        {'dataTime': '2020-04-03 14:06:04', 'lng': 175.89517, 'lat': 11.68842, 'speed': 3.9, 'dir': 0},
        {'dataTime': '2020-04-05 18:19:21', 'lng': 175.98398, 'lat': 11.66094, 'speed': 3.5, 'dir': 0},
        {'dataTime': '2020-04-12 18:20:58', 'lng': 174.92369, 'lat': 13.35526, 'speed': 3.0, 'dir': 0},
        {'dataTime': '2020-04-17 06:06:11', 'lng': 179.41869, 'lat': 10.846482, 'speed': 4.7, 'dir': 0},
        {'dataTime': '2020-04-18 06:19:01', 'lng': -177.97417, 'lat': 12.26355, 'speed': 7.3, 'dir': 0},
        {'dataTime': '2020-04-18 22:26:21', 'lng': -177.95534, 'lat': 12.262037, 'speed': 4.1, 'dir': 0},
    ]

    try:
        # 尝试打开串行端口
        with serial.Serial(port, baud_rate, timeout=1) as ser:
            print(f"\n成功打开端口 {port}。准备发送数据...")
            print(f"共找到 {len(hardcoded_data)} 条轨迹记录。")
            
            # 遍历硬编码的轨迹数据，逐条发送
            for index, record in enumerate(hardcoded_data):
                try:
                    # 从字典中提取GPS数据
                    lat = record['lat']
                    lon = record['lng']
                    speed_knots = record['speed']
                    bearing_deg = record['dir']
                    timestamp = datetime.datetime.strptime(record['dataTime'], '%Y-%m-%d %H:%M:%S')
                    
                    # 调用 utils 模块中的函数生成符合NMEA 0183标准的 $GPRMC 语句
                    nmea_sentence = create_gprmc_sentence(
                        lat=lat,
                        lon=lon,
                        speed_knots=speed_knots,
                        bearing_deg=bearing_deg,
                        timestamp=timestamp
                    )
                    
                    print(f"发送 (记录 {index + 1}/{len(hardcoded_data)}): {nmea_sentence}")
                    # 发送数据到串口，并附加回车换行符
                    ser.write((nmea_sentence + '\r\n').encode('ascii'))
                    # 等待指定的时间间隔，控制发送频率
                    time.sleep(interval_seconds)
                except (ValueError, TypeError) as e:
                    # 捕获数据格式或类型错误，跳过当前记录并打印警告
                    print(f"警告: 跳过记录 {index + 1}，数据格式或类型错误: {e}")
                    continue
                except Exception as e:
                    # 捕获其他意外错误，打印错误信息并继续
                    print(f"警告: 处理记录 {index + 1} 时发生意外错误: {e}")
                    continue

            print("\n--- 所有轨迹数据已发送完毕 ---")

    except serial.SerialException as e:
        # 捕获串口打开失败的异常
        print(f"\n[错误] 无法打开串行端口 {port}。")
        print("请检查以下几点：")
        print("  1. 您是否已正确安装并配置了虚拟串行端口软件（如 com0com）？")
        print("  2. 您选择的端口号是否正确？")
        print("  3. 该端口是否已被其他程序（如ArcGIS端的预警系统）占用？")
        print(f"详细错误信息: {e}")
    except KeyboardInterrupt:
        # 捕获用户中断 (Ctrl+C)
        print("\n--- 模拟器已被用户手动停止 ---")
    except Exception as e:
        # 捕获其他所有未预期的异常
        import traceback
        print(f"\n[严重错误] 发生未预期的异常: {e}")
        print(traceback.format_exc())

# =============================================================================
# 脚本执行入口
# =============================================================================
if __name__ == '__main__':
    # --- 模拟器配置 ---
    # 【重要】在运行前，请确保此处的端口号是您创建的虚拟串口对中的一个，
    # 并且是“未被”ArcGIS端预警系统监听的那一个。
    # 例如，如果预警系统监听COM8，此处应设置为COM7。
    VIRTUAL_PORT = 'COM7' 
    
    # NMEA 0183 标准通常使用 4800 波特率
    BAUD_RATE = 4800
    
    # 根据用户需求，设置GPS信号的发送频率为每10秒一条
    SIGNAL_INTERVAL_SECONDS = 10 

    # 启动模拟器
    run_simulator(VIRTUAL_PORT, BAUD_RATE, interval_seconds=SIGNAL_INTERVAL_SECONDS)
