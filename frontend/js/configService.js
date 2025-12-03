import { state } from './state.js';

export async function fetchConfig(onBoatListRefresh = () => {}) {
    try {
        const response = await fetch('http://localhost:8000/api/config');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        state.config = await response.json();
        setInterval(() => {
            try {
                onBoatListRefresh();
            } catch (error) {
                console.error('刷新船只列表失败:', error);
            }
        }, 5000);
    } catch (error) {
        console.error('无法加载配置文件:', error);
        state.config = {
            frontend_parameters: {
                offline_timeout_seconds: 60,
            },
        };
    }
}
