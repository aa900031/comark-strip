import { createMarkdownParser } from 'comark'
import footnotes from 'comark/plugins/footnotes'
import { bench, describe } from 'vitest'
import strip from './index'

// 300 paragraphs streamed in 200-char chunks, with a footnote definition arriving last
// so the footnotes plugin rewrites reused nodes on the final chunk.
const markdown = `${Array.from({ length: 300 }, (_, index) => `Para ${index} with *em*, **strong** and a [^${index % 5}] ref.`).join('\n\n')}\n\n[^1]: World\n`

describe('strip', () => {
	bench('streaming', async () => {
		const parse = createMarkdownParser({ plugins: [footnotes(), strip()] })
		for (let index = 200; index <= markdown.length; index += 200)
			await parse(markdown.slice(0, index), { streaming: true })
		await parse(markdown, { streaming: true })
	})
})
