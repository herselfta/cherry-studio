import { describe, expect, it } from 'vitest'

import { getMacAppBundlePath, parseMacCodeSignatureInfo } from '../macCodeSigning'

describe('macCodeSigning', () => {
  it('detects ad hoc signatures as unstable for TCC', () => {
    const info = parseMacCodeSignatureInfo(
      `Executable=/Applications/Cherry Studio.app/Contents/MacOS/Cherry Studio
Identifier=com.kangfenmao.CherryStudio
Signature=adhoc
TeamIdentifier=not set`,
      '# designated => cdhash H"123456"',
      '/Applications/Cherry Studio.app'
    )

    expect(info.kind).toBe('adhoc')
    expect(info.isStableForTcc).toBe(false)
    expect(info.designatedRequirement).toBe('cdhash H"123456"')
  })

  it('detects Developer ID signatures as stable for TCC', () => {
    const info = parseMacCodeSignatureInfo(
      `Executable=/Applications/Cherry Studio.app/Contents/MacOS/Cherry Studio
Authority=Developer ID Application: CherryHQ (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=ABCDE12345`,
      '# designated => identifier "com.kangfenmao.CherryStudio" and anchor apple generic',
      '/Applications/Cherry Studio.app'
    )

    expect(info.kind).toBe('developer-id')
    expect(info.isStableForTcc).toBe(true)
    expect(info.signingIdentity).toBe('Developer ID Application: CherryHQ (ABCDE12345)')
    expect(info.teamIdentifier).toBe('ABCDE12345')
  })

  it('derives the app bundle path from the packaged executable path', () => {
    const appBundlePath = getMacAppBundlePath('/Applications/Cherry Studio.app/Contents/MacOS/Cherry Studio')

    expect(appBundlePath).toBe('/Applications/Cherry Studio.app')
  })
})
