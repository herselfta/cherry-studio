import { describe, expect, it } from 'vitest'

import { installPdfRuntimePolyfills } from '../installPdfRuntimePolyfills'

describe('installPdfRuntimePolyfills', () => {
  it('installs missing canvas polyfills onto the provided global scope', () => {
    class MockDOMMatrix {}
    class MockImageData {}
    class MockPath2D {}

    const globalScope = {} as Parameters<typeof installPdfRuntimePolyfills>[0]

    installPdfRuntimePolyfills(globalScope, {
      DOMMatrix: MockDOMMatrix,
      ImageData: MockImageData,
      Path2D: MockPath2D
    })

    expect((globalScope as any).DOMMatrix).toBe(MockDOMMatrix)
    expect((globalScope as any).ImageData).toBe(MockImageData)
    expect((globalScope as any).Path2D).toBe(MockPath2D)
  })

  it('preserves existing globals while filling any missing ones', () => {
    class ExistingDOMMatrix {}
    class MockImageData {}
    class MockPath2D {}
    class ReplacementDOMMatrix {}

    const globalScope = {
      DOMMatrix: ExistingDOMMatrix
    } as Parameters<typeof installPdfRuntimePolyfills>[0]

    installPdfRuntimePolyfills(globalScope, {
      DOMMatrix: ReplacementDOMMatrix,
      ImageData: MockImageData,
      Path2D: MockPath2D
    })

    expect((globalScope as any).DOMMatrix).toBe(ExistingDOMMatrix)
    expect((globalScope as any).ImageData).toBe(MockImageData)
    expect((globalScope as any).Path2D).toBe(MockPath2D)
  })
})
