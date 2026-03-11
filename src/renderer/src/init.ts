import KeyvStorage from '@kangfenmao/keyv-storage'
import { loggerService } from '@logger'

import { autoRestoreFromWebdavIfNeeded, startAutoSync } from './services/BackupService'
import { startNutstoreAutoSync } from './services/NutstoreService'
import storeSyncService from './services/StoreSyncService'
import { webTraceService } from './services/WebTraceService'
import store from './store'

loggerService.initWindowSource('mainWindow')

function initKeyv() {
  window.keyv = new KeyvStorage()
  window.keyv.init()
}

function initAutoSync() {
  // First, check if we need to auto-restore from WebDAV (after 3 seconds to let the app settle)
  setTimeout(async () => {
    const { webdavAutoRestoreOnStartup, webdavHost } = store.getState().settings
    if (webdavAutoRestoreOnStartup && webdavHost) {
      const restored = await autoRestoreFromWebdavIfNeeded()
      if (restored) {
        // handleData will relaunch the app, so we don't need to start auto-sync
        return
      }
    }

    // Then, start auto-backup timers (after an additional 5 seconds = 8 seconds total)
    setTimeout(() => {
      const { webdavAutoSync, localBackupAutoSync, s3 } = store.getState().settings
      const { nutstoreAutoSync } = store.getState().nutstore
      if (webdavAutoSync || (s3 && s3.autoSync) || localBackupAutoSync) {
        startAutoSync()
      }
      if (nutstoreAutoSync) {
        startNutstoreAutoSync()
      }
    }, 5000)
  }, 3000)
}

function initStoreSync() {
  storeSyncService.subscribe()
}

function initWebTrace() {
  webTraceService.init()
}

initKeyv()
initAutoSync()
initStoreSync()
initWebTrace()
