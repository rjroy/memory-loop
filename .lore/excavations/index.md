# Excavation Index

**Codebase**: Memory Loop
**Started**: 2026-01-28

## Start Here

**New to this codebase?** Read the [System Overview](../specs/_overview.md) first. It explains what Memory Loop is, the GCTR philosophy, and provides a reading path through the other specs.

## Documented Features

| Feature | Spec | Excavated | Type | Connected To |
|---------|------|-----------|------|--------------|
| **System Overview** | [_overview.md](../specs/_overview.md) | 2026-01-28 | **Entry point** | all specs |
| Vault Selection | [vault-selection.md](../specs/_infrastructure/vault-selection.md) | 2026-01-28 | Infrastructure | configuration, all tabs |
| Extraction | [extraction.md](../specs/_infrastructure/extraction.md) | 2026-01-28 | Infrastructure | system-settings, think |
| System Settings | [system-settings.md](../specs/_infrastructure/system-settings.md) | 2026-01-28 | Infrastructure | vault-selection, extraction, spaced-repetition |
| Configuration | [configuration.md](../specs/_infrastructure/configuration.md) | 2026-01-28 | Infrastructure | vault-selection, inspiration, ground, think |
| Communication Layer | [communication-layer.md](../specs/_infrastructure/communication-layer.md) | 2026-01-28 | Infrastructure | think, pair-writing, all REST features |
| Card Generator | [card-generator.md](../specs/_infrastructure/card-generator.md) | 2026-01-28 | Infrastructure | spaced-repetition, system-settings, configuration |
| Ground | [home-dashboard.md](../specs/home-dashboard.md) | 2026-01-28 | Tab (container) | spaced-repetition, inspiration, capture, think, recall |
| Spaced Repetition | [spaced-repetition.md](../specs/spaced-repetition.md) | 2026-01-28 | Sub-feature | ground, system-settings, recall |
| Inspiration | [inspiration.md](../specs/inspiration.md) | 2026-01-28 | Sub-feature | ground, think, configuration |
| Capture | [capture.md](../specs/capture.md) | 2026-01-28 | Tab | ground, think, recall |
| Think | [think.md](../specs/think.md) | 2026-01-28 | Tab | ground, capture, recall, extraction, configuration |
| Recall | [recall.md](../specs/recall.md) | 2026-01-28 | Tab | ground, spaced-repetition, think, capture, task-list |
| Task List | [task-list.md](../specs/task-list.md) | 2026-01-28 | Sub-feature | recall, configuration |
| Pair Writing | [pair-writing.md](../specs/pair-writing.md) | 2026-01-28 | Sub-feature | recall, think |
| Navigation Bar | [navigation-bar.md](../specs/navigation-bar.md) | 2026-01-28 | UI (core) | all tabs, configuration |

## Discovered (Not Yet Documented)

### Infrastructure (excavate first)

| Feature | Entry Point | Files | Priority |
|---------|-------------|-------|----------|
| ~~Vault Selection~~ | | | ✓ Done |
| ~~Extraction~~ | | | ✓ Done |
| ~~System Settings~~ | | | ✓ Done |
| ~~Configuration~~ | | | ✓ Done |

### Sub-features (from Ground)

| Feature | Discovered From | Entry Point | Priority |
|---------|-----------------|-------------|----------|
| ~~Spaced Repetition~~ | | | ✓ Done |
| ~~Inspiration~~ | | | ✓ Done |

### Top-Level Tabs

| Tab | Mode | Entry Point | Priority |
|-----|------|-------------|----------|
| ~~Capture~~ | | | ✓ Done |
| ~~Think~~ | | | ✓ Done |
| ~~Recall~~ | | | ✓ Done |

## Unexplored Entry Points

| Entry Point | Type | Notes |
|-------------|------|-------|
| ~~WebSocket handlers~~ | Backend | ✓ Documented as Communication Layer |
| ~~/api/sessions~~ | REST | ✓ Documented as Communication Layer (session management split) |
| ~~Card Generator~~ | Backend | ✓ Documented as Card Generator infrastructure |
| ~~Tasks~~ | REST | ✓ Documented as standalone Task List feature |
| ~~Health Issues~~ | REST | ✓ Documented in Home Dashboard (Health Panel section) |
| ~~Setup Wizard~~ | REST | ✓ Documented in Vault Selection (Setup Wizard section) |

## Architecture Notes

See [System Overview](../specs/_overview.md) for full context. Quick reference:

- **GCTR Framework**: Ground → Capture → Think → Recall. See [Navigation Bar](../specs/navigation-bar.md).
- **Communication**: REST for CRUD, WebSocket for streaming. See [Communication Layer](../specs/_infrastructure/communication-layer.md).
- **Data**: Everything lives in the vault as markdown files. No external database.
