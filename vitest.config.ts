import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		coverage: {
			provider: 'istanbul',
		},
		outputFile: {
			junit: './reports/junit.xml',
		},
		projects: [
			'./src',
		],
	},
})
