# Cross-Device Data Contract

This note defines the intended boundary between the desktop `migration` package and the cross-device `mobile sync` payload.

## Model Fields

- `assistant.model`
  - The assistant's currently active runtime model.
  - This is part of both `migration` and `mobile sync`.
- `assistant.defaultModel`
  - The assistant-local fallback/default model.
  - This is part of both `migration` and `mobile sync`.
- `llm.defaultModel`
  - Desktop-global default model used when an assistant has no explicit `model`.
  - This is part of desktop `migration`.
  - This is intentionally not part of `mobile sync`.

## Desktop `migration`

- Purpose: portable restore.
- Behavior: restore a full logical backup on another device.
- Model behavior:
  - Restores per-assistant `model` and `defaultModel`.
  - Restores desktop-global `llm.defaultModel`.
- References:
  - `/Users/mac/GitHub/cherry-studio/src/renderer/src/services/BackupService.ts`
  - `/Users/mac/GitHub/cherry-studio-app/src/services/BackupService.ts`

## Cross-Device `mobile sync`

- Purpose: merge shared data between desktop and app.
- Schema:
  - `v1` remains supported as a legacy non-destructive merge import.
  - `v2` adds `sourceDeviceId` and `sourcePlatform`.
  - `exportedAt` remains required and is used to detect stale imports from the same source device.
- Behavior:
  - Settings and assistant metadata still import via upsert/merge.
  - Conversation entities (`topics/messages/messageBlocks`) use source-aware incremental sync in `v2`.
  - The target device must not be treated as a full mirror of the source device.
- Source of truth:
  - Top-level `topics/messages/messageBlocks` are the canonical conversation records.
  - `assistant.topics` is retained only as a compatibility/sidebar index and must be rebuilt from top-level topics during import.
- Source-aware deletion:
  - Desktop keeps a hidden per-device ledger keyed by `sourceDeviceId`.
  - The ledger stores the last imported `exportedAt` plus the topic/message/block ids last seen from that source device.
  - During `v2` import, only ids that were previously seen from the same `sourceDeviceId` and are now absent may be deleted.
  - Local-only conversations that were never seen from that source device must be preserved.
- Conflict resolution:
  - If the same entity id exists on both sides, compare `updatedAt` and fall back to `createdAt`.
  - The newer entity wins.
  - If timestamps are equal, the incoming payload wins.
- Topic ownership:
  - When a topic moves to another assistant, desktop must rebuild assistant sidebar indexes from the final top-level topics.
  - Old assistant ownership must not linger as a stale `assistant.topics` entry.
- Old payload protection:
  - If an incoming `v2` payload from the same `sourceDeviceId` has an `exportedAt` older than or equal to the last imported value, destructive deletion is skipped.
  - The import degrades to a non-destructive merge and should log a warning.
- Model behavior:
  - Syncs each exported assistant's `model` and `defaultModel`.
  - Does not sync desktop-global `llm.defaultModel`.
  - Does not create cross-device semantics for helper/system-only assistants such as `quick` and `translate`.
- Settings boundary:
  - Syncs portable identity state such as `userName` and `avatar`.
  - Does not sync per-device UI preferences like `theme`.
  - Does not sync desktop-only `localStorage` keys such as `language` or `memory_currentUserId`.
  - Does not sync device-specific MCP server registries.
- References:
  - `/Users/mac/GitHub/cherry-studio/src/renderer/src/services/MobileSyncService.ts`
  - `/Users/mac/GitHub/cherry-studio/src/renderer/src/services/mobileSyncUtils.ts`
  - `/Users/mac/GitHub/cherry-studio-app/src/services/MobileSyncService.ts`
  - `/Users/mac/GitHub/cherry-studio-app/src/services/mobileSyncUtils.ts`

## Guardrails

- Do not map desktop `llm.defaultModel` onto the default assistant's active `model`.
- Do not drop `assistant.model` during mobile sync export/import.
- Do not treat `assistant.topics` as the primary cross-device topic source.
- Do not delete local conversations that have never been seen from the importing `sourceDeviceId`.
- Do not perform destructive deletion when replaying an older payload from the same source device.
- If new assistant-level model fields are added, update both `migration` and `mobile sync` tests together.
