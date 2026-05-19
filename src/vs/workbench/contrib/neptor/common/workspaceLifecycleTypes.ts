/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** Progress steps while the workbench analyzes a folder for deploy (UI may show a checklist). */
export type DeployAnalysisPhase =
	| 'queued'
	| 'scan_tree'
	| 'dockerfile'
	| 'dependencies'
	| 'resources'
	| 'complete'
	| 'error';

export type DeployResourceEstimate = {
	/** Example: "1 vCPU (burstable)" */
	cpuLabel: string;
	/** Example: "2 GiB RAM" */
	memoryLabel: string;
	/** Rough monthly cost band for deploy estimates */
	estimatedMonthlyUsdBand: 'under_25' | '25_to_100' | '100_plus';
};

export type DeployDockerfileInfo = {
	found: boolean;
	/** Workspace-relative path when present */
	path?: string;
	/** First lines for preview */
	excerpt?: string;
};

export type DeployAnalysisResult = {
	analysisId: string;
	phasesSeen: DeployAnalysisPhase[];
	dockerfile: DeployDockerfileInfo;
	resources: DeployResourceEstimate;
	warnings: string[];
	completedAtIso: string;
};

export type DeployOutcome = {
	deploymentId: string;
	url: string;
	region: string;
	status: 'provisioning' | 'running' | 'failed';
	createdAtIso: string;
};

export type WorkspaceMember = {
	id: string;
	email: string;
	/** Display label derived from profile or email local-part */
	displayName: string;
	role: 'owner' | 'admin' | 'contributor' | 'viewer';
	joinedAtIso: string;
};

export type WorkspacePendingInvite = {
	id: string;
	email: string;
	sentAtIso: string;
	status: 'pending';
};

export type CollaborationActivityKind = 'chat_message' | 'file_edit' | 'memory_save' | 'deploy_event';

export type CollaborationActivityEventBase = {
	id: string;
	timestampIso: string;
	actor: {
		id: string;
		displayName: string;
		avatarHue: number;
	};
	summary: string;
};

export type CollaborationChatEvent = CollaborationActivityEventBase & {
	kind: 'chat_message';
	threadLabel?: string;
};

export type CollaborationFileEditEvent = CollaborationActivityEventBase & {
	kind: 'file_edit';
	uri?: string;
};

export type CollaborationMemoryEvent = CollaborationActivityEventBase & {
	kind: 'memory_save';
	artifactType?: string;
};

export type CollaborationDeployEvent = CollaborationActivityEventBase & {
	kind: 'deploy_event';
	deploymentId?: string;
};

export type CollaborationActivityEvent =
	| CollaborationChatEvent
	| CollaborationFileEditEvent
	| CollaborationMemoryEvent
	| CollaborationDeployEvent;
