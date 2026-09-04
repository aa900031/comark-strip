import type { Node } from 'comark'
import type { Handler, Options } from './index'
import { createMarkdownParser, parseMarkdown } from 'comark'
import footnotes from 'comark/plugins/footnotes'
import { renderMarkdown } from 'comark/render'
import { describe, expect, it } from 'vitest'
import strip from './index'

describe('strip', () => {
	it('should expose the public api', async () => {
		expect(Object.keys(await import('./index')).sort()).toEqual(['default'])
	})

	it('should keep unknown nodes', () => {
		const tree = {
			nodes: [['x', {}, ['strong', {}, 'value', ['y', {}, 'with value']]]],
			frontmatter: {},
			meta: {},
		}
		strip().post!({
			// @ts-expect-error -- partial state
			tree,
			markdown: '',
			options: {},
			tokens: [],
		})
		expect(tree.nodes).toEqual([['x', {}, 'value', ['y', {}, 'with value']]])
	})

	it('should support text', async () => {
		expect(await process('Alfred')).toBe('Alfred')
	})

	it('should support emphasis (1)', async () => {
		expect(await process('*Alfred*')).toBe('Alfred')
	})

	it('should support emphasis (2)', async () => {
		expect(await process('_Alfred_')).toBe('Alfred')
	})

	it('should support strong (1)', async () => {
		expect(await process('**Alfred**')).toBe('Alfred')
	})

	it('should support strong (2)', async () => {
		expect(await process('__Alfred__')).toBe('Alfred')
	})

	it('should support strikethrough', async () => {
		expect(await process('~~Alfred~~')).toBe('Alfred')
	})

	it('should support inline code', async () => {
		expect(await process('`Alfred`')).toBe('Alfred')
	})

	it('should support a resource link', async () => {
		expect(await process('[Hello](world)')).toBe('Hello')
	})

	it('should support strong in a link', async () => {
		expect(await process('[**H**ello](world)')).toBe('Hello')
	})

	it('should support a reference/definition', async () => {
		expect(await process('[Hello][id]\n\n[id]: http://example.com "optional title"')).toBe('Hello')
	})

	it('should support a paragraph', async () => {
		expect(await process('Hello.\n\nWorld.')).toBe('Hello.\n\nWorld.')
	})

	it('should remove YAML frontmatter', async () => {
		expect(await process('---\ntitle: Hello\n---\n\nHello')).toBe('Hello')
	})

	it('should remove TOML frontmatter', async () => {
		expect(await process('+++\ntitle = "Hello"\n+++\n\nHello')).toBe('Hello')
	})

	it('should support a heading (atx)', async () => {
		expect(await process('## Alfred')).toBe('Alfred')
	})

	it('should support heading (setext)', async () => {
		expect(await process('Alfred\n=====')).toBe('Alfred')
	})

	it('should support a list item', async () => {
		expect(await process('- Hello\n    * World\n        + !')).toBe('Hello\n\nWorld\n\n!')
	})

	it('should support a list', async () => {
		expect(await process('- Hello\n\n- World\n\n- !')).toBe('Hello\n\nWorld\n\n!')
	})

	it('should support a list item (empty)', async () => {
		expect(await process('- Hello\n- \n- World!')).toBe('Hello\n\nWorld!')
	})

	it('should support a block quote', async () => {
		expect(await process('> Hello\n> World\n> !')).toBe('Hello\nWorld\n!')
	})

	it('should support an image', async () => {
		expect(await process('![An image](image.png "test")')).toBe('An image')
	})

	it('should support an image (no alt)', async () => {
		expect(await process('![](image.png "test")')).toBe('test')
	})

	it('should support an image (no alt, no title)', async () => {
		expect(await process('![](image.png)')).toBe('')
	})

	it('should support an image reference, definition', async () => {
		expect(await process('![An image][id]\n\n[id]: http://example.com/a.jpg')).toBe('An image')
	})

	it('should support a thematic break', async () => {
		expect(await process('---')).toBe('')
	})

	it('should support a hard break', async () => {
		expect(await process('A  \nB')).toBe('A\nB')
	})

	it('should support a soft break', async () => {
		expect(await process('A\nB')).toBe('A\nB')
	})

	it('should support a table', async () => {
		expect(await process('| A | B |\n| - | - |\n| C | D |')).toBe('')
	})

	it('should remove task list checkboxes', async () => {
		expect(await process('- [ ] todo\n- [x] done')).toBe('todo\n\ndone')
	})

	it('should remove task list checkboxes from items with block content', async () => {
		expect(await process('- [ ] todo\n\n  more\n- [x] done')).toBe('todo\n\nmore\n\ndone')
	})

	it('should support code (indented)', async () => {
		expect(await process('\talert("hello");')).toBe('')
	})

	it('should support code (fenced)', async () => {
		expect(await process('```js\nconsole.log("world");\n```')).toBe('')
	})

	it('should support html (text)', async () => {
		expect(await process('<sup>Hello</sup>')).toBe('Hello')
	})

	it('should support html (flow)', async () => {
		expect(await process('<script>alert("world");</script>')).toBe('')
	})

	it('should support html (comment)', async () => {
		expect(await process('<!-- Hello -->')).toBe('')
	})

	it('should remove inline html comments', async () => {
		expect(await process('before <!-- hidden --> after')).toBe('before  after')
	})

	it('should remove trailing text from block html', async () => {
		expect(await process('<div>inside</div>tail')).toBe('')
	})

	it('should support html in an image', async () => {
		expect(await process('[<img src="http://example.com/a.jpg" />](http://example.com)')).toBe('')
	})

	it('should support a footnote', async () => {
		expect(await process('Hello[^1]\n\n[^1]: World')).toBe('Hello')
	})

	it('should support `options.keep` (empty)', async () => {
		expect(await process('- **Hello**\n\n- World!', { keep: [] })).toBe('Hello\n\nWorld!')
	})

	it('should support keeping lists', async () => {
		expect(await process('- **Hello**\n\n- World!', { keep: ['ul', 'li'] })).toBe('- Hello\n- World!')
	})

	it('should keep task list checkboxes when keeping lists', async () => {
		expect(await process('- [ ] todo\n- [x] done', { keep: ['ul', 'li'] })).toBe('- [ ] todo\n- [x] done')
	})

	it('should throw for unknown nodes in `keep` w/o handlers', async () => {
		await expect(process('- **Hello**\n\n- World!', { keep: ['typo'] }))
			.rejects
			.toThrow(/Unknown node type `typo` in `keep`, use a replace tuple with a handle instead: `remove: \[\['typo', handle\]\]`/)
	})

	it('should support `options.remove`', async () => {
		expect(await process('I read this :cite[smith04]!', { remove: ['cite'] })).toBe('I read this !')
	})

	it('should not leave empty paragraphs behind', async () => {
		expect(await process('a\n\n> <!-- c -->\n\nb')).toBe('a\n\nb')
	})

	it('should strip paragraph attributes', async () => {
		expect(await process('Hello world {#foo .red}')).toBe('Hello world')
	})

	it('should treat `remove: [\'html\']` like the default', async () => {
		// In strip-markdown, remove: ['html'] equals the default: inline text survives.
		expect(await process('a <sup>Hello</sup> b', { remove: ['html'] })).toBe('a Hello b')
	})

	it('should remove inline comments with a custom `html` handler', async () => {
		expect(await process('before <!-- hidden --> after', { remove: [['html', () => undefined]] })).toBe('before  after')
	})

	it('should support `text` handlers', async () => {
		expect(await process('Alfred', { remove: [['text', () => 'Batman']] })).toBe('Batman')
	})

	it('should ignore non-function handlers', async () => {
		// strip-markdown skips falsy handlers instead of crashing.
		// @ts-expect-error -- falsy handler
		expect(await process('*x*', { remove: [['em', undefined]] })).toBe('*x*')
	})

	it('should support keeping YAML frontmatter', async () => {
		expect(await process('---\ntitle: Hello\n---\n\nHello', { keep: ['yaml'] })).toContain('title: Hello')
	})

	it('should support keeping TOML frontmatter', async () => {
		expect(await process('+++\ntitle = "Hello"\n+++\n\nHello', { keep: ['toml'] })).toContain('title = "Hello"')
	})

	it('should remove TOML frontmatter with trailing whitespace on fences', async () => {
		expect(await process('+++ \ntitle = "Hello"\n+++ \n\nHello')).toBe('Hello')
	})

	it('should keep user nodes with footnote-like classes', async () => {
		expect(await process('a :sup[1]{class="footnote-x"} b')).toContain('1')
	})

	it('should not strip TOML-looking blocks mid-document when streaming', async () => {
		const parse = createMarkdownParser({ plugins: [strip()] })
		const doc1 = await parse('para\n\n+++\nnot frontmatter\n+++', { streaming: true })
		expect(JSON.stringify(doc1.nodes)).toContain('not frontmatter')
		const doc2 = await parse('para\n\n+++\nnot frontmatter\n+++\n\nappended', { streaming: true })
		expect(JSON.stringify(doc2.nodes)).toContain('not frontmatter')
	})

	it('should apply custom handlers once per node when streaming', async () => {
		const parse = createMarkdownParser({
			plugins: [strip({ remove: [['em', (node) => {
				node[2] = `X${node[2]}`
				return node
			}]] })],
		})
		const full = 'aaa *bbb*\n\nccc *ddd*\n\neee *fff*\n'
		let doc
		for (let index = 8; index <= full.length; index += 8)
			doc = await parse(full.slice(0, index), { streaming: true })
		doc = await parse(full, { streaming: true })
		expect(JSON.stringify(doc!.nodes)).not.toContain('XX')
	})

	it('should support callbacks in `remove`', async () => {
		const handler: Handler = node => (node[0] === 'abbr' && String(node[1].title || '')) || node.slice(2) as Node[]
		expect(await process(
			'A :i[lovely] language known as :abbr[HTML]{title="HyperText Markup Language"}.',
			{
				remove: [
					['i', handler],
					['abbr', handler],
				],
			},
		)).toBe('A lovely language known as HyperText Markup Language.')
	})
})

async function process(value: string, options?: Options): Promise<string> {
	const doc = await parseMarkdown(value, { plugins: [footnotes(), strip(options)] })
	return renderMarkdown(doc)
}
