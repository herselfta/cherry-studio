import { FILE_TYPE } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { buildPortableImageAssets } from '../BackupService'

describe('BackupService.buildPortableImageAssets', () => {
  it('inlines image files referenced by portable message blocks once', async () => {
    const readPortableImage = vi.fn(async (file) => ({
      fileId: file.id,
      mime: 'image/png',
      data: `data:image/png;base64,${file.id}`,
      ext: file.ext,
      name: file.name,
      origin_name: file.origin_name
    }))

    const portableImageAssets = await buildPortableImageAssets(
      {
        message_blocks: [
          {
            id: 'block-1',
            type: 'image',
            file: {
              id: 'image-1',
              name: 'image-1',
              origin_name: 'shared-image.png',
              path: '/Users/mac/shared-image.png',
              size: 12,
              ext: '.png',
              type: FILE_TYPE.IMAGE,
              created_at: new Date().toISOString(),
              count: 1
            }
          },
          {
            id: 'block-2',
            type: 'image',
            file: {
              id: 'image-1',
              name: 'image-1',
              origin_name: 'shared-image.png',
              path: '/Users/mac/shared-image.png',
              size: 12,
              ext: '.png',
              type: FILE_TYPE.IMAGE,
              created_at: new Date().toISOString(),
              count: 1
            }
          }
        ]
      },
      readPortableImage
    )

    expect(readPortableImage).toHaveBeenCalledTimes(1)
    expect(portableImageAssets).toEqual([
      expect.objectContaining({
        fileId: 'image-1',
        data: 'data:image/png;base64,image-1'
      })
    ])
  })
})
