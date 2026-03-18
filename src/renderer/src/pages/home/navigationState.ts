import type { Assistant, Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'

export interface HomeNavigationState {
  assistant?: Assistant
  assistantId?: string
  topic?: Topic
  topicId?: string
  messageId?: string
}

let pendingHomeNavigationState: HomeNavigationState | null = null

export const findAssistantByHomeNavigationState = (
  assistants: Assistant[],
  state?: HomeNavigationState | null
): Assistant | undefined => {
  if (!state) {
    return undefined
  }

  if (state.assistant) {
    return state.assistant
  }

  if (state.assistantId) {
    return assistants.find((assistant) => assistant.id === state.assistantId)
  }

  if (state.topic?.assistantId) {
    return assistants.find((assistant) => assistant.id === state.topic?.assistantId)
  }

  if (state.topicId) {
    return assistants.find((assistant) => assistant.topics?.some((topic) => topic.id === state.topicId))
  }

  return undefined
}

export const findTopicByHomeNavigationState = (
  assistants: Assistant[],
  assistant: Assistant | undefined,
  state?: HomeNavigationState | null
): Topic | undefined => {
  if (!state) {
    return undefined
  }

  if (state.topic) {
    return state.topic
  }

  if (!state.topicId) {
    return undefined
  }

  if (assistant) {
    return assistant.topics?.find((topic) => topic.id === state.topicId)
  }

  return assistants.flatMap((candidate) => candidate.topics ?? []).find((topic) => topic.id === state.topicId)
}

export const resolveHomeActiveTopic = (previousTopic: Topic | undefined, nextTopic: Topic): Topic => {
  return previousTopic?.id === nextTopic?.id ? previousTopic : nextTopic
}

export const setPendingHomeNavigationState = (state: HomeNavigationState | null) => {
  pendingHomeNavigationState = state
}

export const consumePendingHomeNavigationState = (): HomeNavigationState | null => {
  const state = pendingHomeNavigationState
  pendingHomeNavigationState = null
  return state
}

export const isHomeRouteActive = () => {
  const currentPath = window.location.hash.replace(/^#/, '').split('?')[0] || '/'
  return currentPath === '/'
}

export const createHomeNavigationStateForMessage = (message: Message): HomeNavigationState => ({
  assistantId: message.assistantId,
  topicId: message.topicId,
  messageId: message.id
})

export const createHomeNavigationStateForTopic = ({
  assistantId,
  topicId
}: {
  assistantId: string
  topicId: string
}): HomeNavigationState => ({
  assistantId,
  topicId
})
