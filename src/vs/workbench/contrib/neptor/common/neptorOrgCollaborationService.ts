/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export type OrgCollaborationActivityKind =
	| 'chat_message'
	| 'file_edit'
	| 'memory_save'
	| 'deploy_event'
	| 'team_event';

export interface OrgCollaborationActivityEvent {
	id: string;
	orgId: string;
	userId?: string;
	kind: OrgCollaborationActivityKind;
	summary: string;
	timestampIso: string;
	actor: {
		id: string;
		displayName: string;
		email?: string;
		avatarHue: number;
	};
	threadLabel?: string;
	uri?: string;
	artifactType?: string;
}

export const INeptorOrgCollaborationService = createDecorator<INeptorOrgCollaborationService>('neptorOrgCollaborationService');

export interface INeptorOrgCollaborationService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;

	isEnabled(): boolean;

	/** Cached team rules text for LLM injection (sync). */
	getTeamInstructionsSync(): string;

	/** Where team rules are loaded from: memwal, database, or none. */
	getTeamRulesStorage(): 'memwal' | 'database' | 'none';

	/** Latest Walrus Memory blob id for active org rules (if any). */
	getTeamRulesWalrusBlobId(): string | null;

	/** Refresh rules cache from org API. */
	refreshTeamInstructions(): Promise<void>;

	/** After user sends a chat prompt: record activity + extract/merge rules (async). */
	onUserPrompt(promptText: string, threadLabel?: string): void;

	/** Record a team activity event. */
	recordActivity(input: {
		kind: OrgCollaborationActivityKind;
		summary: string;
		uri?: string;
		artifactType?: string;
		threadLabel?: string;
	}): Promise<void>;

	/** Fetch recent activity for active org. */
	fetchRecentActivity(limit?: number): Promise<OrgCollaborationActivityEvent[]>;

	/** Sync org + member to API after local create/join. Returns false if skipped or failed. */
	syncOrganization(orgId: string): Promise<boolean>;
	syncMember(orgId: string, memberId: string): Promise<boolean>;
}
