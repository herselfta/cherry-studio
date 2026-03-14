import KeyvStorage from "@kangfenmao/keyv-storage";
import { loggerService } from "@logger";

import { startAutoBackup } from "./services/BackupService";
import { startManualSyncSchedules } from "./services/ManualSyncScheduleService";
import { startNutstoreAutoBackup } from "./services/NutstoreService";
import storeSyncService from "./services/StoreSyncService";
import { webTraceService } from "./services/WebTraceService";
import store from "./store";

loggerService.initWindowSource("mainWindow");

function initKeyv() {
	window.keyv = new KeyvStorage();
	window.keyv.init();
}

function initAutoBackup() {
	setTimeout(() => {
		const { webdavAutoSync, localBackupAutoSync, s3 } =
			store.getState().settings;
		const { nutstoreAutoSync } = store.getState().nutstore;
		if (webdavAutoSync || (s3 && s3.autoSync) || localBackupAutoSync) {
			startAutoBackup();
		}
		if (nutstoreAutoSync) {
			startNutstoreAutoBackup();
		}
		startManualSyncSchedules();
	}, 8000);
}

function initStoreSync() {
	storeSyncService.subscribe();
}

function initWebTrace() {
	webTraceService.init();
}

initKeyv();
initAutoBackup();
initStoreSync();
initWebTrace();
