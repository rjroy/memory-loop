# External Data Sync

Sync enriches your vault files with metadata from external APIs. Define a pipeline configuration, and Memory Loop will fetch data and update your markdown frontmatter automatically.

## Quick Start

1. Create a pipeline config at `.memory-loop/sync/bgg.yaml`
2. Add a `bgg_id` field to your game files
3. Click "Sync External Data" in the Ground tab

## How It Works

```
Pipeline Config          Your Vault Files           External API
.memory-loop/sync/   →   Games/gloomhaven.md    ←   BoardGameGeek
     bgg.yaml             (bgg_id: 174430)           XML API
```

The sync process:
1. Discovers pipeline configs in `.memory-loop/sync/*.yaml`
2. Finds files matching the configured pattern with the ID field
3. Fetches data from the external API
4. Updates frontmatter according to field mappings and merge strategies

## Pipeline Configuration

Each pipeline is a YAML file in `.memory-loop/sync/`. See [bgg-pipeline.example.yaml](./bgg-pipeline.example.yaml) for a complete annotated example.

### Basic Structure

```yaml
name: Board Games BGG Sync
connector: bgg

match:
  field: bgg_id           # Frontmatter field containing external ID
  pattern: Games/**/*.md  # Glob pattern for candidate files

defaults:
  merge_strategy: overwrite
  namespace: bgg          # Optional: prefix for synced fields

fields:
  - source: rating        # Field from API
    target: rating        # Field in frontmatter
  - source: mechanics
    target: mechanics
    strategy: merge       # Override default strategy
    normalize: true       # Apply vocabulary normalization
```

### Match Configuration

| Field | Description |
|-------|-------------|
| `field` | Frontmatter field containing the external ID (e.g., `bgg_id`) |
| `pattern` | Glob pattern for files to consider (e.g., `Games/**/*.md`) |

Only files matching the pattern AND containing the ID field will be synced.

### Merge Strategies

| Strategy | Behavior |
|----------|----------|
| `overwrite` | Always replace with synced value |
| `preserve` | Keep existing value if present |
| `merge` | For arrays, combine values without duplicates |

Set a default strategy, then override per-field as needed.

### Namespacing

When `namespace` is set (e.g., `bgg`), synced fields are nested:

```yaml
# With namespace: bgg
bgg:
  rating: 8.5
  mechanics:
    - Worker Placement

# Without namespace
rating: 8.5
mechanics:
  - Worker Placement
```

Namespacing keeps synced data separate from your own fields.

## Available Connectors

### BGG (BoardGameGeek)

Fetches board game metadata from the BGG XML API.

**Connector ID:** `bgg`

**Available Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Primary game name |
| `rating` | number | BGG average rating (0-10) |
| `weight` | number | Complexity rating (1-5) |
| `minPlayers` | number | Minimum player count |
| `maxPlayers` | number | Maximum player count |
| `minPlaytime` | number | Minimum play time (minutes) |
| `maxPlaytime` | number | Maximum play time (minutes) |
| `yearPublished` | number | Publication year |
| `mechanics` | string[] | Game mechanisms |
| `categories` | string[] | Game categories |

**Authentication:** Requires a BGG API token. Store in `.memory-loop/secrets/bgg.yaml`:

```yaml
bgg_token: your_token_here
```

## Vocabulary Normalization

External APIs use inconsistent terminology. Vocabulary normalization maps variations to canonical terms using an LLM.

```yaml
vocabulary:
  "Worker Placement":
    - "worker placement"
    - "Action Point Allowance System"
  "Deck Building":
    - "deckbuilding"
    - "Deck / Pool Building"
```

Enable per-field with `normalize: true`. The LLM uses your vocabulary as context to match similar terms, even if not explicitly listed.

**Requires:** Anthropic API key in `.memory-loop/secrets/bgg.yaml`:

```yaml
anthropic_key: sk-ant-...
```

## Sync Metadata

After sync, files include tracking metadata:

```yaml
_sync_meta:
  last_synced: "2026-01-15T10:30:00Z"
  source: bgg
  source_id: "174430"
```

This enables incremental sync (skipping recently-synced files) and audit trails.

## Sync Modes

| Mode | Behavior |
|------|----------|
| `incremental` | Skip files synced within the last 24 hours |
| `full` | Re-sync all matching files |

The UI button triggers incremental sync by default.

## Secrets Management

Store API credentials in `.memory-loop/secrets/<connector>.yaml`. These files should be:

- Added to `.gitignore`
- Optionally encrypted with git-crypt

Secrets are never logged or included in error messages.

## Error Handling

Sync continues on individual file failures. The final status reports:

- Total files processed
- Files successfully updated
- Error count with details

Example: "Synced 8/10 files (2 errors)"

## Troubleshooting

**Files not being synced:**
- Verify the file matches the glob pattern
- Check that the ID field exists in frontmatter
- Ensure the ID value is valid for the connector

**API errors:**
- Check your API credentials in secrets
- BGG has rate limits; the connector retries automatically
- Some IDs may not exist in the external database

**Unexpected field values:**
- Check your merge strategy (preserve won't overwrite existing values)
- Verify field mappings in your config
- For arrays, merge combines rather than replaces
