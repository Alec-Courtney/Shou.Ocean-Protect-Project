import { fetchConfig } from './configService.js';
import { dom } from './domElements.js';
import { clearHistory, queryHistory, updateTodayWarningCount } from './historyManager.js';
import { updateBoatList } from './boatManager.js';
import { fetchFishingZones, initMap, recenterMap, toggleBaseLayer, toggleLabels } from './mapController.js';
import { toggleNotificationCenter } from './notifications.js';
import { connectToBackend } from './socketManager.js';
import { setActiveDrawer, startClock } from './uiControls.js';

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    fetchFishingZones();
    fetchConfig(updateBoatList);
    connectToBackend();
    updateTodayWarningCount();

    dom.queryHistoryBtn?.addEventListener('click', queryHistory);
    dom.clearHistoryBtn?.addEventListener('click', clearHistory);

    if (dom.drawerButtons?.length) {
        dom.drawerButtons.forEach(btn => {
            btn.addEventListener('click', () => setActiveDrawer(btn.dataset.drawerTarget));
        });
        setActiveDrawer('history');
    }

    dom.notificationToggle?.addEventListener('click', () => toggleNotificationCenter());
    dom.notificationClose?.addEventListener('click', () => toggleNotificationCenter(false));

    startClock();
    toggleLabels(false);

    dom.toggleLabelsBtn?.addEventListener('click', () => toggleLabels());
    dom.mapLabelsToggleBtn?.addEventListener('click', () => toggleLabels());
    dom.recenterBtn?.addEventListener('click', () => recenterMap());
    dom.toggleStyleBtn?.addEventListener('click', () => toggleBaseLayer());
});
