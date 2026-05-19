/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type {
	CollaborationActivityEvent,
	DeployAnalysisPhase,
	DeployAnalysisResult,
	DeployOutcome,
	WorkspaceMember,
	WorkspacePendingInvite,
} from './workspaceLifecycleTypes.js';

export const IWorkspaceLifecycleService = createDecorator<IWorkspaceLifecycleService>('workspaceLifecycleService');

export interface IWorkspaceLifecycleService {
	readonly _serviceBrand: undefined;

	/**
	 * Workspace deploy analysis for the multi-step deploy wizard. Calls `onPhase` as work advances.
	 */
	analyzeWorkspaceForDeploy(onPhase?: (phase: DeployAnalysisPhase, detail?: string) => void): Promise<DeployAnalysisResult>;

	/**
	 * Deploy after analysis; returns deployment URL and status.
	 */
	deployWorkspace(args: { analysisId: string }): Promise<DeployOutcome>;

	/**
	 * Invite flow. Accepts the invite and adds a member to the local workspace store.
	 */
	sendInvite(email: string): Promise<WorkspaceMember>;

	listMembers(): WorkspaceMember[];

	listPendingInvites(): WorkspacePendingInvite[];

	/**
	 * Recent items for first paint; streaming UI should prefer `subscribeActivityFeed`.
	 */
	getRecentActivity(limit?: number): CollaborationActivityEvent[];

	subscribeActivityFeed(handler: (event: CollaborationActivityEvent) => void): IDisposable;
}
