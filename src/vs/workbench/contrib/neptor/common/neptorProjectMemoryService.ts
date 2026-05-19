/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import { ParsedMemorySection } from './memory/parseMemoryMarkdown.js';
import { MemoryArtifactType } from './memory/memoryConstants.js';
import { MemoryManifest } from './memory/memoryManifest.js';
import type { WorkspaceMemoryStatusFile } from './memory/workspaceMemoryStatus.js';

export interface PmMemoryArtifactView {
	id: string;
	type: MemoryArtifactType;
	title: string;
	relPath: string;
	resource: URI;
	updatedIso: string;
	sections: ParsedMemorySection[];
	truncated: boolean;
	manifestFingerprint: string;
}

export interface PmMemoryRootView {
	workspaceFolderFsPath: string;
	manifestResource: URI | null;
	manifestError: string | null;
	manifest: MemoryManifest | null;
	artifacts: PmMemoryArtifactView[];
}

export interface PmMemoryOverview {
	roots: PmMemoryRootView[];
}

export interface PmMemorySearchHit {
	workspaceFolderFsPath: string;
	artifactId: string;
	artifactType: MemoryArtifactType;
	relPath: string;
	sectionId: string;
	sectionTitle: string;
	score: number;
	excerpt: string;
}

export interface PmMemoryBootstrapStatus {
	needsBootstrap: boolean;
	reason: string | null;
	manifestPath: URI | null;
	/** Sidecar JSON next to index.json (progress + completion). */
	statusPath: URI | null;
	/** Parsed when present; use for wizard checklist / debugging. */
	workspaceMemoryStatus: WorkspaceMemoryStatusFile | null;
}

export interface INeptorProjectMemoryService {
	readonly _serviceBrand: undefined;

	rebuildProjectMemory(): Promise<{ ok: boolean; detail: string }>;

	getRetrievalContextForPrompt(lastUserMessage: string | undefined): Promise<string>;

	/** Short summary from overview (+ vision snippet) for optional code chat injection */
	getSummaryForCodeChat(): Promise<string>;

	readOverviewForUi(): Promise<PmMemoryOverview>;

	/** Scan disk under `.neptor/memory` and rewrite `index.json` */
	refreshMemoryManifestForFolder(folderUri: URI, opts?: { bootstrapCompletedAtIso?: string; workspaceProfile?: import('./memory/memoryConstants.js').MemoryWorkspaceProfile; lastConsolidationAtIso?: string }): Promise<MemoryManifest | null>;

	getBootstrapStatusForFirstFolder(): Promise<PmMemoryBootstrapStatus>;

	/** Update `.neptor/memory/workspace_memory_status.json` during PM bootstrap (incremental checklist). */
	touchWorkspaceBootstrapProgress(
		folderUri: URI,
		action:
			| { kind: 'start' }
			| { kind: 'artifact_begin'; artifactType: MemoryArtifactType }
			| { kind: 'artifact_saved'; artifactType: MemoryArtifactType }
			| { kind: 'artifact_failed'; artifactType: MemoryArtifactType; message: string }
			| { kind: 'finish'; ok: boolean; summary?: string },
	): Promise<void>;

	pmMemorySearch(query: string, maxHits: number): Promise<{ hits: PmMemorySearchHit[] }>;

	pmMemoryRead(artifactType: MemoryArtifactType, sectionId: string | null): Promise<{ text: string }>;
}

export const INeptorProjectMemoryService = createDecorator<INeptorProjectMemoryService>('neptorProjectMemoryService');
