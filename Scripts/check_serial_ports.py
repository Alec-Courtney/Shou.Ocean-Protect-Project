# -*- coding: utf-8 -*-
"""
功能: 串口诊断工具。
      用于检测并测试系统上所有可用的串行端口，判断其是否被其他程序占用，
      从而帮助用户诊断和解决串口连接问题。
"""

import serial.tools.list_ports

def list_available_ports():
    """
    扫描系统上所有可用的 COM 端口，并尝试打开和关闭每个端口以测试其可用性。
    打印详细的端口信息、状态（可用或被占用）以及故障排除建议。

    此函数不接受参数，不返回任何值，直接将结果打印到控制台。
    """
    ports = serial.tools.list_ports.comports() # 获取所有可用的串口信息
    
    print("--- 串口诊断工具 ---")
    if not ports:
        print("\n[结果]: 未检测到任何活动的串口。")
        print("\n[建议]:")
        print("  1. 如果您使用物理GPS设备，请确保它已通过USB正确连接。")
        print("  2. 如果您使用虚拟串口软件 (如 com0com)，请确保它已启动并正确创建了配对的端口。")
        print("  3. 检查设备管理器，确认串口驱动是否已正确安装。")
    else:
        print("\n[结果]: 检测到以下串口，正在测试其可用性...")
        # 遍历并测试每个检测到的串口
        for port_info in sorted(ports):
            print("-" * 25)
            print(f"  设备: {port_info.device}")      # 串口设备名称 (例如 COM1, COM2)
            print(f"  描述: {port_info.description}") # 串口的描述信息
            
            ser = None # 初始化串口对象
            try:
                # 尝试以默认设置打开串口
                ser = serial.Serial(port_info.device)
                print(f"  状态: \033[92m可用 (成功打开和关闭)\033[0m") # 绿色表示可用
            except serial.SerialException as e:
                # 捕获串口异常，特别是“访问被拒绝”或“已被占用”的错误
                if "Access is denied" in str(e) or "already in use" in str(e):
                    print(f"  状态: \033[91m不可用 (端口已被占用)\033[0m") # 红色表示被占用
                else:
                    print(f"  状态: \033[91m错误 ({e})\033[0m") # 其他错误
            finally:
                # 确保在任何情况下都关闭串口，释放资源
                if ser and ser.is_open:
                    ser.close()
        print("-" * 25)
        print("\n[说明]:")
        print("  - \033[92m可用\033[0m: 表示端口存在且当前未被任何程序占用，可以被本系统连接。")
        print("  - \033[91m不可用\033[0m: 表示端口虽然存在，但已被其他程序（可能是GPS模拟器或一个未关闭的旧进程）占用。")
        print("\n[下一步]:")
        print("  - 请确保后端服务器和GPS模拟器连接的是不同的、配对的、且状态为\033[92m可用\033[0m的端口。")
        print("  - 如果所有端口都不可用，请尝试重启虚拟串口软件或计算机。")

if __name__ == "__main__":
    # 当脚本作为主程序直接运行时，调用端口检测功能
    list_available_ports()
