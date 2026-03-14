import { ProviderAvatar } from '@renderer/components/ProviderAvatar'
import type { Provider } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { Flex } from 'antd'
import React, { startTransition, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

export interface ProviderFilterOption {
  provider: Provider
  count: number
}

interface ProviderFilterSectionProps {
  providers: ProviderFilterOption[]
  selectedProviderIds: string[]
  onToggleProvider: (providerId: string) => void
  onResetProviders: () => void
}

const ProviderFilterSection: React.FC<ProviderFilterSectionProps> = ({
  providers,
  selectedProviderIds,
  onToggleProvider,
  onResetProviders
}) => {
  const { t } = useTranslation()

  const handleReset = useCallback(() => {
    startTransition(() => onResetProviders())
  }, [onResetProviders])

  const handleProviderClick = useCallback(
    (providerId: string) => {
      startTransition(() => onToggleProvider(providerId))
    },
    [onToggleProvider]
  )

  const isAllSelected = selectedProviderIds.length === 0

  return (
    <FilterContainer>
      <Flex wrap="wrap" gap={6}>
        <FilterText>{t('models.filter.by_provider')}</FilterText>
        <ProviderChip type="button" $active={isAllSelected} aria-pressed={isAllSelected} onClick={handleReset}>
          <ChipLabel>{t('models.all')}</ChipLabel>
        </ProviderChip>
        {providers.map(({ provider, count }) => {
          const isActive = selectedProviderIds.includes(provider.id)
          return (
            <ProviderChip
              key={provider.id}
              type="button"
              $active={isActive}
              aria-pressed={isActive}
              title={getFancyProviderName(provider)}
              onClick={() => handleProviderClick(provider.id)}>
              <ProviderAvatar provider={provider} size={16} />
              <ChipLabel>{getFancyProviderName(provider)}</ChipLabel>
              <ChipCount>{count}</ChipCount>
            </ProviderChip>
          )
        })}
      </Flex>
    </FilterContainer>
  )
}

const FilterContainer = styled.div`
  padding: 8px 18px;
  max-height: 108px;
  overflow-y: auto;
`

const FilterText = styled.span`
  display: inline-flex;
  align-items: center;
  color: var(--color-text-3);
  font-size: 12px;
  margin-right: 2px;
`

const ProviderChip = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px 0 6px;
  border-radius: 999px;
  border: 1px solid ${(props) => (props.$active ? 'var(--color-primary)' : 'var(--color-border)')};
  background: ${(props) => (props.$active ? 'var(--color-primary-mute)' : 'var(--color-background-soft)')};
  color: ${(props) => (props.$active ? 'var(--color-primary)' : 'var(--color-text)')};
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    opacity 0.2s ease;
  cursor: pointer;

  &:hover {
    opacity: 0.9;
  }
`

const ChipLabel = styled.span`
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
`

const ChipCount = styled.span`
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--color-background-mute);
  color: var(--color-text-3);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
`

export default ProviderFilterSection
