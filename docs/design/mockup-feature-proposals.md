# Mockup Feature Proposals for Memory Loop

**Generated:** 2025-12-26
**Status:** Draft for Discussion
**Context:** Analysis of `ai-gen-reference-*.png` mockups vs current implementation

---

## Executive Summary

The mockups envision **RetroNotes**: a full-featured personal productivity suite with notes, tasks, inspiration, and goal tracking. Memory Loop has evolved into something different and arguably more focused: **a vault-aware AI companion** for Obsidian users.

This document proposes selective feature adoption that enhances Memory Loop's identity rather than morphing it into a generic productivity app. The guiding principle: **complement Obsidian, don't compete with it.**

---

## What Memory Loop Already Does Well

The current implementation successfully captures the mockup's *emotional* intent:

| Mockup Element | Current Implementation |
|----------------|------------------------|
| Synthwave aesthetic | Fully realized (glassmorphism, gradients, glow effects) |
| Responsive design | Mobile-first with desktop breakpoints |
| Quick note capture | Note Mode with auto-save drafts |
| AI interaction | Discussion Mode with streaming responses |
| File browsing | Browse Mode with lazy-loading tree |
| Recent notes | Displayed in Note Mode sidebar |
| Visual hierarchy | Header/content/input zones well-defined |

The visual language is **on point**. The question is which *functional* elements add value.

---

## Feature Analysis: Keep, Adapt, or Skip

### 1. Dashboard Overview

**Mockup suggests:** Central hub showing recent activity, quick actions, at-a-glance widgets

**Recommendation: ADAPT**

A dashboard makes sense, but not as a feature-silo launcher. Instead:

**Proposed: "Home" view showing:**
- **Session context card** - Current vault, active session duration, message count
- **Recent captures** - Last 5 notes with quick preview
- **Conversation starters** - AI-generated prompts based on vault content
- **Quick actions** - "Capture thought" / "Ask Claude" / "Browse vault"

**Why:** Reduces cognitive load when opening the app. "What do I want to do?" is answered immediately. The mockup's dashboard is navigation-heavy; ours should be action-oriented.

**Complexity:** Medium - Mostly UI composition of existing data

---

### 2. Categories / Favorites / Tags

**Mockup suggests:** Left sidebar with organizational taxonomy

**Recommendation: SKIP**

This directly competes with Obsidian's native organization:
- Obsidian has folders, tags, bookmarks, canvas, and plugins for organization
- Users have already invested in their vault's structure
- Duplicating this creates sync confusion ("Did I favorite it in Obsidian or Memory Loop?")

**Alternative consideration:** If users strongly want this, expose Obsidian's bookmarks file (`.obsidian/bookmarks.json`) in Browse Mode. But don't build a parallel system.

---

### 3. To-Do List / Task Management

**Mockup suggests:** Dedicated task panel with checkboxes

**Recommendation: ADAPT (carefully)**

Tasks are tricky. Obsidian users often use:
- Dataview queries for task aggregation
- Tasks plugin with due dates and priorities
- Simple `- [ ]` checkboxes in daily notes

Building a separate task system would be another "parallel universe" problem.

**Proposed: Task Surfacing (read-only)**

In Discussion Mode, Claude could be prompted to:
- Find incomplete tasks in the vault: "What tasks haven't I finished this week?"
- Summarize commitments: "What did I say I'd do in my meeting notes?"
- Suggest prioritization: "Based on my notes, what should I focus on today?"

This leverages AI understanding without creating data duplication.

**Complexity:** Low - This is prompt engineering, not feature building

---

### 4. Inspiration Layer

**Mockup suggests:** "Inspiration of the Day" quote widget

**Recommendation: ADAPT**

Generic motivational quotes feel like padding. But *contextual* inspiration is different.

**Proposed: "Contextual Prompts"**

Replace passive quotes with active AI-generated prompts based on vault content:
- "You mentioned wanting to learn Rust three weeks ago. Ready to start?"
- "Your last reflection mentioned feeling overwhelmed. Want to talk through it?"
- "You've captured 12 project ideas but haven't revisited them. Pick one to explore?"

These appear on the Home view or as subtle suggestions in Note Mode.

**Why:** Transforms "inspiration" from decoration into engagement. The app knows you; it can prompt meaningfully.

**Complexity:** Medium-High - Requires vault analysis, potentially expensive API calls

**Alternative (simpler):** Random vault excerpt. Pull a paragraph from a random note and display it. "Remember this?" - serendipitous rediscovery without AI cost.

---

### 5. Goal Tracker

**Mockup suggests:** Dedicated goal management area

**Recommendation: SKIP (but enable via AI)**

Goals are personal and varied. Some people want OKRs, others want habits, others want "someday/maybe" lists. Building a goal system means picking one model and alienating users with different mental models.

**Alternative:** Like tasks, make goals a *discussion topic*:
- "Help me define a goal for Q1"
- "Review my goals and tell me which I'm making progress on"
- "I wrote about wanting to publish a book. Am I closer?"

Claude can parse the vault for goal-related content. The user doesn't need a special "goal" data type.

---

### 6. Reminders / Notifications

**Mockup suggests:** Reminders section in sidebar

**Recommendation: SKIP**

Memory Loop is a web app without native notification infrastructure. Implementing reminders requires:
- Backend scheduler
- Push notification service
- Mobile app wrapper for system notifications
- Or email integration

This is significant infrastructure for a feature users already have via:
- OS calendar apps
- Obsidian Reminder plugin
- Dedicated reminder apps (Todoist, Things, etc.)

**Future consideration:** If Memory Loop becomes a PWA with service workers, browser notifications become possible. But this is a v2+ concern.

---

### 7. Enhanced Note Editing

**Mockup suggests:** Rich note editor with formatting, images, save/edit modes

**Recommendation: SKIP**

Memory Loop's Note Mode is intentionally **capture-focused**, not editor-focused:
- Quick thought → append to daily note → done
- The full editing experience lives in Obsidian

Expanding into rich editing would mean:
- Competing with Obsidian's excellent editor
- Handling bidirectional sync complexity
- Feature creep into "yet another notes app"

**Keep it simple:** Capture. Browse. Discuss. Edit in Obsidian.

---

### 8. Quick Links / Shortcuts

**Mockup suggests:** Sidebar shortcuts to specific areas (Idea Vault, Goal Tracker)

**Recommendation: ADAPT**

While we're skipping dedicated "Idea Vault" and "Goal Tracker" features, the concept of **pinned paths** in Browse Mode has merit.

**Proposed: Pinned Folders**

Allow users to pin specific vault directories for quick access:
- Pin "Projects" folder
- Pin "Daily Notes" folder
- Pin "Reference" folder

These appear at the top of Browse Mode's tree, always visible.

**Why:** Reduces navigation friction for large vaults. Users have different vault structures; let them customize.

**Complexity:** Low - UI addition + localStorage persistence

---

### 9. Recent Notes Enhancement

**Mockup suggests:** Horizontal card row with categorized recent items

**Recommendation: ENHANCE**

Current implementation shows recent captures. The mockup shows recent notes as categorized cards with thumbnails.

**Proposed Enhancements:**

1. **Show recent captures AND recent discussions** - Both are valuable entry points
2. **Preview snippets** - First 2-3 lines of content, not just timestamp
3. **Quick actions on hover/tap** - "Continue discussion" / "View in browse" / "Open in Obsidian"

**Skip:** Categorization (see Categories analysis above) and thumbnails (adds complexity for minimal value).

**Complexity:** Low-Medium - Extend existing recent notes component

---

### 10. User Profile / Personalization

**Mockup suggests:** User avatar, account settings

**Recommendation: DEFER**

Current Memory Loop has no user accounts - it's session-based per device. Adding accounts enables:
- Cross-device session sync
- Per-user preferences
- Collaborative vault access (future)

This is architecturally significant. It's not "add an avatar" - it's "build an auth system."

**Consideration:** Before adding accounts, validate user demand. Single-user local usage may be the ideal use case. Not every app needs accounts.

---

## Proposed Roadmap Priority

Based on value vs. complexity:

### High Priority (Low Complexity, High Value)

1. **Pinned Folders** - Immediate UX improvement for Browse Mode
2. **Enhanced Recent Items** - Show both captures and discussions with snippets
3. **Quick Actions** - Context menus for common operations

### Medium Priority (Medium Complexity, High Value)

4. **Home View** - Dashboard-lite with context and prompts
5. **Contextual Prompts** - AI-powered engagement (start simple with vault excerpts)

### Exploration (High Complexity, Uncertain Value)

6. **Task Surfacing** - Prompt engineering experiment
7. **PWA + Notifications** - Major infrastructure investment
8. **User Accounts** - Only if cross-device sync demand is validated

### Skip (Competes with Obsidian)

- Categories / Tags / Favorites (use Obsidian's)
- Goal Tracker (use AI discussion)
- Reminders (use native tools)
- Rich editing (use Obsidian)

---

## Design Philosophy Reflection

The mockup analysis document asked:

> Is the primary value capturing information efficiently **or** creating a space that *feels good* to think in?

Memory Loop's answer should be: **Both, but through different mechanisms.**

- **Efficiency** comes from: Quick capture, AI conversations, browse-in-place
- **Feeling good** comes from: Synthwave aesthetics, smooth animations, no cognitive overhead

The mockup's approach to "feeling good" was *additive* - more widgets, more sections, more visual complexity. Memory Loop's approach should be *reductive* - fewer decisions, less navigation, immediate action.

**The vibe should come from polish, not from clutter.**

---

## Appendix: Feature Comparison Matrix

| Mockup Feature | Implement? | Rationale |
|----------------|------------|-----------|
| Synthwave theme | **Done** | Core identity |
| Responsive design | **Done** | Core requirement |
| Note capture | **Done** | Core feature |
| AI chat | **Done** | Core feature |
| File browsing | **Done** | Core feature |
| Recent notes | **Enhance** | Add snippets, discussions |
| Dashboard | **Adapt** | Simpler "Home" view |
| Categories | Skip | Obsidian has this |
| Favorites | Skip | Obsidian has this |
| To-Do list | **Adapt** | AI surfacing only |
| Inspiration | **Adapt** | Contextual prompts |
| Goal tracker | Skip | Use AI discussion |
| Reminders | Skip | No notification infra |
| Rich editing | Skip | Obsidian does this |
| Quick links | **Adapt** | Pinned folders |
| User accounts | Defer | Validate demand first |

---

## Next Steps

If this direction is approved:

1. Create detailed specs for "Pinned Folders" feature
2. Design "Home" view wireframes
3. Prototype "Contextual Prompts" with simple vault excerpts
4. User research: What do current users want most?

---

*This document is intentionally opinionated. Disagreement is productive. The goal is clarity of direction, not premature consensus.*
