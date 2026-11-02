import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const witness = join(process.cwd(), 'mcp-witness.jsonl');
const record = (event: string, marker?: string) => appendFileSync(witness, `${JSON.stringify({ event, pid: process.pid, ...(marker ? { marker } : {}) })}\n`, { mode: 0o600 });
const server = new Server({ name: 'fixture-echo', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler('tools/list', async () => {
  record('tools-list');
  return { tools: [{ name: 'echo', description: 'Echo a fixture marker', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] };
});
server.setRequestHandler('tools/call', async request => {
  const text = request.params.arguments?.text;
  if (request.params.name !== 'echo' || (text !== 'direct-fixture-ok' && text !== 'code-fixture-ok')) throw new Error('Invalid fixture request');
  record('call', text);
  return { content: [{ type: 'text', text }], structuredContent: { text } };
});
record('start');
server.oninitialized = () => { record('rpc-ready'); };
await server.connect(new StdioServerTransport());
record('transport-connected');
let closing: Promise<void> | undefined;
const close = () => closing ??= (async () => { await server.close(); record('stop'); })();
process.once('SIGTERM', () => { void close().finally(() => { process.exitCode = 0; }); });
process.stdin.once('end', () => { void close(); });
