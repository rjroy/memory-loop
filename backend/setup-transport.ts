import { projectRootFromArgs } from './runtime-options';
import { setupTransport } from './transport';

async function main() {
  await setupTransport(projectRootFromArgs(process.argv.slice(2)));
  console.info('Transport setup complete');
}

main().catch(() => {
  console.error('Transport setup failed; check private metadata and permissions');
  process.exitCode = 1;
});
