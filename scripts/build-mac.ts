import 'dotenv/config'

import { spawnSync } from 'node:child_process'

import type { CodeSigningIdentity } from './macSigning'
import { parseCodeSigningIdentities, pickCodeSigningIdentity } from './macSigning'

const ALLOW_ADHOC_ENV = 'CHERRY_MAC_ALLOW_ADHOC'

function getExecutable(command: string) {
  return process.platform === 'win32' ? `${command}.cmd` : command
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(getExecutable(command), args, {
    env,
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function listCodeSigningIdentities(): CodeSigningIdentity[] {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8'
  })

  if (result.status !== 0) {
    return []
  }

  return parseCodeSigningIdentities(`${result.stdout ?? ''}${result.stderr ?? ''}`)
}

function printSigningHelp() {
  console.error('\nmacOS build blocked: no stable code signing identity was found.\n')
  console.error(
    'Selection Assistant relies on Accessibility permission, and ad hoc-signed app replacements lose that permission on update.'
  )
  console.error('\nRecommended fixes:')
  console.error('  1. Use the project signing secrets (CSC_LINK / CSC_KEY_PASSWORD) when you have them.')
  console.error('  2. Or create a persistent local "Code Signing" certificate in Keychain Access, for example:')
  console.error('     Name: Cherry Studio Local Code Signing')
  console.error('     Identity Type: Self Signed Root')
  console.error('     Certificate Type: Code Signing')
  console.error('\nAfter that, rerun `pnpm build:mac` and this script will automatically pick the identity.')
  console.error(
    `If you intentionally want an ad hoc package, run \`${ALLOW_ADHOC_ENV}=1 pnpm build:mac\` or \`pnpm build:mac:adhoc\`.`
  )
}

function main() {
  if (process.platform !== 'darwin') {
    console.error('`pnpm build:mac` must be run on macOS.')
    process.exit(1)
  }

  const env = { ...process.env }
  const allowAdhoc = env[ALLOW_ADHOC_ENV] === '1'
  const builderArgs = process.argv.slice(2)

  if (!env.CSC_LINK) {
    const identities = listCodeSigningIdentities()
    const requestedIdentityName = env.CSC_NAME?.trim()
    const selectedIdentity = pickCodeSigningIdentity(identities, requestedIdentityName)

    if (requestedIdentityName && !selectedIdentity) {
      console.error(`Configured CSC_NAME was not found in the current keychain: ${requestedIdentityName}`)
      console.error(
        'Run `security find-identity -v -p codesigning` to inspect the identities available on this machine.'
      )
      process.exit(1)
    }

    if (!selectedIdentity && !allowAdhoc) {
      printSigningHelp()
      process.exit(1)
    }

    if (selectedIdentity) {
      env.CSC_NAME = selectedIdentity.name
      console.log(`Using macOS code signing identity: ${selectedIdentity.name}`)
    } else {
      console.warn(`Proceeding with ad hoc signing because ${ALLOW_ADHOC_ENV}=1.`)
      console.warn(
        'Selection Assistant Accessibility permission will need to be removed and re-added after each replacement update.'
      )
    }
  }

  runCommand('pnpm', ['build'], env)
  runCommand('pnpm', ['exec', 'electron-builder', '--mac', ...builderArgs], env)
}

main()
