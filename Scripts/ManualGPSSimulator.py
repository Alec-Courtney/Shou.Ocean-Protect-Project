# -*- coding: utf-8 -*-
"""
功能: 手动GPS遥控模拟器。
      本脚本提供一个独立的、基于Tkinter的图形用户界面（GUI），
      允许用户手动、实时地控制一个模拟的GPS设备，并通过HTTP POST请求发送数据到后端。

主要功能:
- **GUI界面**: 提供直观的滑块和按钮来控制模拟船只的速度和航向。
- **实时控制**: 用户的操作会即时反映到发送的GPS数据中。
- **动态位置更新**: 根据当前的速度和航向，在后台线程中持续计算并更新模拟船只的经纬度位置。
- **多线程**: 使用独立的线程处理数据发送，避免GUI冻结。
- **HTTP通信**: 通过HTTP POST请求将GPS数据发送到后端服务器。

此工具非常适用于进行交互式和探索性的系统测试。
"""

import time
import requests
import threading
import datetime
import math
import tkinter as tk
from tkinter import ttk


# =============================================================================
# 主应用程序类
# =============================================================================
# -*- coding: utf-8 -*-
"""
文件: Scripts/ManualGPSSimulator.py
作者: [在此处填写作者姓名]
创建日期: 2025-08-15
最后修改日期: 2025-08-15
功能: 手动GPS遥控模拟器。
      本脚本提供一个独立的、基于Tkinter的图形用户界面（GUI），
      允许用户手动、实时地控制一个模拟的GPS设备，并通过HTTP POST请求发送数据到后端。

主要功能:
- **GUI界面**: 提供直观的滑块和按钮来控制模拟船只的速度和航向。
- **实时控制**: 用户的操作会即时反映到发送的GPS数据中。
- **动态位置更新**: 根据当前的速度和航向，在后台线程中持续计算并更新模拟船只的经纬度位置。
- **多线程**: 使用独立的线程处理数据发送，避免GUI冻结。
- **HTTP通信**: 通过HTTP POST请求将GPS数据发送到后端服务器。

此工具非常适用于进行交互式和探索性的系统测试。
"""

import time
import requests
import threading
import datetime
import math
import tkinter as tk
from tkinter import ttk


# =============================================================================
# 主应用程序类
# =============================================================================
class AppController(tk.Tk):
    """
    Tkinter应用程序的主控制器类。
    负责构建和管理GUI界面，处理用户输入，并在后台线程中发送模拟GPS数据。
    """
    def __init__(self):
        """
        初始化AppController实例。
        设置窗口标题、大小，初始化内部状态变量，创建GUI组件，并绑定窗口关闭事件。
        """
        super(AppController, self).__init__()
        self.title("手动GPS遥控模拟器 V2.1")
        self.geometry("420x500") # 调整窗口大小以容纳更多信息

        # --- 内部状态变量 ---
        self.sending_thread = None          # 用于发送数据的后台线程
        self.stop_event = threading.Event() # 用于控制后台线程停止的事件
        self.turning_direction = 0          # 转向方向: -1 (左转), 1 (右转), 0 (不转)
        self.TURN_RATE = 1                  # 每秒转向的度数，调整为每秒1度转向

        # --- 构建GUI界面 ---
        self._create_widgets()

        # --- 绑定窗口关闭事件 ---
        # 当用户点击窗口关闭按钮时，调用 on_closing 方法
        self.protocol("WM_DELETE_WINDOW", self.on_closing)

    def _create_widgets(self):
        """
        创建并布局所有的GUI组件，包括连接设置、遥控操作和状态显示框架。
        """
        # --- 1. 连接设置框架 (V4.0) ---
        conn_frame = ttk.LabelFrame(self, text="连接设置")
        conn_frame.pack(padx=10, pady=10, fill="x")

        ttk.Label(conn_frame, text="服务器地址:").grid(row=0, column=0, padx=5, pady=5, sticky="w")
        self.server_url_var = tk.StringVar(value="http://localhost:8000/api/gps_data")
        ttk.Entry(conn_frame, textvariable=self.server_url_var, width=30).grid(row=0, column=1, columnspan=2, padx=5, pady=5, sticky="ew")

        ttk.Label(conn_frame, text="船只ID:").grid(row=1, column=0, padx=5, pady=5, sticky="w")
        self.boat_id_var = tk.StringVar(value="BOAT-001")
        ttk.Entry(conn_frame, textvariable=self.boat_id_var, width=15).grid(row=1, column=1, padx=5, pady=5)

        ttk.Label(conn_frame, text="船只名称:").grid(row=2, column=0, padx=5, pady=5, sticky="w")
        self.boat_name_var = tk.StringVar(value="My Test Boat")
        ttk.Entry(conn_frame, textvariable=self.boat_name_var, width=15).grid(row=2, column=1, padx=5, pady=5)

        ttk.Label(conn_frame, text="发送间隔 (秒):").grid(row=3, column=0, padx=5, pady=5, sticky="w")
        self.interval_var = tk.StringVar(value="1")
        ttk.Entry(conn_frame, textvariable=self.interval_var, width=15).grid(row=3, column=1, padx=5, pady=5)

        self.connect_btn = ttk.Button(conn_frame, text="开始发送", command=self.toggle_connection)
        self.connect_btn.grid(row=1, column=2, rowspan=3, padx=10, pady=5, ipady=20)

        # --- 2. 遥控操作框架 ---
        ctrl_frame = ttk.LabelFrame(self, text="遥控操作")
        ctrl_frame.pack(padx=10, pady=10, fill="x")

        ttk.Label(ctrl_frame, text="速度 (节):").pack(pady=(5,0))
        self.speed_scale = tk.Scale(ctrl_frame, from_=0, to=1000, resolution=0.1, orient="horizontal", length=380)
        self.speed_scale.set(10) # 默认速度
        self.speed_scale.pack()

        ttk.Label(ctrl_frame, text="航向 (度):").pack(pady=(10,0))
        self.bearing_scale = tk.Scale(ctrl_frame, from_=0, to=359, orient="horizontal", length=380)
        self.bearing_scale.pack()

        # 方向快捷按钮
        dir_button_frame = ttk.Frame(ctrl_frame)
        dir_button_frame.pack(pady=5)
        
        buttons = {"北 (0)": 0, "东 (90)": 90, "南 (180)": 180, "西 (270)": 270}
        for text, bearing in buttons.items():
            ttk.Button(dir_button_frame, text=text, command=lambda b=bearing: self.set_bearing(b)).pack(side="left", padx=5, expand=True)

        # 平滑转向按钮
        turn_button_frame = ttk.Frame(ctrl_frame)
        turn_button_frame.pack(pady=10)
        
        left_btn = ttk.Button(turn_button_frame, text="左转 (←)")
        left_btn.pack(side="left", padx=20, expand=True)
        
        right_btn = ttk.Button(turn_button_frame, text="右转 (→)")
        right_btn.pack(side="left", padx=20, expand=True)

        # 绑定鼠标和键盘事件，实现平滑转向
        left_btn.bind("<ButtonPress-1>", lambda e: self.start_turning(-1))
        right_btn.bind("<ButtonPress-1>", lambda e: self.start_turning(1))
        
        self.bind("<KeyPress-Left>", lambda e: self.start_turning(-1))
        self.bind("<KeyPress-Right>", lambda e: self.start_turning(1))

        stop_turn_btn = ttk.Button(turn_button_frame, text="停止转向")
        stop_turn_btn.pack(side="left", padx=20, expand=True)
        stop_turn_btn.bind("<ButtonPress-1>", lambda e: self.stop_turning())
        self.bind("<KeyPress-Up>", lambda e: self.stop_turning()) # 绑定上箭头键停止转向


        # --- 3. 状态显示框架 ---
        status_frame = ttk.LabelFrame(self, text="状态")
        status_frame.pack(padx=10, pady=10, fill="x", expand=True)
        self.status_label = ttk.Label(status_frame, text="已断开连接", foreground="red", wraplength=380)
        self.status_label.pack(padx=5, pady=5)

    def toggle_connection(self):
        """
        切换数据发送的连接状态（开始发送/停止发送）。
        如果当前正在发送，则停止；否则，启动发送。
        """
        if self.sending_thread and self.sending_thread.is_alive():
            self.stop_sending()
        else:
            self.start_sending()

    def start_sending(self):
        """
        启动后台线程，开始向后端服务器发送HTTP请求。
        更新UI状态为“正在发送”。
        """
        self.stop_event.clear() # 清除停止事件，允许线程运行
        self.sending_thread = threading.Thread(target=self.send_data_loop)
        self.sending_thread.daemon = True # 设置为守护线程，主程序退出时自动终止
        self.sending_thread.start()
        
        self.status_label.config(text="正在发送数据...", foreground="blue")
        self.connect_btn.config(text="停止发送")

    def set_bearing(self, bearing: int):
        """
        设置船只的航向。

        参数:
            bearing (int): 目标航向，单位度 (0-359)。
        """
        self.bearing_scale.set(bearing)

    def start_turning(self, direction: int):
        """
        开始平滑转向。

        参数:
            direction (int): 转向方向 (-1 表示左转，1 表示右转)。
        """
        self.turning_direction = direction

    def stop_turning(self):
        """
        停止平滑转向。
        """
        self.turning_direction = 0

    def stop_sending(self):
        """
        请求后台发送线程停止，并更新UI状态为“已停止”。
        """
        if self.sending_thread and self.sending_thread.is_alive():
            self.stop_event.set() # 设置停止事件，通知线程停止
        
        self.status_label.config(text="已停止", foreground="red")
        self.connect_btn.config(text="开始发送")

    def send_data_loop(self):
        """
        在后台线程中运行的循环。
        负责根据当前速度和航向计算模拟船只的新位置，并周期性地发送HTTP POST请求到后端。
        """
        # 初始经纬度，可以根据需要调整
        lat, lon = 20.9, 125.39 
        try:
            interval_seconds = float(self.interval_var.get())
        except ValueError:
            interval_seconds = 1.0 # 默认发送间隔
        
        server_url = self.server_url_var.get()
        boat_id = self.boat_id_var.get()
        boat_name = self.boat_name_var.get()

        while not self.stop_event.is_set(): # 循环直到停止事件被设置
            try:
                # 处理平滑转向逻辑
                if self.turning_direction != 0:
                    turn_amount = self.TURN_RATE * interval_seconds
                    current_bearing = self.bearing_scale.get()
                    new_bearing = (current_bearing + self.turning_direction * turn_amount) % 360
                    self.bearing_scale.set(new_bearing) # 更新航向滑块
                
                bearing_deg = self.bearing_scale.get() # 获取当前航向
                speed_knots = self.speed_scale.get()   # 获取当前速度
                
                # 如果速度大于0，则计算新位置
                if speed_knots > 0:
                    meters_per_second = speed_knots * 0.514444 # 节转换为米/秒
                    distance_m = meters_per_second * interval_seconds # 计算在间隔时间内移动的距离
                    R = 6371000 # 地球平均半径（米）
                    
                    # 将经纬度和航向转换为弧度
                    lat_rad = math.radians(lat)
                    lon_rad = math.radians(lon)
                    bearing_rad = math.radians(bearing_deg)
                    
                    # 使用球面三角学公式计算新的经纬度
                    new_lat_rad = math.asin(math.sin(lat_rad) * math.cos(distance_m / R) +
                                            math.cos(lat_rad) * math.sin(distance_m / R) * math.cos(bearing_rad))
                    new_lon_rad = lon_rad + math.atan2(math.sin(bearing_rad) * math.sin(distance_m / R) * math.cos(lat_rad),
                                                     math.cos(distance_m / R) - math.sin(lat_rad) * math.sin(new_lat_rad))
                    
                    lat = math.degrees(new_lat_rad) # 弧度转回度
                    lon = math.degrees(new_lon_rad)

                # 准备要发送的JSON数据负载
                payload = {
                    "boat_id": boat_id,
                    "boat_name": boat_name if boat_name else None, # 如果船只名称为空，则发送None
                    "latitude": lat,
                    "longitude": lon,
                    "speed_knots": speed_knots,
                    "bearing_deg": bearing_deg,
                    "timestamp": datetime.datetime.utcnow().isoformat() + "Z" # 使用UTC时间并格式化为ISO 8601
                }
                
                # 发送HTTP POST请求到后端服务器
                try:
                    response = requests.post(server_url, json=payload, timeout=5) # 设置5秒超时
                    response.raise_for_status() # 如果状态码不是2xx，则引发HTTPError
                    # 使用 after 方法安全地更新GUI，避免跨线程操作Tkinter组件
                    self.after(0, self.update_status_text, f"成功发送到 {server_url}", "green")
                except requests.exceptions.RequestException as e:
                    # 捕获请求异常，并更新状态文本
                    self.after(0, self.update_status_text, f"HTTP请求失败: {e}", "red")

                # 等待指定间隔，如果停止事件被设置，则立即停止等待
                self.stop_event.wait(interval_seconds)

            except Exception as e:
                # 捕获线程中的其他意外错误
                self.after(0, self.update_status_text, f"线程错误: {e}", "red")
                break # 发生错误时退出循环
        
        print("发送线程已停止。")

    def update_status_text(self, text: str, color: str = "black"):
        """
        安全地更新GUI界面的状态文本标签。
        此方法通过 `self.after(0, ...)` 调用，确保在Tkinter主线程中执行UI更新。

        参数:
            text (str): 要显示的状态文本。
            color (str, optional): 文本颜色。默认为"black"。
        """
        self.status_label.config(text=text, foreground=color)

    def on_closing(self):
        """
        处理窗口关闭事件。
        在窗口关闭前，确保停止后台发送线程，并销毁Tkinter窗口。
        """
        self.stop_sending() # 停止数据发送线程
        self.destroy()      # 销毁Tkinter窗口

# =============================================================================
# 脚本执行入口
# =============================================================================
if __name__ == "__main__":
    # 创建并运行Tkinter应用程序实例
    app = AppController()
    app.mainloop() # 启动Tkinter事件循环，使GUI保持运行
