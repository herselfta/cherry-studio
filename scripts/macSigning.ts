export type CodeSigningIdentity = {
  hash: string
  name: string
}

const identityPriorityPrefixes = ['Developer ID Application:', 'Apple Development:', 'Cherry Studio Local Code Signing']

export function parseCodeSigningIdentities(output: string): CodeSigningIdentity[] {
  return output
    .split('\n')
    .map((line) => line.match(/^\s*\d+\)\s+([0-9A-F]+)\s+"(.+)"$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      hash: match[1],
      name: match[2]
    }))
}

export function pickCodeSigningIdentity(
  identities: CodeSigningIdentity[],
  requestedIdentityName?: string
): CodeSigningIdentity | null {
  if (requestedIdentityName) {
    return identities.find((identity) => identity.name === requestedIdentityName) ?? null
  }

  for (const prefix of identityPriorityPrefixes) {
    const match = identities.find((identity) => identity.name.startsWith(prefix))
    if (match) {
      return match
    }
  }

  return identities[0] ?? null
}
