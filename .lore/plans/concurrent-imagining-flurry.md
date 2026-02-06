# Plan: Fix PairWriting Actions Not Appearing in Discussion

## Bug

When a user triggers a Quick Action or Advisory Action in PairWriting mode, the message doesn't appear in the Discussion panel, and neither does the AI response. The session gets created but nothing is visible.

## Root Cause

PairWritingMode and Discussion each create their own `useChat(vault)` instance. Two separate SSE connections, two separate session IDs.

- **PairWritingMode** (line 82): `useChat(vault)` with NO `onEvent` handler. Responses go nowhere.
- **Discussion** (line 145): `useChat(vault, { onEvent: handleMessage })` with full event pipeline.

When PairWritingMode sends a message, it also never calls `addMessage()`, so the user message doesn't appear in SessionContext either.

## Fix: `sendMessageRef` prop on Discussion

Add an optional ref prop to Discussion. PairWritingMode passes a ref, Discussion assigns its `sendChatMessage` to it. PairWritingMode routes actions through the ref instead of its own useChat.

This works because Discussion's `sendChatMessage` already calls both `addMessage()` AND `chat.sendMessage()`, so user message + SSE response both flow through Discussion's pipeline.

## Files Modified

### 1. `nextjs/components/discussion/Discussion.tsx`

- Add `SendMessageFn` type and `DiscussionProps` interface with optional `sendMessageRef`
- Change signature from `Discussion()` to `Discussion({ sendMessageRef }: DiscussionProps)`
- Add `useEffect` after `sendChatMessage` definition (after line 159) to assign/cleanup the ref:

```typescript
useEffect(() => {
  if (sendMessageRef) {
    sendMessageRef.current = sendChatMessage;
  }
  return () => {
    if (sendMessageRef) {
      sendMessageRef.current = null;
    }
  };
}, [sendMessageRef, sendChatMessage]);
```

### 2. `nextjs/components/discussion/index.ts`

- Export `type DiscussionProps` and `type SendMessageFn` from Discussion

### 3. `nextjs/components/pair-writing/PairWritingMode.tsx`

- Remove `import { useChat }` (line 20) and the `useChat(vault)` call (line 82)
- Import `type { SendMessageFn }` from Discussion
- Create ref: `const sendMessageRef = useRef<SendMessageFn | null>(null)`
- In `handleQuickAction` and `handleAdvisoryAction`, replace `void sendChatMessage(message)` with `void sendMessageRef.current?.(message)`
- Remove `sendChatMessage` from dependency arrays of both callbacks
- Pass ref to Discussion: `<DiscussionComponent sendMessageRef={sendMessageRef} />`
- Update `DiscussionComponent` prop type from `typeof Discussion` to `React.ComponentType<DiscussionProps>`

### 4. `nextjs/components/pair-writing/__tests__/PairWritingMode.test.tsx`

- Update `MockDiscussion` to accept and wire up `sendMessageRef` prop
- Add `mockSentMessages` array to track messages, reset in `beforeEach`
- Change Quick/Advisory action tests from checking `mockFetch.mock.calls` to checking `mockSentMessages` content
- The fetch mock setup can stay (VaultSelect may still trigger fetches) but action assertions change

### 5. `nextjs/components/discussion/__tests__/Discussion.test.tsx`

Add test block for `sendMessageRef`:
- Ref gets assigned after mount
- Message sent through ref appears in conversation
- Ref nulled on unmount
- Standalone mode (no ref) still works

## Edge Cases

**Discussion not mounted yet**: `sendMessageRef.current` starts null. Action handlers guard with `?.` operator. In practice impossible because Discussion is a child of PairWritingMode and the user must interact with the editor before any action fires.

**`sendChatMessage` changes across renders**: The `useEffect` re-assigns the ref whenever `sendChatMessage` changes. Ref always points to latest version.

## Execution Order

1. Update Discussion.tsx (add props, ref wiring)
2. Update Discussion barrel export
3. Update PairWritingMode.tsx (remove useChat, add ref, route through it)
4. Update PairWritingMode tests
5. Add Discussion sendMessageRef tests
6. Run full test suite

## Verification

- `bun run --cwd nextjs test` passes
- Quick/Advisory action messages appear in Discussion conversation (verified by test)
- Discussion works standalone without ref (verified by existing tests still passing)
