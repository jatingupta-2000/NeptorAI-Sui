/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { MEMORY_ARTIFACT_TYPES, MemoryArtifactType, MemoryWorkspaceProfile, NEPTOR_MEMORY_SCHEMA_VERSION, NEPTOR_MEMORY_SCHEMA_VERSION_V1 } from './memoryConstants.js';

export interface MemoryManifestArtifactRef {
	id: string;
	type: MemoryArtifactType;
	relPath: string;
	title: string;
	updatedIso: string;
	sourceFingerprint: string;
	charsApprox: number;
	sectionTags: string[];
	/** Derived headings for retrieval (optional, populated on refresh) */
	sectionTitles?: string[];
	/** Optional keywords for lightweight retrieval */
	keywords?: string[];
}

export interface MemoryManifest {
	neptor_memory_schema: number;
	generatedAtIso: string;
	workspaceFolderFsPath: string;
	sourceFingerprint: string;
	artifacts: MemoryManifestArtifactRef[];
	bootstrapCompletedAtIso?: string;
	lastConsolidationAtIso?: string;
	workspaceProfile?: MemoryWorkspaceProfile;
	/** Rollup hash of artifact fingerprints for quick change detection */
	manifestContentHash?: string;
}

export type ManifestParseResult =
	| { ok: true; manifest: MemoryManifest }
	| { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const ARTIFACT_TYPE_SET = new Set<string>(MEMORY_ARTIFACT_TYPES);

function isMemoryArtifactType(v: unknown): v is MemoryArtifactType {
	return typeof v === 'string' && ARTIFACT_TYPE_SET.has(v);
}

function isWorkspaceProfile(v: unknown): v is MemoryWorkspaceProfile {
	return v === 'new' || v === 'existing';
}

export function parseAndValidateMemoryManifestJson(raw: string, maxJsonChars: number): ManifestParseResult {
	if (raw.length > maxJsonChars) {
		return { ok: false, error: `Manifest exceeds max length (${raw.length} > ${maxJsonChars})` };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return { ok: false, error: `Manifest JSON parse error: ${e}` };
	}
	if (!isRecord(parsed)) {
		return { ok: false, error: 'Manifest root must be an object' };
	}
	const schemaVer = parsed.neptor_memory_schema;
	if (schemaVer !== NEPTOR_MEMORY_SCHEMA_VERSION && schemaVer !== NEPTOR_MEMORY_SCHEMA_VERSION_V1) {
		return { ok: false, error: `Unsupported neptor_memory_schema: ${String(schemaVer)}` };
	}
	if (typeof parsed.generatedAtIso !== 'string' || !parsed.generatedAtIso) {
		return { ok: false, error: 'Manifest missing generatedAtIso' };
	}
	if (typeof parsed.workspaceFolderFsPath !== 'string' || !parsed.workspaceFolderFsPath) {
		return { ok: false, error: 'Manifest missing workspaceFolderFsPath' };
	}
	if (typeof parsed.sourceFingerprint !== 'string') {
		return { ok: false, error: 'Manifest missing sourceFingerprint' };
	}
	if (!Array.isArray(parsed.artifacts)) {
		return { ok: false, error: 'Manifest artifacts must be an array' };
	}

	const artifacts: MemoryManifestArtifactRef[] = [];
	for (const entry of parsed.artifacts) {
		if (!isRecord(entry)) {
			return { ok: false, error: 'Invalid artifact entry' };
		}
		if (typeof entry.id !== 'string' || !entry.id) {
			return { ok: false, error: 'Artifact missing id' };
		}
		if (!isMemoryArtifactType(entry.type)) {
			return { ok: false, error: `Artifact ${entry.id} has invalid type` };
		}
		if (typeof entry.relPath !== 'string' || !entry.relPath) {
			return { ok: false, error: `Artifact ${entry.id} missing relPath` };
		}
		if (typeof entry.title !== 'string') {
			return { ok: false, error: `Artifact ${entry.id} missing title` };
		}
		if (typeof entry.updatedIso !== 'string') {
			return { ok: false, error: `Artifact ${entry.id} missing updatedIso` };
		}
		if (typeof entry.sourceFingerprint !== 'string') {
			return { ok: false, error: `Artifact ${entry.id} missing sourceFingerprint` };
		}
		if (typeof entry.charsApprox !== 'number') {
			return { ok: false, error: `Artifact ${entry.id} missing charsApprox` };
		}
		if (!Array.isArray(entry.sectionTags) || !entry.sectionTags.every(t => typeof t === 'string')) {
			return { ok: false, error: `Artifact ${entry.id} has invalid sectionTags` };
		}
		let sectionTitles: string[] | undefined;
		if (entry.sectionTitles !== undefined) {
			if (!Array.isArray(entry.sectionTitles) || !entry.sectionTitles.every(t => typeof t === 'string')) {
				return { ok: false, error: `Artifact ${entry.id} has invalid sectionTitles` };
			}
			sectionTitles = entry.sectionTitles as string[];
		}
		let keywords: string[] | undefined;
		if (entry.keywords !== undefined) {
			if (!Array.isArray(entry.keywords) || !entry.keywords.every(t => typeof t === 'string')) {
				return { ok: false, error: `Artifact ${entry.id} has invalid keywords` };
			}
			keywords = entry.keywords as string[];
		}
		artifacts.push({
			id: entry.id,
			type: entry.type,
			relPath: entry.relPath,
			title: entry.title,
			updatedIso: entry.updatedIso,
			sourceFingerprint: entry.sourceFingerprint,
			charsApprox: entry.charsApprox,
			sectionTags: entry.sectionTags as string[],
			sectionTitles,
			keywords,
		});
	}

	let bootstrapCompletedAtIso: string | undefined;
	if (parsed.bootstrapCompletedAtIso !== undefined) {
		if (typeof parsed.bootstrapCompletedAtIso !== 'string') {
			return { ok: false, error: 'Invalid bootstrapCompletedAtIso' };
		}
		bootstrapCompletedAtIso = parsed.bootstrapCompletedAtIso;
	}
	let lastConsolidationAtIso: string | undefined;
	if (parsed.lastConsolidationAtIso !== undefined) {
		if (typeof parsed.lastConsolidationAtIso !== 'string') {
			return { ok: false, error: 'Invalid lastConsolidationAtIso' };
		}
		lastConsolidationAtIso = parsed.lastConsolidationAtIso;
	}
	let workspaceProfile: MemoryWorkspaceProfile | undefined;
	if (parsed.workspaceProfile !== undefined) {
		if (!isWorkspaceProfile(parsed.workspaceProfile)) {
			return { ok: false, error: 'Invalid workspaceProfile' };
		}
		workspaceProfile = parsed.workspaceProfile;
	}
	let manifestContentHash: string | undefined;
	if (parsed.manifestContentHash !== undefined) {
		if (typeof parsed.manifestContentHash !== 'string') {
			return { ok: false, error: 'Invalid manifestContentHash' };
		}
		manifestContentHash = parsed.manifestContentHash;
	}

	return {
		ok: true,
		manifest: {
			neptor_memory_schema: NEPTOR_MEMORY_SCHEMA_VERSION,
			generatedAtIso: parsed.generatedAtIso,
			workspaceFolderFsPath: parsed.workspaceFolderFsPath,
			sourceFingerprint: parsed.sourceFingerprint,
			artifacts,
			bootstrapCompletedAtIso,
			lastConsolidationAtIso,
			workspaceProfile,
			manifestContentHash,
		},
	};
}
