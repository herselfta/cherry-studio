function normalizePortableTimestamp(value: string | number | undefined) {
  if (typeof value === 'number') return value
  if (!value) return undefined
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? undefined : timestamp
}
console.log(normalizePortableTimestamp('2026-03-28T05:36:02.447Z'), normalizePortableTimestamp(1711604162447))
