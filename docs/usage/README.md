# Using Memory Loop

Memory Loop is organized around four modes, each designed for a specific type of interaction with your Obsidian vault.


## The Four Tabs

| Tab | Icon | Purpose | Use when... |
|-----|------|---------|-------------|
| [Ground](./ground.md) | 🪨 | Home dashboard | Starting your session, checking goals, accessing recent activity |
| [Capture](./capture.md) | 🪶 | Quick note entry | Capturing thoughts, running meeting sessions |
| [Think](./think.md) | ✨ | AI conversation | Exploring ideas, running commands, analyzing notes |
| [Recall](./recall/) | 🪞 | File browsing | Reading notes, searching, editing, reviewing tasks |

## Quick Start

**New to Memory Loop?** Here's a suggested first session:

1. **Ground**: See your vault name and any goals you've set
2. **Capture**: Jot down a quick thought to test the capture flow
3. **Ground**: Notice your capture appears in Recent Activity
4. **Think**: Ask Claude something about your vault
5. **Recall**: Browse your files and find the daily note with your capture

## Navigation

The tab bar appears at the top of the screen. Tap any tab to switch views.

<img src="images/navbar.webp"/>

Each tab maintains its state when you switch away. Your draft messages, scroll positions, and selected files persist as you move between tabs.

## Common Patterns

### Capture Then Reflect

1. Throughout the day, use **Capture** for quick thoughts
2. End the day on **Ground** and tap **Daily Debrief**
3. **Think** summarizes your captures and surfaces themes

### Meeting Notes Flow

1. Start a meeting in **Capture** with a title
2. Capture notes throughout the meeting
3. Stop the meeting to auto-transition to **Think**
4. Run `/expand-note` to transform raw notes into coherent documentation

### Read Then Discuss

1. Use **Recall** to find and read a note
2. Long-press and select "Think about"
3. **Think** opens with the file path ready for discussion

### Goal-Driven Session

1. Start on **Ground** to see your goals
2. Tap the goals card to discuss progress in **Think**
3. Update goals in **Recall** using adjust mode

## Documentation

- [Ground Tab](./ground.md): Dashboard, debriefs, inspiration, goals, recent activity
- [Capture Tab](./capture.md): Quick note entry, draft preservation, error handling
- [Think Tab](./think.md): AI chat, slash commands, tool usage, sessions
- [Recall Tab](./recall/): File tree, search, viewers, editing, tasks

## Related Documentation

- [Widgets](../widgets/README.md): Configure computed widgets for Ground and Recall
- [Deployment](../deployment/systemd.md): Self-hosting setup
