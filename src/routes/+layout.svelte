<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { children } = $props();

	const nav = [
		{ href: '/', label: 'Dashboard' },
		{ href: '/session/diagnostic', label: 'Diagnostic' },
		{ href: '/session/bigram-drill', label: 'Drill' },
		{ href: '/session/real-text', label: 'Real text' },
		{ href: '/analytics', label: 'Analytics' },
		{ href: '/settings', label: 'Settings' }
	] as const;
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex min-h-screen flex-col">
	<header class="navbar border-b border-base-300 bg-base-100">
		<div class="flex-1">
			<a href={resolve('/')} class="btn text-lg font-semibold btn-ghost">Typing Trainer</a>
		</div>
		<nav class="flex-none">
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
		</nav>
	</header>
	<main class="container mx-auto flex-1 p-6">
		{@render children()}
	</main>
</div>
