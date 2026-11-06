# Native Windows verification

Windows execution is **not yet verified**. Use this procedure to collect evidence
from the updated `work/68l-portable-filesystem` branch. Do not use the real vault
or inspect, migrate or remove its existing `.memory-loop` directory.

## Toolchain and build

Run from the updated checkout in PowerShell. Stop any web process serving this
checkout's `.next` before building; do not stop unrelated applications.

```powershell
git branch --show-current
bun --version
node --version
bun --no-env-file install --frozen-lockfile
bun --no-env-file run typecheck
bun --no-env-file run build
```

Use Bun **1.4.3**; do not regenerate the lockfile with the older Bun that could
not read it. Linux validation used Node **26.13.0**. Dependencies require Node
22 or newer; report the exact version used if different.

## Owned filesystem tests

These tests create their own disposable data. They do not select a real vault or
require a live model/provider. Pass explicit filenames rather than relying on
shell glob expansion:

```powershell
$files = @(
  'backend/safe-fs.test.ts',
  'backend/safe-fs-files.test.ts',
  'backend/safe-fs-mutations.test.ts',
  'backend/transport.test.ts',
  'backend/vault.test.ts',
  'backend/vault-save.test.ts',
  'backend/vault-actions-http.test.ts',
  'backend/vault-file-http.test.ts',
  'backend/upload-http.test.ts',
  'backend/vault-search-http.test.ts',
  'backend/capture-writer.test.ts',
  'backend/capture-http.test.ts',
  'backend/ground-reader.test.ts',
  'backend/ground-generation-boundaries.test.ts',
  'backend/ground-generation-publication.test.ts',
  'backend/think-state-file.test.ts',
  'backend/think-body-store.test.ts',
  'backend/think-transcript-faults.test.ts'
)
bun --no-env-file run test:backend -- @files
bun --no-env-file run test:backend -- backend/think-durable-admission.test.ts -t 'reopens native Windows state using forward-slash absolute spelling'
```

Report passed, failed and skipped counts, including test names and error codes.
Do not change permissions or disable assertions to make a failure pass. Some
link-creation scenarios depend on host capabilities; a fixture error must be
reported, not treated as a successful containment check. Linux process/signal
characterization and the Linux comparison seam are not part of this selection.

## Create a disposable application root and vault

This creates a new GUID-named temporary directory. It does not change the
checkout's existing transport or configuration. Write JSON without a UTF-8 BOM,
including on Windows PowerShell 5.1:

```powershell
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('memory-loop-verify-' + [guid]::NewGuid().ToString('N'))
$projectRoot = Join-Path $fixture 'app'
$vault = Join-Path $fixture 'vault'
New-Item -ItemType Directory -Path $projectRoot, $vault | Out-Null
$env:MEMORY_LOOP_TRANSPORT_FILE = Join-Path $projectRoot '.memory-loop\transport.json'
bun --no-env-file run setup:transport --project-root $projectRoot
$utf8 = [Text.UTF8Encoding]::new($false)
$config = @{ vaultDirectory = $vault } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $projectRoot '.memory-loop\config.json'), $config, $utf8)
[IO.File]::WriteAllText((Join-Path $vault 'Welcome.md'), "# Windows verification`r`n`r`nDisposable note.`r`n", $utf8)
"Application root: $projectRoot"
"Disposable vault: $vault"
```

Keep the printed paths. If setup fails, stop and report the error rather than
overwriting credentials or switching to a real application root.

## Start, inspect and stop

Open two PowerShell terminals in the updated checkout. In **each**, substitute
the printed application-root path and set its terminal-local selector:

```powershell
$projectRoot = 'PASTE THE PRINTED APPLICATION ROOT HERE'
$env:MEMORY_LOOP_TRANSPORT_FILE = Join-Path $projectRoot '.memory-loop\transport.json'
```

Terminal 1:

```powershell
bun --no-env-file run daemon --project-root $projectRoot
```

Terminal 2:

```powershell
bun --no-env-file run server --hostname 127.0.0.1 --port 3000
```

An optional third terminal, with the same root and selector, can run:

```powershell
bun --no-env-file run check:daemon --project-root $projectRoot
```

If a port is occupied, stop and report it. Do not kill an unrelated process or
silently redirect to another application. Open `http://127.0.0.1:3000/recall`.

Exercise the disposable data:

1. Read and search for `Welcome.md`; edit it, save and reload.
2. Create a note and folder, move the note, then delete the test entries.
3. Try a move into an existing same-name destination; both entries must remain.
4. Upload a nonempty test file twice; collision naming must preserve both files.
5. Capture a short message and confirm it appears in Recall and recent captures
   on Ground. Missing optional Ground resources should be reported honestly.
6. Open Think and record its state. This minimal configuration does not select
   an OpenCode service, so it is **not a conversation verification**.

Stop each tier with **Ctrl+C in its own terminal** and wait for both commands to
return to their prompts. Start them again with the same selectors and verify
that saved notes and captures remain. Record shutdown behavior and any errors.
Keep the disposable data until results have been reviewed.

Managed `bun run restart` remains Linux-only by agreement. Do not substitute
Windows `SIGTERM` or forced process termination for the Ctrl+C check.

## Think conversation gate

A full conversation, transcript, reload and paired-deletion check still needs a
separately isolated native Windows OpenCode setup. First establish whether a
Windows executable is already installed. Do not install a binary, select a real
service, enable generation jobs or make paid model calls as an incidental test.
The retained Linux `think:fixture` harness is not yet a verified Windows harness.
Filesystem test results alone do not establish native-provider integration.
