# Durable Facts

## Categories

Each category exists because it changes how an AI should respond. If information doesn't fit one of these purposes, it probably doesn't belong.

### Identity
Background that calibrates technical depth and domain assumptions. "Senior engineer, 20 years" means skip beginner explanations. "Manager of 8 engineers" means leadership context matters. Keep to a few sentences that establish the baseline.

### Goals
Active projects and objectives that provide context for questions. When the user asks about "the plugin system," knowing they're building Memory Loop makes the question concrete. Include only current work; drop completed or abandoned projects.

### Preferences
Communication and working style that shapes how to respond. "Prefers direct feedback" means don't hedge. "Thinks out loud" means expect iterative refinement. "Avoids em-dashes" means follow that in writing. These directly change output style.

### Project Context
Technical decisions and constraints that inform suggestions. "Uses bun, not npm" prevents wrong tool recommendations. "Monorepo with shared/ workspace" shapes where to put code. Include what affects recommendations; skip historical rationale unless it's still relevant.

### Patterns
Recurring themes that prevent repeated mistakes. If the user consistently rejects over-engineered solutions, note it. If they've explained a concept three times, capture the settled understanding. These are patterns in *this user's* thinking, not general insights.
