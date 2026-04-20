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
	// `index.ts` barrel; deep paths like `$lib/session/delta` leak internal
	// layout and make renames/refactors viral. Exceptions: `.svelte`
	// components (Svelte can't re-export `.svelte` cleanly from a `.ts`
	// barrel), the `components/` sub-folder (4-seg component paths like
	// `$lib/session/components/Foo.svelte`), and anything under `assets/`.
	//
	// Tests are exempt — they unit-test internals and must be allowed to
	// import specific files. Barrel files are also exempt since they exist
	// to re-export internal files. The negation semantics of ESLint's
	// `no-restricted-imports` are *prefix*-based, which is why
	// `!$lib/*/components` (3-seg) un-bans every 4+-seg path under it.
	{
		files: ['src/**/*.{ts,svelte}', 'src/**/*.svelte.ts'],
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
	// Routes are the UI layer — they must not reach past the domain into
	// `storage/` (raw IndexedDB access). Persistence goes through domain
	// modules: `session/persistence` for writes, loaders for reads,
	// `settings/profile` for the profile. This rule enforces the invariant
	// described in ARCHITECTURE.md. Options here *replace* the general
	// lib-boundary rule above for route files (ESLint rule options don't
	// merge across config blocks), so we repeat the deep-path ban.
	{
		files: ['src/routes/**/*.{ts,svelte}'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/storage', '$lib/storage/**'],
							message:
								'Routes must not touch $lib/storage directly. Go through a domain module — loaders for reads, `session/persistence` for writes, `settings/profile` for profile, `settings/data-transfer` for bulk export/import.'
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
