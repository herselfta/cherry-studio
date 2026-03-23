import type { BackupArtifactType } from '@renderer/components/BackupTypeModal'

export async function buildBackupArtifactFileName(artifactType: BackupArtifactType) {
  const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  const [hostname, deviceType] = await Promise.all([
    window.api.system.getHostname().catch(() => 'desktop'),
    window.api.system.getDeviceType().catch(() => 'desktop')
  ])

  if (artifactType === 'app') {
    // APP artifacts are portable shared-data payloads, not desktop restore archives.
    return `cherry-studio.mobile-sync.${timestamp}.${hostname || 'desktop'}.${deviceType || 'desktop'}.json`
  }

  // PC artifacts keep the migration naming so restore pickers can distinguish them
  // from APP sync JSON even though both now share the same selection modal.
  return `cherry-studio.migration.${timestamp}.${hostname || 'desktop'}.${deviceType || 'desktop'}.zip`
}
