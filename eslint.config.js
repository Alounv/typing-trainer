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

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Skill / agent assets live in-tree for distribution but aren't our source
	// code — don't lint them.
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
	// Lib-boundary rules. Imports between libs must go through each lib's
	// `index.ts` barrel; deep paths leak internal layout. Exceptions:
	// `.svelte` components, the `components/` sub-folder, and `assets/`.
	{
		files: ['src/**/*.ts', 'src/**/*.svelte'],
		ignores: ['src/**/*.test.ts', 'src/**/*.svelte.test.ts', 'src/lib/*/index.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/*/*', '!$lib/*/*.svelte', '!$lib/*/components', '!$lib/assets/**'],
							message:
								"Import from the lib barrel (e.g. '$lib/session'), not a deep file path. Svelte component subpaths (`$lib/<lib>/components/Foo.svelte` or `$lib/<lib>/Foo.svelte`) and static assets under `$lib/assets` are the only exceptions."
						}
					]
				}
			]
		}
	},
	// Route `+page.svelte` files stay UI-only: no direct storage, no deep
	// lib paths. Route-local loader `.ts` files are the orchestration
	// layer — they may touch `$lib/storage` and compose domain calls,
	// but still go through lib barrels.
	{
		files: ['src/routes/**/*.svelte'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/storage', '$lib/storage/**'],
							message:
								'UI files must not touch $lib/storage directly. Use a route-local loader.ts or a domain public surface.'
						},
						{
							group: ['$lib/*/*', '!$lib/*/*.svelte', '!$lib/*/components', '!$lib/assets/**'],
							message:
								"Import from the lib barrel (e.g. '$lib/session'), not a deep file path. Svelte component subpaths and static assets under `$lib/assets` are the only exceptions."
						}
					]
				}
			]
		}
	},
	{
		// Override or add rule settings here, such as:
		// 'svelte/button-has-type': 'error'
		rules: {}
	}
);
