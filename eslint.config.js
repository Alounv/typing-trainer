import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

// Import-path boundary: imports must go through a lib barrel. Allow:
// - `$lib/<lib>` (barrel, e.g. `$lib/corpus`)
// - `$lib/support/<lib>` (support barrel, e.g. `$lib/support/core`)
// - `.svelte` files anywhere under `$lib/<lib>/...` (components don't re-export through .ts barrels)
// - `$lib/<lib>/components` (component sub-folder)
// - `$lib/assets/**` (static assets)
// Ban deep paths into library internals: `$lib/<lib>/<file>`, `$lib/support/<lib>/<file>`.
const LIB_BOUNDARY_GROUP = [
	'$lib/*/*',
	'$lib/support/*/*',
	'!$lib/support/*',
	'!$lib/*/*.svelte',
	'!$lib/*/components',
	'!$lib/support/*/*.svelte',
	'!$lib/support/*/components',
	'!$lib/assets/**'
];

const LIB_BOUNDARY_MESSAGE =
	"Import from the lib barrel (e.g. '$lib/corpus', '$lib/support/core'), not a deep file path. Svelte components under `components/` and assets under `$lib/assets` are the only exceptions.";

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Skill / agent assets live in-tree for distribution but aren't our source code — don't lint them.
	{ ignores: ['.agents/**', 'skills-lock.json'] },
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			// Allow the "strip via rest" pattern — `const { drop, ...rest } = obj`
			// — and the `_name` convention for intentionally unused bindings.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					ignoreRestSiblings: true
				}
			]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	},
	// Lib-boundary rule. Tests and barrel files (`index.ts`) are exempt.
	{
		files: ['src/**/*.ts', 'src/**/*.svelte'],
		ignores: [
			'src/**/*.test.ts',
			'src/**/*.svelte.test.ts',
			'src/lib/*/index.ts',
			'src/lib/support/*/index.ts'
		],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [{ group: LIB_BOUNDARY_GROUP, message: LIB_BOUNDARY_MESSAGE }]
				}
			]
		}
	},
	// Route `+page.svelte` files stay UI-only: no direct storage, no deep
	// lib paths. Route-local loader `.ts` files are the orchestration
	// layer — they may touch `$lib/support/storage` and compose domain calls,
	// but still go through lib barrels.
	{
		files: ['src/routes/**/*.svelte'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/support/storage', '$lib/support/storage/**'],
							message:
								'UI files must not touch $lib/support/storage directly. Use a route-local loader.ts or a domain public surface.'
						},
						{ group: LIB_BOUNDARY_GROUP, message: LIB_BOUNDARY_MESSAGE }
					]
				}
			]
		}
	},
	{
		rules: {}
	}
);
