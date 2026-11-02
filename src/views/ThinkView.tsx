'use client';

import ThinkConversation from '../think/ThinkConversation';
import { useThinkPresentation } from '../think/presentation';
import type { ThinkPresenterProps } from '../think/types';
import '../think/think.css';

export default function ThinkView({ presentation }: Partial<ThinkPresenterProps> = {}) {
  if (presentation) return <ThinkConversation presentation={presentation} />;

  return <ConnectedThinkView />;
}

function ConnectedThinkView() {
  const presentation = useThinkPresentation();
  return <ThinkConversation presentation={presentation} />;
}
