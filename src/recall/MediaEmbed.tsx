import { useEffect, useMemo, useState } from 'react';
import { idKey, readFile } from './api';
import FileViewer from './FileViewer';
import { resolveMediaReference, type MediaSyntax, type RecallMediaContext } from './mediaReferences';
import { useVaultRead } from './useVaultRead';

export default function MediaEmbed({ reference, label, syntax, context }: {
  reference: string; label?: string; syntax: MediaSyntax; context: RecallMediaContext;
}) {
  useEffect(() => { if (!context.index && !context.unavailable) context.load?.(); }, [context.index, context.unavailable, context.load]);
  const resolution = useMemo(() => context.index ? resolveMediaReference(context.index, context.noteId, reference, syntax) : null,
    [context.index, context.noteId, reference, syntax]);
  const entry = resolution?.status === 'file' ? resolution.entry : null;
  const [revision, setRevision] = useState(0);
  const read = useVaultRead(entry?.kind === 'file' ? idKey(entry.id) : null, revision, readFile);
  const name = label || entry?.name || reference;
  let message: string | null = null;
  if (!resolution) message = context.unavailable ? "Couldn't resolve this media reference. Refresh files to try again." : 'Loading media…';
  else if (resolution.status === 'missing') message = `Media not found: “${reference}”.`;
  else if (resolution.status === 'ambiguous') message = `More than one file matches “${reference}”. Use a vault-relative path.`;
  else if (resolution.status === 'remote') message = "Remote media isn't loaded.";
  else if (resolution.status === 'unavailable' || read.status === 'error') message = "This media reference isn't available.";
  else if (entry?.kind === 'file' && read.status !== 'ready') message = 'Loading media…';
  const file = entry?.kind === 'note' ? { name: entry.name, kind: 'unsupported' as const } : read.status === 'ready' ? read.data : null;
  return <span className="recall-media-embed" role="group" aria-label={`Media: ${name}`} aria-busy={message === 'Loading media…' || undefined}>
    {message ? <span className="recall-embed-message">{message}
      {read.status === 'error' && read.error === 'transport' && <button type="button" className="recall-button" onClick={() => setRevision(value => value + 1)}>Retry media</button>}
    </span> : file && entry && <FileViewer key={`${idKey(entry.id)}:${revision}`} file={file} id={entry.id} label={name} embedded />}
  </span>;
}
