# Widget Examples

Real-world widget configurations for common use cases.

## Reading Tracker

Track books with reading progress and ratings.

### Collection Dashboard (Ground)

```yaml
name: Reading Dashboard
type: aggregate
location: ground
source:
  pattern: "Books/**/*.md"
fields:
  total_books:
    count: true
  books_read:
    expr: "this.status == 'read' ? 1 : 0"
  pages_total:
    sum: pages
  average_rating:
    avg: rating
display:
  type: summary-card
  title: Reading Stats
```

### Similar Books (Recall)

```yaml
name: Similar Books
type: similarity
location: recall
source:
  pattern: "Books/**/*.md"
dimensions:
  - field: genres
    weight: 0.5
    method: jaccard
  - field: rating
    weight: 0.3
    method: proximity
  - field: author
    weight: 0.2
    method: jaccard
display:
  type: list
  limit: 5
  title: You Might Also Like
```

### Book Rating Editor (Recall)

```yaml
name: My Rating
type: aggregate
location: recall
source:
  pattern: "Books/**/*.md"
fields:
  rating:
    expr: "this.rating"
display:
  type: meter
  min: 0
  max: 10
editable:
  - field: rating
    type: slider
    label: Rating
    min: 1
    max: 10
    step: 0.5
  - field: status
    type: select
    label: Status
    options:
      - want-to-read
      - reading
      - read
      - abandoned
```

## Board Game Collection

Track board games with BGG data and play sessions.

### Collection Overview

```yaml
name: Game Collection
type: aggregate
location: ground
source:
  pattern: "Games/**/*.md"
  filter:
    type: board-game
fields:
  total_games:
    count: true
  avg_bgg_rating:
    avg: bgg.rating
  avg_weight:
    avg: bgg.weight
  total_plays:
    sum: plays
display:
  type: summary-card
  title: Board Game Stats
```

### Games by Player Count

```yaml
name: Games Table
type: aggregate
location: ground
source:
  pattern: "Games/**/*.md"
fields:
  game_count:
    count: true
display:
  type: table
  columns:
    - Name
    - Players
    - Weight
    - Rating
  title: All Games
```

### Similar Games

```yaml
name: Similar Games
type: similarity
location: recall
source:
  pattern: "Games/**/*.md"
dimensions:
  - field: mechanics
    weight: 0.4
    method: jaccard
  - field: categories
    weight: 0.3
    method: jaccard
  - field: bgg.weight
    weight: 0.2
    method: proximity
  - field: players.best
    weight: 0.1
    method: proximity
display:
  type: list
  limit: 5
```

## Project Management

Track projects with status and progress.

### Project Status Dashboard

```yaml
name: Project Overview
type: aggregate
location: ground
source:
  pattern: "Projects/**/*.md"
fields:
  total_projects:
    count: true
  active_count:
    expr: "this.status == 'active' ? 1 : 0"
  completed_count:
    expr: "this.status == 'completed' ? 1 : 0"
  avg_progress:
    avg: progress
display:
  type: summary-card
  title: Projects
```

### Project Progress Meter

```yaml
name: Progress
type: aggregate
location: recall
source:
  pattern: "Projects/**/*.md"
fields:
  current_progress:
    expr: "this.progress"
display:
  type: meter
  min: 0
  max: 100
  title: Completion
editable:
  - field: progress
    type: slider
    label: Progress %
    min: 0
    max: 100
    step: 5
  - field: status
    type: select
    label: Status
    options:
      - planning
      - active
      - blocked
      - completed
      - cancelled
```

## Movie/TV Watchlist

Track media consumption with ratings and watch status.

### Watchlist Dashboard

```yaml
name: Watchlist Stats
type: aggregate
location: ground
source:
  pattern: "Media/**/*.md"
fields:
  total_items:
    count: true
  watched_count:
    expr: "this.watched ? 1 : 0"
  average_rating:
    avg: rating
  total_runtime:
    sum: runtime
display:
  type: summary-card
```

### Similar Media

```yaml
name: Similar Titles
type: similarity
location: recall
source:
  pattern: "Media/**/*.md"
dimensions:
  - field: genres
    weight: 0.5
    method: jaccard
  - field: year
    weight: 0.2
    method: proximity
  - field: director
    weight: 0.3
    method: jaccard
display:
  type: list
  limit: 8
```

## Recipe Collection

Track recipes with ratings and dietary info.

### Recipe Stats

```yaml
name: Recipe Collection
type: aggregate
location: ground
source:
  pattern: "Recipes/**/*.md"
fields:
  total_recipes:
    count: true
  avg_rating:
    avg: rating
  avg_prep_time:
    avg: prep_time
  avg_cook_time:
    avg: cook_time
display:
  type: summary-card
```

### Similar Recipes

```yaml
name: Similar Recipes
type: similarity
location: recall
source:
  pattern: "Recipes/**/*.md"
dimensions:
  - field: ingredients
    weight: 0.4
    method: jaccard
  - field: cuisine
    weight: 0.3
    method: jaccard
  - field: dietary
    weight: 0.2
    method: jaccard
  - field: difficulty
    weight: 0.1
    method: proximity
display:
  type: list
  limit: 5
  title: You Might Also Like
```

### Recipe Rating

```yaml
name: My Rating
type: aggregate
location: recall
source:
  pattern: "Recipes/**/*.md"
fields:
  rating:
    expr: "coalesce(this.rating, 0)"
display:
  type: meter
  min: 0
  max: 5
editable:
  - field: rating
    type: slider
    label: Rating
    min: 1
    max: 5
    step: 1
  - field: made_count
    type: number
    label: Times Made
    min: 0
```

## Research Notes

Track research papers and notes with topics and citations.

### Research Overview

```yaml
name: Research Stats
type: aggregate
location: ground
source:
  pattern: "Research/**/*.md"
fields:
  total_papers:
    count: true
  papers_read:
    expr: "this.status == 'read' ? 1 : 0"
  avg_relevance:
    avg: relevance
  total_citations:
    sum: citations
display:
  type: summary-card
  title: Research Progress
```

### Related Papers

```yaml
name: Related Papers
type: similarity
location: recall
source:
  pattern: "Research/**/*.md"
dimensions:
  - field: topics
    weight: 0.5
    method: jaccard
  - field: authors
    weight: 0.2
    method: jaccard
  - field: year
    weight: 0.15
    method: proximity
  - field: venue
    weight: 0.15
    method: jaccard
display:
  type: list
  limit: 10
  title: Related Work
```

## Exercise/Fitness Log

Track workouts with metrics and progress.

### Weekly Summary

```yaml
name: This Week
type: aggregate
location: ground
source:
  pattern: "Fitness/Workouts/**/*.md"
fields:
  total_workouts:
    count: true
  total_duration:
    sum: duration
  avg_intensity:
    avg: intensity
  total_calories:
    sum: calories
display:
  type: summary-card
  title: Weekly Stats
```

### Workout Rating

```yaml
name: Workout Quality
type: aggregate
location: recall
source:
  pattern: "Fitness/Workouts/**/*.md"
fields:
  quality:
    expr: "this.quality"
display:
  type: meter
  min: 0
  max: 10
  title: Quality
editable:
  - field: quality
    type: slider
    label: How did it feel?
    min: 1
    max: 10
    step: 1
  - field: type
    type: select
    label: Workout Type
    options:
      - strength
      - cardio
      - flexibility
      - mixed
```

## Frontmatter Templates

Example frontmatter for the widgets above:

### Book

```yaml
---
title: "The Design of Everyday Things"
author: "Don Norman"
genres:
  - design
  - psychology
  - nonfiction
pages: 368
rating: 9
status: read
date_finished: 2024-03-15
---
```

### Board Game

```yaml
---
title: "Wingspan"
type: board-game
bgg:
  id: 266192
  rating: 8.1
  weight: 2.4
players:
  min: 1
  max: 5
  best: 3
mechanics:
  - engine-building
  - hand-management
  - set-collection
categories:
  - animals
  - card-game
plays: 12
---
```

### Project

```yaml
---
title: "Website Redesign"
status: active
progress: 65
priority: high
deadline: 2024-06-01
tags:
  - web
  - design
  - client-work
---
```

### Recipe

```yaml
---
title: "Pasta Carbonara"
cuisine: italian
prep_time: 15
cook_time: 20
servings: 4
difficulty: 2
rating: 5
dietary:
  - gluten
ingredients:
  - pasta
  - eggs
  - pancetta
  - parmesan
  - black-pepper
made_count: 8
---
```
