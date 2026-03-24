import fs from 'node:fs'
import path from 'node:path'

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
  optionalDependencies?: Record<string, string>
}

const { nativePrebuildPackages } = require('../before-pack.js') as {
  nativePrebuildPackages: string[]
}

const CANVAS_NATIVE_PACKAGES = [
  '@napi-rs/canvas-darwin-arm64',
  '@napi-rs/canvas-darwin-x64',
  '@napi-rs/canvas-linux-arm64-gnu',
  '@napi-rs/canvas-linux-arm64-musl',
  '@napi-rs/canvas-linux-x64-gnu',
  '@napi-rs/canvas-linux-x64-musl',
  '@napi-rs/canvas-win32-arm64-msvc',
  '@napi-rs/canvas-win32-x64-msvc'
] as const

describe('before-pack native prebuild configuration', () => {
  test('tracks canvas platform bindings in optionalDependencies', () => {
    for (const packageName of CANVAS_NATIVE_PACKAGES) {
      expect(packageJson.optionalDependencies?.[packageName]).toBe('0.1.97')
    }
  })

  test('keeps canvas platform bindings in the before-pack allowlist', () => {
    expect(nativePrebuildPackages).toEqual(expect.arrayContaining([...CANVAS_NATIVE_PACKAGES]))
  })
})
