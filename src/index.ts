import type { MarkdownExitPlugin, Node } from 'comark'
import type { Handler } from './handlers'
import { defineComarkPlugin } from 'comark'
import { children, createHandlers, isElement } from './handlers'

export type { Handler }

export interface Options {
	/** Tag names to leave unchanged. */
	keep?: readonly string[] | null
	/** Tag names to remove (or replace, with handlers). */
	remove?: ReadonlyArray<readonly [string, Handler] | string> | null
}

const TOML_FRONTMATTER_RE = /^\+\+\+[ \t]*\r?\n(?:[\s\S]*?\r?\n)?\+\+\+[ \t]*(?:\r?\n|$)/
const HTML_COMMENT_RE = /^<!--[\s\S]*?-->$/

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
	const handlers = createHandlers(keep, remove)

	// Unless `html` is kept, comments are dropped at token level: inline comments never
	// become nodes (comark folds them into the surrounding text). With the default
	// handler block html goes too, since it may leave trailing text as a separate node;
	// inline html then only needs `children`.
	const htmlStripped = Object.hasOwn(handlers, 'html')
	const htmlDefault = handlers.html === children
	// Children strip left in each element, to skip subtrees no later plugin touched.
	const processed = new WeakMap<object, Node[]>()
	let tomlOpen = false

	/** Strip `node` and push what remains of it onto `out`. */
	function one(node: Node, out: Node[]): void {
		const type = typeof node === 'string'
			? 'text'
			: node[0] === null || node[1].$?.html ? 'html' : node[0]
		const seen = typeof node !== 'string' && processed.has(node)
		if (seen && !dirty(node))
			return push(out, node)
		let result: Node | Node[] | null | undefined | void = node

		const handler = Object.hasOwn(handlers, type) ? handlers[type] : undefined
		if (handler && !seen)
			result = handler(node)

		if (!result)
			return
		if (typeof result === 'string')
			return push(out, result)
		if (!isElement(result)) {
			for (const item of result)
				one(item, out)
			return
		}

		// Strings can't be tracked by identity: those the previous pass left are matched
		// by value so a `text` handler runs once per string.
		const nodes = all(children(result), processed.get(result)?.filter(child => typeof child === 'string'))
		result.splice(2, result.length, ...nodes)
		processed.set(result, nodes)

		// Drop paragraphs emptied by stripping — comark renders them as blank blocks,
		// while strip-markdown's output never shows them.
		if (result[0] === 'p' && result.length === 2)
			return

		push(out, result)
	}

	/** Has an already-processed subtree changed since strip last saw it? */
	function dirty(node: Node): boolean {
		if (typeof node === 'string')
			return false
		const previous = processed.get(node)
		if (!previous || previous.length !== node.length - 2)
			return true
		return previous.some((child, index) => child !== node[index + 2] || dirty(child))
	}

	function all(nodes: Node[], previousText: string[] = []): Node[] {
		const result: Node[] = []
		for (const node of nodes) {
			const previousIndex = typeof node === 'string' ? previousText.indexOf(node) : -1
			if (previousIndex >= 0) {
				previousText.splice(previousIndex, 1)
				push(result, node)
			}
			else {
				one(node, result)
			}
		}
		return result
	}

	return {
		name: 'strip',
		markdownItPlugins: [
			((md) => {
				// Link reference definitions produce an empty `component` node in comark; drop them.
				md.core.ruler.push('strip-reference', (state) => {
					state.tokens = state.tokens.filter(token => token.type !== 'reference')
				})
				if (htmlStripped) {
					md.core.ruler.push('strip-html', (state) => {
						if (htmlDefault)
							state.tokens = state.tokens.filter(token => token.type !== 'html_block')
						for (const token of state.tokens) {
							if (token.type === 'inline' && token.children)
								token.children = token.children.filter(token => !isHtmlComment(token))
						}
					})
				}
			}) satisfies MarkdownExitPlugin,
		],
		pre(state) {
			// Skip when `toml` is kept, and in streaming re-parses, where
			// state.markdown is a mid-document suffix — a `+++` block there is content.
			if (!Object.hasOwn(handlers, 'toml') || state.parsedLines)
				return
			const match = TOML_FRONTMATTER_RE.exec(state.markdown)
			if (match) {
				state.markdown = state.markdown.slice(match[0].length)
				state.parsedLines = match[0].split('\n').length - 1
			}
			// An unclosed `+++` while streaming parses as paragraphs; see `post`.
			tomlOpen = !match && /^\+\+\+[ \t]*\r?\n/.test(state.markdown)
		},
		post(state) {
			// In streaming mode, reused nodes are already stripped, but other plugins' post
			// hooks may have inserted nodes into them (footnotes replaces `[^1]` spans once the
			// definition arrives). Revisit everything; `processed` keeps custom handlers, which
			// may not be idempotent, from running twice on the same node, and `dirty` skips
			// rebuilding subtrees nothing touched.
			// Root-level strings only come from block html (its trailing text); unless html
			// is kept, drop them so a custom `html` handler behaves like the default.
			state.tree.nodes = all(htmlStripped ? state.tree.nodes.filter(node => typeof node !== 'string') : state.tree.nodes)
			if (tomlOpen) {
				// Drop position meta so comark doesn't reuse these nodes and `pre` sees the
				// document start again once the closing `+++` arrives.
				for (const node of state.tree.nodes) {
					if (typeof node !== 'string')
						delete node[1].$
				}
			}
			if (Object.hasOwn(handlers, 'yaml'))
				state.tree.frontmatter = {}
		},
	}
})

/** Push, merging adjacent text nodes. */
function push(nodes: Node[], value: Node): void {
	const previous = nodes.at(-1)
	if (typeof value === 'string' && typeof previous === 'string')
		nodes[nodes.length - 1] = previous + value
	else
		nodes.push(value)
}

function isHtmlComment(token: { type: string, content?: string | null }): boolean {
	return token.type === 'html_inline' && HTML_COMMENT_RE.test(token.content?.trim() || '')
}
