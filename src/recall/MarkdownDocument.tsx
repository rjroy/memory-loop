import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { createContext, useContext } from 'react';
import type { ElementContent } from 'hast';
import remarkGfm from 'remark-gfm';

const TaskName = createContext('Read-only task');

// Accessible names come from the maintained renderer's tree, not a Markdown parser.
function textOf(node: ElementContent): string {
  return node.type === 'text' ? node.value : node.type === 'element' ? node.children.map(textOf).join(' ') : '';
}

function TaskCheckbox({ checked }: { checked?: boolean }) {
  const name = useContext(TaskName);
  return <input type="checkbox" checked={Boolean(checked)} disabled aria-label={name} />;
}

function webLink(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}

const components: Components = {
  h1: ({ children }) => <h2 className="markdown-h1">{children}</h2>,
  h2: ({ children }) => <h3 className="markdown-h2">{children}</h3>,
  h3: ({ children }) => <h4 className="markdown-h3">{children}</h4>,
  h4: ({ children }) => <h5>{children}</h5>,
  h5: ({ children }) => <h6>{children}</h6>,
  h6: ({ children }) => <h6>{children}</h6>,
  a: ({ href, children }) => href && webLink(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}<span className="visually-hidden"> (opens in a new tab)</span></a>
    : <span>{children}</span>,
  img: ({ alt }) => <span>{alt ? `Image not shown: ${alt}` : 'Image not shown.'}</span>,
  li: ({ children, className, node }) => {
    const name = node?.children.filter(child => child.type !== 'element' || !['ul', 'ol'].includes(child.tagName))
      .map(textOf).join(' ').replace(/\s+/g, ' ').trim() || 'Read-only task';
    return <li className={className}><TaskName.Provider value={name}>{children}</TaskName.Provider></li>;
  },
  input: ({ checked }) => <TaskCheckbox checked={checked} />,
  pre: ({ children }) => <pre tabIndex={0} aria-label="Code block">{children}</pre>,
  table: ({ children }) => <div className="markdown-table-scroll" role="region" aria-label="Table" tabIndex={0}><table>{children}</table></div>,
};

export default function MarkdownDocument({ markdown }: { markdown: string }) {
  // No raw-HTML plugin: react-markdown escapes raw source instead of creating live DOM.
  // URL transforms never fetch data; components above render images and unsupported links as text.
  return <div className="markdown-document"><Markdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</Markdown></div>;
}
