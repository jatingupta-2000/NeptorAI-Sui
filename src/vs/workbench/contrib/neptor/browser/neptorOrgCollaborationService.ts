/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { orgActivityBus } from '../common/neptorOrgActivityBus.js';
import {
	INeptorOrgCollaborationService,
	OrgCollaborationActivityEvent,
	OrgCollaborationActivityKind,
} from '../common/neptorOrgCollaborationService.js';
import { INeptorOrganizationService } from '../common/neptorOrganizationService.js';
import { parseExtractedRulesJson, teamInstructionExtractSystemMessage } from '../common/prompt/teamInstructionExtract.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { INeptorSettingsService } from '../common/neptorSettingsService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

const CACHE_TTL_MS = 60_000;
const EXTRACT_DEBOUNCE_MS = 2000;

function avatarHueFromId(id: string): number {
	let h = 0;
	for (let i = 0; i < id.length; i += 1) {
		h = (h * 31 + id.charCodeAt(i)) % 360;
	}
	return h;
}

function apiBase(orgApiUrl: string): string {
	return orgApiUrl.trim().replace(/\/$/, '');
}

function pathBasename(path: string): string {
	const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
	return parts[parts.length - 1] ?? path;
}

export class NeptorOrgCollaborationService extends Disposable implements INeptorOrgCollaborationService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private _teamInstructionsCache = '';
	private _cacheOrgId: string | null = null;
	private _cacheAt = 0;
	private _rulesStorage: 'memwal' | 'database' | 'none' = 'none';
	private _walrusBlobId: string | null = null;
	private _extractTimer: ReturnType<typeof setTimeout> | null = null;
	private _extractPending: string | null = null;

	constructor(
		@INeptorOrganizationService private readonly _orgService: INeptorOrganizationService,
		@INeptorSettingsService private readonly _settingsService: INeptorSettingsService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) {
		super();
		this._register(this._orgService.onDidChange(() => {
			const org = this._orgService.getActiveOrganization();
			if (org?.id !== this._cacheOrgId) {
				this._teamInstructionsCache = '';
				this._cacheOrgId = null;
				void this.refreshTeamInstructions();
			}
		}));
		this._register(orgActivityBus.event(payload => {
			const orgId = payload.orgId ?? this._orgService.getActiveOrganization()?.id;
			if (!orgId) {
				return;
			}
			if (payload.kind === 'org_created') {
				void this.syncOrganization(orgId);
				if (payload.memberId) {
					void this.syncMember(orgId, payload.memberId);
				}
			}
			if (payload.kind === 'member_joined' && payload.memberId) {
				void this.syncOrganization(orgId);
				void this.syncMember(orgId, payload.memberId);
			}
			void this.recordActivity({
				kind: 'team_event',
				summary: payload.summary,
			});
		}));
	}

	isEnabled(): boolean {
		return Boolean(this._orgApiUrl());
	}

	getTeamRulesStorage(): 'memwal' | 'database' | 'none' {
		return this._rulesStorage;
	}

	getTeamRulesWalrusBlobId(): string | null {
		return this._walrusBlobId;
	}

	getTeamInstructionsSync(): string {
		const org = this._orgService.getActiveOrganization();
		if (!org || !this.isEnabled()) {
			return '';
		}
		if (this._cacheOrgId === org.id && Date.now() - this._cacheAt < CACHE_TTL_MS) {
			return this._teamInstructionsCache;
		}
		void this.refreshTeamInstructions();
		return this._teamInstructionsCache;
	}

	async refreshTeamInstructions(): Promise<void> {
		const org = this._orgService.getActiveOrganization();
		const base = this._orgApiUrl();
		if (!org || !base) {
			this._teamInstructionsCache = '';
			this._cacheOrgId = null;
			this._rulesStorage = 'none';
			this._walrusBlobId = null;
			return;
		}
		try {
			const res = await fetch(`${apiBase(base)}/v1/orgs/${encodeURIComponent(org.id)}/rules`, {
				headers: this._actorHeaders(),
			});
			if (!res.ok) {
				return;
			}
			const data = await res.json() as {
				rules?: string[];
				storage?: 'memwal' | 'walrus' | 'database' | 'none';
				walrusBlobId?: string | null;
			};
			const rules = Array.isArray(data.rules) ? data.rules : [];
			this._teamInstructionsCache = rules.length
				? rules.map((r, i) => `${i + 1}. ${r}`).join('\n')
				: '';
			this._cacheOrgId = org.id;
			this._cacheAt = Date.now();
			this._rulesStorage = (data.storage === 'memwal' || data.storage === 'walrus') ? 'memwal' : (rules.length ? 'database' : 'none');
			this._walrusBlobId = data.walrusBlobId ?? null;
			this._onDidChange.fire();
		} catch {
			// keep stale cache
		}
	}

	onUserPrompt(promptText: string, threadLabel?: string): void {
		if (!this.isEnabled()) {
			return;
		}
		const user = this._orgService.getCurrentUser();
		const org = this._orgService.getActiveOrganization();
		if (!user || !org) {
			return;
		}
		const summary = promptText.trim().length > 80
			? `${promptText.trim().slice(0, 77)}...`
			: promptText.trim();
		void this.recordActivity({
			kind: 'chat_message',
			summary: `Asked: ${summary}`,
			threadLabel: threadLabel ?? 'Chat',
		});
		this._extractPending = promptText;
		if (this._extractTimer) {
			clearTimeout(this._extractTimer);
		}
		this._extractTimer = setTimeout(() => {
			const text = this._extractPending;
			this._extractPending = null;
			this._extractTimer = null;
			if (text) {
				void this._extractAndMergeRules(text);
			}
		}, EXTRACT_DEBOUNCE_MS);
	}

	private _workspaceMetadataForUri(uri?: string): { workspaceFolderName?: string; workspaceFolderFsPath?: string } {
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (!folders.length) {
			return {};
		}
		const normalizedUri = uri?.replace(/^file:\/\//, '').replace(/\\/g, '/');
		const folder = normalizedUri
			? folders.find(folder => normalizedUri.startsWith(folder.uri.fsPath.replace(/\\/g, '/')))
			: folders[0];
		const workspaceFolder = folder ?? folders[0];
		return {
			workspaceFolderName: workspaceFolder.name || pathBasename(workspaceFolder.uri.fsPath),
			workspaceFolderFsPath: workspaceFolder.uri.fsPath,
		};
	}

	async recordActivity(input: {
		kind: OrgCollaborationActivityKind;
		summary: string;
		uri?: string;
		artifactType?: string;
		threadLabel?: string;
	}): Promise<void> {
		const org = this._orgService.getActiveOrganization();
		const base = this._orgApiUrl();
		const user = this._orgService.getCurrentUser();
		if (!org || !base) {
			return;
		}
		try {
			void this.syncOrganization(org.id);
			const workspaceMetadata = this._workspaceMetadataForUri(input.uri);
			const res = await fetch(`${apiBase(base)}/v1/orgs/${encodeURIComponent(org.id)}/activity`, {
				method: 'POST',
				headers: { ...this._actorHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					kind: input.kind,
					summary: input.summary,
					orgName: org.name,
					orgSlug: org.slug,
					orgDescription: org.description,
					ownerId: org.ownerId,
					userId: user?.id,
					email: user?.email,
					displayName: user?.displayName,
					metadata: {
						uri: input.uri,
						artifactType: input.artifactType,
						threadLabel: input.threadLabel,
						...workspaceMetadata,
					},
				}),
			});
			if (res.ok) {
				this._onDidChange.fire();
			}
		} catch {
			// non-fatal
		}
	}

	async fetchRecentActivity(limit = 50): Promise<OrgCollaborationActivityEvent[]> {
		const org = this._orgService.getActiveOrganization();
		const base = this._orgApiUrl();
		if (!org || !base) {
			return [];
		}
		try {
			const res = await fetch(
				`${apiBase(base)}/v1/orgs/${encodeURIComponent(org.id)}/activity?limit=${limit}`,
				{ headers: this._actorHeaders() },
			);
			if (!res.ok) {
				return [];
			}
			const data = await res.json() as { events?: Array<{
				id: string;
				orgId: string;
				userId?: string;
				kind: OrgCollaborationActivityKind;
				summary: string;
				timestampIso: string;
				actor?: { id: string; displayName: string; email?: string };
				metadata?: { uri?: string; artifactType?: string; threadLabel?: string };
			}> };
			return (data.events ?? []).map(ev => ({
				id: ev.id,
				orgId: ev.orgId,
				userId: ev.userId,
				kind: ev.kind,
				summary: ev.summary,
				timestampIso: ev.timestampIso,
				actor: {
					id: ev.actor?.id ?? ev.userId ?? ev.id,
					displayName: ev.actor?.displayName ?? 'Teammate',
					email: ev.actor?.email,
					avatarHue: avatarHueFromId(ev.actor?.id ?? ev.userId ?? ev.id),
				},
				uri: ev.metadata?.uri,
				artifactType: ev.metadata?.artifactType,
				threadLabel: ev.metadata?.threadLabel,
			}));
		} catch {
			return [];
		}
	}

	async syncOrganization(orgId: string): Promise<boolean> {
		const base = this._orgApiUrl();
		if (!base) {
			return false;
		}
		const org = this._orgService.getSnapshot().organizations.find(o => o.id === orgId);
		if (!org) {
			return false;
		}
		try {
			const res = await fetch(`${apiBase(base)}/v1/orgs`, {
				method: 'PUT',
				headers: { ...this._actorHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: org.id,
					name: org.name,
					slug: org.slug,
					description: org.description,
					ownerId: org.ownerId,
					createdAtIso: org.createdAtIso,
					updatedAtIso: org.updatedAtIso,
				}),
			});
			if (!res.ok) {
				const detail = await res.text().catch(() => '');
				this._notificationService.notify({
					severity: Severity.Warning,
					message: `Could not sync ${org.name} to database (${res.status}). ${detail || 'Check org-api is running.'}`,
				});
				return false;
			}
			return true;
		} catch (e) {
			const detail = e instanceof Error ? e.message : String(e);
			this._notificationService.notify({
				severity: Severity.Warning,
				message: `Could not sync ${org.name} to database. ${detail}`,
			});
			return false;
		}
	}

	async syncMember(orgId: string, memberId: string): Promise<boolean> {
		const base = this._orgApiUrl();
		if (!base) {
			return false;
		}
		const member = this._orgService.getSnapshot().members.find(m => m.id === memberId && m.orgId === orgId);
		if (!member) {
			return false;
		}
		const org = this._orgService.getSnapshot().organizations.find(o => o.id === orgId);
		try {
			await this.syncOrganization(orgId);
			const res = await fetch(`${apiBase(base)}/v1/members`, {
				method: 'PUT',
				headers: { ...this._actorHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: member.id,
					orgId: member.orgId,
					orgName: org?.name,
					orgSlug: org?.slug,
					orgDescription: org?.description,
					ownerId: org?.ownerId,
					userId: member.userId,
					email: member.email,
					displayName: member.displayName,
					role: member.role,
					joinedAtIso: member.joinedAtIso,
				}),
			});
			if (!res.ok) {
				const detail = await res.text().catch(() => '');
				this._notificationService.notify({
					severity: Severity.Warning,
					message: `Could not sync member ${member.email} (${res.status}). ${detail || 'Check org-api is running.'}`,
				});
				return false;
			}
			return true;
		} catch (e) {
			const detail = e instanceof Error ? e.message : String(e);
			this._notificationService.notify({
				severity: Severity.Warning,
				message: `Could not sync member ${member.email}. ${detail}`,
			});
			return false;
		}
	}

	private _orgApiUrl(): string {
		return this._orgService.getBackendSettings().orgApiUrl?.trim() ?? '';
	}

	private _actorHeaders(): Record<string, string> {
		const user = this._orgService.getCurrentUser();
		const headers: Record<string, string> = {};
		if (user?.id) {
			headers['X-Neptor-User-Id'] = user.id;
		}
		if (user?.email) {
			headers['X-Neptor-User-Email'] = user.email;
		}
		if (user?.displayName) {
			headers['X-Neptor-Display-Name'] = user.displayName;
		}
		return headers;
	}

	private async _extractAndMergeRules(promptText: string): Promise<void> {
		const org = this._orgService.getActiveOrganization();
		const base = this._orgApiUrl();
		if (!org || !base) {
			return;
		}
		try {
			const modelSelection = this._settingsService.state.modelSelectionOfFeature['Chat'] ?? null;
			const modelSelectionOptions = modelSelection
				? this._settingsService.state.optionsOfModelSelection['Chat'][modelSelection.providerName]?.[modelSelection.modelName]
				: undefined;
			const { messages, separateSystemMessage } = this._instantiationService.invokeFunction(accessor =>
				accessor.get(IConvertToLLMMessageService).prepareLLMSimpleMessages({
					simpleMessages: [{ role: 'user', content: promptText }],
					systemMessage: teamInstructionExtractSystemMessage,
					modelSelection,
					featureName: 'Chat',
				})
			);
			const raw = await new Promise<string>((resolve, reject) => {
				const token = this._llmMessageService.sendLLMMessage({
					messagesType: 'chatMessages',
					messages,
					separateSystemMessage,
					modelSelection,
					modelSelectionOptions,
					overridesOfModel: this._settingsService.state.overridesOfModel,
					chatMode: null,
					logging: { loggingName: 'Neptor team rule extract' },
					onText: () => { },
					onFinalMessage: ({ fullText }) => resolve(fullText),
					onError: (e) => reject(new Error(e.message)),
					onAbort: () => reject(new Error('aborted')),
				});
				if (!token) {
					reject(new Error('LLM not started'));
				}
			});
			const rules = parseExtractedRulesJson(raw);
			if (rules.length === 0) {
				return;
			}
			const res = await fetch(`${apiBase(base)}/v1/orgs/${encodeURIComponent(org.id)}/rules/merge`, {
				method: 'POST',
				headers: { ...this._actorHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ rules: rules.map(r => ({ text: r.text, category: r.category })) }),
			});
			if (!res.ok) {
				return;
			}
			const result = await res.json() as { added?: number; storage?: string };
			await this.refreshTeamInstructions();
			if (result.added && result.added > 0) {
				const suffix = (result.storage === 'memwal' || result.storage === 'walrus') ? ' on Walrus Memory' : '';
				this._notificationService.notify({
					severity: Severity.Info,
					message: `${result.added} team rule(s) saved for ${org.name}${suffix}.`,
				});
			}
		} catch {
			// extraction is best-effort
		}
	}
}

registerSingleton(INeptorOrgCollaborationService, NeptorOrgCollaborationService, InstantiationType.Delayed);
