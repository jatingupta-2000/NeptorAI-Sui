/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import {
	MAX_MEMORY_ARTIFACT_FILE_CHARS,
	MAX_MEMORY_ARTIFACTS_PER_ROOT,
	MAX_MEMORY_CORPUS_CHARS,
	MAX_MEMORY_MANIFEST_JSON_CHARS,
	MAX_MEMORY_RETRIEVAL_CONTEXT_CHARS,
	MEMORY_ARTIFACT_FILE_NAMES,
	MEMORY_ARTIFACT_TYPES,
	MemoryArtifactType,
	MemoryWorkspaceProfile,
	NEPTOR_MEMORY_DIR,
	NEPTOR_MEMORY_MANIFEST,
	NEPTOR_MEMORY_SCHEMA_VERSION,
	NEPTOR_MEMORY_STATUS_FILE,
	NEPTOR_MEMORY_STATUS_SCHEMA,
} from '../common/memory/memoryConstants.js';
import { MemoryManifest, MemoryManifestArtifactRef, parseAndValidateMemoryManifestJson } from '../common/memory/memoryManifest.js';
import {
	buildStatusSyncedFromManifest,
	createInitialGeneratingStatus,
	emptyGenerationState,
	MAX_MEMORY_STATUS_JSON_CHARS,
	manifestIndicatesBootstrapComplete,
	parseWorkspaceMemoryStatusJson,
	stringifyWorkspaceMemoryStatus,
	type WorkspaceMemoryStatusFile,
} from '../common/memory/workspaceMemoryStatus.js';
import { parseTaggedMemoryDocument, ParsedMemorySection } from '../common/memory/parseMemoryMarkdown.js';
import { splitMarkdownForPatch } from '../common/memory/memoryPatchApply.js';
import {
	INeptorProjectMemoryService,
	PmMemoryArtifactView,
	PmMemoryBootstrapStatus,
	PmMemoryOverview,
	PmMemoryRootView,
	PmMemorySearchHit,
} from '../common/neptorProjectMemoryService.js';
import { readFile as readFileLimited } from '../common/prompt/prompts.js';

function djb2Fingerprint(text: string): string {
	let hash = 5381;
	for (let i = 0; i < text.length; i += 1) {
		hash = ((hash << 5) + hash) + text.charCodeAt(i);
		hash = hash >>> 0;
	}
	return hash.toString(16);
}

function defaultSectionTags(type: MemoryArtifactType): string[] {
	switch (type) {
		case 'overview':
			return ['summary', 'scope', 'status'];
		case 'vision':
			return ['bets', 'non-goals', 'signals'];
		case 'architecture':
			return ['layout', 'runtime', 'conventions'];
		case 'tech_stack':
			return ['languages', 'packages', 'platform'];
		case 'code_style':
			return ['format', 'patterns', 'testing'];
		case 'tasks':
			return ['focus', 'files', 'todos'];
		case 'apis':
			return ['surface', 'contracts', 'errors'];
		case 'file_graph':
			return ['layers', 'coupling', 'checklist'];
		case 'fixes':
			return ['bugs', 'infra', 'deps'];
		case 'workflow':
			return ['commands', 'git', 'debug'];
		case 'domain':
			return ['entities', 'rules', 'glossary'];
		case 'flows':
			return ['sequences', 'failures', 'ops'];
		case 'user_journeys':
			return ['paths', 'failure', 'telemetry'];
		case 'docs_index':
			return ['sources', 'gaps'];
		case 'roadmap':
			return ['now', 'next', 'risks'];
		case 'decisions':
			return ['adr', 'superseded', 'pending'];
	}
}

function artifactTitle(type: MemoryArtifactType): string {
	switch (type) {
		case 'overview':
			return 'Project snapshot';
		case 'vision':
			return 'Goals & bets';
		case 'architecture':
			return 'Project memory';
		case 'domain':
			return 'Domain model';
		case 'apis':
			return 'APIs & services';
		case 'tech_stack':
			return 'Stack & deps';
		case 'flows':
			return 'Flows & sequences';
		case 'user_journeys':
			return 'Usage paths';
		case 'docs_index':
			return 'Docs map';
		case 'roadmap':
			return 'Roadmap';
		case 'decisions':
			return 'ADRs';
		case 'code_style':
			return 'Code style';
		case 'tasks':
			return 'Task memory';
		case 'file_graph':
			return 'File graph';
		case 'fixes':
			return 'Errors & fixes';
		case 'workflow':
			return 'Dev workflow';
	}
}

function inferTypeFromFileName(fileName: string): MemoryArtifactType | null {
	const n = fileName.toLowerCase();
	if (!n.endsWith('.md')) {
		return null;
	}
	for (const t of MEMORY_ARTIFACT_TYPES) {
		if (MEMORY_ARTIFACT_FILE_NAMES[t] === n) {
			return t;
		}
	}
	// common aliases we should accept from user-managed memory folders
	if (n === 'user_journey.md') {
		return 'user_journeys';
	}
	if (n === 'api.md') {
		return 'apis';
	}
	if (n === 'flow.md') {
		return 'flows';
	}
	if (n === 'techstack.md' || n === 'tech-stack.md') {
		return 'tech_stack';
	}
	const stem = n.replace(/\.md$/, '');
	if (stem.includes('overview')) {
		return 'overview';
	}
	if (stem.includes('vision')) {
		return 'vision';
	}
	if (stem.includes('arch')) {
		return 'architecture';
	}
	if (stem.includes('domain')) {
		return 'domain';
	}
	if (stem.includes('api')) {
		return 'apis';
	}
	if (stem.includes('tech')) {
		return 'tech_stack';
	}
	if (stem.includes('flow')) {
		return 'flows';
	}
	if (stem.includes('journey') || stem.includes('user')) {
		return 'user_journeys';
	}
	if (stem.includes('index') || stem.includes('doc')) {
		return 'docs_index';
	}
	if (stem.includes('road')) {
		return 'roadmap';
	}
	if (stem.includes('decision') || stem.includes('adr')) {
		return 'decisions';
	}
	if (stem.includes('code_style') || stem === 'style' || stem.includes('codestyle')) {
		return 'code_style';
	}
	if (stem.includes('task')) {
		return 'tasks';
	}
	if (stem.includes('file_graph') || stem.includes('filegraph') || stem === 'graph') {
		return 'file_graph';
	}
	if (stem.includes('fix') || stem.includes('regression') || stem.includes('incident')) {
		return 'fixes';
	}
	if (stem.includes('workflow') || stem.includes('devflow')) {
		return 'workflow';
	}
	return 'overview';
}

function parseSectionsForUi(md: string): ParsedMemorySection[] {
	const split = splitMarkdownForPatch(md);
	if (split.sections.length > 0) {
		return split.sections;
	}

	const tagged = parseTaggedMemoryDocument(md);
	if (tagged.sections.length > 0) {
		return tagged.sections;
	}

	const lines = md.split('\n');
	const firstHeading = lines.find(line => /^#\s+/.test(line));
	const title = firstHeading ? firstHeading.replace(/^#\s+/, '').trim() : 'Document';
	const body = md.trim();
	if (!body) {
		return [];
	}
	return [{ id: 'document', title, tags: [], body }];
}

function overviewBlurb(type: MemoryArtifactType, folderFsPath: string, fingerprint: string): string {
	switch (type) {
		case 'overview':
			return `Fast agent briefing for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`. Summarize facts, not tone.`;
		case 'vision':
			return `Explicit goals, bets, and non-goals for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'architecture':
			return `Core **project memory** for \`${folderFsPath}\`: layout, frameworks, conventions, deploy. Fingerprint \`${fingerprint}\`.`;
		case 'domain':
			return `Domain entities and invariants implied by \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'apis':
			return `API and service contract notes for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'tech_stack':
			return `Dependency and platform truth for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'flows':
			return `Technical sequences (happy + failure) for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'user_journeys':
			return `User-visible paths that code must preserve for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'docs_index':
			return `Authoritative doc pointers for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'roadmap':
			return `Engineering-facing milestones for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'decisions':
			return `ADR-style decision seed for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'code_style':
			return `Style and pattern expectations for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'tasks':
			return `Active engineering task continuity for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'file_graph':
			return `File/service coupling notes for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'fixes':
			return `Known breakages and proven fixes for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
		case 'workflow':
			return `Commands, git flow, and debug habits for \`${folderFsPath}\`. Fingerprint \`${fingerprint}\`.`;
	}
}

function boundariesNotes(type: MemoryArtifactType): string {
	switch (type) {
		case 'overview':
			return 'Keep under ~400 words; link to architecture/tasks for depth.';
		case 'vision':
			return 'State measurable outcomes and explicit non-goals.';
		case 'architecture':
			return 'Add concrete paths and package names as you learn them; avoid marketing language.';
		case 'domain':
			return 'Use the same nouns as the codebase (types, modules, DB tables).';
		case 'apis':
			return 'Record auth modes, breaking changes, and retry semantics when known.';
		case 'tech_stack':
			return 'Pin versions when they matter for reproducibility.';
		case 'flows':
			return 'Each flow: trigger, steps, failure, observability hook.';
		case 'user_journeys':
			return 'Tie each journey to routes, flags, or modules.';
		case 'docs_index':
			return 'Prefer links + one-line purpose; do not snapshot whole docs.';
		case 'roadmap':
			return 'Use engineering milestones, not slide-deck themes.';
		case 'decisions':
			return 'Each ADR: context, decision, alternatives, consequences.';
		case 'code_style':
			return 'Be prescriptive: defaults, anti-patterns, examples in backticks.';
		case 'tasks':
			return 'Refresh after each meaningful session; capture dead ends.';
		case 'file_graph':
			return 'Write “if you change X, verify Y” bullets from real incidents.';
		case 'fixes':
			return 'One entry per issue: symptom, root cause, fix, prevention.';
		case 'workflow':
			return 'Copy-pasteable commands only; no generic advice.';
	}
}

function buildArtifactMarkdown(opts: {
	type: MemoryArtifactType;
	folderFsPath: string;
	treeSample: string;
	fingerprint: string;
	iso: string;
}): string {
	const tags = defaultSectionTags(opts.type).join(', ');
	const id = opts.type;
	return `---
neptor_memory_schema: ${NEPTOR_MEMORY_SCHEMA_VERSION}
artifact_type: ${opts.type}
artifact_id: ${id}
title: ${artifactTitle(opts.type)}
updated_iso: ${opts.iso}
source_fingerprint: ${opts.fingerprint}
chars_approx: 0
section_tags: ${tags}
---

# ${artifactTitle(opts.type)}

## Overview
<!-- neptor:tags overview -->
${overviewBlurb(opts.type, opts.folderFsPath, opts.fingerprint)}

## Repository layout
<!-- neptor:tags layout, tree -->
\`\`\`text
${opts.treeSample}
\`\`\`

## Depth notes
<!-- neptor:tags depth -->
${boundariesNotes(opts.type)}

`;
}

function flowsExtraBlurb(): string {
	return `

## Primary flow (Mermaid)
<!-- neptor:tags diagrams -->
\`\`\`mermaid
flowchart LR
  A[Start] --> B[Neptor PM memory]
  B --> C[Update artifacts]
\`\`\`
`;
}

function retrievalBoostForArtifact(type: MemoryArtifactType, hint: string): number {
	const defaultOrder: MemoryArtifactType[] = [
		'architecture', 'tasks', 'fixes', 'tech_stack', 'code_style', 'file_graph', 'apis', 'overview',
		'decisions', 'workflow', 'domain', 'flows', 'vision', 'roadmap', 'user_journeys', 'docs_index',
	];
	if (!hint) {
		const idx = defaultOrder.indexOf(type);
		return 32 - (idx >= 0 ? idx : defaultOrder.length);
	}
	let score = 0;
	const table: Array<[MemoryArtifactType, RegExp, number]> = [
		['architecture', /architecture|layout|module|monorepo|workspace|structure|folder/i, 14],
		['tasks', /task|todo|wip|branch|feature|bug|sprint|epic/i, 14],
		['fixes', /bug|fix|regression|incident|broken|error|rollback/i, 14],
		['code_style', /style|lint|format|prettier|eslint|convention|pattern/i, 12],
		['file_graph', /import|depend|coupling|graph|refactor|break/i, 12],
		['tech_stack', /stack|framework|npm|yarn|pnpm|docker|k8s|terraform|ci/i, 12],
		['apis', /api|endpoint|rest|graphql|webhook|http|sdk|contract/i, 12],
		['workflow', /git|commit|branch|command|script|debug|deploy habit/i, 11],
		['decisions', /decision|adr|rationale|tradeoff|principle/i, 12],
		['domain', /domain|entity|glossary|invariant/i, 10],
		['flows', /flow|sequence|state machine|retry/i, 11],
		['user_journeys', /user|journey|ux|persona/i, 9],
		['docs_index', /doc|readme|runbook|wiki/i, 9],
		['vision', /vision|goal|strategy|bet/i, 9],
		['overview', /overview|summary|snapshot/i, 10],
		['roadmap', /roadmap|milestone|release|plan/i, 10],
	];
	for (const [t, re, w] of table) {
		if (t === type && re.test(hint)) {
			score += w;
		}
	}
	const idx2 = defaultOrder.indexOf(type);
	score += (20 - (idx2 >= 0 ? idx2 : defaultOrder.length)) / 10;
	return score;
}

function selectSectionsForHint(sections: ParsedMemorySection[], hint: string | undefined): ParsedMemorySection[] {
	if (sections.length === 0) {
		return [];
	}
	const h = (hint ?? '').toLowerCase();
	if (!h) {
		return sections.slice(0, 2);
	}
	const scored = sections.map((s, idx) => {
		let score = 0;
		const blob = `${s.title} ${s.tags.join(' ')} ${s.body}`.toLowerCase();
		for (const word of h.split(/\s+/)) {
			if (word.length < 3) {
				continue;
			}
			if (blob.includes(word)) {
				score += 2;
			}
		}
		return { s, idx, score };
	});
	scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
	const top = scored.filter(x => x.score > 0).slice(0, 3).map(x => x.s);
	if (top.length > 0) {
		return top;
	}
	return sections.slice(0, 2);
}

function escapeXml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function manifestRollupHash(artifacts: MemoryManifestArtifactRef[]): string {
	const joined = artifacts.map(a => `${a.id}:${a.sourceFingerprint}`).sort().join('|');
	return djb2Fingerprint(joined).slice(0, 16);
}

export class NeptorProjectMemoryService extends Disposable implements INeptorProjectMemoryService {
	_serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IDirectoryStrService private readonly directoryStrService: IDirectoryStrService,
	) {
		super();
	}

	private async ensureDirectory(uri: URI): Promise<void> {
		if (await this.fileService.exists(uri)) {
			return;
		}
		const parent = dirname(uri);
		if (parent.toString() !== uri.toString()) {
			await this.ensureDirectory(parent);
		}
		if (!(await this.fileService.exists(uri))) {
			await this.fileService.createFolder(uri);
		}
	}

	async refreshMemoryManifestForFolder(folderUri: URI, opts?: { bootstrapCompletedAtIso?: string; workspaceProfile?: MemoryWorkspaceProfile; lastConsolidationAtIso?: string }): Promise<MemoryManifest | null> {
		const folderFsPath = folderUri.fsPath;
		const memRoot = URI.joinPath(folderUri, ...NEPTOR_MEMORY_DIR.split('/'));
		if (!(await this.fileService.exists(memRoot))) {
			return null;
		}
		const stat = await this.fileService.resolve(memRoot, { resolveMetadata: true });
		if (!stat.children) {
			return null;
		}
		const mdFiles = stat.children.filter(c => !c.isDirectory && c.name.endsWith('.md') && c.name !== 'README.md').slice(0, MAX_MEMORY_ARTIFACTS_PER_ROOT);
		const iso = new Date().toISOString();
		const artifacts: MemoryManifestArtifactRef[] = [];
		for (const child of mdFiles) {
			if (!child.resource) {
				continue;
			}
			const bodyRead = await readFileLimited(this.fileService, child.resource, MAX_MEMORY_ARTIFACT_FILE_CHARS);
			if (!bodyRead.val) {
				continue;
			}
			const md = bodyRead.val;
			const { attrs, sections } = parseTaggedMemoryDocument(md);
			const typeRaw = attrs.artifact_type;
			const inferred = inferTypeFromFileName(child.name);
			const resolvedType = (typeRaw && MEMORY_ARTIFACT_TYPES.includes(typeRaw as MemoryArtifactType))
				? (typeRaw as MemoryArtifactType)
				: inferred;
			if (!resolvedType) {
				continue;
			}
			const type = resolvedType;
			const id = attrs.artifact_id || type;
			const title = attrs.title || artifactTitle(type);
			const fp = attrs.source_fingerprint || djb2Fingerprint(md.slice(0, 80_000));
			const sectionTags = sections.flatMap(s => s.tags);
			const uniqTags = [...new Set(sectionTags)];
			const sectionTitles = sections.map(s => s.title);
			artifacts.push({
				id,
				type,
				relPath: child.name,
				title,
				updatedIso: attrs.updated_iso || iso,
				sourceFingerprint: fp,
				charsApprox: md.length,
				sectionTags: uniqTags.length > 0 ? uniqTags : defaultSectionTags(type),
				sectionTitles,
				keywords: uniqTags,
			});
		}
		const dirStr = artifacts.map(a => `${a.relPath}:${a.sourceFingerprint}`).join('\n');
		const manifestFp = djb2Fingerprint(dirStr.slice(0, 120_000));
		const existingPath = URI.joinPath(memRoot, NEPTOR_MEMORY_MANIFEST);
		let bootstrapCompletedAtIso: string | undefined = opts?.bootstrapCompletedAtIso;
		let workspaceProfile: MemoryWorkspaceProfile | undefined = opts?.workspaceProfile;
		let lastConsolidationAtIso: string | undefined = opts?.lastConsolidationAtIso;
		if (await this.fileService.exists(existingPath)) {
			const ex = await readFileLimited(this.fileService, existingPath, MAX_MEMORY_MANIFEST_JSON_CHARS);
			if (ex.val) {
				const parsed = parseAndValidateMemoryManifestJson(ex.val, MAX_MEMORY_MANIFEST_JSON_CHARS);
				if (parsed.ok) {
					if (bootstrapCompletedAtIso === undefined) {
						bootstrapCompletedAtIso = parsed.manifest.bootstrapCompletedAtIso;
					}
					if (workspaceProfile === undefined) {
						workspaceProfile = parsed.manifest.workspaceProfile;
					}
					if (lastConsolidationAtIso === undefined) {
						lastConsolidationAtIso = parsed.manifest.lastConsolidationAtIso;
					}
				}
			}
		}
		const manifestContentHash = manifestRollupHash(artifacts);
		const manifest: MemoryManifest = {
			neptor_memory_schema: NEPTOR_MEMORY_SCHEMA_VERSION,
			generatedAtIso: iso,
			workspaceFolderFsPath: folderFsPath,
			sourceFingerprint: manifestFp,
			artifacts,
			bootstrapCompletedAtIso,
			lastConsolidationAtIso,
			workspaceProfile,
			manifestContentHash,
		};
		const manifestStr = JSON.stringify(manifest, null, 2);
		const capped = manifestStr.length > MAX_MEMORY_MANIFEST_JSON_CHARS ? `${manifestStr.slice(0, MAX_MEMORY_MANIFEST_JSON_CHARS)}\n` : manifestStr;
		await this.fileService.writeFile(existingPath, VSBuffer.fromString(capped));
		try {
			const prev = await this.tryReadWorkspaceMemoryStatus(folderUri);
			const next = buildStatusSyncedFromManifest(manifest, prev);
			const statusUri = URI.joinPath(memRoot, NEPTOR_MEMORY_STATUS_FILE);
			await this.fileService.writeFile(statusUri, VSBuffer.fromString(stringifyWorkspaceMemoryStatus(next)));
		} catch {
			// Non-fatal; manifest is source of truth for reads
		}
		try {
			mainWindow.dispatchEvent(new CustomEvent('neptor-pm-memory-updated'));
		} catch {
			// ignore
		}
		return manifest;
	}

	private async rebuildRoot(folderUri: URI): Promise<MemoryManifest> {
		const folderFsPath = folderUri.fsPath;
		const memRoot = URI.joinPath(folderUri, '.neptor', 'memory');
		await this.ensureDirectory(URI.joinPath(folderUri, '.neptor'));
		await this.ensureDirectory(memRoot);

		let dirStr: string;
		try {
			dirStr = await this.directoryStrService.getDirectoryStrTool(folderUri);
		} catch {
			dirStr = `(Could not list directory for ${folderFsPath})`;
		}

		const fpSource = dirStr.slice(0, 120_000);
		const fp = djb2Fingerprint(fpSource);
		const iso = new Date().toISOString();

		let treeSample = dirStr;
		if (treeSample.length > 40_000) {
			treeSample = `${treeSample.slice(0, 40_000)}\n\n_(tree sample truncated for memory budget)_\n`;
		}

		let runningChars = 0;

		for (const type of MEMORY_ARTIFACT_TYPES) {
			const fileName = MEMORY_ARTIFACT_FILE_NAMES[type];
			let md = buildArtifactMarkdown({ type, folderFsPath, treeSample, fingerprint: fp, iso });
			if (type === 'flows') {
				md = md.replace('## Depth notes', `${flowsExtraBlurb().trim()}\n\n## Depth notes`);
			}
			if (md.length > MAX_MEMORY_ARTIFACT_FILE_CHARS) {
				md = `${md.slice(0, MAX_MEMORY_ARTIFACT_FILE_CHARS)}\n\n_(truncated to Neptor per artifact cap)_\n`;
			}
			runningChars += md.length;
			if (runningChars > MAX_MEMORY_CORPUS_CHARS) {
				break;
			}
			const targetUri = URI.joinPath(memRoot, fileName);
			await this.fileService.writeFile(targetUri, VSBuffer.fromString(md));
		}

		const manifest = await this.refreshMemoryManifestForFolder(folderUri, { bootstrapCompletedAtIso: iso });
		if (!manifest) {
			throw new Error('refreshMemoryManifestForFolder failed after rebuild');
		}
		return manifest;
	}

	async rebuildProjectMemory(): Promise<{ ok: boolean; detail: string }> {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return { ok: false, detail: 'Open a workspace folder before rebuilding project memory.' };
		}
		const lines: string[] = [];
		let ok = true;
		for (const folder of folders) {
			try {
				await this.rebuildRoot(folder.uri);
				lines.push(`Wrote memory bundle under ${folder.uri.fsPath}/.neptor/memory`);
			} catch (e) {
				ok = false;
				lines.push(`Failed ${folder.uri.fsPath}: ${e}`);
			}
		}
		try {
			mainWindow.dispatchEvent(new CustomEvent('neptor-pm-memory-updated'));
		} catch {
			// ignore
		}
		return { ok, detail: lines.join('\n') };
	}

	async getBootstrapStatusForFirstFolder(): Promise<PmMemoryBootstrapStatus> {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return { needsBootstrap: false, reason: 'No workspace folder', manifestPath: null, statusPath: null, workspaceMemoryStatus: null };
		}
		const folder = folders[0];
		const manifestUri = URI.joinPath(folder.uri, '.neptor', 'memory', NEPTOR_MEMORY_MANIFEST);
		const statusUri = URI.joinPath(folder.uri, '.neptor', 'memory', NEPTOR_MEMORY_STATUS_FILE);
		const workspaceMemoryStatus = await this.tryReadWorkspaceMemoryStatus(folder.uri);
		if (!(await this.fileService.exists(manifestUri))) {
			return {
				needsBootstrap: true,
				reason: 'Missing index.json',
				manifestPath: manifestUri,
				statusPath: statusUri,
				workspaceMemoryStatus,
			};
		}
		const mfRead = await readFileLimited(this.fileService, manifestUri, MAX_MEMORY_MANIFEST_JSON_CHARS);
		if (!mfRead.val) {
			return {
				needsBootstrap: true,
				reason: 'Unreadable manifest',
				manifestPath: manifestUri,
				statusPath: statusUri,
				workspaceMemoryStatus,
			};
		}
		const parsed = parseAndValidateMemoryManifestJson(mfRead.val, MAX_MEMORY_MANIFEST_JSON_CHARS);
		if (!parsed.ok) {
			return {
				needsBootstrap: true,
				reason: parsed.error,
				manifestPath: manifestUri,
				statusPath: statusUri,
				workspaceMemoryStatus,
			};
		}
		if (manifestIndicatesBootstrapComplete(parsed.manifest)) {
			return {
				needsBootstrap: false,
				reason: null,
				manifestPath: manifestUri,
				statusPath: statusUri,
				workspaceMemoryStatus,
			};
		}
		const types = new Set(parsed.manifest.artifacts.map(a => a.type));
		const missing = MEMORY_ARTIFACT_TYPES.filter(t => !types.has(t));
		let reason: string;
		if (missing.length > 0) {
			reason = `Missing artifacts: ${missing.join(', ')}`;
		} else if (!parsed.manifest.bootstrapCompletedAtIso?.trim()) {
			reason =
				'Memory folder exists but bootstrap is not finalized in index.json (no bootstrapCompletedAtIso). Run Generate or Rebuild.';
		} else {
			reason = 'Project memory needs setup';
		}
		return {
			needsBootstrap: true,
			reason,
			manifestPath: manifestUri,
			statusPath: statusUri,
			workspaceMemoryStatus,
		};
	}

	async touchWorkspaceBootstrapProgress(
		folderUri: URI,
		action:
			| { kind: 'start' }
			| { kind: 'artifact_begin'; artifactType: MemoryArtifactType }
			| { kind: 'artifact_saved'; artifactType: MemoryArtifactType }
			| { kind: 'artifact_failed'; artifactType: MemoryArtifactType; message: string }
			| { kind: 'finish'; ok: boolean; summary?: string },
	): Promise<void> {
		const memRoot = URI.joinPath(folderUri, ...NEPTOR_MEMORY_DIR.split('/'));
		await this.ensureDirectory(URI.joinPath(folderUri, '.neptor'));
		await this.ensureDirectory(memRoot);
		const fsPath = folderUri.fsPath;
		const nowIso = new Date().toISOString();

		const prev = await this.tryReadWorkspaceMemoryStatus(folderUri);

		const write = async (s: WorkspaceMemoryStatusFile) => {
			const uri = URI.joinPath(memRoot, NEPTOR_MEMORY_STATUS_FILE);
			await this.fileService.writeFile(uri, VSBuffer.fromString(stringifyWorkspaceMemoryStatus(s)));
		};

		switch (action.kind) {
			case 'start':
				await write(createInitialGeneratingStatus(fsPath));
				return;
			case 'artifact_begin': {
				const gen = prev?.generation ?? emptyGenerationState();
				await write({
					neptor_pm_memory_status_schema: NEPTOR_MEMORY_STATUS_SCHEMA,
					updatedAtIso: nowIso,
					workspaceFolderFsPath: fsPath,
					phase: 'generating',
					setupComplete: false,
					generation: {
						...gen,
						startedAtIso: gen.startedAtIso ?? nowIso,
						currentArtifactType: action.artifactType,
					},
				});
				return;
			}
			case 'artifact_saved': {
				const gen = prev?.generation ?? emptyGenerationState();
				const done = new Set(gen.completedTypes);
				done.add(action.artifactType);
				await write({
					neptor_pm_memory_status_schema: NEPTOR_MEMORY_STATUS_SCHEMA,
					updatedAtIso: nowIso,
					workspaceFolderFsPath: fsPath,
					phase: 'generating',
					setupComplete: false,
					generation: {
						...gen,
						startedAtIso: gen.startedAtIso ?? nowIso,
						currentArtifactType: null,
						completedTypes: MEMORY_ARTIFACT_TYPES.filter(t => done.has(t)),
					},
				});
				return;
			}
			case 'artifact_failed': {
				const gen = prev?.generation ?? emptyGenerationState();
				await write({
					neptor_pm_memory_status_schema: NEPTOR_MEMORY_STATUS_SCHEMA,
					updatedAtIso: nowIso,
					workspaceFolderFsPath: fsPath,
					phase: 'generating',
					setupComplete: false,
					generation: {
						...gen,
						currentArtifactType: null,
						failedTypes: [...gen.failedTypes, { type: action.artifactType, message: action.message.slice(0, 800) }],
					},
				});
				return;
			}
			case 'finish': {
				const gen = prev?.generation ?? emptyGenerationState();
				await write({
					neptor_pm_memory_status_schema: NEPTOR_MEMORY_STATUS_SCHEMA,
					updatedAtIso: nowIso,
					workspaceFolderFsPath: fsPath,
					phase: action.ok ? 'generating' : 'failed',
					setupComplete: false,
					generation: {
						...gen,
						lastRunOk: action.ok,
						lastRunSummary: action.summary ?? (action.ok ? 'Finished generation pass' : 'Some artifacts failed'),
						currentArtifactType: null,
					},
				});
				return;
			}
		}
	}

	private async tryReadWorkspaceMemoryStatus(folderUri: URI): Promise<WorkspaceMemoryStatusFile | null> {
		const uri = URI.joinPath(folderUri, '.neptor', 'memory', NEPTOR_MEMORY_STATUS_FILE);
		if (!(await this.fileService.exists(uri))) {
			return null;
		}
		const r = await readFileLimited(this.fileService, uri, MAX_MEMORY_STATUS_JSON_CHARS);
		if (!r.val) {
			return null;
		}
		const p = parseWorkspaceMemoryStatusJson(r.val);
		return p.ok ? p.status : null;
	}

	private async readRootManifestPair(): Promise<Array<{ folder: URI; manifest: MemoryManifest }>> {
		const out: Array<{ folder: URI; manifest: MemoryManifest }> = [];
		for (const folder of this.workspaceContextService.getWorkspace().folders) {
			const manifestUri = URI.joinPath(folder.uri, '.neptor', 'memory', NEPTOR_MEMORY_MANIFEST);
			if (!(await this.fileService.exists(manifestUri))) {
				continue;
			}
			const mfRead = await readFileLimited(this.fileService, manifestUri, MAX_MEMORY_MANIFEST_JSON_CHARS);
			if (!mfRead.val) {
				continue;
			}
			const parsed = parseAndValidateMemoryManifestJson(mfRead.val, MAX_MEMORY_MANIFEST_JSON_CHARS);
			if (!parsed.ok) {
				continue;
			}
			out.push({ folder: folder.uri, manifest: parsed.manifest });
		}
		return out;
	}

	async getSummaryForCodeChat(): Promise<string> {
		const pairs = await this.readRootManifestPair();
		if (pairs.length === 0) {
			return '';
		}
		const chunks: string[] = [];
		const budget = 6000;
		let remaining = budget;
		for (const { folder, manifest } of pairs) {
			const pickTypes: MemoryArtifactType[] = ['architecture', 'tasks', 'fixes', 'code_style', 'tech_stack', 'overview'];
			for (const t of pickTypes) {
				const ref = manifest.artifacts.find(a => a.type === t);
				if (!ref) {
					continue;
				}
				const artUri = URI.joinPath(folder, '.neptor', 'memory', ref.relPath);
				const r = await readFileLimited(this.fileService, artUri, MAX_MEMORY_ARTIFACT_FILE_CHARS);
				if (!r.val) {
					continue;
				}
				const { sections } = splitMarkdownForPatch(r.val);
				const blob = sections.map(s => `### ${s.title}\n${s.body}`).join('\n').slice(0, 1200);
				const part = `## ${ref.title} (${folder.fsPath})\n${blob}`;
				if (part.length > remaining) {
					chunks.push(part.slice(0, remaining));
					remaining = 0;
					break;
				}
				chunks.push(part);
				remaining -= part.length;
			}
			if (remaining <= 0) {
				break;
			}
		}
		return chunks.join('\n\n');
	}

	async pmMemorySearch(query: string, maxHits: number): Promise<{ hits: PmMemorySearchHit[] }> {
		const q = (query ?? '').toLowerCase().trim();
		const hits: PmMemorySearchHit[] = [];
		if (!q) {
			return { hits };
		}
		const overview = await this.readOverviewForUi();
		for (const root of overview.roots) {
			if (root.manifestError) {
				continue;
			}
			for (const art of root.artifacts) {
				const bodyRead = await readFileLimited(this.fileService, art.resource, MAX_MEMORY_ARTIFACT_FILE_CHARS);
				if (!bodyRead.val) {
					continue;
				}
				const split = splitMarkdownForPatch(bodyRead.val);
				for (const sec of split.sections) {
					const blob = `${sec.title} ${sec.tags.join(' ')} ${sec.body}`.toLowerCase();
					let score = 0;
					for (const word of q.split(/\s+/)) {
						if (word.length < 2) {
							continue;
						}
						if (blob.includes(word)) {
							score += 3;
						}
					}
					if (art.type === 'architecture' && /\barch|structure|component|layout|folder|module\b/i.test(q)) {
						score += 2;
					}
					if (art.type === 'tasks' && /\btask|wip|todo|branch|feature|sprint\b/i.test(q)) {
						score += 2;
					}
					if (art.type === 'fixes' && /\bbug|fix|regression|incident|deploy|rollback|broken\b/i.test(q)) {
						score += 2;
					}
					if (art.type === 'code_style' && /\blint|format|eslint|prettier|style|convention\b/i.test(q)) {
						score += 2;
					}
					if (art.type === 'file_graph' && /\bimport|depend|coupling|graph|refactor\b/i.test(q)) {
						score += 2;
					}
					if (art.type === 'tech_stack' && /\b(stack|yarn|pnpm|npm|docker|k8s|terraform|ci)\b/i.test(q)) {
						score += 2;
					}
					if (art.type === 'workflow' && /\b(git|commit|command|debug|script)\b/i.test(q)) {
						score += 2;
					}
					if (score <= 0) {
						continue;
					}
					const excerpt = sec.body.trim().slice(0, 480);
					hits.push({
						workspaceFolderFsPath: root.workspaceFolderFsPath,
						artifactId: art.id,
						artifactType: art.type,
						relPath: art.relPath,
						sectionId: sec.id,
						sectionTitle: sec.title,
						score,
						excerpt: excerpt.length < sec.body.trim().length ? `${excerpt}…` : excerpt,
					});
				}
			}
		}
		hits.sort((a, b) => b.score - a.score);
		return { hits: hits.slice(0, Math.max(1, Math.min(maxHits, 20))) };
	}

	async pmMemoryRead(artifactType: MemoryArtifactType, sectionId: string | null): Promise<{ text: string }> {
		const overview = await this.readOverviewForUi();
		const parts: string[] = [];
		for (const root of overview.roots) {
			if (root.manifestError) {
				continue;
			}
			const art = root.artifacts.find(a => a.type === artifactType);
			if (!art) {
				continue;
			}
			const bodyRead = await readFileLimited(this.fileService, art.resource, MAX_MEMORY_ARTIFACT_FILE_CHARS);
			if (!bodyRead.val) {
				continue;
			}
			if (!sectionId || !sectionId.trim()) {
				parts.push(`${root.workspaceFolderFsPath}/${art.relPath}\n${bodyRead.val}`);
				continue;
			}
			const split = splitMarkdownForPatch(bodyRead.val);
			const want = sectionId.trim().toLowerCase();
			const sec = split.sections.find(s => s.id === want || s.title.toLowerCase() === want);
			if (sec) {
				parts.push(`${root.workspaceFolderFsPath}/${art.relPath} :: ${sec.title}\n${sec.body}`);
			} else {
				parts.push(`${root.workspaceFolderFsPath}/${art.relPath}\n(Section not found: ${sectionId})\n${bodyRead.val.slice(0, 4000)}`);
			}
		}
		if (parts.length === 0) {
			return { text: '(No matching PM memory artifact in workspace.)' };
		}
		return { text: parts.join('\n\n---\n\n') };
	}

	async readOverviewForUi(): Promise<PmMemoryOverview> {
		const roots: PmMemoryRootView[] = [];
		const folders = this.workspaceContextService.getWorkspace().folders;
		for (const folder of folders) {
			const memRoot = URI.joinPath(folder.uri, ...NEPTOR_MEMORY_DIR.split('/'));
			if (!(await this.fileService.exists(memRoot))) {
				roots.push({
					workspaceFolderFsPath: folder.uri.fsPath,
					manifestResource: null,
					manifestError: 'No memory files found. Create markdown files in .neptor/memory.',
					manifest: null,
					artifacts: [],
				});
				continue;
			}

			const memStat = await this.fileService.resolve(memRoot, { resolveMetadata: true });
			if (!memStat.children) {
				roots.push({
					workspaceFolderFsPath: folder.uri.fsPath,
					manifestResource: null,
					manifestError: 'Could not list .neptor/memory files.',
					manifest: null,
					artifacts: [],
				});
				continue;
			}

			const manifestUri = URI.joinPath(folder.uri, '.neptor', 'memory', NEPTOR_MEMORY_MANIFEST);
			let parsedManifest: MemoryManifest | null = null;
			if (await this.fileService.exists(manifestUri)) {
				const mfRead = await readFileLimited(this.fileService, manifestUri, MAX_MEMORY_MANIFEST_JSON_CHARS);
				if (mfRead.val) {
					const parsed = parseAndValidateMemoryManifestJson(mfRead.val, MAX_MEMORY_MANIFEST_JSON_CHARS);
					if (parsed.ok) {
						parsedManifest = parsed.manifest;
					}
				}
			}

			const artifacts: PmMemoryArtifactView[] = [];
			const mdFiles = memStat.children
				.filter(c => !c.isDirectory && c.name.toLowerCase().endsWith('.md') && c.name.toLowerCase() !== 'readme.md')
				.slice(0, MAX_MEMORY_ARTIFACTS_PER_ROOT);

			for (const child of mdFiles) {
				if (!child.resource) {
					continue;
				}
				const type = inferTypeFromFileName(child.name);
				if (!type) {
					continue;
				}
				const bodyRead = await readFileLimited(this.fileService, child.resource, MAX_MEMORY_ARTIFACT_FILE_CHARS);
				if (!bodyRead.val) {
					continue;
				}
				const parsedDoc = parseTaggedMemoryDocument(bodyRead.val);
				const manifestRef = parsedManifest?.artifacts.find(a => a.relPath.toLowerCase() === child.name.toLowerCase());
				const childMtimeIso = typeof child.mtime === 'number' && child.mtime > 0
					? new Date(child.mtime).toISOString()
					: null;
				const updatedIso =
					parsedDoc.attrs.updated_iso ||
					manifestRef?.updatedIso ||
					childMtimeIso ||
					new Date().toISOString();
				const id = parsedDoc.attrs.artifact_id || manifestRef?.id || type;
				const title = parsedDoc.attrs.title || manifestRef?.title || artifactTitle(type);

				artifacts.push({
					id,
					type,
					title,
					relPath: child.name,
					resource: child.resource,
					updatedIso,
					sections: parseSectionsForUi(bodyRead.val),
					truncated: bodyRead.truncated,
					manifestFingerprint: parsedManifest?.sourceFingerprint || djb2Fingerprint(`${folder.uri.fsPath}:${child.name}`),
				});
			}

			roots.push({
				workspaceFolderFsPath: folder.uri.fsPath,
				manifestResource: (await this.fileService.exists(manifestUri)) ? manifestUri : null,
				manifestError: null,
				manifest: parsedManifest,
				artifacts,
			});
		}

		return { roots };
	}

	async getRetrievalContextForPrompt(lastUserMessage: string | undefined): Promise<string> {
		const overview = await this.readOverviewForUi();
		const hint = lastUserMessage ?? '';
		const blocks: string[] = [];
		let budget = MAX_MEMORY_RETRIEVAL_CONTEXT_CHARS;

		for (const root of overview.roots) {
			if (root.manifestError || root.artifacts.length === 0) {
				continue;
			}
			const sorted = [...root.artifacts].sort((a, b) => retrievalBoostForArtifact(b.type, hint) - retrievalBoostForArtifact(a.type, hint));
			for (const art of sorted) {
				const bodyRead = await readFileLimited(this.fileService, art.resource, MAX_MEMORY_ARTIFACT_FILE_CHARS);
				if (!bodyRead.val) {
					continue;
				}
				const split = splitMarkdownForPatch(bodyRead.val);
				const picked = selectSectionsForHint(split.sections, hint);
				for (const sec of picked) {
					const excerpt = sec.body.length > 6000 ? `${sec.body.slice(0, 6000)}\n_(section truncated)_\n` : sec.body;
					const chunk =
						`<memory_excerpt workspace="${escapeXml(root.workspaceFolderFsPath)}" artifact_id="${escapeXml(art.id)}" rel_path="${escapeXml(art.relPath)}" section="${escapeXml(sec.id)}">\n` +
						`${excerpt}\n` +
						`</memory_excerpt>`;
					if (chunk.length + 2 > budget) {
						blocks.push(chunk.slice(0, Math.max(0, budget - 50)) + '\n_(truncated to retrieval budget)_\n');
						budget = 0;
						break;
					}
					blocks.push(chunk);
					budget -= chunk.length + 1;
				}
				if (budget < 400) {
					break;
				}
			}
			if (budget < 400) {
				break;
			}
		}

		const inner = blocks.length > 0
			? blocks.join('\n')
			: '(No project memory available. Run Neptor: Rebuild Project Memory or the PM workspace wizard.)';
		return `<project_memory>\n${inner}\n</project_memory>`;
	}
}

registerSingleton(INeptorProjectMemoryService, NeptorProjectMemoryService, InstantiationType.Delayed);
