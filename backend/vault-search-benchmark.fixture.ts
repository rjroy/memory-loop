/** Standalone, destructive only to its own generated /tmp/opencode directory. */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve, sleep, version } from 'bun';
import { openVault, type VaultReader } from './vault';

if (process.argv.length !== 2) throw new Error('This fixture accepts no arguments or vault paths');
const prefix = '/tmp/opencode/search-p0d-3-owned-';
const root = await mkdtemp(prefix);
let reader: VaultReader | undefined;
let server: ReturnType<typeof serve> | undefined;
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), runtime: version, measurements: [] };
const measurements = report.measurements as unknown[];
const memory = () => { const { rss, heapUsed, heapTotal, external } = process.memoryUsage(); return { rss, heapUsed, heapTotal, external }; };
const log = (message: string) => console.error(`${new Date().toISOString()} ${message}`);

try {
  log('generating fixture');
  const directories = Array.from({ length: 80 }, (_, i) => join(root, `project-${String(i).padStart(3, '0')}`));
  await Promise.all(directories.map(path => mkdir(path)));
  const prose = 'A café notebook records observations, decisions, implementation details, and thoughtful context for future readers. '.repeat(2);
  const templates = [
    `# Project notes\n\n${(`${prose}\n`).repeat(15)}`,
    JSON.stringify({ title: 'Project record', description: prose.repeat(15), tags: ['notes', 'café'] }, null, 2) + '\n',
    `// Project utilities\n${(`// ${prose}\n`).repeat(15)}export const active = true;\n`,
    `MIT License\n\n${(`${prose}\n`).repeat(15)}`,
  ];
  let next = 0;
  let totalBytes = 0;
  await Promise.all(Array.from({ length: 32 }, async () => {
    for (;;) {
      const i = next++;
      if (i >= 10240) break;
      const suffix = ['md', 'json', 'ts', 'LICENSE'][i % 4];
      const name = suffix === 'LICENSE' ? `LICENSE-${i}` : `${i % 128 === 0 ? 'sdk-' : 'record-'}${String(i).padStart(5, '0')}.${suffix}`;
      const text = templates[i % 4] + (i % 128 === 0 ? '\nsdk\n' : '');
      await writeFile(join(directories[Math.floor(i / 128)], name), text);
      totalBytes += Buffer.byteLength(text);
    }
  }));
  const large = `${'ordinary line without marker\n'.repeat(80000)}sdkbeyondpreview\n`;
  await writeFile(join(root, 'large-document.txt'), large);
  totalBytes += (await stat(join(root, 'large-document.txt'))).size;
  report.dataset = { visibleFiles: 10241, bytes: totalBytes, directories: 80, writeConcurrency: 32, largeBytes: Buffer.byteLength(large), positiveFiles: 80, negativeQuery: 'zzqxvnonexistent987654321', cache: 'Fixture writes warm the OS page cache; no cold-disk claim.' };
  const positive = await readFile(join(directories[0], 'sdk-00000.md'), 'utf8');
  const negative = await readFile(join(directories[0], 'record-00001.json'), 'utf8');
  report.physicalSamples = { sdkPositive: positive.split('\n').includes('sdk'), sdkNegative: !negative.toLowerCase().includes('sdk'), largeMarkerBeyond2MiB: Buffer.byteLength(large.slice(0, large.indexOf('sdkbeyondpreview'))) > 2 * 1024 * 1024 };
  if (!positive.split('\n').includes('sdk') || negative.toLowerCase().includes('sdk')) throw new Error('Physical sample verification failed');
  reader = await openVault(root);
  server = serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') });
  const pingUrl = `http://127.0.0.1:${server.port}/`;
  report.memoryBefore = memory();
  async function measure(mode: 'filename' | 'content', query: string, iteration: number) {
    log(`benchmarking ${mode} ${query === 'sdk' ? 'sdk' : query === 'sdkbeyondpreview' ? 'beyond-preview' : 'no-match'} iteration ${iteration}`);
    let last = performance.now();
    let maxGapMs = 0;
    let pingMaxMs = 0;
    let pings = 0;
    let running = true;
    const heartbeat = setInterval(() => { const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - last); last = now; }, 25);
    const ping = (async () => { while (running) { const start = performance.now(); await fetch(pingUrl).then(response => response.text()); pingMaxMs = Math.max(pingMaxMs, performance.now() - start); pings++; await sleep(25); } })();
    const start = performance.now();
    try {
      if (!reader) throw new Error('Reader not open');
      const result = await reader.search({ mode, query }, new AbortController().signal);
      const durationMs = performance.now() - start;
      measurements.push({ mode, query, iteration, durationMs, counts: result.counts, coverage: result.coverage, limited: result.limited, retained: result.hits.length, beyondPreviewHit: query === 'sdkbeyondpreview' && result.mode === 'content' ? result.hits.some(hit => hit.name === 'large-document.txt' && hit.line === 80001) : undefined, heartbeat: { maxGapMs, pings, pingMaxMs }, memory: memory() });
      if (result.coverage.timedOut) throw new Error('Search deadline reached; stopping measurements');
    } finally { running = false; clearInterval(heartbeat); await ping; }
  }
  for (const mode of ['filename', 'content'] as const) for (const query of ['sdk', 'zzqxvnonexistent987654321']) for (let iteration = 0; iteration < 4; iteration++) await measure(mode, query, iteration);
  await measure('content', 'sdkbeyondpreview', 0);
  const sampleRoot = join(root, 'sample-check');
  await mkdir(sampleRoot);
  await writeFile(join(sampleRoot, 'positive.md'), 'software development kit\n');
  await writeFile(join(sampleRoot, 'negative.md'), 'quiet plains\n');
  const sampleReader = await openVault(sampleRoot);
  try {
    const sample = await sampleReader.search({ mode: 'content', query: 'sdk' }, new AbortController().signal);
    report.sdkPhysicalSearch = { counts: sample.counts, coverage: sample.coverage, positiveFound: sample.hits.some(hit => hit.name === 'positive.md'), negativeFound: sample.hits.some(hit => hit.name === 'negative.md') };
    if (sample.counts.matches !== 1 || !sample.hits.some(hit => hit.name === 'positive.md') || sample.hits.some(hit => hit.name === 'negative.md')) throw new Error('SDK physical search verification failed');
  } finally { await sampleReader.close(); await rm(sampleRoot, { recursive: true }); }
  log('benchmarking cancellation and recovery');
  let opened: (() => void) | undefined;
  const started = new Promise<void>(resolve => { opened = resolve; });
  await reader.close();
  reader = await openVault(root, { onSearchFileOpened: async () => { opened?.(); } });
  const controller = new AbortController();
  const abortStart = performance.now();
  const pending = reader.search({ mode: 'content', query: 'sdk' }, controller.signal).then(() => 'completed', () => 'aborted');
  await started;
  controller.abort();
  const outcome = await pending;
  const abortMs = performance.now() - abortStart;
  const recovery = await reader.search({ mode: 'filename', query: 'sdk' }, new AbortController().signal);
  report.cancellation = { outcome, abortMs, recoveryCounts: recovery.counts, recoveryCoverage: recovery.coverage };
  report.memoryAfter = memory();
  report.finishedAt = new Date().toISOString();
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  report.finishedAt = new Date().toISOString();
  process.exitCode = 1;
} finally {
  await reader?.close();
  await server?.stop(true);
  if (!root.startsWith(prefix) || root.slice(prefix.length).includes('/')) throw new Error('Unsafe cleanup path');
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
