import { getV8Flags } from '@codspeed/core'
import { isCI } from 'std-env'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		execArgv: isCI ? getV8Flags() : undefined,
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
