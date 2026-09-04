# comark-strip

> [comark](https://comark.dev) plugin to remove markdown formatting. A port of [strip-markdown](https://github.com/remarkjs/strip-markdown).

[![npm version](https://img.shields.io/npm/v/comark-strip?style=flat&colorA=18181B&colorB=F0DB4F)](https://npmjs.com/package/comark-strip)
[![npm downloads](https://img.shields.io/npm/dm/comark-strip?style=flat&colorA=18181B&colorB=F0DB4F)](https://npmjs.com/package/comark-strip)
[![coverage](https://img.shields.io/codecov/c/gh/aa900031/comark-strip?logo=codecov&style=flat&colorA=18181B&colorB=F0DB4F)](https://codecov.io/gh/aa900031/comark-strip)
![coderabbit](https://img.shields.io/coderabbit/prs/github/aa900031/comark-strip?style=flat&logo=coderabbit&logoColor=FF570A&label=CodeRabbit&colorA=18181B&colorB=F0DB4F)

## Features

- Removes `pre`, `hr`, `table`, frontmatter, block HTML, comments and footnotes, including their content
- Renders everything else as simple paragraphs without formatting
- Uses `alt` (or `title`) text for images
- Unknown nodes (e.g. your own components) are kept, but their children are stripped

## Install

```bash
pnpm add comark-strip
# or
npm install comark-strip
# or
yarn add comark-strip
```

## Quick start

```ts
import { parseMarkdown } from 'comark'
import strip from 'comark-strip'
import { renderMarkdown } from 'comark/render'

const doc = await parseMarkdown('Some *emphasis*, **importance**, and `code`.', {
	plugins: [strip()],
})

console.log(await renderMarkdown(doc))
// Some emphasis, importance, and code.
```

## Options

Same as strip-markdown, but keyed by comark tag name instead of mdast node type.
Pseudo tags: raw HTML elements are matched by `html`, plain text by `text`, and
frontmatter by `yaml` / `toml` (frontmatter is never a tree node, so a `remove`
handler for `yaml`/`toml` never fires — `keep` and plain `remove` work).

- `keep` (`string[]`, optional) — tag names to leave unchanged, e.g. `['ul', 'li']`
- `remove` (`Array<string | [string, Handler]>`, optional) — tag names to remove, or replace with a handler

Fenced code is a `pre` with an inner `code`; to keep fences intact use `keep: ['pre', 'code']`.

```ts
strip({
	keep: ['ul', 'li'],
	remove: [
		'cite',
		['abbr', node => String(node[1].title || '') || node.slice(2)],
	],
})
```

A `Handler` receives the node (`[tag, attrs, ...children]`) and returns a node, an array of nodes, or nothing to remove it.

Plugins run in registration order. Register plugins that transform the tree,
such as `footnotes()` and `alert()`, before `strip()`:

```ts
import alert from 'comark/plugins/alert'
import footnotes from 'comark/plugins/footnotes'

const doc = await parseMarkdown(markdown, {
	plugins: [alert(), footnotes(), strip()],
})
```

## Development

```bash
pnpm install
pnpm test       # run unit tests
pnpm typecheck  # verify types
pnpm build      # build dist/
```
