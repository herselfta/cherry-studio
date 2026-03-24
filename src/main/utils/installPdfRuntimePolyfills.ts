import { createRequire } from 'node:module'

import type * as CanvasModule from '@napi-rs/canvas'

type CanvasPolyfillKey = 'DOMMatrix' | 'ImageData' | 'Path2D'
type CanvasRuntimePolyfills = Record<CanvasPolyfillKey, unknown>
type CanvasPolyfillGlobal = Partial<Record<CanvasPolyfillKey, unknown>>

let cachedCanvasRuntime: CanvasRuntimePolyfills | undefined

function loadCanvasRuntimePolyfills(): CanvasRuntimePolyfills {
  if (cachedCanvasRuntime) {
    return cachedCanvasRuntime
  }

  const require = createRequire(import.meta.url)
  cachedCanvasRuntime = require('@napi-rs/canvas') as typeof CanvasModule
  return cachedCanvasRuntime
}

export function installPdfRuntimePolyfills(
  globalScope: CanvasPolyfillGlobal = globalThis as unknown as CanvasPolyfillGlobal,
  canvasRuntime?: CanvasRuntimePolyfills
) {
  if (globalScope.DOMMatrix && globalScope.ImageData && globalScope.Path2D) {
    return
  }

  const runtime = canvasRuntime ?? loadCanvasRuntimePolyfills()

  // pdf-parse 2.x is shared between renderer and main, but its PDF.js runtime
  // expects browser globals such as DOMMatrix/ImageData/Path2D. Electron's main
  // process does not provide them, so packaged builds can crash during startup
  // as soon as the shared PDF helper is imported. Keep this bootstrap polyfill
  // in place unless the main-side PDF extraction path stops using pdf-parse.
  globalScope.DOMMatrix ??= runtime.DOMMatrix
  globalScope.ImageData ??= runtime.ImageData
  globalScope.Path2D ??= runtime.Path2D
}
