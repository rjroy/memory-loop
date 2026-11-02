import { useEffect, useRef, useState } from 'react';
import type { VaultFileResponse, VaultId } from '../../backend/contract';
import { fileContentLocation } from './api';

export function fileKindLabel(file: VaultFileResponse): string {
  switch (file.kind) {
    case 'image': return 'Image';
    case 'video': return 'Video';
    case 'text': return 'Text · Read-only';
    case 'unsupported': return 'File · Read-only';
  }
}

/** Shared passive presentation. The caller owns identity, download, loading and read errors. */
export default function FileViewer({ file, id, label = file.name, embedded = false }: { file: VaultFileResponse; id: VaultId; label?: string; embedded?: boolean }) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    return () => { if (video && !video.paused) video.pause(); };
  }, [file, failed]);

  if (file.kind === 'text' && !embedded) return file.text.length
    ? <pre className="recall-raw-text">{file.text}</pre>
    : <p className="note-status">This file is empty.</p>;

  // Embedded phrasing must remain valid inside Markdown paragraphs/headings.
  const Wrapper = embedded ? 'span' : 'div';
  const Paragraph = embedded ? 'span' : 'p';
  if (file.kind === 'unsupported' || file.kind === 'text' || failed) return <Wrapper className="recall-viewer-fallback" role={embedded ? undefined : 'status'}>
    <Paragraph>{file.kind === 'image' ? "This image can't be displayed in this browser."
      : file.kind === 'video' ? "This video can't be played in this browser."
        : 'No preview is available for this file.'}</Paragraph>
    <Paragraph>{file.kind === 'video' && 'Its format or codec may not be supported. '}Download the original to open it in another app.</Paragraph>
    {embedded && <a className="recall-embed-download" href={fileContentLocation(id, true)} download={file.name}>Download original<span className="visually-hidden">: {label}</span></a>}
  </Wrapper>;

  const source = fileContentLocation(id);
  return <Wrapper className={`recall-media-stage${embedded ? ' recall-media-stage--embedded' : ''}`}>
    {file.kind === 'image'
      ? <img className="recall-media" src={source} alt={label} onError={() => setFailed(true)} />
      : <video className="recall-media" ref={videoRef} src={source} controls preload="metadata" playsInline
        aria-label={label} onError={() => setFailed(true)} />}
  </Wrapper>;
}
