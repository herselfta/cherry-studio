import { PushpinOutlined } from '@ant-design/icons'
import { FreeTrialModelTag } from '@renderer/components/FreeTrialModelTag'
import { HStack } from '@renderer/components/Layout'
import ModelTagsWithLabel from '@renderer/components/ModelTagsWithLabel'
import { TopView } from '@renderer/components/TopView'
import { DynamicVirtualList, type DynamicVirtualListRef } from '@renderer/components/VirtualList'
import { getModelLogo } from '@renderer/config/models'
import { usePinnedModels } from '@renderer/hooks/usePinnedModels'
import { getModelUniqId } from '@renderer/services/ModelService'
import { getProviderById } from '@renderer/services/ProviderService'
import type { Model, Provider } from '@renderer/types'
import { objectEntries } from '@renderer/types'
import { classNames, filterModelsByKeywords, getFancyProviderName } from '@renderer/utils'
import { getModelTags } from '@renderer/utils/model'
import { Avatar, Divider, Empty, Modal, Tooltip } from 'antd'
import { first, sortBy } from 'lodash'
import { Settings2 } from 'lucide-react'
import React, {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { MODEL_TAGS, useModelProviderFilter, useModelTagFilter } from './filters'
import ProviderFilterSection from './ProviderFilterSection'
import SelectModelSearchBar from './searchbar'
import TagFilterSection from './TagFilterSection'
import type { FlatListItem, FlatListModel } from './types'

const PAGE_SIZE = 12
const ITEM_HEIGHT = 36

export interface SelectModelPopupParams {
  providers: Provider[]
  model?: Model
  loading?: boolean
  /** Show tag filter section */
  showTagFilter?: boolean
  /** Show provider filter section */
  showProviderFilter?: boolean
  showPinnedModels?: boolean
  prioritizedProviderIds?: string[]
}

interface Props extends SelectModelPopupParams {
  resolve: (value: Model | undefined) => void
}

const SelectModelPopupView: React.FC<Props> = ({
  providers,
  model,
  loading = false,
  showTagFilter = true,
  showProviderFilter = true,
  showPinnedModels = true,
  prioritizedProviderIds = [],
  resolve
}) => {
  const { t } = useTranslation()
  const { pinnedModels, togglePinnedModel, loading: pinnedLoading } = usePinnedModels()
  const isLoading = loading || (showPinnedModels && pinnedLoading)
  const [open, setOpen] = useState(true)
  const listRef = useRef<DynamicVirtualListRef>(null)
  const [_searchText, setSearchText] = useState('')
  const searchText = useDeferredValue(_searchText)

  const currentModelId = model ? getModelUniqId(model) : ''

  const [focusedItemKey, _setFocusedItemKey] = useState('')
  const [isMouseOver, setIsMouseOver] = useState(false)
  const preventScrollToIndex = useRef(false)

  const setFocusedItemKey = useCallback((key: string) => {
    startTransition(() => {
      _setFocusedItemKey(key)
    })
  }, [])

  const { tagSelection, selectedTags, tagFilter, toggleTag } = useModelTagFilter()
  const { selectedProviderIds, providerFilter, toggleProvider, resetProviders } = useModelProviderFilter()

  const sortedProviders = useMemo(() => {
    if (prioritizedProviderIds.length === 0) {
      return providers
    }

    const priorityMap = new Map(prioritizedProviderIds.map((id, index) => [id, index]))

    return [...providers].sort((a, b) => {
      const aPriority = priorityMap.get(a.id)
      const bPriority = priorityMap.get(b.id)

      if (aPriority === undefined && bPriority === undefined) return 0
      if (aPriority === undefined) return 1
      if (bPriority === undefined) return -1
      return aPriority - bPriority
    })
  }, [providers, prioritizedProviderIds])

  const searchFilter = useCallback(
    (provider: Provider) => {
      let models = provider.models

      if (searchText.trim()) {
        models = filterModelsByKeywords(searchText, models, provider)
      }

      return sortBy(models, ['group', 'name'])
    },
    [searchText]
  )

  const providerModelGroups = useMemo(
    () => sortedProviders.map((provider) => ({ provider, models: searchFilter(provider) })),
    [sortedProviders, searchFilter]
  )

  const availableTags = useMemo(() => {
    const models = providerModelGroups
      .filter(({ provider }) => !showProviderFilter || providerFilter(provider.id))
      .flatMap(({ models }) => models)
    const tagSet = new Set(
      objectEntries(getModelTags(models))
        .filter(([, state]) => state)
        .map(([tag]) => tag)
    )

    selectedTags.forEach((tag) => tagSet.add(tag))

    return MODEL_TAGS.filter((tag) => tagSet.has(tag))
  }, [providerModelGroups, providerFilter, selectedTags, showProviderFilter])

  const providerFilterOptions = useMemo(() => {
    const counts = new Map<string, number>()

    providerModelGroups.forEach(({ provider, models }) => {
      const count = models.filter((candidate) => !showTagFilter || tagFilter(candidate)).length
      if (count > 0 || selectedProviderIds.includes(provider.id)) {
        counts.set(provider.id, count)
      }
    })

    return sortedProviders
      .filter((provider) => counts.has(provider.id))
      .map((provider) => ({
        provider,
        count: counts.get(provider.id) ?? 0
      }))
  }, [providerModelGroups, selectedProviderIds, showTagFilter, sortedProviders, tagFilter])

  const createModelItem = useCallback(
    (model: Model, provider: Provider, isPinned: boolean): FlatListModel => {
      const modelId = getModelUniqId(model)
      const groupName = getFancyProviderName(provider)
      const isCherryAi = provider.id === 'cherryai'

      return {
        key: isPinned ? `${modelId}_pinned` : modelId,
        type: 'model',
        name: (
          <ModelName>
            <HStack alignItems="center">
              {model.name}
              {isPinned && <span style={{ color: 'var(--color-text-3)', whiteSpace: 'pre-wrap' }}> | {groupName}</span>}
            </HStack>
            {isCherryAi && <FreeTrialModelTag model={model} showLabel={false} />}
          </ModelName>
        ),
        tags: (
          <TagsContainer>
            <ModelTagsWithLabel model={model} size={11} showLabel={true} />
          </TagsContainer>
        ),
        icon: (
          <Avatar src={getModelLogo(model)} size={24}>
            {first(model.name) || 'M'}
          </Avatar>
        ),
        model,
        isPinned,
        isSelected: modelId === currentModelId
      }
    },
    [currentModelId]
  )

  const { listItems, modelItems } = useMemo(() => {
    const items: FlatListItem[] = []
    const pinnedModelIds = new Set(pinnedModels)
    const finalModelFilter = (providerId: string, model: Model) => {
      const matchesTag = !showTagFilter || tagFilter(model)
      const matchesProvider = !showProviderFilter || providerFilter(providerId)
      return matchesTag && matchesProvider
    }

    if (searchText.length === 0 && showPinnedModels && pinnedModelIds.size > 0) {
      const pinnedItems = providerModelGroups.flatMap(({ provider, models }) =>
        models
          .filter((item) => pinnedModelIds.has(getModelUniqId(item)))
          .filter((item) => finalModelFilter(provider.id, item))
          .map((item) => createModelItem(item, provider, true))
      )

      if (pinnedItems.length > 0) {
        items.push({
          key: 'pinned-group',
          type: 'group',
          name: t('models.pinned'),
          isSelected: false
        })

        items.push(...pinnedItems)
      }
    }

    providerModelGroups.forEach(({ provider, models }) => {
      const filteredModels = models
        .filter((item) => searchText.length > 0 || !pinnedModelIds.has(getModelUniqId(item)))
        .filter((item) => finalModelFilter(provider.id, item))

      if (filteredModels.length === 0) return

      const canNavigateToSettings = provider.id !== 'cherryai' && !!getProviderById(provider.id)

      items.push({
        key: `provider-${provider.id}`,
        type: 'group',
        name: getFancyProviderName(provider),
        actions: canNavigateToSettings && (
          <Tooltip title={t('navigate.provider_settings')} mouseEnterDelay={0.5} mouseLeaveDelay={0}>
            <Settings2
              size={12}
              color="var(--color-text)"
              className="action-icon"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                resolve(undefined)
                window.navigate(`/settings/provider?id=${provider.id}`)
              }}
            />
          </Tooltip>
        ),
        isSelected: false
      })

      items.push(
        ...filteredModels.map((item) =>
          createModelItem(item, provider, showPinnedModels && pinnedModelIds.has(getModelUniqId(item)))
        )
      )
    })

    const selectableModels = items.filter((item) => item.type === 'model')
    return { listItems: items, modelItems: selectableModels }
  }, [
    createModelItem,
    pinnedModels,
    providerFilter,
    providerModelGroups,
    resolve,
    searchText.length,
    showPinnedModels,
    showProviderFilter,
    showTagFilter,
    t,
    tagFilter
  ])

  const shouldShowProviderFilter =
    showProviderFilter && (providerFilterOptions.length > 1 || selectedProviderIds.length > 0)
  const shouldShowTagFilter = showTagFilter && (availableTags.length > 0 || selectedTags.length > 0)

  const listHeight = useMemo(() => {
    return Math.min(PAGE_SIZE, listItems.length) * ITEM_HEIGHT
  }, [listItems.length])

  useLayoutEffect(() => {
    if (isLoading) return

    if (preventScrollToIndex.current) {
      preventScrollToIndex.current = false
      return
    }

    let targetItemKey: string | undefined

    if (searchText || selectedTags.length > 0 || selectedProviderIds.length > 0) {
      targetItemKey = modelItems[0]?.key
    } else {
      targetItemKey = modelItems.find((item) => item.isSelected)?.key
    }

    if (targetItemKey) {
      setFocusedItemKey(targetItemKey)
      const index = listItems.findIndex((item) => item.key === targetItemKey)
      if (index >= 0) {
        const targetScrollTop = index * ITEM_HEIGHT - listHeight / 2
        listRef.current?.scrollToOffset(targetScrollTop, {
          align: 'start',
          behavior: 'auto'
        })
      }
    }
  }, [
    isLoading,
    listHeight,
    listItems,
    modelItems,
    searchText,
    selectedProviderIds.length,
    selectedTags.length,
    setFocusedItemKey
  ])

  const handleItemClick = useCallback(
    (item: FlatListItem) => {
      if (item.type === 'model') {
        resolve(item.model)
        setOpen(false)
      }
    },
    [resolve]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const modelCount = modelItems.length

      if (!open || modelCount === 0 || e.isComposing) return

      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter', 'Escape'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        setIsMouseOver(false)
      }

      const currentIndex = modelItems.findIndex((item) => item.key === focusedItemKey)

      let nextIndex = -1

      switch (e.key) {
        case 'ArrowUp':
          nextIndex = (currentIndex < 0 ? 0 : currentIndex - 1 + modelCount) % modelCount
          break
        case 'ArrowDown':
          nextIndex = (currentIndex < 0 ? 0 : currentIndex + 1) % modelCount
          break
        case 'PageUp':
          nextIndex = Math.max(0, (currentIndex < 0 ? 0 : currentIndex) - PAGE_SIZE)
          break
        case 'PageDown':
          nextIndex = Math.min(modelCount - 1, (currentIndex < 0 ? 0 : currentIndex) + PAGE_SIZE)
          break
        case 'Enter':
          if (currentIndex >= 0) {
            const selectedItem = modelItems[currentIndex]
            if (selectedItem) {
              handleItemClick(selectedItem)
            }
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
          resolve(undefined)
          break
      }

      if (nextIndex < 0) return

      const nextKey = modelItems[nextIndex]?.key || ''
      if (nextKey) {
        setFocusedItemKey(nextKey)
        const index = listItems.findIndex((item) => item.key === nextKey)
        if (index >= 0) {
          listRef.current?.scrollToIndex(index, { align: 'auto' })
        }
      }
    },
    [focusedItemKey, handleItemClick, listItems, modelItems, open, resolve, setFocusedItemKey]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const onCancel = useCallback(() => {
    setOpen(false)
  }, [])

  const onAfterClose = useCallback(async () => {
    resolve(undefined)
    SelectModelPopup.hide()
  }, [resolve])

  const togglePin = useCallback(
    async (modelId: string) => {
      await togglePinnedModel(modelId)
      preventScrollToIndex.current = true
    },
    [togglePinnedModel]
  )

  const getItemKey = useCallback((index: number) => listItems[index].key, [listItems])
  const estimateSize = useCallback(() => ITEM_HEIGHT, [])
  const isSticky = useCallback((index: number) => listItems[index].type === 'group', [listItems])

  const rowRenderer = useCallback(
    (item: FlatListItem) => {
      const isFocused = item.key === focusedItemKey
      if (item.type === 'group') {
        return (
          <GroupItem>
            {item.name}
            {item.actions}
          </GroupItem>
        )
      }
      return (
        <ModelItem
          className={classNames({
            focused: isFocused,
            selected: item.isSelected
          })}
          onClick={() => handleItemClick(item)}
          onMouseOver={() => !isFocused && setFocusedItemKey(item.key)}>
          <ModelItemLeft>
            {item.icon}
            {item.name}
            {item.tags}
          </ModelItemLeft>
          {showPinnedModels && (
            <PinIconWrapper
              onClick={(e) => {
                e.stopPropagation()
                togglePin(getModelUniqId(item.model))
              }}
              data-pinned={item.isPinned}
              $isPinned={item.isPinned}>
              <PushpinOutlined />
            </PinIconWrapper>
          )}
        </ModelItem>
      )
    },
    [focusedItemKey, handleItemClick, setFocusedItemKey, showPinnedModels, togglePin]
  )

  return (
    <Modal
      centered
      open={open}
      onCancel={onCancel}
      afterClose={onAfterClose}
      width={600}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 16
        },
        body: {
          maxHeight: 'inherit',
          padding: 0
        }
      }}
      closeIcon={null}
      footer={null}>
      <SelectModelSearchBar onSearch={setSearchText} />
      <Divider style={{ margin: 0, marginTop: 4, borderBlockStartWidth: 0.5 }} />
      {shouldShowProviderFilter && (
        <>
          <ProviderFilterSection
            providers={providerFilterOptions}
            selectedProviderIds={selectedProviderIds}
            onToggleProvider={toggleProvider}
            onResetProviders={resetProviders}
          />
          <Divider style={{ margin: 0, borderBlockStartWidth: 0.5 }} />
        </>
      )}
      {shouldShowTagFilter && (
        <>
          <TagFilterSection availableTags={availableTags} tagSelection={tagSelection} onToggleTag={toggleTag} />
          <Divider style={{ margin: 0, borderBlockStartWidth: 0.5 }} />
        </>
      )}

      {listItems.length > 0 ? (
        <ListContainer onMouseMove={() => !isMouseOver && setIsMouseOver(true)}>
          <DynamicVirtualList
            ref={listRef}
            list={listItems}
            size={listHeight}
            getItemKey={getItemKey}
            estimateSize={estimateSize}
            isSticky={isSticky}
            scrollPaddingStart={ITEM_HEIGHT}
            overscan={5}
            scrollerStyle={{ pointerEvents: isMouseOver ? 'auto' : 'none' }}>
            {rowRenderer}
          </DynamicVirtualList>
        </ListContainer>
      ) : (
        <EmptyState>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </EmptyState>
      )}
    </Modal>
  )
}

const ListContainer = styled.div`
  position: relative;
  overflow: hidden;
`

const GroupItem = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  line-height: 1;
  font-size: 12px;
  font-weight: normal;
  height: ${ITEM_HEIGHT}px;
  padding: 5px 18px;
  color: var(--color-text-3);
  z-index: 1;
  background: var(--modal-background);

  .action-icon {
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s;

    &:hover {
      opacity: 1 !important;
    }
  }
  &:hover .action-icon {
    opacity: 0.3;
  }
`

const ModelItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  font-size: 14px;
  padding: 0 8px;
  margin: 1px 8px;
  height: ${ITEM_HEIGHT - 2}px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.1s ease;

  &.focused {
    background-color: var(--color-background-mute);
  }

  &.selected {
    &::before {
      content: '';
      display: block;
      position: absolute;
      left: -1px;
      top: 13%;
      width: 3px;
      height: 74%;
      background: var(--color-primary-soft);
      border-radius: 8px;
    }
  }

  .pin-icon {
    opacity: 0;
  }

  &:hover .pin-icon {
    opacity: 0.3;
  }
`

const ModelItemLeft = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  overflow: hidden;
  padding-right: 26px;

  .anticon {
    min-width: auto;
    flex-shrink: 0;
  }
`

const ModelName = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  margin: 0 8px;
  min-width: 0;
  gap: 5px;
`

const TagsContainer = styled.div`
  display: flex;
  justify-content: flex-end;
  min-width: 80px;
  max-width: 180px;
  overflow: hidden;
  flex-shrink: 0;
`

const EmptyState = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
`

const PinIconWrapper = styled.div.attrs({ className: 'pin-icon' })<{ $isPinned?: boolean }>`
  margin-left: auto;
  padding: 0 10px;
  opacity: ${(props) => (props.$isPinned ? 1 : 'inherit')};
  transition: opacity 0.2s;
  position: absolute;
  right: 0;
  color: ${(props) => (props.$isPinned ? 'var(--color-primary)' : 'inherit')};
  transform: ${(props) => (props.$isPinned ? 'rotate(-45deg)' : 'none')};

  &:hover {
    opacity: 1 !important;
    color: ${(props) => (props.$isPinned ? 'var(--color-primary)' : 'inherit')};
  }
`

const TopViewKey = 'SelectModelPopup'

export const createModelPopup = <TProps extends object, TResult>(
  Component: React.ComponentType<TProps & { resolve: (value: TResult | undefined) => void }>
) => {
  return class {
    static hide() {
      TopView.hide(TopViewKey)
    }
    static show(params: Omit<TProps, 'resolve'>) {
      return new Promise<TResult | undefined>((resolve) => {
        const props = { ...params, resolve } as TProps & { resolve: (value: TResult | undefined) => void }
        TopView.show(<Component {...props} />, TopViewKey)
      })
    }
  }
}

export const SelectModelPopup = createModelPopup<SelectModelPopupParams, Model>(SelectModelPopupView)

export default SelectModelPopupView
