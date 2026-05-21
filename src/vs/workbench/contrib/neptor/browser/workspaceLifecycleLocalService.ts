/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import {
	CollaborationActivityEvent,
	DeployAnalysisPhase,
	DeployAnalysisResult,
	DeployDockerfileInfo,
	DeployOutcome,
	DeployResourceEstimate,
	WorkspaceMember,
	WorkspacePendingInvite,
} from '../common/workspaceLifecycleTypes.js';
import { IWorkspaceLifecycleService } from '../common/workspaceLifecycleService.js';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function randomHex(len: number): string {
	const alphabet = '0123456789abcdef';
	let s = '';
	for (let i = 0; i < len; i++) {
		s += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return s;
}

export class WorkspaceLifecycleLocalService extends Disposable implements IWorkspaceLifecycleService {
	readonly _serviceBrand: undefined;

	private readonly _members: WorkspaceMember[] = [
		{
			id: 'm-self',
			email: 'you@workspace.local',
			displayName: 'You',
			role: 'owner',
			joinedAtIso: new Date().toISOString(),
		},
	];

	private readonly _pending: WorkspacePendingInvite[] = [];
	private _activityBuffer: CollaborationActivityEvent[] = [];
	private _activitySeq = 0;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContext: IWorkspaceContextService,
	) {
		super();
		this._seedActivity();
	}

	private _seedActivity(): void {
		const now = Date.now();
		this._pushBuf(this._makeEvent('memory_save', now - 120_000, 'Alex', 210, 'Updated task memory after refactor', { artifactType: 'tasks' }));
		this._pushBuf(this._makeEvent('chat_message', now - 90_000, 'Jordan', 45, 'Asked PM agent about API versioning', { threadLabel: 'Product' }));
		this._pushBuf(this._makeEvent('file_edit', now - 60_000, 'Sam', 120, 'Touched src/api/routes.ts', { uri: 'src/api/routes.ts' }));
	}

	private _pushBuf(e: CollaborationActivityEvent): void {
		this._activityBuffer.push(e);
		if (this._activityBuffer.length > 80) {
			this._activityBuffer = this._activityBuffer.slice(-80);
		}
	}

	private _makeEvent(
		kind: CollaborationActivityEvent['kind'],
		at: number,
		name: string,
		hue: number,
		summary: string,
		extra: { threadLabel?: string; uri?: string; artifactType?: string; deploymentId?: string } = {},
	): CollaborationActivityEvent {
		const base = {
			id: `evt-${++this._activitySeq}`,
			timestampIso: new Date(at).toISOString(),
			actor: { id: `a-${name.toLowerCase()}`, displayName: name, avatarHue: hue },
			summary,
		};
		switch (kind) {
			case 'chat_message':
				return { ...base, kind: 'chat_message', threadLabel: extra.threadLabel ?? 'Agent' };
			case 'file_edit':
				return { ...base, kind: 'file_edit', uri: extra.uri };
			case 'memory_save':
				return { ...base, kind: 'memory_save', artifactType: extra.artifactType };
			case 'deploy_event':
				return { ...base, kind: 'deploy_event', deploymentId: extra.deploymentId };
		}
	}

	private async _readDockerfilePreview(): Promise<DeployDockerfileInfo> {
		const folders = this.workspaceContext.getWorkspace().folders;
		if (!folders.length) {
			return { found: false };
		}
		const root = folders[0].uri;
		for (const name of ['Dockerfile', 'dockerfile']) {
			const file = URI.joinPath(root, name);
			try {
				const exists = await this.fileService.exists(file);
				if (!exists) {
					continue;
				}
				const content = await this.fileService.readFile(file);
				const text = content.value.toString();
				const lines = text.split(/\r?\n/).slice(0, 12).join('\n');
				const excerpt = lines.length > 420 ? `${lines.slice(0, 417)}…` : lines;
				return { found: true, path: name, excerpt };
			} catch {
				continue;
			}
		}
		return { found: false };
	}

	private _deployHostSlug(): string {
		const folders = this.workspaceContext.getWorkspace().folders;
		const raw = (folders[0]?.name ?? 'app').trim() || 'app';
		const slug = raw
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');
		return (slug || 'app').slice(0, 63);
	}

	async analyzeWorkspaceForDeploy(onPhase?: (phase: DeployAnalysisPhase, detail?: string) => void): Promise<DeployAnalysisResult> {
		const phasesSeen: DeployAnalysisPhase[] = [];
		const pushPhase = (p: DeployAnalysisPhase, detail?: string) => {
			phasesSeen.push(p);
			onPhase?.(p, detail);
		};

		pushPhase('queued', 'Starting workspace triage…');
		await sleep(400);

		pushPhase('scan_tree', 'Walking folders and lockfiles…');
		await sleep(650);

		pushPhase('dockerfile', 'Looking for a Dockerfile…');
		const dockerfile = await this._readDockerfilePreview();
		await sleep(500);

		pushPhase('dependencies', 'Inferring package graph…');
		await sleep(550);

		pushPhase('resources', 'Sizing runtime footprint…');
		const resources: DeployResourceEstimate = {
			cpuLabel: dockerfile.found ? '2 vCPU (shared)' : '1 vCPU (burstable)',
			memoryLabel: dockerfile.found ? '4 GiB RAM' : '2 GiB RAM',
			estimatedMonthlyUsdBand: dockerfile.found ? '25_to_100' : 'under_25',
		};
		await sleep(500);

		const warnings: string[] = [];
		if (!dockerfile.found) {
			warnings.push('No Dockerfile at workspace root—Neptor will provision a managed runtime image for this workspace.');
		} else {
			if (/^FROM\s+scratch/im.test(dockerfile.excerpt ?? '')) {
				warnings.push('Base image is minimal; ensure your binary or static assets are copied in the image.');
			}
		}

		pushPhase('complete', 'Analysis finished');
		const analysisId = `ana-${Date.now().toString(36)}-${randomHex(6)}`;

		return {
			analysisId,
			phasesSeen,
			dockerfile,
			resources,
			warnings,
			completedAtIso: new Date().toISOString(),
		};
	}

	async deployWorkspace(args: { analysisId: string }): Promise<DeployOutcome> {
		void args.analysisId;
		await sleep(240);
		const host = this._deployHostSlug();
		return {
			deploymentId: `dep-${Date.now().toString(36)}`,
			url: `https://${host}.neptorai.com`,
			region: 'US West (Oregon)',
			status: 'running',
			createdAtIso: new Date().toISOString(),
		};
	}

	async sendInvite(email: string): Promise<WorkspaceMember> {
		const trimmed = email.trim().toLowerCase();
		await sleep(500 + Math.floor(Math.random() * 400));
		const local = trimmed.split('@')[0] ?? 'teammate';
		const member: WorkspaceMember = {
			id: `m-${Date.now().toString(36)}`,
			email: trimmed,
			displayName: local.charAt(0).toUpperCase() + local.slice(1),
			role: 'contributor',
			joinedAtIso: new Date().toISOString(),
		};
		if (!this._members.some(m => m.email === member.email)) {
			this._members.push(member);
		}
		this._pushBuf(
			this._makeEvent('chat_message', Date.now(), member.displayName, member.email.length % 360, `Joined workspace (${trimmed})`, {
				threadLabel: 'Workspace',
			}),
		);
		return member;
	}

	listMembers(): WorkspaceMember[] {
		return this._members.slice();
	}

	listPendingInvites(): WorkspacePendingInvite[] {
		return this._pending.slice();
	}

	getRecentActivity(limit = 40): CollaborationActivityEvent[] {
		return this._activityBuffer.slice(-limit);
	}

	subscribeActivityFeed(handler: (event: CollaborationActivityEvent) => void): IDisposable {
		const templates: Array<() => CollaborationActivityEvent> = [
			() => this._makeEvent('chat_message', Date.now(), 'Jordan', 45, 'Tagged you in a PM briefing question', { threadLabel: 'Product' }),
			() => this._makeEvent('file_edit', Date.now(), 'Sam', 120, `Edited ${['lib/wiring.ts', 'README.md', 'config/vite.config.ts'][this._activitySeq % 3]}`, {
				uri: 'workspace',
			}),
			() => this._makeEvent(
				'memory_save',
				Date.now(),
				'Alex',
				210,
				'Consolidated architecture notes after onboarding',
				{ artifactType: 'architecture' },
			),
			() => this._makeEvent('deploy_event', Date.now(), 'Neptor Bot', 300, 'Deployment health check: OK', { deploymentId: `dep-${Date.now().toString(36)}` }),
		];

		const id = globalThis.setInterval(() => {
			const pick = templates[Math.floor(Math.random() * templates.length)]!();
			this._pushBuf(pick);
			handler(pick);
		}, 4800);

		return toDisposable(() => {
			globalThis.clearInterval(id);
		});
	}
}

registerSingleton(IWorkspaceLifecycleService, WorkspaceLifecycleLocalService, InstantiationType.Delayed);
