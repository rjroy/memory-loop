const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const obj = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const ident = (value: unknown): value is string => typeof value === 'string' && identifier.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const choices = (value: unknown, allowed: string[]): value is string => typeof value === 'string' && allowed.includes(value);

function bodyRef(value: unknown, conversationId: string, epoch: string): Record<string, unknown> {
  if (!obj(value) || !obj(value.key) || value.key.conversationId !== conversationId || !obj(value.key.owner) ||
      value.epoch !== epoch || !id(value.contentId) || !id(value.generation) || !number(value.through) ||
      !choices(value.kind, ['preview', 'canonical'])) throw new Error('invalid body reference');
  const owner = value.key.owner;
  let projected: Record<string, unknown>;
  if (owner.kind === 'original' && id(owner.clientCommandId) && ident(owner.messageId)) projected = { kind: owner.kind, clientCommandId: owner.clientCommandId, messageId: owner.messageId };
  else if (owner.kind === 'assistant-text' && ident(owner.messageId) && number(owner.ordinal)) projected = { kind: owner.kind, messageId: owner.messageId, ordinal: owner.ordinal };
  else if (owner.kind === 'form-reply' && id(owner.clientCommandId) && ident(owner.decisionId)) projected = { kind: owner.kind, clientCommandId: owner.clientCommandId, decisionId: owner.decisionId };
  else throw new Error('invalid body owner');
  if (value.kind === 'canonical' && (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256))) throw new Error('invalid body digest');
  return { key: { conversationId, owner: projected }, epoch, contentId: value.contentId, generation: value.generation, through: value.through, kind: value.kind, ...(value.kind === 'canonical' ? { sha256: value.sha256 } : {}) };
}

function entry(value: unknown, conversationId: string, epoch: string): Record<string, unknown> {
  if (!obj(value) || !number(value.displayOrder)) throw new Error('invalid entry');
  const base = { kind: value.kind, displayOrder: value.displayOrder };
  if (value.kind === 'original' && id(value.clientCommandId) && ident(value.messageId) || value.kind === 'form-reply' && id(value.clientCommandId) && ident(value.decisionId) || value.kind === 'assistant-text' && ident(value.messageId) && number(value.ordinal) && choices(value.closure, ['open', 'closed']) && choices(value.capture, ['complete', 'incomplete', 'unknown'])) {
    const body = bodyRef(value.body, conversationId, epoch);
    const key = body.key as { owner: Record<string, unknown> };
    if (key.owner.kind !== value.kind || (value.kind === 'assistant-text' && (key.owner.messageId !== value.messageId || key.owner.ordinal !== value.ordinal)) ||
        (value.kind === 'original' && (key.owner.clientCommandId !== value.clientCommandId || key.owner.messageId !== value.messageId)) ||
        (value.kind === 'form-reply' && (key.owner.clientCommandId !== value.clientCommandId || key.owner.decisionId !== value.decisionId))) throw new Error('body ownership mismatch');
    return { ...base, ...(value.kind === 'assistant-text' ? { messageId: value.messageId, ordinal: value.ordinal, closure: value.closure, capture: value.capture } : { clientCommandId: value.clientCommandId, ...(value.kind === 'original' ? { messageId: value.messageId } : { decisionId: value.decisionId }) }), body };
  }
  if (value.kind === 'tool' && ident(value.messageId) && ident(value.toolCallId) && choices(value.category, ['file-read', 'file-write', 'shell', 'search', 'subagent', 'custom']) && choices(value.state, ['started', 'completed', 'failed', 'interrupted', 'unknown']) && (value.sourceTime === undefined || number(value.sourceTime)) && (value.durationMs === undefined || number(value.durationMs))) return { ...base, messageId: value.messageId, toolCallId: value.toolCallId, category: value.category, state: value.state, ...(value.sourceTime === undefined ? {} : { sourceTime: value.sourceTime }), ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }) };
  if (value.kind === 'lifecycle' && id(value.clientCommandId) && (value.runId === undefined || id(value.runId)) && choices(value.state, ['registered', 'ready', 'upstream-unconfirmed', 'rejected', 'admitted', 'monitor-unavailable', 'cancelled-before-delivery', 'completed', 'failed', 'interrupted', 'requested', 'replied', 'stale']) && (value.sourceTime === undefined || number(value.sourceTime))) return { ...base, clientCommandId: value.clientCommandId, state: value.state, ...(value.runId === undefined ? {} : { runId: value.runId }), ...(value.sourceTime === undefined ? {} : { sourceTime: value.sourceTime }) };
  throw new Error('invalid projection entry');
}

export function projectConversation(value: unknown, conversationId: string, snapshot: boolean): Record<string, unknown> {
  if (!obj(value) || value.conversationId !== conversationId || !id(value.epoch) || !number(value.revision) || !choices(value.creation, ['registered', 'ready', 'upstream-unconfirmed', 'rejected']) ||
      (value.permissionCompatibility !== undefined && value.permissionCompatibility !== 'incompatible') || (value.permissionPending !== undefined && typeof value.permissionPending !== 'boolean')) throw new Error('invalid conversation');
  const result: Record<string, unknown> = { conversationId, epoch: value.epoch, revision: value.revision, creation: value.creation,
    ...(value.permissionCompatibility === undefined ? {} : { permissionCompatibility: value.permissionCompatibility }), ...(value.permissionPending === undefined ? {} : { permissionPending: value.permissionPending }) };
  if (snapshot) {
    if (!Array.isArray(value.entries) || value.entries.length > 50 || (value.contentHealth !== undefined && !choices(value.contentHealth, ['complete', 'incomplete'])) ||
        (value.nextCursor !== undefined && (typeof value.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,256}\.[a-f0-9]{64}$/.test(value.nextCursor)))) throw new Error('invalid manifest');
    result.entries = value.entries.map(item => entry(item, conversationId, value.epoch as string));
    if (value.contentHealth !== undefined) result.contentHealth = value.contentHealth;
    if (value.nextCursor !== undefined) result.nextCursor = value.nextCursor;
  }
  return result;
}
