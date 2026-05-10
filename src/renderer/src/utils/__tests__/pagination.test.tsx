import { DoubleLeftOutlined, DoubleRightOutlined } from '@ant-design/icons'
import { describe, expect, it } from 'vitest'

import { createAlwaysVisiblePaginationConfig } from '../pagination'

describe('createAlwaysVisiblePaginationConfig', () => {
  it('forces the size changer to stay visible and swaps jump icons', () => {
    const pagination = createAlwaysVisiblePaginationConfig({ showSizeChanger: false })

    expect(pagination.showSizeChanger).toBe(true)
    expect(pagination.showLessItems).toBe(false)

    const jumpPrev = pagination.itemRender?.(1, 'jump-prev', <span />) as any
    const jumpNext = pagination.itemRender?.(1, 'jump-next', <span />) as any

    expect(jumpPrev?.props?.children?.type).toBe(DoubleLeftOutlined)
    expect(jumpNext?.props?.children?.type).toBe(DoubleRightOutlined)
  })
})
