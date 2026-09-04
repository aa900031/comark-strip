import type { CommentNode, ElementNode, Node } from 'comark'

/**
 * Transform a node. Return nothing to remove it, a node, or a list of nodes.
 * The node is `[tag, attrs, ...children]` for elements, `[null, attrs, content]`
 * for comments, and a plain string for `text` handlers (as in strip-markdown,
 * the parameter is deliberately untyped).
 */
export type Handler = (node: any) => Node[] | Node | null | undefined | void

type Handlers = Record<string, Handler>

const defaults: Handlers = {
	a: children,
	blockquote: block,
	br: lineBreak,
	code: children,
	del: children,
	em: children,
	h1: paragraph,
	h2: paragraph,
	h3: paragraph,
	h4: paragraph,
	h5: paragraph,
	h6: paragraph,
	hr: empty,
	html: children,
	img: image,
	li: listItem,
	ol: children,
	p: paragraph,
	pre: empty,
	s: children,
	section: footnote,
	strong: children,
	sub: children,
	sup: footnote,
	table: empty,
	text: node => node,
	toml: empty,
	ul: children,
	yaml: empty,
}

export function createHandlers(
	keep: readonly string[],
	remove: ReadonlyArray<readonly [string, Handler] | string>,
): Handlers {
	const handlers: Handlers = { ...defaults }

	for (const value of remove) {
		if (typeof value === 'string')
			// `remove: ['html']` mirrors strip-markdown, where it equals the default
			// (mdast html nodes are tag-only markers, so inline text always survives).
			handlers[value] = value === 'html' ? children : empty
		else
			handlers[value[0]] = value[1]
	}

	for (const key of new Set(keep)) {
		if (!Object.hasOwn(handlers, key))
			throw new Error(`Unknown node type \`${key}\` in \`keep\`, use a replace tuple with a handle instead: \`remove: [['${key}', handle]]\``)
		delete handlers[key]
	}
	return handlers
}

export function isElement(value: unknown): value is ElementNode | CommentNode {
	return Array.isArray(value) && typeof value[1] === 'object' && value[1] !== null && !Array.isArray(value[1])
}

export function children(node: ElementNode | CommentNode): Node[] {
	return node.slice(2) as Node[]
}

function paragraph(node: ElementNode | CommentNode): ElementNode {
	// Carry `$` (position meta) through so comark's streaming reuse keeps its anchor.
	return ['p', node[1].$ ? { $: node[1].$ } : {}, ...children(node)]
}

const BLOCK_TAGS = new Set(['p', 'ul', 'ol', 'blockquote', 'pre', 'table', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** Block container: unwrap, but re-wrap inline-only content (comark `autoUnwrap`) in a paragraph so siblings stay separated. */
function block(node: ElementNode | CommentNode): Node[] | ElementNode {
	const nodes = children(node)
	return nodes.some(child => Array.isArray(child) && child[0] !== null && (BLOCK_TAGS.has(child[0]) || child[1].$?.block))
		? nodes
		: paragraph(node)
}

function image(node: ElementNode | CommentNode): Node | undefined {
	const value = String(node[1].alt || node[1].title || '')
	return value || undefined
}

/** Like comark's own `li` renderer, drop the checkbox of a `task-list-item` (and the space after it). */
function listItem(node: ElementNode | CommentNode): Node[] | ElementNode {
	if (String(node[1].class || '').includes('task-list-item')) {
		const first = node[2]
		const host = isElement(first) && first[0] === 'p' ? first : node
		if (isElement(host[2]) && host[2][0] === 'input') {
			host.splice(2, 1)
			if (typeof host[2] === 'string')
				host[2] = (host[2] as string).replace(/^ /, '')
		}
	}
	return block(node)
}

/** `sup.footnote-ref` / `section.footnotes` from `comark/plugins/footnotes` are removed, other nodes are unwrapped like their html counterparts. */
function footnote(node: ElementNode | CommentNode): Node[] | undefined {
	const cls = node[1].class
	return cls === 'footnote-ref' || cls === 'footnotes' ? undefined : children(node)
}

function lineBreak(): Node {
	return '\n'
}

export function empty(): undefined {
	return undefined
}
