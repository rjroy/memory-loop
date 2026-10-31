import { expect, vi } from 'vitest';
import type { ThinkService } from './think/service';

/** A fresh service spy for each HTTP boundary test. */
export function thinkHttpService() {
  const unexpected = async () => { throw new Error('Unexpected Think service call'); };
  return {
    create: vi.fn<ThinkService['create']>(),
    conversation: vi.fn<ThinkService['conversation']>(),
    snapshot: vi.fn<ThinkService['snapshot']>(unexpected),
    watch: vi.fn<ThinkService['watch']>(unexpected),
    contentChunk: vi.fn<ThinkService['contentChunk']>(unexpected),
    command: vi.fn<ThinkService['command']>(),
    send: vi.fn<ThinkService['send']>(unexpected),
    stop: vi.fn<ThinkService['stop']>(unexpected),
    decisions: vi.fn<ThinkService['decisions']>(unexpected),
    decision: vi.fn<ThinkService['decision']>(unexpected),
    reply: vi.fn<ThinkService['reply']>(unexpected),
    content: { page: vi.fn<ThinkService['content']['page']>(unexpected), open: vi.fn<ThinkService['content']['open']>(unexpected) },
    close: vi.fn<ThinkService['close']>(async () => {}),
  } satisfies ThinkService;
}

export function expectNoThinkDispatch(think: ReturnType<typeof thinkHttpService>) {
  expect(think.create).not.toHaveBeenCalled();
  expect(think.conversation).not.toHaveBeenCalled();
  expect(think.snapshot).not.toHaveBeenCalled();
  expect(think.watch).not.toHaveBeenCalled();
  expect(think.contentChunk).not.toHaveBeenCalled();
  expect(think.command).not.toHaveBeenCalled();
  expect(think.send).not.toHaveBeenCalled();
  expect(think.stop).not.toHaveBeenCalled();
  expect(think.decisions).not.toHaveBeenCalled();
  expect(think.decision).not.toHaveBeenCalled();
  expect(think.reply).not.toHaveBeenCalled();
  expect(think.content.page).not.toHaveBeenCalled();
  expect(think.content.open).not.toHaveBeenCalled();
}
