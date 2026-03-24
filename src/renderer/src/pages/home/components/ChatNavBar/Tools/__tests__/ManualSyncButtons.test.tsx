import { render, screen } from '@testing-library/react'
import type { CSSProperties, HTMLAttributes, PropsWithChildren, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ManualSyncButtons from '../ManualSyncButtons'

vi.mock('@renderer/components/Layout', () => ({
  HStack: ({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) => (
    <div className={className} style={style}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/components/BackupTypeModal', () => ({
  __esModule: true,
  default: () => null
}))

vi.mock('@renderer/components/LocalBackupManager', () => ({
  LocalBackupManager: () => null
}))

vi.mock('@renderer/components/LocalBackupModals', () => ({
  LocalBackupModal: () => null,
  useLocalBackupModal: () => ({
    isModalVisible: false,
    handleBackup: vi.fn(),
    handleCancel: vi.fn(),
    backuping: false,
    customFileName: '',
    setCustomFileName: vi.fn(),
    showBackupModal: vi.fn()
  })
}))

vi.mock('@renderer/components/NavbarIcon', () => ({
  default: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/components/S3BackupManager', () => ({
  S3BackupManager: () => null
}))

vi.mock('@renderer/components/S3Modals', () => ({
  S3BackupModal: () => null,
  useS3BackupModal: () => ({
    isModalVisible: false,
    handleBackup: vi.fn(),
    handleCancel: vi.fn(),
    backuping: false,
    customFileName: '',
    setCustomFileName: vi.fn(),
    showBackupModal: vi.fn()
  })
}))

vi.mock('@renderer/components/WebdavBackupManager', () => ({
  WebdavBackupManager: () => null
}))

vi.mock('@renderer/components/WebdavModals', () => ({
  WebdavBackupModal: () => null,
  useWebdavBackupModal: () => ({
    isModalVisible: false,
    handleBackup: vi.fn(),
    handleCancel: vi.fn(),
    backuping: false,
    customFileName: '',
    setCustomFileName: vi.fn(),
    showBackupModal: vi.fn()
  })
}))

vi.mock('@renderer/context/ThemeProvider', () => ({
  useTheme: () => ({
    theme: 'light'
  })
}))

const settingsMocks = vi.hoisted(() => ({
  useSettings: vi.fn()
}))

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: settingsMocks.useSettings
}))

vi.mock('@renderer/services/NutstoreService', () => ({
  backupToNutstore: vi.fn(),
  restoreFromNutstore: vi.fn()
}))

vi.mock('@renderer/store', () => ({
  useAppSelector: vi.fn((selector) =>
    selector({
      nutstore: {
        nutstoreToken: undefined,
        nutstorePath: ''
      }
    })
  )
}))

vi.mock('@shared/config/nutstore', () => ({
  NUTSTORE_HOST: 'https://example.com'
}))

vi.mock('antd', () => ({
  Dropdown: ({ children }: PropsWithChildren) => <>{children}</>,
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('ManualSyncButtons', () => {
  beforeEach(() => {
    settingsMocks.useSettings.mockReturnValue({
      localBackupDir: undefined,
      webdavHost: '',
      s3: {}
    })
  })

  it('renders horizontally by default', () => {
    const { container } = render(<ManualSyncButtons />)

    expect(container.firstChild).toHaveStyle({ flexDirection: 'row' })
  })

  it('renders vertically in sidebar mode', () => {
    const { container } = render(<ManualSyncButtons orientation="vertical" />)

    expect(container.firstChild).toHaveStyle({ flexDirection: 'column' })
  })

  it('uses sidebar action buttons in vertical mode', () => {
    render(<ManualSyncButtons orientation="vertical" />)

    const buttons = screen.getAllByRole('button')

    expect(buttons).toHaveLength(2)
    buttons.forEach((button) => {
      expect(button).toHaveAttribute('data-variant', 'sidebar')
    })
  })
})
