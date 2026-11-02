import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ElementContent } from 'hast';
import remarkGfm from 'remark-gfm';
import MediaEmbed from './MediaEmbed';
import remarkRecallMedia from './remarkRecallMedia';
import type { RecallMediaContext } from './mediaReferences';

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

function containsMedia(node: ElementContent): boolean {
  return node.type === 'element' && (node.tagName === 'img' || node.children.some(containsMedia));
}

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  return href && webLink(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}<span className="visually-hidden"> (opens in a new tab)</span></a>
    : <span>{children}</span>;
}

const components: Components = {
  h1: ({ children }) => <h2 className="markdown-h1">{children}</h2>,
  h2: ({ children }) => <h3 className="markdown-h2">{children}</h3>,
  h3: ({ children }) => <h4 className="markdown-h3">{children}</h4>,
  h4: ({ children }) => <h5>{children}</h5>,
  h5: ({ children }) => <h6>{children}</h6>,
  h6: ({ children }) => <h6>{children}</h6>,
  a: MarkdownLink,
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

const cardComponents: Components = {
  ...components,
  h1: ({ children }) => <h3 className="markdown-h1">{children}</h3>,
  h2: ({ children }) => <h4 className="markdown-h2">{children}</h4>,
  h3: ({ children }) => <h5 className="markdown-h3">{children}</h5>,
  h4: ({ children }) => <h6>{children}</h6>,
};

export default function MarkdownDocument({ markdown, headingStart = 2, media }: { markdown: string; headingStart?: 2 | 3; media?: RecallMediaContext }) {
  const renderers = useMemo<Components>(() => {
    const base = headingStart === 3 ? cardComponents : components;
    if (!media) return base;
    return { ...base,
      img: ({ node, alt }) => <MediaEmbed
        reference={String(node?.properties['data-media-reference'] ?? '')}
        syntax={node?.properties['data-media-syntax'] === 'obsidian' ? 'obsidian' : 'markdown'} label={alt} context={media} />,
      a: props => {
        // Native playback/download controls cannot be nested inside an anchor.
        // Retain an authored external target as a separate ordinary link.
        if (props.node?.children.some(containsMedia)) return <span className="recall-media-link">{props.children}
          {props.href && webLink(props.href) && <a href={props.href} target="_blank" rel="noopener noreferrer">Open linked page<span className="visually-hidden"> (opens in a new tab)</span></a>}
        </span>;
        return <MarkdownLink href={props.href}>{props.children}</MarkdownLink>;
      },
    };
  }, [headingStart, media]);
  // No raw-HTML plugin: react-markdown escapes raw source instead of creating live DOM.
  // Keep the default safe URL transform. Only the Recall image renderer resolves
  // an inert authored destination through the loaded tree and same-origin API.
  return <div className="markdown-document"><Markdown remarkPlugins={media ? [remarkGfm, remarkRecallMedia] : [remarkGfm]} components={renderers}>{markdown}</Markdown></div>;
}
