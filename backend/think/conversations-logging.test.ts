import { expect, it, vi } from 'vitest';
import { createConversationService } from './conversations';
import type { RegisteredConversation, ThinkStateStore } from './state';

it('reports a resume persistence failure at warning severity with safe correlation', async () => {
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const clientCommandId = '22222222-2222-4222-8222-222222222222';
  const epoch = '33333333-3333-4333-8333-333333333333';
  const directory = '/fixture/vault';
  const owner = { conversationId, directory, purpose: 'think', lifecycle: 'live' } as RegisteredConversation;
  const state = {
    registry: { conversation: () => owner },
    command: () => null,
    registerCommand: vi.fn(),
    outcome: () => { throw Object.assign(new Error('private note payload'), { code: 'SQLITE_BUSY' }); },
  } as unknown as ThinkStateStore;
  const onPersistenceFailure = vi.fn();
  const service = createConversationService({ state, directory, epoch, onPersistenceFailure,
    native: { inspect: async () => ({ state: 'ready', busy: false, uncertain: false }),
      prepare: async () => ({ state: 'ready', busy: false, uncertain: false }) } });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(await service.resume({ conversationId, clientCommandId })).toMatchObject({ state: 'ready' });
    expect(onPersistenceFailure).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith('think_resume_outcome', expect.objectContaining({
      level: 'warning', status: 'persistence_unavailable', operation: 'resume', conversationId, clientCommandId, code: 'SQLITE_BUSY',
    }));
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private note payload');
  } finally { await service.close(); warning.mockRestore(); }
});
