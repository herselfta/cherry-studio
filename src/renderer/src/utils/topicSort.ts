import type { Topic } from '@renderer/types'

export type TopicSortMode = 'manual' | 'updatedAt' | 'createdAt'
export type TopicTimeSortMode = Exclude<TopicSortMode, 'manual'>

export const DEFAULT_TOPIC_SORT_MODE: TopicSortMode = 'updatedAt'

function getTopicSortTimestamp(topic: Topic, sortMode: TopicTimeSortMode) {
  return new Date(topic[sortMode]).getTime()
}

export function compareTopics(left: Topic, right: Topic, sortMode: TopicTimeSortMode) {
  const timestampDiff = getTopicSortTimestamp(right, sortMode) - getTopicSortTimestamp(left, sortMode)
  if (timestampDiff !== 0) {
    return timestampDiff
  }

  const updatedDiff = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  if (updatedDiff !== 0) {
    return updatedDiff
  }

  const createdDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  if (createdDiff !== 0) {
    return createdDiff
  }

  return left.name.localeCompare(right.name)
}

function sortTopicGroup(topics: Topic[], sortMode: TopicSortMode) {
  if (sortMode === 'manual') {
    return topics
  }

  return [...topics].sort((left, right) => compareTopics(left, right, sortMode))
}

export function sortTopics(topics: Topic[], options: { sortMode: TopicSortMode; pinTopicsToTop?: boolean }) {
  const { sortMode, pinTopicsToTop = false } = options

  if (!pinTopicsToTop) {
    return sortTopicGroup(topics, sortMode)
  }

  const pinnedTopics = topics.filter((topic) => topic.pinned)
  const unpinnedTopics = topics.filter((topic) => !topic.pinned)

  return [...sortTopicGroup(pinnedTopics, sortMode), ...sortTopicGroup(unpinnedTopics, sortMode)]
}
