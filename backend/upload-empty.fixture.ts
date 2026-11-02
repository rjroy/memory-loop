import { serve } from 'bun';
import { createApp } from './app';
import { openVault } from './vault';

const root = process.argv[2];
if (!root) throw new Error('Missing owned vault');
const token = 'a'.repeat(64);
const vault = await openVault(root);
let app: ReturnType<typeof createApp>;
const server = serve({ hostname: '127.0.0.1', port: 0, development: false, fetch: request => app(request) });
app = createApp({ authority: `127.0.0.1:${server.port}`, serviceToken: token, vault: { reader: vault } });
console.log(`UPLOAD_FIXTURE_READY ${server.port}`);
process.on('SIGTERM', () => {
  void (async () => { await server.stop(true); await vault.close(); process.exit(0); })();
});
