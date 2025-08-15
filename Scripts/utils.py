# -*- coding: utf-8 -*-
"""
功能: 共享工具模块。
      提供项目中多个脚本可以共享的辅助函数，以遵循DRY（Don't Repeat Yourself）原则，
      提高代码的可维护性和复用性。

主要功能:
- 提供生成NMEA 0183标准 $GPRMC 语句的函数。
"""

import datetime

def create_gprmc_sentence(lat: float, lon: float, speed_knots: float, bearing_deg: float, timestamp: datetime.datetime) -> str:
    """
    根据输入的GPS数据，创建一条标准的 $GPRMC 格式的NMEA语句。
    $GPRMC (Recommended Minimum Specific GPS/Transit Data) 语句包含了
    时间、位置、速度、航向等关键导航信息。

    参数:
        lat (float): 纬度 (十进制度)。例如: 34.0522 (北纬), -34.0522 (南纬)。
        lon (float): 经度 (十进制度)。例如: 118.2437 (东经), -118.2437 (西经)。
        speed_knots (float): 速度，单位为节 (Knots)。
        bearing_deg (float): 航向，单位为度 (Degrees)，真北方向，范围 0-359。
        timestamp (datetime.datetime): 数据点的时间戳对象。应为UTC时间。

    返回:
        str: 一条完整的、包含校验和的 $GPRMC NMEA语句。
             例如: "$GPRMC,123519.00,A,4807.038,N,01131.000,E,022.4,084.4,230394,004.2,W*70"
    """
    
    # --- 格式化时间和日期 ---
    # UTC时间 (HHMMSS.ss)
    utc_time = timestamp.strftime('%H%M%S.00') 
    # UTC日期 (DDMMYY)
    utc_date = timestamp.strftime('%d%m%y')   
    
    # --- 格式化纬度 (从十进制度转换为 DDMM.MMMM 格式) ---
    lat_abs = abs(lat)
    lat_deg = int(lat_abs)
    lat_min = (lat_abs - lat_deg) * 60
    lat_dir = 'N' if lat >= 0 else 'S' # 根据纬度正负判断南北半球
    lat_str = "{:02d}{:05.2f}".format(lat_deg, lat_min) # 格式化为两位整数度，五位小数分钟

    # --- 格式化经度 (从十进制度转换为 DDDMM.MMMM 格式) ---
    lon_abs = abs(lon)
    lon_deg = int(lon_abs)
    lon_min = (lon_abs - lon_deg) * 60
    lon_dir = 'E' if lon >= 0 else 'W' # 根据经度正负判断东西半球
    lon_str = "{:03d}{:05.2f}".format(lon_deg, lon_min) # 格式化为三位整数度，五位小数分钟

    # --- 组合语句主体 (不含校验和) ---
    # $GPRMC,时间,状态(A=有效),纬度,N/S,经度,E/W,速度(节),航向(度),日期,磁偏角,,模式
    # 状态 'A' 表示数据有效，'V' 表示数据无效。这里我们假设数据始终有效。
    # 磁偏角和模式指示符通常留空或根据实际情况填写。
    sentence_body = "GPRMC,{0},{1},{2},{3},{4},{5},{6:.1f},{7:.1f},{8},,,".format(
        utc_time, 'A', lat_str, lat_dir, lon_str, lon_dir, speed_knots, bearing_deg, utc_date)
    
    # --- 计算校验和 ---
    # NMEA校验和是语句中 '$' 和 '*' 之间所有字符的异或(XOR)值。
    checksum = 0
    for char in sentence_body:
        checksum ^= ord(char) # 对每个字符的ASCII值进行异或操作
    checksum_str = "*{:02X}".format(checksum) # 格式化为两位十六进制数，并加上 '*' 前缀

    # 返回完整的NMEA语句，以 '$' 开头，以校验和结尾
    return "${0}{1}".format(sentence_body, checksum_str)
