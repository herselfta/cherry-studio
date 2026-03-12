import { CheckOutlined, FolderOutlined, LoadingOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import NutstorePathPopup from '@renderer/components/Popups/NutsorePathPopup'
import Selector from '@renderer/components/Selector'
import { WebdavBackupManager } from '@renderer/components/WebdavBackupManager'
import { useWebdavBackupModal, WebdavBackupModal } from '@renderer/components/WebdavModals'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useNutstoreSSO } from '@renderer/hooks/useNutstoreSSO'
import { useTimer } from '@renderer/hooks/useTimer'
import {
  backupToNutstore,
  checkConnection,
  createDirectory,
  restoreFromNutstore,
  startNutstoreAutoSync,
  stopNutstoreAutoSync
} from '@renderer/services/NutstoreService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  setNutstoreAutoSync,
  setNutstoreMaxBackups,
  setNutstorePath,
  setNutstoreSkipBackupFile,
  setNutstoreSyncInterval,
  setNutstoreToken
} from '@renderer/store/nutstore'
import { modalConfirm } from '@renderer/utils'
import { NUTSTORE_HOST } from '@shared/config/nutstore'
import { Button, Input, Switch, Typography } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type FileStat } from 'webdav'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'
import {
  AutoSyncDescription,
  AutoSyncStatusValue,
  DEFAULT_AUTO_SYNC_INTERVAL,
  getAutoSyncIntervalOptions,
  getAutoSyncIntervalValue
} from './AutoSyncSettings'
import ManualSyncScheduleSettings from './ManualSyncScheduleSettings'

const NutstoreSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const {
    nutstoreToken,
    nutstorePath,
    nutstoreSyncInterval,
    nutstoreAutoSync,
    nutstoreSyncState,
    nutstoreSkipBackupFile,
    nutstoreMaxBackups
  } = useAppSelector((state) => state.nutstore)

  const dispatch = useAppDispatch()

  const [nutstoreUsername, setNutstoreUsername] = useState<string | undefined>(undefined)
  const [nutstorePass, setNutstorePass] = useState<string | undefined>(undefined)
  const [storagePath, setStoragePath] = useState<string | undefined>(nutstorePath)
  const [checkConnectionLoading, setCheckConnectionLoading] = useState(false)
  const [nsConnected, setNsConnected] = useState<boolean>(false)
  const [syncInterval, setSyncInterval] = useState<number>(nutstoreSyncInterval)
  const [nutSkipBackupFile, setNutSkipBackupFile] = useState<boolean>(nutstoreSkipBackupFile)
  const [backupManagerVisible, setBackupManagerVisible] = useState(false)

  const nutstoreSSOHandler = useNutstoreSSO()
  const { setTimeoutTimer } = useTimer()

  const handleClickNutstoreSSO = useCallback(async () => {
    const ssoUrl = await window.api.nutstore.getSSOUrl()
    window.open(ssoUrl, '_blank')
    const nutstoreToken = await nutstoreSSOHandler()

    dispatch(setNutstoreToken(nutstoreToken))
  }, [dispatch, nutstoreSSOHandler])

  useEffect(() => {
    async function decryptTokenEffect() {
      if (nutstoreToken) {
        const decrypted = await window.api.nutstore.decryptToken(nutstoreToken)

        if (decrypted) {
          setNutstoreUsername(decrypted.username)
          setNutstorePass(decrypted.access_token)
          if (!nutstorePath) {
            dispatch(setNutstorePath('/cherry-studio'))
            setStoragePath('/cherry-studio')
          }
        }
      }
    }
    decryptTokenEffect()
  }, [nutstoreToken, dispatch, nutstorePath])

  const handleLayout = useCallback(async () => {
    const confirmedLogout = await modalConfirm({
      title: t('settings.data.nutstore.logout.title'),
      content: t('settings.data.nutstore.logout.content')
    })
    if (confirmedLogout) {
      dispatch(setNutstoreToken(''))
      dispatch(setNutstorePath(''))
      dispatch(setNutstoreAutoSync(false))
      setNutstoreUsername('')
      setStoragePath(undefined)
    }
  }, [dispatch, t])

  const handleCheckConnection = async () => {
    if (!nutstoreToken) return
    setCheckConnectionLoading(true)
    const isConnectedToNutstore = await checkConnection()

    window.toast[isConnectedToNutstore ? 'success' : 'error']({
      timeout: 2000,
      title: isConnectedToNutstore
        ? t('settings.data.nutstore.checkConnection.success')
        : t('settings.data.nutstore.checkConnection.fail')
    })

    setNsConnected(isConnectedToNutstore)
    setCheckConnectionLoading(false)

    setTimeoutTimer('handleCheckConnection', () => setNsConnected(false), 3000)
  }

  const { isModalVisible, handleBackup, handleCancel, backuping, customFileName, setCustomFileName, showBackupModal } =
    useWebdavBackupModal({
      backupMethod: backupToNutstore
    })

  const onSyncIntervalChange = (value: number) => {
    setSyncInterval(value)
    dispatch(setNutstoreSyncInterval(value))
    if (nutstoreAutoSync) {
      startNutstoreAutoSync()
    }
  }

  const onAutoSyncToggle = (checked: boolean) => {
    if (!checked) {
      dispatch(setNutstoreAutoSync(false))
      stopNutstoreAutoSync()
      return
    }

    const nextInterval = syncInterval > 0 ? syncInterval : DEFAULT_AUTO_SYNC_INTERVAL
    setSyncInterval(nextInterval)
    dispatch(setNutstoreSyncInterval(nextInterval))
    dispatch(setNutstoreAutoSync(true))
    startNutstoreAutoSync()
  }

  const onSkipBackupFilesChange = (value: boolean) => {
    setNutSkipBackupFile(value)
    dispatch(setNutstoreSkipBackupFile(value))
  }

  const onMaxBackupsChange = (value: number) => {
    dispatch(setNutstoreMaxBackups(value))
  }

  const handleClickPathChange = async () => {
    if (!nutstoreToken) {
      return
    }

    const result = await window.api.nutstore.decryptToken(nutstoreToken)

    if (!result) {
      return
    }

    const targetPath = await NutstorePathPopup.show({
      ls: async (target: string) => {
        const { username, access_token } = result
        const token = window.btoa(`${username}:${access_token}`)
        const items = await window.api.nutstore.getDirectoryContents(token, target)
        return items.map(fileStatToStatModel)
      },
      mkdirs: async (path) => {
        await createDirectory(path)
      }
    })

    if (!targetPath) {
      return
    }

    setStoragePath(targetPath)
    dispatch(setNutstorePath(targetPath))
  }

  const isLogin = nutstoreToken && nutstoreUsername

  const showBackupManager = () => {
    setBackupManagerVisible(true)
  }

  const closeBackupManager = () => {
    setBackupManagerVisible(false)
  }

  const isSyncConfigured = Boolean(nutstoreToken && storagePath)
  const isAutoSyncEnabled = Boolean(nutstoreAutoSync && syncInterval > 0)

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.nutstore.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>
          {isLogin ? t('settings.data.nutstore.isLogin') : t('settings.data.nutstore.notLogin')}
        </SettingRowTitle>
        {isLogin ? (
          <HStack gap="5px" justifyContent="space-between" alignItems="center">
            <Button
              type={nsConnected ? 'primary' : 'default'}
              ghost={nsConnected}
              onClick={handleCheckConnection}
              loading={checkConnectionLoading}>
              {checkConnectionLoading ? (
                <LoadingOutlined spin />
              ) : nsConnected ? (
                <CheckOutlined />
              ) : (
                t('settings.data.nutstore.checkConnection.name')
              )}
            </Button>
            <Button type="primary" danger onClick={handleLayout}>
              {t('settings.data.nutstore.logout.button')}
            </Button>
          </HStack>
        ) : (
          <Button onClick={handleClickNutstoreSSO}>{t('settings.data.nutstore.login.button')}</Button>
        )}
      </SettingRow>
      <SettingDivider />
      {isLogin && (
        <>
          <SettingRow>
            <SettingRowTitle>{t('settings.data.nutstore.username')}</SettingRowTitle>
            <Typography.Text style={{ color: 'var(--color-text-3)' }}>{nutstoreUsername}</Typography.Text>
          </SettingRow>

          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.nutstore.path.label')}</SettingRowTitle>
            <HStack gap="4px" justifyContent="space-between">
              <Input
                placeholder={t('settings.data.nutstore.path.placeholder')}
                style={{ width: 250 }}
                value={nutstorePath}
                onChange={(e) => {
                  setStoragePath(e.target.value)
                  dispatch(setNutstorePath(e.target.value))
                }}
              />
              <Button type="default" onClick={handleClickPathChange}>
                <FolderOutlined />
              </Button>
            </HStack>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.auto_sync.manual.label')}</SettingRowTitle>
            <HStack gap="5px" justifyContent="space-between">
              <Button onClick={showBackupModal} loading={backuping}>
                {t('settings.data.nutstore.backup.button')}
              </Button>
              <Button onClick={showBackupManager} disabled={!nutstoreToken}>
                {t('settings.data.nutstore.restore.button')}
              </Button>
            </HStack>
          </SettingRow>
          <SettingRow>
            <SettingHelpText>{t('settings.data.auto_sync.manual.help')}</SettingHelpText>
          </SettingRow>
          <SettingDivider />
          <ManualSyncScheduleSettings provider="nutstore" isConfigured={isSyncConfigured} />
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.auto_sync.label')}</SettingRowTitle>
            <Switch checked={isAutoSyncEnabled} onChange={onAutoSyncToggle} disabled={!isSyncConfigured} />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.auto_sync.interval.label')}</SettingRowTitle>
            <Selector
              size={14}
              value={getAutoSyncIntervalValue(syncInterval)}
              onChange={onSyncIntervalChange}
              placeholder={t('settings.data.auto_sync.interval.placeholder')}
              disabled={!isSyncConfigured}
              options={getAutoSyncIntervalOptions(t)}
            />
          </SettingRow>
          <SettingRow>
            <AutoSyncDescription isConfigured={isSyncConfigured} />
          </SettingRow>
          {isAutoSyncEnabled && (
            <>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{t('settings.data.auto_sync.status.label')}</SettingRowTitle>
                <AutoSyncStatusValue isConfigured={isSyncConfigured} syncState={nutstoreSyncState} />
              </SettingRow>
            </>
          )}
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.webdav.maxBackups')}</SettingRowTitle>
            <Selector
              size={14}
              value={nutstoreMaxBackups}
              onChange={onMaxBackupsChange}
              disabled={!nutstoreToken}
              options={[
                { label: t('settings.data.local.maxBackups.unlimited'), value: 0 },
                { label: '1', value: 1 },
                { label: '3', value: 3 },
                { label: '5', value: 5 },
                { label: '10', value: 10 },
                { label: '20', value: 20 },
                { label: '50', value: 50 }
              ]}
            />
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>{t('settings.data.backup.skip_file_data_title')}</SettingRowTitle>
            <Switch checked={nutSkipBackupFile} onChange={onSkipBackupFilesChange} />
          </SettingRow>
          <SettingRow>
            <SettingHelpText>{t('settings.data.backup.skip_file_data_help')}</SettingHelpText>
          </SettingRow>
        </>
      )}
      <>
        <WebdavBackupModal
          isModalVisible={isModalVisible}
          handleBackup={handleBackup}
          handleCancel={handleCancel}
          backuping={backuping}
          customFileName={customFileName}
          setCustomFileName={setCustomFileName}
          customLabels={{
            modalTitle: t('settings.data.nutstore.backup.modal.title'),
            filenamePlaceholder: t('settings.data.nutstore.backup.modal.filename.placeholder')
          }}
        />

        <WebdavBackupManager
          visible={backupManagerVisible}
          onClose={closeBackupManager}
          webdavConfig={{
            webdavHost: NUTSTORE_HOST,
            webdavUser: nutstoreUsername,
            webdavPass: nutstorePass,
            webdavPath: storagePath
          }}
          restoreMethod={restoreFromNutstore}
          customLabels={{
            restoreConfirmTitle: t('settings.data.nutstore.restore.confirm.title'),
            restoreConfirmContent: t('settings.data.nutstore.restore.confirm.content'),
            invalidConfigMessage: t('message.error.invalid.nutstore')
          }}
        />
      </>
    </SettingGroup>
  )
}

export interface StatModel {
  path: string
  basename: string
  isDir: boolean
  isDeleted: boolean
  mtime: number
  size: number
}

function fileStatToStatModel(from: FileStat): StatModel {
  return {
    path: from.filename,
    basename: from.basename,
    isDir: from.type === 'directory',
    isDeleted: false,
    mtime: new Date(from.lastmod).valueOf(),
    size: from.size
  }
}

export default NutstoreSettings
