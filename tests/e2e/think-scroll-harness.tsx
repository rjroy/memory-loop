import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ThinkConversation from '../../src/think/ThinkConversation';
import { PresentationContext } from '../../src/shell/presentation';
import type { ThinkPresentationActions, ThinkPresentationState } from '../../src/think/types';

const identity = { conversationId: '11111111-1111-4111-8111-111111111111', epoch: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const ref = { ...identity, contentId: 'fixture', generation: 'fixture', through: 1, kind: 'canonical' as const, sha256: 'a'.repeat(64), key: { conversationId: identity.conversationId, owner: { kind: 'original' as const, clientCommandId: 'fixture', messageId: 'fixture' } } };
const noop = () => {};
const actions: ThinkPresentationActions = { editDraft: noop, send: noop, stop: noop, requestNewChat: noop, cancelNewChat: noop, confirmNewChat: noop, checkConnection: noop, retryBody: noop, editQuestion: noop, replyQuestion: noop, recoverRejected: noop };

function Harness() {
  const [step, setStep] = useState(0);
  (window as unknown as { fixtureStep: (step: number) => void }).fixtureStep = value => flushSync(() => setStep(value));
  const text = Array.from({ length: 35 + step }, (_, i) => `Fixture paragraph ${i}: ${'controlled streaming words '.repeat(6)}`).join('\n\n');
  const state: ThinkPresentationState = { identity, revision: step + 1, creation: 'ready', messages: [{ role: 'assistant', messageId: 'fixture', displayOrder: 1, activity: [{ kind: 'tool', id: 'tool-fixture', messageId: 'fixture', category: step % 4 < 2 ? 'shell' : 'file-read', state: step % 4 < 2 ? 'started' : 'completed' }], parts: [{ messageId: 'fixture', ordinal: 0, closure: 'open', capture: step % 4 < 2 ? 'complete' : 'incomplete', content: { state: 'ready', ref, text } }] }], backgroundActivity: [], draft: { text: '', version: 1 }, composer: { kind: 'stop', runId: 'fixture', state: 'available' }, run: { state: 'working', runId: 'fixture' }, monitoring: 'following', questions: [], history: { state: 'complete' }, newChat: 'idle', rejectedSubmissions: [] };
  return <PresentationContext.Provider value={{ location: { key: 'fixture', pathname: '/think', search: '', hash: '' }, navigationType: 'INITIAL', isNavigating: false, navigate: noop, linkIntent: noop, rememberEntry: noop, registerRecallCapture: () => noop, registerHeading: () => noop }}><ThinkConversation presentation={{ state, actions }} /></PresentationContext.Provider>;
}

const workspace = document.querySelector('.workspace');
if (!workspace) throw new Error('Fixture workspace missing');
createRoot(workspace).render(<Harness />);
