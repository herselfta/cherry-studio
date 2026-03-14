import { describe, expect, it } from 'vitest'

import { parseCodeSigningIdentities, pickCodeSigningIdentity } from '../macSigning'

describe('macSigning helpers', () => {
  it('parses valid identities from security output', () => {
    const identities = parseCodeSigningIdentities(
      `  1) ABC123 "Apple Development: Dev User (TEAM123)"\n  2) DEF456 "Cherry Studio Local Code Signing"\n     2 valid identities found`
    )

    expect(identities).toEqual([
      {
        hash: 'ABC123',
        name: 'Apple Development: Dev User (TEAM123)'
      },
      {
        hash: 'DEF456',
        name: 'Cherry Studio Local Code Signing'
      }
    ])
  })

  it('prefers Developer ID identities when no explicit choice is provided', () => {
    const selected = pickCodeSigningIdentity([
      { hash: 'AAA', name: 'Apple Development: Dev User (TEAM123)' },
      { hash: 'BBB', name: 'Developer ID Application: CherryHQ (TEAM999)' }
    ])

    expect(selected).toEqual({
      hash: 'BBB',
      name: 'Developer ID Application: CherryHQ (TEAM999)'
    })
  })

  it('honors an explicit identity name when present', () => {
    const selected = pickCodeSigningIdentity(
      [
        { hash: 'AAA', name: 'Apple Development: Dev User (TEAM123)' },
        { hash: 'BBB', name: 'Cherry Studio Local Code Signing' }
      ],
      'Cherry Studio Local Code Signing'
    )

    expect(selected).toEqual({
      hash: 'BBB',
      name: 'Cherry Studio Local Code Signing'
    })
  })
})
