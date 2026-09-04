import type { MarkdownExitPlugin, Node } from 'comark'
import type { Handler } from './handlers'
import { defineComarkPlugin } from 'comark'
import { children, createHandlers, empty, isElement } from './handlers'

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

	// Block html and comments are dropped at token level: inline comments never
	// become nodes (comark folds them into the surrounding text), and block html
	// may leave trailing text as a separate node. Inline html then only needs `children`.
	const stripHtml = handlers.html === children || handlers.html === empty
	const stripComments = Object.hasOwn(handlers, 'html')
	const processed = new WeakSet<object>()

	function one(node: Node, parentSeen = false): Node | Node[] | undefined {
		const type = typeof node === 'string'
			? 'text'
			: node[0] === null || node[1].$?.html ? 'html' : node[0]
		// Strings can't be tracked by identity; they inherit their parent's state.
		const seen = typeof node === 'string' ? parentSeen : processed.has(node)
		if (seen && !dirty(node))
			return node
		let result: Node | Node[] | null | undefined = node

		const handler = Object.hasOwn(handlers, type) ? handlers[type] : undefined
		if (handler && !seen)
			result = handler(node) || undefined

		if (!result || typeof result === 'string')
			return result || undefined

		if (Array.isArray(result) && !isElement(result))
			return all(result)

		processed.add(result)
		result.splice(2, result.length, ...all(result.slice(2) as Node[], seen))

		// Drop paragraphs emptied by stripping — comark renders them as blank blocks,
		// while strip-markdown's output never shows them.
		if (result[0] === 'p' && result.length === 2)
			return undefined

		return result
	}

	/** Does an already-processed subtree contain a node another plugin inserted since? */
	function dirty(node: Node): boolean {
		if (typeof node === 'string')
			return false
		if (!processed.has(node))
			return true
		for (let index = 2; index < node.length; index++) {
			if (dirty(node[index] as Node))
				return true
		}
		return false
	}

	function all(nodes: Node[], parentSeen = false): Node[] {
		const result: Node[] = []
		for (const node of nodes) {
			const value = one(node, parentSeen)
			if (Array.isArray(value) && !isElement(value))
				result.push(...value)
			else if (value)
				result.push(value)
		}
		return clean(result)
	}

	return {
		name: 'strip',
		markdownItPlugins: [
			((md) => {
				// Link reference definitions produce an empty `component` node in comark; drop them.
				md.core.ruler.push('strip-reference', (state) => {
					state.tokens = state.tokens.filter(token => token.type !== 'reference')
				})
				if (stripComments) {
					md.core.ruler.push('strip-html', (state) => {
						if (stripHtml)
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
			// Skip when `toml` is kept/replaced, and in streaming re-parses, where
			// state.markdown is a mid-document suffix — a `+++` block there is content.
			if (handlers.toml !== empty || state.parsedLines)
				return
			const match = TOML_FRONTMATTER_RE.exec(state.markdown)
			if (match) {
				state.markdown = state.markdown.slice(match[0].length)
				state.parsedLines = match[0].split('\n').length - 1
			}
		},
		post(state) {
			// In streaming mode, reused nodes are already stripped, but other plugins' post
			// hooks may have inserted nodes into them (footnotes replaces `[^1]` spans once the
			// definition arrives). Revisit everything; `processed` keeps custom handlers, which
			// may not be idempotent, from running twice on the same node, and `dirty` skips
			// rebuilding subtrees nothing touched.
			state.tree.nodes.splice(0, state.tree.nodes.length, ...all(state.tree.nodes))
			if (handlers.yaml === empty)
				state.tree.frontmatter = {}
		},
	}
})

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

function isHtmlComment(token: { type: string, content?: string | null }): boolean {
	return token.type === 'html_inline' && HTML_COMMENT_RE.test(token.content?.trim() || '')
}
