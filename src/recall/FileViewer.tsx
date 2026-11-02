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
export default function FileViewer({ file, id }: { file: VaultFileResponse; id: VaultId }) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    return () => { if (video && !video.paused) video.pause(); };
  }, [file, failed]);

  if (file.kind === 'text') return file.text.length
    ? <pre className="recall-raw-text">{file.text}</pre>
    : <p className="note-status">This file is empty.</p>;

  if (file.kind === 'unsupported' || failed) return <div className="recall-viewer-fallback" role="status">
    <p>{file.kind === 'image' ? "This image can't be displayed in this browser."
      : file.kind === 'video' ? "This video can't be played in this browser."
        : 'No preview is available for this file.'}</p>
    <p>{file.kind === 'video' && 'Its format or codec may not be supported. '}Download the original to open it in another app.</p>
  </div>;

  const source = fileContentLocation(id);
  return <div className="recall-media-stage">
    {file.kind === 'image'
      ? <img className="recall-media" src={source} alt={file.name} onError={() => setFailed(true)} />
      : <video className="recall-media" ref={videoRef} src={source} controls preload="metadata" playsInline
        aria-label={file.name} onError={() => setFailed(true)} />}
  </div>;
}
