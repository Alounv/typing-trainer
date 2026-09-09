## Project Configuration

- **Language**: TypeScript
- **Package Manager**: bun
- **Add-ons**: prettier, eslint, vitest, playwright, tailwindcss, sveltekit-adapter, mcp

## Conventions

- **Default to no comment.** Write one only where the code would otherwise look wrong or arbitrary: a constraint from outside the file (Dexie's structured clone rejects a `$state` proxy; `bind:value` yields `undefined` on an emptied number input, and `Number('')` is `0`), a decision whose alternative looks just as correct (why `hasty` ranks below `fluency`; why `50` is missing from the WPM milestones), or a unit that is not what it looks like (`priorityScore` deliberately breaks the millisecond unit). A self-describing name, a union whose members read plainly, and a list of what a component renders all earn nothing — the last one tracks the markup and rots with it. The trap is the doc comment on an exported function or type, where the urge is to explain the thing the export exists for; that belongs in the commit message. **The test: does the sentence say why this code looks wrong, or only why it exists?** The second is a cut. Write for someone opening the file cold, never as a note about the change in hand — no "used to", no "not yet", no argument against the design being replaced. Say it once and stop.
- **Tests at the library frontier.** Each lib has one test file (`corpus.test.ts`, `skill.test.ts`, …) that goes through the barrel. Reaching one level in is allowed for the domain's core arithmetic, and only with a comment saying why the frontier cannot reach it. No per-file tests for internal helpers.
- **No nested ternaries.** Extract a helper or use `$derived.by` with early returns.
- **Table tests use `it.each`**, not a `for` loop wrapping `it()`.
- **Imports cross libs through the barrel** (`$lib/skill`, not `$lib/skill/debt`). Enforced by `no-restricted-imports`; `.svelte` paths and `$lib/assets/**` are exempt. `session` and `progress` have no barrel — components are their whole public surface.
- **Land on `main`.** Solo repo, no PRs. Hooks live in `.githooks/` (pre-commit checks formatting on staged files, pre-push runs lint + check + unit + knip), so use plain `git` — jj does not run them.

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
