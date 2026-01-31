---
title: Allowing User Input During AI Response
date: 2026-01-28
status: resolved
tags: [ux, discussion, streaming, input-handling]
modules: [frontend-discussion]
resolution: Draft Mode implemented (PR #436, commit f57134a). Other ideas (full input, queue) not pursued.
---

# Brainstorm: Allowing User Input During AI Response

## Context

Exploring the risks and trade-offs of allowing users to compose their next message while the AI is still streaming a response in the Discussion component (`frontend/src/components/discussion/Discussion.tsx`).

Currently, the input is disabled during `isSubmitting` state. The backend already has interrupt logic that aborts a previous query if a new message arrives.

## Current Implementation

- **Frontend**: `isSubmitting` state disables the textarea and file attach button
- **Backend**: `handleDiscussionMessage` interrupts any active query before starting a new one (lines 726-734 in websocket-handler.ts)
- The send button transforms into a stop button during streaming

## Ideas Explored

### Allow Full Input During Response

The backend is surprisingly well-prepared for this:
- Interrupt mechanism exists and works
- State management clears `activeQuery` properly on abort
- Frontend changes would be minimal: remove `disabled={isSubmitting}`

But this introduces risks around premature submission and cognitive overload.

### Queue Instead of Replace

Messages typed during response go into a visible queue. User can edit/delete before the queue sends after response completes.

Trade-off: Adds significant UI complexity. Queue management becomes a feature unto itself.

### Draft Mode During Response

User can type into a visually distinct draft area (grayed, different background). Submit button only enables after response completes.

Trade-off: Captures the "I know what I want to say" use case without premature submission risk, but adds cognitive overhead with two input states.

## Identified Risks

1. **Premature submission** - User hits Enter by habit while response is streaming. Their half-formed thought becomes the next message. Backend handles this gracefully, but user didn't mean to send yet.

2. **Context mismatch** - User starts typing based on early tokens, but the AI's full response changes direction. The follow-up becomes non-sequitur.

3. **Message ordering confusion** - Rapid-fire submits during long responses could create surprising interleaves in conversation history.

4. **Visual noise during cognitive load** - User is already watching streaming text. Adding an active input field creates competing visual focus. Mobile screen real estate is especially precious.

5. **Stop button placement** - Currently send transforms to stop during `isSubmitting`. If input is enabled, do we show both? UI complexity increases.

6. **Abort timing races** - If user sends a new message 100ms before `response_end`, there's a race between interrupt completing and new session starting. Backend handles this, but edge cases might cause dropped content.

7. **Slash command autocomplete conflicts** - The autocomplete dropdown could conflict with the streaming display area.

8. **File attachment during response** - What happens if user attaches while AI is referencing a different file?

## Open Questions

- How often do users actually want to type during response? Real problem or theoretical efficiency gain?
- Mobile vs Desktop: Should behavior differ? On mobile, keyboard covers the response anyway.
- What does "stop" mean when input is enabled? Stop AND keep draft? Stop AND clear?
- Is the premature submission risk worth solving the "type ahead" use case?

## Next Steps

Needs user reflection on whether this is worth pursuing given the complexity trade-offs.
