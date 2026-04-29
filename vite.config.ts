import { execSync } from 'node:child_process';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

function resolveCommitHash(): string {
	try {
		const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
		const dirty =
			execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] })
				.toString()
				.trim().length > 0;
		return dirty ? `${hash}-dirty` : hash;
	} catch {
		return 'dev';
	}
}

export default defineConfig({
	define: {
		__COMMIT_HASH__: JSON.stringify(resolveCommitHash())
	},
	plugins: [tailwindcss(), sveltekit()],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
