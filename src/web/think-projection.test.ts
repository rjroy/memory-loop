import { describe, expect, it } from 'vitest';
import { projectConversation } from './think-projection';

const id = '11111111-1111-4111-8111-111111111111';
const epoch = '22222222-2222-4222-8222-222222222222';
const command = '33333333-3333-4333-8333-333333333333';
const content = '44444444-4444-4444-8444-444444444444';
const revision = { conversationId: id, epoch, revision: 1, creation: 'ready', sendEligibility: 'available' };
const owner = { kind: 'original', clientCommandId: command, messageId: 'msg_fixture' };
const body = { key: { conversationId: id, owner }, epoch, contentId: content, generation: content, through: 3, kind: 'canonical', sha256: 'a'.repeat(64), privateField: 'secret' };
const original = { kind: 'original', displayOrder: 0, clientCommandId: command, messageId: 'msg_fixture', body, privateField: 'secret' };
const snapshot = (entries: unknown[]) => ({ ...revision, entries });

describe('public Think conversation projection', () => {
  it('projects each public entry variant while stripping private fields and lifecycle command kind', () => {
    const assistantBody = { ...body, kind: 'preview', sha256: 'ignored', key: { conversationId: id, owner: { kind: 'assistant-text', messageId: 'msg_ai', ordinal: 0 } } };
    const replyBody = { ...body, key: { conversationId: id, owner: { kind: 'form-reply', clientCommandId: command, decisionId: 'form_1' } } };
    const result = projectConversation(snapshot([original,
      { kind: 'assistant-text', displayOrder: 1, messageId: 'msg_ai', ordinal: 0, closure: 'open', capture: 'unknown', body: assistantBody },
      { kind: 'form-reply', displayOrder: 2, clientCommandId: command, decisionId: 'form_1', body: replyBody },
      { kind: 'tool', displayOrder: 3, messageId: 'msg_ai', toolCallId: 'tool_1', category: 'custom', state: 'failed' },
      { kind: 'compaction', displayOrder: 4, sessionId: 'ses_1', eventId: 'evt_1', phase: 'ended', sourceTime: 1, sourceSequence: 1 },
      { kind: 'original-capture', displayOrder: 5, commandKind: 'send', clientCommandId: command, state: 'captured', sourceTime: 1 },
      { kind: 'lifecycle', displayOrder: 6, commandKind: 'send', clientCommandId: command, state: 'admitted' },
    ]), id, true);
    expect(result.entries.map(item => item.kind)).toEqual(['original', 'assistant-text', 'form-reply', 'tool', 'compaction', 'original-capture', 'lifecycle']);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.entries[1]).toMatchObject({ body: { kind: 'preview' } });
    expect(result.entries[1]).not.toHaveProperty('body.sha256');
    expect(result.entries[6]).not.toHaveProperty('commandKind');
  });

  it.each([
    { ...body, epoch: id }, { ...body, key: { ...body.key, conversationId: epoch } },
    { ...body, key: { ...body.key, owner: { ...owner, messageId: 'msg_other' } } },
    { ...body, sha256: 'invalid' },
  ])('rejects mismatched owner, conversation, epoch, or canonical digest', invalid => {
    expect(() => projectConversation(snapshot([{ ...original, body: invalid }]), id, true)).toThrow();
  });

  it('distinguishes absent optional fields from null and ignores manifest fields in revision mode', () => {
    expect(projectConversation({ ...revision, entries: null, contentHealth: null, nextCursor: null }, id, false)).toEqual(revision);
    expect(() => projectConversation({ ...revision, transcript: null }, id, false)).toThrow();
    expect(() => projectConversation({ ...revision, entries: [], contentHealth: null }, id, true)).toThrow();
    expect(() => projectConversation(snapshot(Array(51).fill(original)), id, true)).toThrow();
    expect(projectConversation(snapshot([]), id, true)).toEqual({ ...revision, entries: [] });
  });

  it('retains per-variant timestamp bounds', () => {
    const timestamp = 8640000000000001;
    expect(projectConversation(snapshot([{ kind: 'tool', displayOrder: 0, messageId: 'msg', toolCallId: 'tool', category: 'custom', state: 'started', sourceTime: timestamp }]), id, true).entries).toHaveLength(1);
    expect(() => projectConversation(snapshot([{ kind: 'compaction', displayOrder: 0, sessionId: 'ses', eventId: 'evt', phase: 'ended', sourceTime: timestamp, sourceSequence: 1 }]), id, true)).toThrow();
  });
});
