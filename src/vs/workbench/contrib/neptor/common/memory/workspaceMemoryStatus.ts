/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { MEMORY_ARTIFACT_TYPES, MemoryArtifactType, NEPTOR_MEMORY_STATUS_SCHEMA } from './memoryConstants.js';
import type { MemoryManifest } from './memoryManifest.js';

export const MAX_MEMORY_STATUS_JSON_CHARS = 16_000;

export type WorkspaceMemoryGenerationPhase = 'idle' | 'generating' | 'complete' | 'failed';

export interface WorkspaceMemoryGenerationFailedEntry {
	type: MemoryArtifactType;
	message: string;
}

/** Written next to index.json — progress + completion for PM bootstrap (not chat logs). */
export interface WorkspaceMemoryStatusFile {
	neptor_pm_memory_status_schema: number;
	updatedAtIso: string;
	workspaceFolderFsPath?: string;
	phase: WorkspaceMemoryGenerationPhase;
	/** Wizard / PM setup can hide when true and manifest still matches completion rules. */
	setupComplete: boolean;
	generation: {
		startedAtIso?: string;
		completedAtIso?: string;
		currentArtifactType?: MemoryArtifactType | null;
		completedTypes: MemoryArtifactType[];
		failedTypes: WorkspaceMemoryGenerationFailedEntry[];
		/** Mirrors last bootstrap aggregate result when generation ends */
		lastRunOk?: boolean;
		lastRunSummary?: string;
	};
}

export type WorkspaceMemoryStatusParseResult =
	| { ok: true; status: WorkspaceMemoryStatusFile }
	| { ok: false; error: string };

const TYPE_SET = new Set<string>(MEMORY_ARTIFACT_TYPES);

function isArtifactType(v: unknown): v is MemoryArtifactType {
	return typeof v === 'string' && TYPE_SET.has(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function emptyGenerationState(): WorkspaceMemoryStatusFile['generation'] {
	return {
		completedTypes: [],
		failedTypes: [],
	};
}

export function createInitialGeneratingStatus(workspaceFolderFsPath: string): WorkspaceMemoryStatusFile {
	const iso = new Date().toISOString();
	return {
		neptor_pm_memory_status_schema: NEPTOR_MEMORY_STATUS_SCHEMA,
		updatedAtIso: iso,
		workspaceFolderFsPath,
		phase: 'generating',
		setupComplete: false,
		generation: {
			...emptyGenerationState(),
			startedAtIso: iso,
			currentArtifactType: null,
		},
	};
}

/** True when workspace memory bootstrap is finished (manifest is canonical; status echoes it). */
export function manifestIndicatesBootstrapComplete(manifest: MemoryManifest): boolean {
	const typesPresent = new Set(manifest.artifacts.map(a => a.type));
	if (!MEMORY_ARTIFACT_TYPES.every(t => typesPresent.has(t))) {
		return false;
	}
	return !!manifest.bootstrapCompletedAtIso?.trim();
}

export function buildStatusSyncedFromManifest(
	manifest: MemoryManifest,
	prev: WorkspaceMemoryStatusFile | null,
): WorkspaceMemoryStatusFile {
	const iso = new Date().toISOString();
	const completedTypes = MEMORY_ARTIFACT_TYPES.filter(t =>
		manifest.artifacts.some(a => a.type === t)
	);
	const complete = manifestIndicatesBootstrapComplete(manifest);
	const gen = prev?.generation ?? emptyGenerationState();
	const hasFails = gen.failedTypes.length > 0;
	const phase: WorkspaceMemoryGenerationPhase = complete ? 'complete' : hasFails ? 'failed' : prev?.phase === 'generating' ? 'generating' : 'idle';
	return {
		neptor_pm_memory_status_schema: NEPTOR_MEMORY_STATUS_SCHEMA,
		updatedAtIso: iso,
		workspaceFolderFsPath: manifest.workspaceFolderFsPath,
		phase,
		setupComplete: complete,
		generation: {
			...gen,
			completedTypes: complete ? completedTypes : gen.completedTypes,
			completedAtIso: complete ? iso : gen.completedAtIso,
			lastRunSummary: complete
				? `All ${MEMORY_ARTIFACT_TYPES.length} artifact types tracked in index.json`
				: gen.lastRunSummary,
		},
	};
}

export function parseWorkspaceMemoryStatusJson(raw: string): WorkspaceMemoryStatusParseResult {
	if (raw.length > MAX_MEMORY_STATUS_JSON_CHARS) {
		return { ok: false, error: 'Status JSON too large' };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return { ok: false, error: `Parse error: ${e}` };
	}
	if (!isRecord(parsed)) {
		return { ok: false, error: 'Root must be an object' };
	}
	if (parsed.neptor_pm_memory_status_schema !== NEPTOR_MEMORY_STATUS_SCHEMA) {
		return { ok: false, error: 'Unsupported neptor_pm_memory_status_schema' };
	}
	if (typeof parsed.updatedAtIso !== 'string' || !parsed.updatedAtIso) {
		return { ok: false, error: 'Missing updatedAtIso' };
	}
	const phaseRaw = parsed.phase;
	if (
		phaseRaw !== 'idle' &&
		phaseRaw !== 'generating' &&
		phaseRaw !== 'complete' &&
		phaseRaw !== 'failed'
	) {
		return { ok: false, error: 'Invalid phase' };
	}
	if (typeof parsed.setupComplete !== 'boolean') {
		return { ok: false, error: 'setupComplete must be boolean' };
	}
	if (!isRecord(parsed.generation)) {
		return { ok: false, error: 'generation must be an object' };
	}
	const gen = parsed.generation;
	const completedRaw = Array.isArray(gen.completedTypes) ? gen.completedTypes : null;
	if (!completedRaw) {
		return { ok: false, error: 'generation.completedTypes must be an array' };
	}
	const completedTypes: MemoryArtifactType[] = [];
	for (const t of completedRaw) {
		if (!isArtifactType(t)) {
			return { ok: false, error: 'Invalid entry in completedTypes' };
		}
		completedTypes.push(t);
	}
	const failedRaw = Array.isArray(gen.failedTypes) ? gen.failedTypes : null;
	if (!failedRaw) {
		return { ok: false, error: 'generation.failedTypes must be an array' };
	}
	const failedTypes: WorkspaceMemoryGenerationFailedEntry[] = [];
	for (const e of failedRaw) {
		if (!isRecord(e) || !isArtifactType(e.type) || typeof e.message !== 'string') {
			return { ok: false, error: 'Invalid failedTypes entry' };
		}
		failedTypes.push({ type: e.type, message: e.message });
	}

	let workspaceFolderFsPath: string | undefined;
	if (typeof parsed.workspaceFolderFsPath === 'string') {
		workspaceFolderFsPath = parsed.workspaceFolderFsPath;
	}

	const currentArtifactType =
		gen.currentArtifactType === null || gen.currentArtifactType === undefined
			? undefined
			: isArtifactType(gen.currentArtifactType)
				? gen.currentArtifactType
				: undefined;

	const status: WorkspaceMemoryStatusFile = {
		neptor_pm_memory_status_schema: NEPTOR_MEMORY_STATUS_SCHEMA,
		updatedAtIso: parsed.updatedAtIso,
		...(workspaceFolderFsPath !== undefined ? { workspaceFolderFsPath } : {}),
		phase: phaseRaw,
		setupComplete: parsed.setupComplete,
		generation: {
			...(typeof gen.startedAtIso === 'string' ? { startedAtIso: gen.startedAtIso } : {}),
			...(typeof gen.completedAtIso === 'string' ? { completedAtIso: gen.completedAtIso } : {}),
			...(currentArtifactType !== undefined ? { currentArtifactType } : {}),
			completedTypes,
			failedTypes,
			...(typeof gen.lastRunOk === 'boolean' ? { lastRunOk: gen.lastRunOk } : {}),
			...(typeof gen.lastRunSummary === 'string' ? { lastRunSummary: gen.lastRunSummary } : {}),
		},
	};
	return { ok: true, status };
}

export function stringifyWorkspaceMemoryStatus(status: WorkspaceMemoryStatusFile): string {
	return `${JSON.stringify(status, null, 2)}\n`;
}
