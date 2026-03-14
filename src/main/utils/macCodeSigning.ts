import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { app } from 'electron'

export type MacCodeSignatureKind =
  | 'adhoc'
  | 'apple-development'
  | 'developer-id'
  | 'development'
  | 'self-signed'
  | 'unknown'
  | 'unsigned'

export interface MacCodeSignatureInfo {
  appBundlePath: string | null
  designatedRequirement: string | null
  isStableForTcc: boolean
  kind: MacCodeSignatureKind
  signingIdentity: string | null
  teamIdentifier: string | null
}

interface CommandResult {
  output: string
  status: number | null
}

function runCodesignCommand(args: string[], appBundlePath: string): CommandResult {
  const result = spawnSync('codesign', [...args, appBundlePath], {
    encoding: 'utf8'
  })

  return {
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    status: result.status
  }
}

export function getMacAppBundlePath(executablePath: string): string | null {
  const bundlePath = path.resolve(executablePath, '../../..')
  return bundlePath.endsWith('.app') ? bundlePath : null
}

export function parseMacCodeSignatureInfo(
  detailOutput: string,
  requirementOutput: string,
  appBundlePath: string | null
): MacCodeSignatureInfo {
  const authorityMatches = [...detailOutput.matchAll(/^Authority=(.+)$/gm)]
  const signingIdentity = authorityMatches[0]?.[1]?.trim() ?? null
  const teamIdentifier = detailOutput.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? null
  const designatedRequirement = requirementOutput.match(/# designated => (.+)$/m)?.[1]?.trim() ?? null

  if (!detailOutput.trim()) {
    return {
      appBundlePath,
      designatedRequirement,
      isStableForTcc: false,
      kind: 'unknown',
      signingIdentity,
      teamIdentifier
    }
  }

  if (/Signature=adhoc/m.test(detailOutput)) {
    return {
      appBundlePath,
      designatedRequirement,
      isStableForTcc: false,
      kind: 'adhoc',
      signingIdentity,
      teamIdentifier
    }
  }

  if (/Authority=Developer ID Application:/m.test(detailOutput)) {
    return {
      appBundlePath,
      designatedRequirement,
      isStableForTcc: true,
      kind: 'developer-id',
      signingIdentity,
      teamIdentifier
    }
  }

  if (/Authority=Apple Development:/m.test(detailOutput)) {
    return {
      appBundlePath,
      designatedRequirement,
      isStableForTcc: true,
      kind: 'apple-development',
      signingIdentity,
      teamIdentifier
    }
  }

  if (signingIdentity) {
    return {
      appBundlePath,
      designatedRequirement,
      isStableForTcc: true,
      kind: 'self-signed',
      signingIdentity,
      teamIdentifier
    }
  }

  return {
    appBundlePath,
    designatedRequirement,
    isStableForTcc: false,
    kind: 'unknown',
    signingIdentity,
    teamIdentifier
  }
}

export function getMacCodeSignatureInfo(): MacCodeSignatureInfo {
  if (!app.isPackaged) {
    return {
      appBundlePath: null,
      designatedRequirement: null,
      isStableForTcc: true,
      kind: 'development',
      signingIdentity: null,
      teamIdentifier: null
    }
  }

  const appBundlePath = getMacAppBundlePath(app.getPath('exe'))

  if (!appBundlePath) {
    return {
      appBundlePath: null,
      designatedRequirement: null,
      isStableForTcc: false,
      kind: 'unknown',
      signingIdentity: null,
      teamIdentifier: null
    }
  }

  const detailResult = runCodesignCommand(['-dv', '--verbose=4'], appBundlePath)
  const requirementResult = runCodesignCommand(['-dr', '-'], appBundlePath)

  if (detailResult.status !== 0) {
    return {
      appBundlePath,
      designatedRequirement: null,
      isStableForTcc: false,
      kind: 'unsigned',
      signingIdentity: null,
      teamIdentifier: null
    }
  }

  return parseMacCodeSignatureInfo(
    detailResult.output,
    requirementResult.status === 0 ? requirementResult.output : '',
    appBundlePath
  )
}
