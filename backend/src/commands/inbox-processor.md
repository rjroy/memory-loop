# Inbox Processor

Help organize and process items in the 00_Inbox folder according to the PARA
method.

## Task

Review all notes in `00_Inbox/` and help categorize them:

1. **Scan the Inbox**
   - List all files currently in 00_Inbox
   - Exclude README.md and Welcome.md

2. **Analyze Each Item**
   - Read the content
   - Identify the type of note
   - Suggest appropriate destination

3. **Categorization Rules**
   - **→ 01_Projects**: Has deadline, specific outcome
   - **→ 02_Areas**: Ongoing responsibility, no end date
   - **→ 03_Resources**: Reference material, knowledge
   - **→ 04_Archive**: Old/completed, no longer active
   - **→ Delete**: No value, redundant, or temporary

4. **Suggest Actions**

   ```
   File: [filename]
   Type: [detected type]
   Destination: [suggested folder]
   Reason: [why this categorization]
   Related to: [any existing notes it connects to]
   ```

5. **Identify Patterns**
   - Common themes across multiple notes
   - Notes that could be combined
   - Missing connections between items

## Output Format

Provide a clear action plan:

1. Items to move (with destinations)
2. Items to combine or link
3. Items to delete
4. Items needing more context

## Remember

- Some items legitimately belong in the Inbox (daily notes, quick captures)
- Don't over-organize - sometimes "good enough" is perfect
- Look for opportunities to connect ideas, not just file them
