/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** Current manifest + artifact frontmatter schema written by Neptor */
export const NEPTOR_MEMORY_SCHEMA_VERSION = 2;

/** Legacy manifests / artifacts may still carry this value until rebuilt */
export const NEPTOR_MEMORY_SCHEMA_VERSION_V1 = 1;

export const NEPTOR_MEMORY_DIR = '.neptor/memory';
export const NEPTOR_MEMORY_MANIFEST = 'index.json';

/** Sidecar JSON: bootstrap lifecycle + checklist (paired with index.json). */
export const NEPTOR_MEMORY_STATUS_FILE = 'workspace_memory_status.json';
export const NEPTOR_MEMORY_STATUS_SCHEMA = 1;

/** Rough char budget (~50k tokens at 4 chars per token) */
export const MAX_MEMORY_CORPUS_CHARS = 200_000;

export const MAX_MEMORY_ARTIFACT_FILE_CHARS = 80_000;

export const MAX_MEMORY_MANIFEST_JSON_CHARS = 256_000;

/** Injected into PM system prompt */
export const MAX_MEMORY_RETRIEVAL_CONTEXT_CHARS = 24_000;

export const MAX_MEMORY_ARTIFACTS_PER_ROOT = 48;

export type MemoryArtifactType =
	| 'overview'
	| 'vision'
	| 'architecture'
	| 'domain'
	| 'apis'
	| 'tech_stack'
	| 'flows'
	| 'user_journeys'
	| 'docs_index'
	| 'roadmap'
	| 'decisions'
	| 'code_style'
	| 'tasks'
	| 'file_graph'
	| 'fixes'
	| 'workflow';

/**
 * Highest-signal artifact types first (coding-agent continuity): project shape, style,
 * active work, stack, APIs, coupling graph, regressions, habits, decisions, snapshots.
 */
export const MEMORY_ARTIFACT_TYPES: MemoryArtifactType[] = [
	'architecture',
	'overview',
	'tech_stack',
	'code_style',
	'tasks',
	'apis',
	'file_graph',
	'fixes',
	'workflow',
	'decisions',
	'domain',
	'flows',
	'vision',
	'roadmap',
	'user_journeys',
	'docs_index',
];

export const MEMORY_ARTIFACT_FILE_NAMES: Record<MemoryArtifactType, string> = {
	overview: 'overview.md',
	vision: 'vision.md',
	architecture: 'architecture.md',
	domain: 'domain.md',
	apis: 'apis.md',
	tech_stack: 'tech_stack.md',
	flows: 'flows.md',
	user_journeys: 'user_journeys.md',
	docs_index: 'docs_index.md',
	roadmap: 'roadmap.md',
	decisions: 'decisions.md',
	code_style: 'code_style.md',
	tasks: 'tasks.md',
	file_graph: 'file_graph.md',
	fixes: 'fixes.md',
	workflow: 'workflow.md',
};

/** UI labels (coding-agent oriented) */
export const MEMORY_ARTIFACT_LABEL: Record<MemoryArtifactType, string> = {
	overview: 'Project snapshot',
	vision: 'Goals & bets',
	architecture: 'Project memory',
	domain: 'Domain model',
	apis: 'APIs & services',
	tech_stack: 'Stack & deps',
	flows: 'Flows & sequences',
	user_journeys: 'Usage paths',
	docs_index: 'Docs map',
	roadmap: 'Roadmap',
	decisions: 'ADRs',
	code_style: 'Code style',
	tasks: 'Task memory',
	file_graph: 'File graph',
	fixes: 'Errors & fixes',
	workflow: 'Dev workflow',
};

/** One-line hint for humans + LLMs: what to capture (summaries, not raw logs). */
export const MEMORY_ARTIFACT_STORES: Record<MemoryArtifactType, string> = {
	architecture: 'Repo layout, frameworks, conventions, env, deploy, important entrypoints—persistent codebase understanding.',
	overview: '60-second snapshot so the agent rejoins sessions with continuity (product + engineering focus).',
	tech_stack: 'SDKs, package managers, CI/CD, infra, DB—dependency and platform truth.',
	code_style: 'Indentation, naming, TS strictness, libraries, errors, testing, component patterns—generated code stays native.',
	tasks: 'Active feature or bug, files touched, TODOs, recent decisions, failed approaches—cross-session engineering state.',
	apis: 'Service boundaries, contracts, versioning, retries—things that must not regress.',
	file_graph: 'Which files/services affect others, imports, brittle edges—helps avoid breaking changes.',
	fixes: 'Past bugs, working fixes, deploy issues, dep conflicts—highest ROI “do not repeat” memory.',
	workflow: 'Commands, git flow, branching, debugging habits—how this developer prefers to operate.',
	decisions: 'Why choices were made (ADR-style)—prevents accidental architecture regressions.',
	domain: 'Entities, invariants, lifecycle—ubiquitous language for the codebase.',
	flows: 'Critical sequences including failure/retry—not marketing journeys only.',
	user_journeys: 'Important user-visible paths tied to shipped behavior.',
	docs_index: 'Where authoritative docs live; avoid duplicating them—link and summarize.',
	roadmap: 'Engineering-facing milestones when relevant to code direction.',
	vision: 'Goals, constraints, explicit non-goals—light strategy for agents, not personality fluff.',
};

/** Short conversational line for PM briefing hero (dashboard tone, not doc manual). */
export const MEMORY_ARTIFACT_BRIEFING_TAGLINE: Record<MemoryArtifactType, string> = {
	architecture: 'How the codebase is shaped, what stacks it, where to look first.',
	overview: 'A fast briefing so you rejoin this project without rereading everything.',
	tech_stack: 'What runs here: packages, platforms, infra, CI.',
	code_style: 'How code should feel when you or an agent edits it.',
	tasks: 'What you are actively building or fixing right now.',
	apis: 'Surfaces others depend on—contracts worth not breaking.',
	file_graph: 'What touches what—so changes stay safe.',
	fixes: 'What broke before and how it got fixed.',
	workflow: 'How you typically run commands, branches, and debug.',
	decisions: 'Why the team chose this path—not just what shipped.',
	domain: 'Language and rules the code assumes about the world.',
	flows: 'Important sequences—including what happens when things fail.',
	user_journeys: 'User-visible flows that implementations must honour.',
	docs_index: 'Where the real manuals live—we link instead of cloning.',
	roadmap: 'What is next from an engineering standpoint.',
	vision: 'Bets and boundaries that steer tradeoffs.',
};

/** Comma-separated list for tool descriptions and consolidation prompts (stays in sync with types). */
export const MEMORY_ARTIFACT_TYPES_CSV = MEMORY_ARTIFACT_TYPES.join(', ');

export type MemoryWorkspaceProfile = 'new' | 'existing';

/** Dispatched by PM canvas to switch editor surface tab via MEMORY_ARTIFACT_LABEL. */
export const PM_JUMP_MEMORY_TAB_EVENT = 'neptor-pm-jump-memory-tab';

/** Ask ProductMemoryView to refresh from disk. */
export const PM_REQUEST_REFRESH_EVENT = 'neptor-pm-request-refresh';
