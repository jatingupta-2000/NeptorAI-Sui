/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { MemoryArtifactType, MemoryWorkspaceProfile } from './memory/memoryConstants.js';

export interface PmWizardAnswers {
	workspaceProfile: MemoryWorkspaceProfile;
	targetUsers: string;
	outcomes: string;
	constraints: string;
}

/** UI timeline events for PM workspace bootstrap (Cursor-style activity). */
export type PmBootstrapProgress =
	| { kind: 'line'; variant: 'context' | 'thinking' | 'tool' | 'success' | 'error'; text: string }
	| { kind: 'stream'; artifactType: MemoryArtifactType; label: string; snippet: string }
	| { kind: 'reasoning'; artifactType: MemoryArtifactType; text: string }
	| { kind: 'artifact_end'; artifactType: MemoryArtifactType };

export interface IPmWorkspaceBootstrapService {
	readonly _serviceBrand: undefined;
	runWizardBootstrap(
		answers: PmWizardAnswers,
		onProgress?: (e: PmBootstrapProgress) => void,
	): Promise<{ ok: boolean; detail: string }>;
}

export const IPmWorkspaceBootstrapService = createDecorator<IPmWorkspaceBootstrapService>('pmWorkspaceBootstrapService');
