import type { CommentNode, ElementNode, Node } from 'comark'
import { defineComarkPlugin } from 'comark'

/**
 * Transform a node. Return nothing to remove it, a node, or a list of nodes.
 * The node is `[tag, attrs, ...children]` for elements, `[null, attrs, content]`
 * for comments, and a plain string for `text` handlers (as in strip-markdown,
 * the parameter is deliberately untyped).
 */
export type Handler = (node: any) => Node[] | Node | null | undefined

export interface Options {
	/** Tag names to leave unchanged. */
	keep?: readonly string[] | null
	/** Tag names to remove (or replace, with handlers). */
	remove?: ReadonlyArray<readonly [string, Handler] | string> | null
}

type Handlers = Record<string, Handler>

const TOML_FRONTMATTER_RE = /^\+\+\+[ \t]*\r?\n(?:[\s\S]*?\r?\n)?\+\+\+[ \t]*(?:\r?\n|$)/
const HTML_COMMENT_RE = /^<!--[\s\S]*?-->$/

/**
 * Modifiers for known tags. Tags not listed here are not changed (but their children are).
 * Pseudo-tags: raw HTML elements and comments are looked up under `html`, plain
 * text under `text`, and frontmatter under `yaml` / `toml` (option targets only —
 * frontmatter never reaches the tree as a node).
 */
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
	html,
	img: image,
	input: taskInput,
	li: block,
	ol: children,
	p: paragraph,
	pre: empty,
	s: children,
	section: footnote,
	strong: children,
	sup: footnote,
	table: empty,
	text: node => node,
	toml: empty,
	ul: children,
	yaml: empty,
}

/**
 * Remove markdown formatting.
 *
 * - remove `pre`, `hr`, `table`, frontmatter, block html, footnotes and their content
 * - render everything else as simple paragraphs without formatting
 * - uses `alt` text for images
 */
export default defineComarkPlugin<Options | null | undefined>((options) => {
	const keep = options?.keep || []
	const remove = options?.remove || []
	const handlers: Handlers = { ...defaults }

	// A kept `li` still needs its internal checkbox for Comark's list renderer.
	if (keep.includes('li'))
		handlers.input = node => node

	for (const value of remove) {
		if (typeof value === 'string')
			// `remove: ['html']` mirrors strip-markdown, where it equals the default
			// (mdast html nodes are tag-only markers, so inline text always survives).
			handlers[value] = value === 'html' ? html : empty
		else
			handlers[value[0]] = value[1]
	}

	let map = handlers

	if (keep.length > 0) {
		map = {}
		for (const key in handlers) {
			if (!keep.includes(key))
				map[key] = handlers[key]!
		}
		for (const key of keep) {
			if (!Object.hasOwn(handlers, key))
				throw new Error(`Unknown node type \`${key}\` in \`keep\`, use a replace tuple with a handle instead: \`remove: [['${key}', handle]]\``)
		}
	}

	const stripHtml = map.html === html || map.html === empty
	// Inline comments never become nodes (comark folds them into the surrounding
	// text), so they must be dropped at token level whenever `html` is not kept.
	const stripComments = Object.hasOwn(map, 'html')

	function one(node: Node): Node | Node[] | undefined {
		const type = typeof node === 'string'
			? 'text'
			: node[0] === null || node[1].$?.html ? 'html' : node[0]
		let result: Node | Node[] | null | undefined = node

		if (Object.hasOwn(map, type)) {
			const handler = map[type]
			if (handler)
				result = handler(node) || undefined
		}

		if (!result || typeof result === 'string')
			return result || undefined

		if (Array.isArray(result) && !isElement(result))
			return all(result)

		result.splice(2, result.length, ...all(result.slice(2) as Node[]))

		// Drop paragraphs emptied by stripping — comark renders them as blank blocks,
		// while strip-markdown's output never shows them.
		if (result[0] === 'p' && result.length === 2)
			return undefined

		return result
	}

	function all(nodes: Node[]): Node[] {
		const result: Node[] = []
		for (let index = 0; index < nodes.length; index++) {
			const node = nodes[index]!
			const value = one(node)
			if (Array.isArray(value) && !isElement(value))
				result.push(...value)
			else if (value)
				result.push(value)
			else if (isTaskInput(node) && typeof nodes[index + 1] === 'string')
				nodes[index + 1] = (nodes[index + 1] as string).replace(/^ /, '')
		}
		return clean(result)
	}

	return {
		name: 'strip',
		markdownItPlugins: [
			(md) => {
				// Link reference definitions produce an empty `component` node in comark; drop them.
				md.core.ruler.push('strip-reference', (state: any) => {
					state.tokens = state.tokens.filter((token: any) => token.type !== 'reference')
				})
				if (stripHtml || stripComments) {
					md.core.ruler.push('strip-html', (state: any) => {
						if (stripHtml)
							state.tokens = state.tokens.filter((token: any) => token.type !== 'html_block')
						for (const token of state.tokens) {
							if (token.type === 'inline' && token.children)
								token.children = token.children.filter((token: any) => !isHtmlComment(token))
						}
					})
				}
			},
		],
		pre(state) {
			// Skip when `toml` is kept/replaced, and in streaming re-parses, where
			// state.markdown is a mid-document suffix — a `+++` block there is content.
			if (map.toml !== empty || state.parsedLines)
				return
			const match = TOML_FRONTMATTER_RE.exec(state.markdown)
			if (match) {
				state.markdown = state.markdown.slice(match[0].length)
				state.parsedLines = (state.parsedLines || 0) + match[0].split(/\r?\n/).length - 1
			}
		},
		post(state) {
			// In streaming mode the first `reusableNodes.length` nodes are the previous
			// parse's output, already stripped — re-running handlers on them would
			// double-apply non-idempotent custom handlers (and is O(n²) over a stream).
			const reused: number = state.reusableNodes?.length || 0
			state.tree.nodes = reused > 0
				? [...state.tree.nodes.slice(0, reused), ...all(state.tree.nodes.slice(reused))]
				: all(state.tree.nodes)
			if (map.yaml === empty)
				state.tree.frontmatter = {}
		},
	}
})

function isElement(value: Node | Node[]): value is ElementNode | CommentNode {
	return typeof value[1] === 'object' && value[1] !== null && !Array.isArray(value[1])
}

/** Merge adjacent text nodes. */
function clean(values: Node[]): Node[] {
	const result: Node[] = []
	for (const value of values) {
		const previous = result.at(-1)
		if (typeof value === 'string' && typeof previous === 'string')
			result[result.length - 1] = previous + value
		else
			result.push(value)
	}
	return result
}

function children(node: ElementNode | CommentNode): Node[] {
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

function taskInput(node: ElementNode | CommentNode): Node | undefined {
	return isTaskInput(node) ? undefined : node
}

function isTaskInput(node: Node): node is ElementNode {
	return Array.isArray(node)
		&& node[0] === 'input'
		&& node[1].class === 'task-list-item-checkbox'
		&& node[1].type === 'checkbox'
}

function isHtmlComment(token: { type: string, content?: string }): boolean {
	return token.type === 'html_inline' && HTML_COMMENT_RE.test(token.content?.trim() || '')
}

/** Inline html keeps its text, block html (and comments) is removed. */
function html(node: ElementNode | CommentNode): Node[] | undefined {
	return node[0] === null || node[1].$?.block ? undefined : children(node)
}

/** `sup.footnote-ref` / `section.footnotes` from `comark/plugins/footnotes` are removed, other nodes are left as-is. */
function footnote(node: ElementNode | CommentNode): Node | undefined {
	const cls = node[1].class
	return cls === 'footnote-ref' || cls === 'footnotes' ? undefined : node
}

function lineBreak(): Node {
	return '\n'
}

function empty(): undefined {
	return undefined
}
