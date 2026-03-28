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
- Behavior: upsert shared entities without wiping the target device.
- Model behavior:
  - Syncs each exported assistant's `model` and `defaultModel`.
  - Does not sync desktop-global `llm.defaultModel`.
  - Does not create cross-device semantics for helper/system-only assistants such as `quick` and `translate`.
- References:
  - `/Users/mac/GitHub/cherry-studio/src/renderer/src/services/MobileSyncService.ts`
  - `/Users/mac/GitHub/cherry-studio/src/renderer/src/services/mobileSyncUtils.ts`
  - `/Users/mac/GitHub/cherry-studio-app/src/services/MobileSyncService.ts`
  - `/Users/mac/GitHub/cherry-studio-app/src/services/mobileSyncUtils.ts`

## Guardrails

- Do not map desktop `llm.defaultModel` onto the default assistant's active `model`.
- Do not drop `assistant.model` during mobile sync export/import.
- If new assistant-level model fields are added, update both `migration` and `mobile sync` tests together.
