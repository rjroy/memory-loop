'use client';

import type { ThinkPresenterProps } from './types';

/** One shell-owned control; responsive placement never creates a second button. */
export default function ThinkNewChatButton({ presentation: { state, actions } }: ThinkPresenterProps) {
  return <button type="button" className="think-button think-new-chat" aria-label="New chat" title="New chat"
    disabled={state.newChat === 'starting'} onClick={actions.requestNewChat}>
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
    <span className="think-new-chat-label">New chat</span>
  </button>;
}
