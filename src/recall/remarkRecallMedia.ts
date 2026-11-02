import type { Nodes, Root } from 'mdast';
import type { Extension as FromMarkdownExtension } from 'mdast-util-from-markdown';
import type { Extension, State, Tokenizer } from 'micromark-util-types';
import type { Plugin } from 'unified';
// Load remark-parse's unified.Data extension registrations without a runtime import.
import type {} from 'remark-parse';

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    recallEmbed: 'recallEmbed';
    recallEmbedMarker: 'recallEmbedMarker';
    recallEmbedTarget: 'recallEmbedTarget';
  }
}

declare module 'mdast' {
  interface Data { recallMediaSyntax?: 'obsidian' }
}

// Extend micromark's phrasing grammar, not the raw source. CommonMark still owns
// escapes, code spans/fences, HTML, links and ordinary image/reference syntax.
const tokenizeEmbed: Tokenizer = function (effects, ok, nok) {
  let length = 0;
  function start(code: Parameters<State>[0]): ReturnType<State> {
    if (code !== 33) return nok(code);
    effects.enter('recallEmbed'); effects.enter('recallEmbedMarker'); effects.consume(code);
    return firstBracket;
  }
  const firstBracket: State = code => {
    if (code !== 91) return nok(code);
    effects.consume(code); return secondBracket;
  };
  const secondBracket: State = code => {
    if (code !== 91) return nok(code);
    effects.consume(code); effects.exit('recallEmbedMarker'); effects.enter('recallEmbedTarget');
    return target;
  };
  const target: State = code => {
    if (code === 93) {
      if (!length) return nok(code);
      effects.exit('recallEmbedTarget'); effects.enter('recallEmbedMarker'); effects.consume(code);
      return close;
    }
    // Bare, single-line targets only. Sizing/alias and heading/block extensions
    // remain literal source instead of being partially interpreted as a filename.
    if (code === null || code < 0 || [10, 13, 91, 124, 35, 94].includes(code) || length >= 4096) return nok(code);
    effects.consume(code); length++; return target;
  };
  const close: State = code => {
    if (code !== 93) return nok(code);
    effects.consume(code); effects.exit('recallEmbedMarker'); effects.exit('recallEmbed');
    return after;
  };
  const after: State = code => {
    // ![[alt]](destination) / ![[alt]][reference] are CommonMark images
    // with bracketed alt text. Roll back this entire attempt and let the core
    // grammar interpret the suffix; never steal the prefix as an Obsidian file.
    return code === 40 || code === 91 ? nok(code) : ok(code);
  };
  return start;
};

const syntax: Extension = { text: { 33: { name: 'recallEmbed', tokenize: tokenizeEmbed } } };
const fromMarkdown: FromMarkdownExtension = {
  enter: {
    recallEmbed(token) { this.enter({ type: 'image', url: '', alt: '', title: null, data: { recallMediaSyntax: 'obsidian' } }, token); },
  },
  exit: {
    recallEmbedTarget(token) {
      const image = this.stack.at(-1);
      if (image?.type === 'image') image.url = image.alt = this.sliceSerialize(token);
    },
    recallEmbed(token) { this.exit(token); },
  },
};

function walk(node: Nodes, visit: (node: Nodes) => void) {
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    visit(current);
    if ('children' in current) for (let index = current.children.length - 1; index >= 0; index--) pending.push(current.children[index]);
  }
}

/** Opt-in only: retain the authored destination before HTML URL normalization. */
const remarkRecallMedia: Plugin<[], Root> = function () {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(syntax);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdown);
  return tree => {
    const definitions = new Map<string, string>();
    walk(tree, node => {
      if (node.type === 'definition' && !definitions.has(node.identifier.toUpperCase())) definitions.set(node.identifier.toUpperCase(), node.url);
    });
    walk(tree, node => {
      if (node.type !== 'image' && node.type !== 'imageReference') return;
      const reference = node.type === 'image' ? node.url : definitions.get(node.identifier.toUpperCase());
      if (reference === undefined) return;
      node.data = { ...node.data, hProperties: {
        ...node.data?.hProperties,
        'data-media-reference': reference,
        'data-media-syntax': node.data?.recallMediaSyntax ?? 'markdown',
      } };
    });
  };
};
export default remarkRecallMedia;
