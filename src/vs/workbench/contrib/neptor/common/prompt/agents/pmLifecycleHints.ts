/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { MemoryArtifactType } from '../../memory/memoryConstants.js';
import { diagramRequirementsMarkdown } from './sdlcDiagramCatalog.js';

/**
 * Lifecycle prompt for Neptor memory artifacts, tuned for **coding/editor agents**
 * (continuity + repo context over generic product storytelling).
 *
 * Sections are dense facts: bullets, paths, identifiers, small tables—not essays.
 */

export function pmArtifactLifecycleSpec(artifactType: MemoryArtifactType): string {
	const role = lifecycleRole(artifactType);
	const sections = sectionScaffold(artifactType);
	const diagrams = diagramRequirementsMarkdown(artifactType);
	return [
		`Lifecycle role:`,
		role,
		``,
		`Required section scaffold (use these ## headings, in this order):`,
		sections,
		``,
		`Diagram requirements (Mermaid only when listed; use exact diagram types):`,
		diagrams,
	].join('\n');
}

function lifecycleRole(t: MemoryArtifactType): string {
	switch (t) {
		case 'architecture':
			return `Primary **project memory** for the codebase: layouts, frameworks, conventions, env, deploy surfaces, packages/workspaces, and the files everyone touches. Highest priority for Cursor-style continuity. Prefer paths and bullets; no personality.`;
		case 'overview':
			return `Short **session briefing** (~60s read): repo purpose in engineering terms, what is shipped vs experimental, critical constraints, link-outs to deeper artifacts.`;
		case 'tech_stack':
			return `**Stack & dependency truth**: SDKs, package managers, versions where known, cloud/CI, Observability—not marketing. Tables beat prose.`;
		case 'code_style':
			return `**How code is written here**: formatting, naming, TS strictness, patterns (repo / functional / errors), libraries to prefer or avoid, test style—so generations feel native.`;
		case 'tasks':
			return `**Ongoing engineering work**: active feature or bug branch theme, touched files/packages, blocking TODOs, recent decisions and **failed attempts** agents must not redo. Refresh often.`;
		case 'apis':
			return `**Contracts**: internal and external APIs, versioning, timeouts/retries, auth, error envelopes—anything that breaks if guessed wrong.`;
		case 'file_graph':
			return `**Coupling**: which directories/modules/files drive others, import hotspots, brittle edges, “change X → check Y”—reduces breakage in large repos.`;
		case 'fixes':
			return `**Error / fix playbook**: regressions solved, infra footguns, dependency conflicts, edge-runtime issues—minimal narrative, maximum reproducible takeaway.`;
		case 'workflow':
			return `**How the developer works**: package manager commands, scripts, git/branch norms, debugging flow, deploy habits—executable habits, not opinions.`;
		case 'decisions':
			return `**ADRs**: context, decision, rejected options, consequences—prevent silent architecture regressions.`;
		case 'domain':
			return `Domain model bullets the code actually implements—entities, invariants, transitions—not generic product copy.`;
		case 'flows':
			return `Critical **technical sequences** including failure/retry—not UX storyboards unless they map to shipped code paths.`;
		case 'user_journeys':
			return `Operator or end-user journeys that **must remain stable**—states, failure surfaces, instrumentation hooks.`;
		case 'docs_index':
			return `Pointers to authoritative docs (READMEs, runbooks)—summarize gaps; never paste whole external manuals.`;
		case 'roadmap':
			return `Near-term engineering milestones affecting the codebase (not a slide deck).`;
		case 'vision':
			return `Tight strategic frame: bets, measurable outcomes, explicit **non-goals**—keeps agents from scope creep without fluff.`;
	}
}

function sectionScaffold(t: MemoryArtifactType): string {
	const list = (items: string[]): string => items.map((s, i) => `${i + 1}. ## ${s}`).join('\n');
	switch (t) {
		case 'architecture':
			return list(['Purpose & runtime', 'Repo layout map', 'Frameworks & build', 'Coding conventions', 'Important files & packages', 'Env & secrets model', 'Deployment & infra touchpoints']);
		case 'overview':
			return list(['TL;DR for agents', 'What ships vs experimental', 'Key constraints', 'Where to dig deeper']);
		case 'tech_stack':
			return list(['Language & runtime pins', 'Core libraries & frameworks', 'Data stores & caches', 'CI/CD & package managers', 'Infra vendors', 'Open risks']);
		case 'code_style':
			return list(['Formatting & naming', 'TypeScript / typing rules', 'Error handling conventions', 'Testing expectations', 'Component / module patterns', 'Libraries encouraged & banned']);
		case 'tasks':
			return list(['Current focus', 'Files & packages touched', 'Open TODOs', 'Recent decisions', 'Approaches tried and rejected']);
		case 'apis':
			return list(['Surface overview', 'Auth & transport', 'Endpoints or modules', 'Errors, retries & idempotency', 'Compatibility notes']);
		case 'file_graph':
			return list(['Hotspots & layers', 'Import / dependency bullets', 'Service coupling', 'Breaking-change checklist', 'Gaps']);
		case 'fixes':
			return list(['Regressions ledger', 'Infra / deploy scars', 'Dependency conflicts solved', 'Edge cases']);
		case 'workflow':
			return list(['Daily commands', 'Git & branch strategy', 'Debug workflow', 'Release / rollout habits']);
		case 'decisions':
			return list(['Active ADRs', 'Superseded calls', 'Pending forks']);
		case 'domain':
			return list(['Bounded contexts', 'Core entities', 'Invariants & lifecycles', 'Glossary']);
		case 'flows':
			return list(['Flow catalog', 'Primary sequence', 'Failure & retry paths', 'Ops notes']);
		case 'user_journeys':
			return list(['Journeys that matter to code', 'States & checkpoints', 'Failure UX tied to telemetry']);
		case 'docs_index':
			return list(['Authoritative docs', 'Ownership & freshness', 'Missing coverage']);
		case 'roadmap':
			return list(['Now', 'Next', 'Later', 'Dependencies', 'Delivery risks']);
		case 'vision':
			return list(['North star metric', 'Bets', 'Non-goals', 'Signals']);
	}
}
