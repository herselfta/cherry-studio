import { ProviderAvatar } from '@renderer/components/ProviderAvatar'
import type { Provider } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import type { FC } from 'react'
import { startTransition, useCallback } from 'react'
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

const ProviderFilterSection: FC<ProviderFilterSectionProps> = ({
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
      <FilterRow>
        <FilterText>{t('models.filter.by_provider')}</FilterText>
        <ChipScroller>
          <ChipTrack>
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
                  <ProviderAvatar provider={provider} size={14} />
                  <ChipLabel>{getFancyProviderName(provider)}</ChipLabel>
                  <ChipCount>{count}</ChipCount>
                </ProviderChip>
              )
            })}
          </ChipTrack>
        </ChipScroller>
      </FilterRow>
    </FilterContainer>
  )
}

const FilterContainer = styled.div`
  padding: 8px 18px 6px;
`

const FilterRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`

const ChipScroller = styled.div`
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
`

const ChipTrack = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: max-content;
`

const FilterText = styled.span`
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  color: var(--color-text-3);
  font-size: 12px;
  white-space: nowrap;
`

const ProviderChip = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px 0 5px;
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
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1;
`

const ChipCount = styled.span`
  flex: 0 0 auto;
  color: var(--color-text-3);
  font-size: 10px;
  line-height: 1;

  &::before {
    content: '·';
    margin-right: 2px;
  }
`

export default ProviderFilterSection
