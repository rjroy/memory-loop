import { OpenCode } from '@opencode/client';
import { Service } from '@opencode/client/service';

// Invoked only by the owned native fixture with its loopback URL and credentials.
async function main(): Promise<void> {
  const { OPENCODE_TEST_URL: origin, OPENCODE_TEST_PASSWORD: password, OPENCODE_TEST_SESSION_ID: sessionID, OPENCODE_TEST_MESSAGE_ID: messageID, OPENCODE_TEST_SERVER_PID: serverPID } = process.env;
  if (!process.versions.bun || !origin || !password || !sessionID || !messageID || !serverPID || !/^[1-9]\d*$/.test(serverPID) || !/^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.test(origin)) {
    throw new Error('invalid owned Bun smoke inputs');
  }
  const port = Number(new URL(origin).port);
  if (port > 65535 || [3000, 3001, 9443, 4173, 4317, 48763].includes(port)) throw new Error('invalid owned Bun smoke origin');
  const client = OpenCode.make({ baseUrl: origin, headers: Service.headers({ url: origin, auth: { type: 'basic', username: 'opencode', password } }) });
  const info = await client.server.info({ signal: AbortSignal.timeout(5000) });
  if (info.version !== '2.2.2' || info.pid !== Number(serverPID)) throw new Error('unexpected owned server identity');
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const result = await client.message.list(cursor ? { sessionID, cursor, limit: 50 } : { sessionID, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(5000) });
    if (result.data.some(message => message.type === 'user' && message.id === messageID && message.text === 'fixture prompt')) {
      console.info('owned Bun client smoke verified');
      return;
    }
    const next = result.cursor.next;
    if (!next || result.data.length === 0 || seen.has(next)) break;
    seen.add(next); cursor = next;
  }
  throw new Error('owned fixture history not found');
}

void main().catch(() => { console.error('owned Bun client smoke failed'); process.exitCode = 1; });
