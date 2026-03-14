import { styled } from 'styled-components'

const SidebarActionIcon = styled.div<{ $themeMode: string }>`
  width: 35px;
  min-width: 35px;
  height: 35px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
  box-sizing: border-box;
  -webkit-app-region: none;
  border: 0.5px solid transparent;
  color: var(--color-icon);
  line-height: 0;
  transition:
    background-color 0.2s ease-in-out,
    border-color 0.2s ease-in-out,
    opacity 0.2s ease-in-out,
    color 0.2s ease-in-out;

  > svg,
  > .iconfont,
  .icon {
    color: inherit;
    display: block;
    flex-shrink: 0;
  }

  &:hover {
    background-color: ${({ $themeMode }) => ($themeMode === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    opacity: 0.8;
    cursor: pointer;
    color: var(--color-icon-white);
  }

  &.active {
    background-color: ${({ $themeMode }) => ($themeMode === 'dark' ? 'var(--color-black)' : 'var(--color-white)')};
    border: 0.5px solid var(--color-border);
    color: var(--color-primary);
  }
`

export default SidebarActionIcon
