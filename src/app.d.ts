// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

// Vite `?raw` text imports. Ambient declaration so TypeScript knows the
// default export is a string; the actual inlining is handled by Vite at
// build time. Keep this narrow to `.txt?raw` — `.svg?raw`, `.md?raw`,
// etc. stay opt-in so a surprise raw import doesn't sneak past review.
declare module '*.txt?raw' {
	const content: string;
	export default content;
}

export {};
