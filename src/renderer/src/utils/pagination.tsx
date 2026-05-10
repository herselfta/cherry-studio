import { DoubleLeftOutlined, DoubleRightOutlined } from '@ant-design/icons'
import type { PaginationProps } from 'antd'

export function createAlwaysVisiblePaginationConfig(pagination: PaginationProps = {}): PaginationProps {
  const { itemRender, ...rest } = pagination

  return {
    ...rest,
    showSizeChanger: true,
    showLessItems: false,
    hideOnSinglePage: false,
    showQuickJumper: true,
    itemRender: (page, type, originalElement) => {
      if (type === 'jump-prev') {
        return (
          <div className="ant-pagination-item-container">
            <DoubleLeftOutlined className="ant-pagination-item-link-icon" aria-label="Jump previous pages" />
          </div>
        )
      }

      if (type === 'jump-next') {
        return (
          <div className="ant-pagination-item-container">
            <DoubleRightOutlined className="ant-pagination-item-link-icon" aria-label="Jump next pages" />
          </div>
        )
      }

      return itemRender ? itemRender(page, type, originalElement) : originalElement
    }
  }
}

export type { PaginationProps }
