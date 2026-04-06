import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useShowAssistants, useShowTopics } from '@renderer/hooks/useStore'
import { useActiveTopic } from '@renderer/hooks/useTopic'
import {
  consumePendingHomeNavigationState,
  findAssistantByHomeNavigationState,
  findTopicByHomeNavigationState,
  type HomeNavigationState,
  resolveHomeActiveTopic
} from '@renderer/pages/home/navigationState'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import NavigationService from '@renderer/services/NavigationService'
import { newMessagesActions } from '@renderer/store/newMessage'
import type { Assistant, Topic } from '@renderer/types'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, SECOND_MIN_WINDOW_WIDTH } from '@shared/config/constant'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { startTransition, useCallback, useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import Chat from './Chat'
import Navbar from './Navbar'
import HomeTabs from './Tabs'

let _activeAssistant: Assistant

const HomePage: FC = () => {
  const { assistants } = useAssistants()
  const navigate = useNavigate()
  const { isLeftNavbar } = useNavbarPosition()

  const location = useLocation()
  const routeState = location.state as HomeNavigationState | null
  const [navigationState, setNavigationState] = useState<HomeNavigationState | null>(
    () => routeState || consumePendingHomeNavigationState()
  )
  const assistantFromState = findAssistantByHomeNavigationState(assistants, navigationState)
  const topicFromState = findTopicByHomeNavigationState(assistants, assistantFromState, navigationState)

  const [activeAssistant, _setActiveAssistant] = useState<Assistant>(
    assistantFromState || _activeAssistant || assistants[0]
  )
  const { activeTopic, setActiveTopic: _setActiveTopic } = useActiveTopic(activeAssistant?.id ?? '', topicFromState)
  const { showAssistants, showTopics, topicPosition } = useSettings()
  const { setShowAssistants, toggleShowAssistants } = useShowAssistants()
  const { toggleShowTopics } = useShowTopics()
  const dispatch = useDispatch()

  _activeAssistant = activeAssistant

  useShortcut('toggle_show_assistants', () => {
    if (topicPosition === 'right') {
      toggleShowAssistants()
      return
    }

    if (!showAssistants) {
      setShowAssistants(true)
      requestAnimationFrame(() => {
        void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
      })
      return
    }

    void EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS)
  })

  useShortcut('toggle_show_topics', () => {
    if (topicPosition === 'right') {
      toggleShowTopics()
      return
    }

    if (!showAssistants) {
      setShowAssistants(true)
      requestAnimationFrame(() => {
        void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
      })
      return
    }

    void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)
  })

  const setActiveAssistant = useCallback(
    (newAssistant: Assistant) => {
      if (newAssistant.id === activeAssistant?.id) return
      startTransition(() => {
        _setActiveAssistant(newAssistant)
        // 同步更新 active topic，避免不必要的重新渲染
        const newTopic = newAssistant.topics[0]
        if (newTopic) {
          _setActiveTopic((prev) => resolveHomeActiveTopic(prev, newTopic))
        }
      })
    },
    [_setActiveTopic, activeAssistant?.id]
  )

  const setActiveTopic = useCallback(
    (newTopic: Topic) => {
      startTransition(() => {
        _setActiveTopic((prev) => resolveHomeActiveTopic(prev, newTopic))
        dispatch(newMessagesActions.setTopicFulfilled({ topicId: newTopic.id, fulfilled: false }))
      })
    },
    [_setActiveTopic, dispatch]
  )

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useEffect(() => {
    if (routeState) {
      setNavigationState(routeState)
      return
    }

    const pendingState = consumePendingHomeNavigationState()
    if (pendingState) {
      setNavigationState(pendingState)
    }
  }, [routeState])

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.APPLY_HOME_NAVIGATION_STATE, (state) => {
      setNavigationState(state as HomeNavigationState)
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!navigationState) {
      return
    }

    const nextAssistant = findAssistantByHomeNavigationState(assistants, navigationState)
    const nextTopic = findTopicByHomeNavigationState(assistants, nextAssistant, navigationState)

    if (navigationState.assistantId && !nextAssistant) {
      return
    }

    if (navigationState.topicId && !nextTopic) {
      return
    }

    nextAssistant && setActiveAssistant(nextAssistant)
    nextTopic && setActiveTopic(nextTopic)
    setNavigationState(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistants, navigationState])

  useEffect(() => {
    const canMinimize = topicPosition == 'left' ? !showAssistants : !showAssistants && !showTopics
    window.api.window.setMinimumSize(canMinimize ? SECOND_MIN_WINDOW_WIDTH : MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)

    return () => {
      window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics, topicPosition])

  return (
    <Container id="home-page">
      {isLeftNavbar && (
        <Navbar
          activeAssistant={activeAssistant}
          activeTopic={activeTopic}
          setActiveTopic={setActiveTopic}
          setActiveAssistant={setActiveAssistant}
          position="left"
        />
      )}
      <ContentContainer id={isLeftNavbar ? 'content-container' : undefined}>
        <AnimatePresence initial={false}>
          {showAssistants && (
            <ErrorBoundary>
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'var(--assistants-width)', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}>
                <HomeTabs
                  activeAssistant={activeAssistant}
                  activeTopic={activeTopic}
                  setActiveAssistant={setActiveAssistant}
                  setActiveTopic={setActiveTopic}
                  position="left"
                />
              </motion.div>
            </ErrorBoundary>
          )}
        </AnimatePresence>
        <ErrorBoundary>
          <Chat
            assistant={activeAssistant}
            activeTopic={activeTopic}
            setActiveTopic={setActiveTopic}
            setActiveAssistant={setActiveAssistant}
          />
        </ErrorBoundary>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  [navbar-position='left'] & {
    max-width: calc(100vw - var(--sidebar-width));
  }
  [navbar-position='top'] & {
    max-width: 100vw;
  }
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  overflow: hidden;

  [navbar-position='top'] & {
    max-width: calc(100vw - 12px);
  }
`

export default HomePage
