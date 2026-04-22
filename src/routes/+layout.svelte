<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import ThemeSelect from '$lib/support/theme/ThemeSelect.svelte';
	import { initThemeStore } from '$lib/support/theme';

	let { children } = $props();

	const nav = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/session/diagnostic', label: 'Diagnostic' },
		{ href: '/session/accuracy-drill', label: 'Accuracy' },
		{ href: '/session/speed-drill', label: 'Speed' },
		{ href: '/session/real-text', label: 'Real text' },
		{ href: '/analytics', label: 'Analytics' },
		{ href: '/settings', label: 'Settings' }
	] as const;

	// The inline script in app.html already applied `data-theme` pre-paint;
	// this mount hydrates the reactive store from the same source and starts
	// listening for OS changes when the user is on "System".
	onMount(() => initThemeStore());
</script>

<div class="flex min-h-screen flex-col">
	<header class="navbar border-b border-base-300 bg-base-100">
		<div class="flex-1">
			<a href={resolve('/')} class="btn text-lg font-semibold btn-ghost">Typing Trainer</a>
		</div>
		<nav class="flex flex-none items-center gap-3">
			<ul class="menu menu-horizontal gap-1 px-1">
				{#each nav as item (item.href)}
					<li>
						<a
							href={resolve(item.href)}
							class:menu-active={page.url.pathname === item.href ||
								(item.href !== '/' && page.url.pathname.startsWith(item.href))}
						>
							{item.label}
						</a>
					</li>
				{/each}
			</ul>
			<!-- Separator between section nav and the appearance control. -->
			<span aria-hidden="true" class="h-5 w-px bg-base-300"></span>
			<ThemeSelect />
		</nav>
	</header>
	<main class="container mx-auto flex-1 p-6">
		{@render children()}
	</main>
</div>
