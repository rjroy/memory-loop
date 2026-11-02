export interface ContentChunkRequest {
  conversationId: string;
  contentId: string;
  generation: string;
  through: number;
  offset: number;
  transfer?: string;
}

export interface ContentChunk extends ContentChunkRequest {
  epoch: string;
  transfer: string;
  bytes: string;
  nextOffset: number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const integer = /^(?:0|[1-9][0-9]*)$/;

export function parseContentRequest(conversationId: string, contentId: string, query: URLSearchParams): ContentChunkRequest | null {
  if (!uuid.test(conversationId) || !uuid.test(contentId) || [...query.keys()].some(key => !['generation', 'through', 'offset', 'transfer'].includes(key))) return null;
  const generation = query.getAll('generation');
  const through = query.getAll('through');
  const offset = query.getAll('offset');
  const transfer = query.getAll('transfer');
  if (generation.length !== 1 || through.length !== 1 || offset.length !== 1 || transfer.length > 1 || !uuid.test(generation[0]) ||
      !integer.test(through[0]) || !integer.test(offset[0]) || transfer.length && !uuid.test(transfer[0])) return null;
  const end = Number(through[0]);
  const start = Number(offset[0]);
  if (!Number.isSafeInteger(end) || !Number.isSafeInteger(start) || start > end || (!transfer.length && start !== 0)) return null;
  return { conversationId, contentId, generation: generation[0], through: end, offset: start, ...(transfer.length ? { transfer: transfer[0] } : {}) };
}
