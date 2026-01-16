# Think Tab

The Think tab is your conversation space with Claude AI, grounded in the context of your Obsidian vault. Ask questions, explore ideas, run commands, and let the AI read and analyze your notes.

[ img: Think tab with conversation ]

## The Chat Interface

The interface follows a familiar chat pattern: your messages on one side, Claude's responses on the other, with an input area at the bottom.

[ img: Chat interface showing user and assistant messages ]

### Message History

Messages display in chronological order with clear visual distinction between your messages and Claude's responses. The view auto-scrolls to the latest message as the conversation progresses.

### Streaming Responses

Claude's responses stream in real-time. You see text appear as it's generated rather than waiting for the complete response. This provides immediate feedback and lets you follow the AI's reasoning.

[ img: Streaming response in progress ]

## Input Area

The input area sits at the bottom of the screen, always accessible.

[ img: Input area with attachment and send buttons ]

### Text Input

The text field expands when focused to give you more writing room. On mobile, this expansion is particularly helpful for longer messages.

### Send Button

Tap the send icon (arrow) to submit your message. While Claude is responding, this button transforms into a stop button (square) that lets you abort the response if needed.

[ img: Stop button during response ]

### File Attachment

The paperclip button lets you attach files from your device. Attached files are uploaded to your vault and their path is added to your message. Claude can then read and analyze the file content.

[ img: File attachment button ]

## Slash Commands

Type `/` to see available commands. These are predefined prompts that trigger specific AI behaviors.

[ img: Slash command autocomplete dropdown ]

### Autocomplete

As you type after the `/`, the dropdown filters to matching commands. Each command shows:
- Command name
- Brief description of what it does

Navigate with arrow keys and press Enter to select, or tap the command directly.

### Built-in Commands

Your vault's `CLAUDE.md` file defines available commands. Common examples:

| Command | Purpose |
|---------|---------|
| `/daily-debrief` | Summarize today's captures and identify themes |
| `/weekly-debrief` | Review the past week's activity |
| `/monthly-summary YYYY MM` | Generate a monthly overview |
| `/review-goals` | Analyze goals against recent progress |
| `/expand-note <path>` | Transform raw meeting notes into coherent documentation |

### Command Arguments

Some commands accept arguments. After selecting a command, a placeholder hint appears showing expected input format. For example, `/monthly-summary` expects `YYYY MM` format.

## Tool Usage

Claude has access to tools for reading your vault, searching files, and performing other operations. When Claude uses a tool, you see it inline in the response.

[ img: Tool invocation display showing Read tool ]

### Tool Display

Each tool invocation shows:
- Tool name (e.g., "Read", "Glob", "Grep")
- Input parameters (the arguments passed to the tool)
- Output (the result, often truncated for readability)

This transparency lets you understand how Claude is gathering information from your vault.

### Tool Permissions

Certain operations require your approval before proceeding. When Claude attempts a sensitive action (like writing to a file), a permission dialog appears.

[ img: Tool permission dialog ]

**Allow**: Let the operation proceed
**Deny**: Block the operation and continue the conversation

This gives you control over what changes Claude can make to your vault.

## Session Management

Conversations persist across app sessions. You can maintain ongoing discussions or start fresh as needed.

### New Session

Tap the **+** button in the top corner to start a new conversation. A confirmation dialog appears since this clears the current session's context.

[ img: New session button and confirmation dialog ]

### Resume Session

From the Ground tab, tap **Resume** on any recent discussion to continue where you left off. The full conversation history loads, and Claude retains context from previous messages.

### Delete Session

From the Ground tab, tap **Delete** on a discussion to remove it permanently. Active sessions cannot be deleted; start a new session first if you want to remove the current one.

## Input Behavior

### Desktop

- **Enter**: Send message
- **Shift+Enter**: Add a new line
- **Arrow keys**: Navigate slash command autocomplete
- **Escape**: Close autocomplete dropdown

### Mobile

- **Enter**: Add a new line
- **Tap send button**: Send message
- **Tap command**: Select from autocomplete

## Draft Preservation

Like Capture, your draft auto-saves as you type:
- Navigate away and your draft persists
- Return to Think and it's restored
- Sending clears the draft

This ensures you don't lose partially composed messages.

## Typical Workflows

### Exploring an Idea

1. Type your question or thought
2. Claude responds with analysis grounded in your vault
3. Follow up with clarifying questions
4. Let the conversation develop organically

### Running a Debrief

1. Tap a debrief button on Ground (or type the command)
2. Claude reads your recent notes
3. Receive a summary with themes and insights
4. Discuss specific points that interest you

### Analyzing a File

1. Use the attachment button to upload a file
2. Ask Claude to analyze, summarize, or critique it
3. The file path in your message lets Claude read the content
4. Discuss findings in follow-up messages

### Goal Review

1. Tap the goals card on Ground (or type `/review-goals`)
2. Claude reads your goals.md and recent activity
3. Get assessment of progress and blockers
4. Refine goals based on the discussion

### Research Assistance

1. Ask Claude about a topic
2. Claude searches your vault for relevant notes
3. Get synthesis of your existing knowledge
4. Identify gaps and areas for further exploration

### Expanding Meeting Notes

After a meeting capture session ends, you're automatically brought here with `/expand-note` pre-filled:

1. Run the command (it already has the meeting file path)
2. Claude reads your raw timestamped captures
3. Answer 2-4 clarifying questions about unclear references
4. Claude transforms raw notes into coherent meeting documentation
5. Review and approve before saving

This workflow bridges the gap between quick captures and polished meeting notes. See [Capture Tab](./capture.md#meeting-capture-mode) for how to start a meeting session.

## Tips

- **Be specific**: Claude works better with focused questions than vague ones
- **Use slash commands**: They're designed for common patterns
- **Check tool output**: See what Claude is reading to understand its reasoning
- **Continue conversations**: Context builds over a session
- **Start fresh when stuck**: Sometimes a new session perspective helps
