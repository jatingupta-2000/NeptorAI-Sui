/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import {
	INeptorOrganizationService,
	NeptorOrganization,
	NeptorOrganizationBackendSettings,
	NeptorOrganizationInvite,
	NeptorOrganizationInvitePreview,
	NeptorOrganizationInviteStats,
	NeptorOrganizationMember,
	NeptorOrganizationSnapshot,
	NeptorOrganizationUser,
} from '../common/neptorOrganizationService.js';
import { NEPTOR_ORGANIZATION_STORAGE_KEY } from '../common/storageKeys.js';
import { orgActivityBus } from '../common/neptorOrgActivityBus.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_BACKEND: NeptorOrganizationBackendSettings = {
	appBaseUrl: '',
	inviteApiUrl: '',
	inviteFromEmail: 'no-reply@noderails.com',
	orgApiUrl: '',
};

function emailOk(raw: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

function slugify(name: string): string {
	const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	return slug || `org-${Date.now().toString(36)}`;
}

const DEFAULT_ACTIVE_ORG_NAME = 'AutoPay Organization';

function normalizeOrgToken(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveDefaultOrgId(
	organizations: NeptorOrganization[],
	orgIds: string[],
	preferredName = DEFAULT_ACTIVE_ORG_NAME,
): string | null {
	if (orgIds.length === 0) {
		return null;
	}
	const orgById = new Map(organizations.map(org => [org.id, org]));
	const candidates = orgIds
		.map(id => orgById.get(id))
		.filter((org): org is NeptorOrganization => Boolean(org));
	const preferredNorm = normalizeOrgToken(preferredName);
	const preferredTokens = preferredNorm ? [preferredNorm] : [];
	if (preferredNorm.includes('autopay')) {
		preferredTokens.push('autopay');
	}
	for (const org of candidates) {
		const nameNorm = normalizeOrgToken(org.name);
		const slugNorm = normalizeOrgToken(org.slug);
		if (preferredTokens.some(token => nameNorm.includes(token) || slugNorm.includes(token))) {
			return org.id;
		}
	}
	const needle = preferredName.trim().toLowerCase();
	if (needle) {
		for (const org of candidates) {
			if (org.name.toLowerCase().includes(needle) || org.slug.toLowerCase().includes(needle)) {
				return org.id;
			}
		}
	}
	return orgIds[0] ?? null;
}

function emptySnapshot(): NeptorOrganizationSnapshot {
	return {
		currentUser: null,
		organizations: [],
		members: [],
		invites: [],
		activeOrgId: null,
		backend: { ...DEFAULT_BACKEND },
	};
}

export class NeptorOrganizationService extends Disposable implements INeptorOrganizationService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private _snapshot: NeptorOrganizationSnapshot;
	private readonly _remoteSyncInFlight = new Set<string>();
	private readonly _lastRemoteSyncAt = new Map<string, number>();
	private _myOrgsSyncInFlight = false;
	private _lastMyOrgsSyncAt = 0;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();
		this._snapshot = this._load();
		this._expireStaleInvites();
		if (this._snapshot.currentUser) {
			void this.refreshMyOrganizationsFromDatabase();
		}
	}

	private _persist(): void {
		this._storageService.store(
			NEPTOR_ORGANIZATION_STORAGE_KEY,
			JSON.stringify(this._snapshot),
			StorageScope.APPLICATION,
			StorageTarget.USER,
		);
		this._onDidChange.fire();
	}

	private _orgApiBase(): string {
		return this._snapshot.backend.orgApiUrl.trim().replace(/\/$/, '');
	}

	private _actorHeaders(): Record<string, string> {
		const user = this._snapshot.currentUser;
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

	private async _refreshOrgPeopleFromDatabase(orgId: string): Promise<void> {
		const base = this._orgApiBase();
		if (!base || !orgId) {
			return;
		}
		const last = this._lastRemoteSyncAt.get(orgId) ?? 0;
		if (Date.now() - last < 15_000 || this._remoteSyncInFlight.has(orgId)) {
			return;
		}
		this._remoteSyncInFlight.add(orgId);
		try {
			const [membersRes, invitesRes] = await Promise.all([
				fetch(`${base}/v1/orgs/${encodeURIComponent(orgId)}/members`, { headers: this._actorHeaders() }),
				fetch(`${base}/v1/orgs/${encodeURIComponent(orgId)}/invites`, { headers: this._actorHeaders() }),
			]);
			let changed = false;
			if (membersRes.ok) {
				const data = await membersRes.json() as { members?: NeptorOrganizationMember[] };
				if (Array.isArray(data.members)) {
					const localMembers = this._snapshot.members.filter(m => m.orgId === orgId);
					const merged = new Map<string, NeptorOrganizationMember>();
					for (const member of localMembers) {
						merged.set(member.id, member);
					}
					for (const member of data.members) {
						merged.set(member.id, member);
					}
					this._snapshot = {
						...this._snapshot,
						members: [
							...this._snapshot.members.filter(m => m.orgId !== orgId),
							...merged.values(),
						],
					};
					changed = true;
				}
			}
			if (invitesRes.ok) {
				const data = await invitesRes.json() as { invites?: NeptorOrganizationInvite[] };
				if (Array.isArray(data.invites)) {
					const localInvites = this._snapshot.invites.filter(i => i.orgId === orgId);
					const merged = new Map<string, NeptorOrganizationInvite>();
					for (const invite of localInvites) {
						merged.set(invite.id, invite);
					}
					for (const invite of data.invites) {
						merged.set(invite.id, invite);
					}
					this._snapshot = {
						...this._snapshot,
						invites: [
							...this._snapshot.invites.filter(i => i.orgId !== orgId),
							...merged.values(),
						],
					};
					changed = true;
				}
			}
			this._lastRemoteSyncAt.set(orgId, Date.now());
			if (changed) {
				this._persist();
			}
		} catch {
			// Local snapshot remains the fallback when org-api or Supabase is unavailable.
		} finally {
			this._remoteSyncInFlight.delete(orgId);
		}
	}

	private _applyRemoteOrganizationBundle(data: {
		organizations?: NeptorOrganization[];
		members?: NeptorOrganizationMember[];
		invites?: NeptorOrganizationInvite[];
	}): void {
		const remoteOrgs = Array.isArray(data.organizations) ? data.organizations : [];
		const remoteMembers = Array.isArray(data.members) ? data.members : [];
		const remoteInvites = Array.isArray(data.invites) ? data.invites : [];
		if (!remoteOrgs.length && !remoteMembers.length && !remoteInvites.length) {
			return;
		}

		const orgMap = new Map(this._snapshot.organizations.map(org => [org.id, org]));
		for (const org of remoteOrgs) {
			const local = orgMap.get(org.id);
			orgMap.set(org.id, local ? { ...local, ...org } : org);
		}

		const remoteOrgIds = new Set([
			...remoteOrgs.map(org => org.id),
			...remoteMembers.map(member => member.orgId),
			...remoteInvites.map(invite => invite.orgId),
		]);
		const localOnlyOrgs = this._snapshot.organizations.filter(org => !remoteOrgIds.has(org.id));

		const keptMembers = this._snapshot.members.filter(member => !remoteOrgIds.has(member.orgId));
		const memberMap = new Map(keptMembers.map(member => [member.id, member]));
		for (const member of remoteMembers) {
			memberMap.set(member.id, member);
		}

		const keptInvites = this._snapshot.invites.filter(invite => !remoteOrgIds.has(invite.orgId));
		const inviteMap = new Map(keptInvites.map(invite => [invite.id, invite]));
		for (const invite of remoteInvites) {
			inviteMap.set(invite.id, invite);
		}

		let currentUser = this._snapshot.currentUser;
		if (currentUser) {
			const dbMembership = remoteMembers.find(
				member => member.email.toLowerCase() === currentUser!.email.toLowerCase(),
			);
			if (dbMembership && dbMembership.userId !== currentUser.id) {
				const previousUserId = currentUser.id;
				currentUser = { ...currentUser, id: dbMembership.userId };
				for (const member of memberMap.values()) {
					if (member.userId === previousUserId) {
						memberMap.set(member.id, { ...member, userId: dbMembership.userId });
					}
				}
			}
		}

		const activeOrgId = (() => {
			if (!currentUser) {
				return this._snapshot.activeOrgId;
			}
			const orgIds = [...memberMap.values()]
				.filter(member => member.userId === currentUser.id)
				.map(member => member.orgId);
			if (!orgIds.length) {
				return null;
			}
			const current = this._snapshot.activeOrgId;
			if (current && orgIds.includes(current)) {
				return current;
			}
			return resolveDefaultOrgId([...orgMap.values(), ...localOnlyOrgs], orgIds);
		})();

		this._snapshot = {
			...this._snapshot,
			currentUser,
			organizations: [...orgMap.values(), ...localOnlyOrgs],
			members: [...memberMap.values()],
			invites: [...inviteMap.values()],
			activeOrgId,
		};
		this._persist();
	}

	async refreshMyOrganizationsFromDatabase(force = false): Promise<boolean> {
		const base = this._orgApiBase();
		const user = this._snapshot.currentUser;
		if (!base || !user?.email) {
			return false;
		}
		if (!force && (Date.now() - this._lastMyOrgsSyncAt < 15_000 || this._myOrgsSyncInFlight)) {
			return false;
		}
		this._myOrgsSyncInFlight = true;
		try {
			const res = await fetch(`${base}/v1/my-orgs`, {
				headers: this._actorHeaders(),
			});
			if (!res.ok) {
				return false;
			}
			const data = await res.json() as {
				organizations?: NeptorOrganization[];
				members?: NeptorOrganizationMember[];
				invites?: NeptorOrganizationInvite[];
			};
			this._applyRemoteOrganizationBundle(data);
			this._lastMyOrgsSyncAt = Date.now();
			return true;
		} catch {
			return false;
		} finally {
			this._myOrgsSyncInFlight = false;
		}
	}

	private async _syncInviteToDatabase(invite: NeptorOrganizationInvite): Promise<void> {
		const base = this._orgApiBase();
		if (!base) {
			return;
		}
		try {
			const res = await fetch(`${base}/v1/orgs/${encodeURIComponent(invite.orgId)}/invites`, {
				method: 'POST',
				headers: { ...this._actorHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify(invite),
			});
			if (!res.ok) {
				return;
			}
			const data = await res.json() as { invite?: NeptorOrganizationInvite };
			if (data.invite) {
				this._snapshot = {
					...this._snapshot,
					invites: this._snapshot.invites.map(i => i.id === invite.id ? data.invite! : i),
				};
				this._persist();
			}
		} catch {
			// Non-fatal. The local invite remains visible and can be synced later.
		}
	}

	private async _patchInviteStatusInDatabase(invite: NeptorOrganizationInvite): Promise<void> {
		const base = this._orgApiBase();
		if (!base) {
			return;
		}
		try {
			await fetch(`${base}/v1/orgs/${encodeURIComponent(invite.orgId)}/invites/${encodeURIComponent(invite.id)}`, {
				method: 'PATCH',
				headers: { ...this._actorHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({
					status: invite.status,
					acceptedAtIso: invite.acceptedAtIso,
					rejectedAtIso: invite.rejectedAtIso,
				}),
			});
		} catch {
			// Non-fatal. Local status remains the immediate UI state.
		}
	}

	private _load(): NeptorOrganizationSnapshot {
		const raw = this._storageService.get(NEPTOR_ORGANIZATION_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return emptySnapshot();
		}
		try {
			const parsed = JSON.parse(raw) as Partial<NeptorOrganizationSnapshot>;
			return {
				...emptySnapshot(),
				...parsed,
				backend: { ...DEFAULT_BACKEND, ...(parsed.backend ?? {}) },
			};
		} catch {
			return emptySnapshot();
		}
	}

	private _expireStaleInvites(): void {
		const now = Date.now();
		let changed = false;
		for (const inv of this._snapshot.invites) {
			if (inv.status === 'pending' && Date.parse(inv.expiresAtIso) < now) {
				inv.status = 'expired';
				changed = true;
			}
		}
		if (changed) {
			this._persist();
		}
	}

	private _requireUser(): NeptorOrganizationUser {
		const user = this._snapshot.currentUser;
		if (!user) {
			throw new Error('Sign in before using organization features.');
		}
		return user;
	}

	private _orgById(orgId: string): NeptorOrganization | undefined {
		return this._snapshot.organizations.find(o => o.id === orgId);
	}

	private _memberForUser(orgId: string, userId: string): NeptorOrganizationMember | undefined {
		return this._snapshot.members.find(m => m.orgId === orgId && m.userId === userId);
	}

	private _canManageOrg(orgId: string): boolean {
		const user = this._snapshot.currentUser;
		if (!user) {
			return false;
		}
		const member = this._memberForUser(orgId, user.id);
		return member?.role === 'owner' || member?.role === 'admin';
	}

	/** Reuse a stable user id for an email already present in member records. */
	private _resolveUserIdForEmail(email: string): string | undefined {
		const matches = this._snapshot.members.filter(m => m.email === email);
		if (matches.length === 0) {
			return undefined;
		}
		if (matches.length === 1) {
			return matches[0].userId;
		}
		const owner = matches.find(m => m.role === 'owner');
		if (owner) {
			return owner.userId;
		}
		return matches
			.slice()
			.sort((a, b) => Date.parse(a.joinedAtIso) - Date.parse(b.joinedAtIso))[0]
			.userId;
	}

	private _activeOrgIdForUser(userId: string): string | null {
		const orgIds = this._snapshot.members
			.filter(m => m.userId === userId)
			.map(m => m.orgId);
		if (orgIds.length === 0) {
			return null;
		}
		const current = this._snapshot.activeOrgId;
		if (current && orgIds.includes(current)) {
			return current;
		}
		return resolveDefaultOrgId(this._snapshot.organizations, orgIds);
	}

	private _uniqueSlug(base: string, excludeOrgId?: string): string {
		let slug = slugify(base);
		const taken = new Set(
			this._snapshot.organizations
				.filter(o => o.id !== excludeOrgId)
				.map(o => o.slug),
		);
		if (!taken.has(slug)) {
			return slug;
		}
		let n = 2;
		while (taken.has(`${slug}-${n}`)) {
			n += 1;
		}
		return `${slug}-${n}`;
	}

	private async _dispatchInviteEmail(invite: NeptorOrganizationInvite, org: NeptorOrganization): Promise<void> {
		const acceptUrl = this.getInviteAcceptUrl(invite.token);
		const { inviteApiUrl, inviteFromEmail } = this._snapshot.backend;
		if (!inviteApiUrl.trim()) {
			this._notificationService.notify({
				severity: Severity.Info,
				message: `Invite created for ${invite.email}. Configure invite API URL in Organizations → Email settings, or copy the accept link.`,
			});
			return;
		}
		const inviterMember = this._snapshot.members.find(m => m.userId === invite.invitedByUserId);
		const inviterDisplayName = inviterMember?.displayName
			|| this._snapshot.currentUser?.displayName
			|| '';
		try {
			const res = await fetch(inviteApiUrl.trim(), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					to: invite.email,
					from: inviteFromEmail.trim() || undefined,
					orgName: org.name,
					acceptUrl,
					token: invite.token,
					inviterDisplayName,
					expiresAtIso: invite.expiresAtIso,
				}),
			});
			if (!res.ok) {
				throw new Error(`Invite API returned ${res.status}`);
			}
			this._notificationService.notify({
				severity: Severity.Info,
				message: `Invite email sent to ${invite.email}.`,
			});
		} catch (e) {
			const detail = e instanceof Error ? e.message : String(e);
			this._notificationService.notify({
				severity: Severity.Warning,
				message: `Invite saved but email failed (${detail}). Copy accept link from Organizations.`,
			});
		}
	}

	getSnapshot(): NeptorOrganizationSnapshot {
		return {
			...this._snapshot,
			organizations: this._snapshot.organizations.slice(),
			members: this._snapshot.members.slice(),
			invites: this._snapshot.invites.slice(),
			backend: { ...this._snapshot.backend },
		};
	}

	getCurrentUser(): NeptorOrganizationUser | null {
		return this._snapshot.currentUser;
	}

	getActiveOrganization(): NeptorOrganization | null {
		if (!this._snapshot.activeOrgId) {
			return null;
		}
		return this._orgById(this._snapshot.activeOrgId) ?? null;
	}

	listMyOrganizations(): NeptorOrganization[] {
		const user = this._snapshot.currentUser;
		if (!user) {
			return [];
		}
		const orgIds = new Set(
			this._snapshot.members.filter(m => m.userId === user.id).map(m => m.orgId),
		);
		return this._snapshot.organizations.filter(o => orgIds.has(o.id));
	}

	async signInLocal(input: { email: string; displayName: string }): Promise<NeptorOrganizationUser> {
		const email = input.email.trim().toLowerCase();
		const displayNameInput = input.displayName.trim();
		if (!emailOk(email)) {
			throw new Error('Enter a valid email address.');
		}
		const prev = this._snapshot.currentUser;
		const sameSessionEmail = prev?.email === email;
		const existingMember = this._snapshot.members.find(m => m.email === email);
		const resolvedId = sameSessionEmail && prev
			? prev.id
			: (this._resolveUserIdForEmail(email) ?? `user-${generateUuid()}`);
		const displayName = displayNameInput
			|| existingMember?.displayName
			|| prev?.displayName
			|| email.split('@')[0]
			|| 'You';
		const user: NeptorOrganizationUser = {
			id: resolvedId,
			email,
			displayName,
		};
		const activeOrgId = this._activeOrgIdForUser(user.id);
		this._snapshot = { ...this._snapshot, currentUser: user, activeOrgId };
		this._persist();
		await this.refreshMyOrganizationsFromDatabase(true);
		return this._snapshot.currentUser ?? user;
	}

	async signOut(): Promise<void> {
		this._snapshot = { ...this._snapshot, currentUser: null, activeOrgId: null };
		this._persist();
	}

	async createOrganization(input: { name: string; description?: string }): Promise<NeptorOrganization> {
		const user = this._requireUser();
		const name = input.name.trim();
		if (!name) {
			throw new Error('Organization name is required.');
		}
		const now = new Date().toISOString();
		const org: NeptorOrganization = {
			id: `org-${generateUuid()}`,
			name,
			slug: this._uniqueSlug(name),
			description: (input.description ?? '').trim(),
			ownerId: user.id,
			createdAtIso: now,
			updatedAtIso: now,
		};
		const member: NeptorOrganizationMember = {
			id: `member-${generateUuid()}`,
			orgId: org.id,
			userId: user.id,
			email: user.email,
			displayName: user.displayName,
			role: 'owner',
			joinedAtIso: now,
		};
		this._snapshot = {
			...this._snapshot,
			organizations: [...this._snapshot.organizations, org],
			members: [...this._snapshot.members, member],
			activeOrgId: org.id,
		};
		this._persist();
		orgActivityBus.fire({
			kind: 'org_created',
			summary: `${user.displayName} created organization ${org.name}`,
			orgId: org.id,
			memberId: member.id,
		});
		return org;
	}

	async updateOrganization(orgId: string, input: { name?: string; description?: string }): Promise<NeptorOrganization> {
		this._requireUser();
		if (!this._canManageOrg(orgId)) {
			throw new Error('Only owners and admins can update an organization.');
		}
		const org = this._orgById(orgId);
		if (!org) {
			throw new Error('Organization not found.');
		}
		const name = input.name !== undefined ? input.name.trim() : org.name;
		if (!name) {
			throw new Error('Organization name is required.');
		}
		const updated: NeptorOrganization = {
			...org,
			name,
			description: input.description !== undefined ? input.description.trim() : org.description,
			slug: name !== org.name ? this._uniqueSlug(name, orgId) : org.slug,
			updatedAtIso: new Date().toISOString(),
		};
		this._snapshot = {
			...this._snapshot,
			organizations: this._snapshot.organizations.map(o => o.id === orgId ? updated : o),
		};
		this._persist();
		return updated;
	}

	async deleteOrganization(orgId: string): Promise<void> {
		const user = this._requireUser();
		const org = this._orgById(orgId);
		if (!org) {
			throw new Error('Organization not found.');
		}
		if (org.ownerId !== user.id) {
			throw new Error('Only the organization owner can delete it.');
		}
		this._snapshot = {
			...this._snapshot,
			organizations: this._snapshot.organizations.filter(o => o.id !== orgId),
			members: this._snapshot.members.filter(m => m.orgId !== orgId),
			invites: this._snapshot.invites.filter(i => i.orgId !== orgId),
			activeOrgId: this._snapshot.activeOrgId === orgId
				? (this._snapshot.organizations.find(o => o.id !== orgId)?.id ?? null)
				: this._snapshot.activeOrgId,
		};
		this._persist();
	}

	async setActiveOrganization(orgId: string): Promise<void> {
		const user = this._requireUser();
		if (!this._memberForUser(orgId, user.id)) {
			throw new Error('You are not a member of that organization.');
		}
		this._snapshot = { ...this._snapshot, activeOrgId: orgId };
		this._persist();
	}

	listMembers(orgId?: string): NeptorOrganizationMember[] {
		const id = orgId ?? this._snapshot.activeOrgId;
		if (id) {
			void this._refreshOrgPeopleFromDatabase(id);
		}
		return id ? this._snapshot.members.filter(m => m.orgId === id) : [];
	}

	listInvites(orgId?: string): NeptorOrganizationInvite[] {
		this._expireStaleInvites();
		const id = orgId ?? this._snapshot.activeOrgId;
		if (id) {
			void this._refreshOrgPeopleFromDatabase(id);
		}
		return id ? this._snapshot.invites.filter(i => i.orgId === id) : [];
	}

	listPendingInvites(orgId?: string): NeptorOrganizationInvite[] {
		return this.listInvites(orgId).filter(i => i.status === 'pending');
	}

	getMemberCount(orgId: string): number {
		return this._snapshot.members.filter(m => m.orgId === orgId).length;
	}

	getInviteStats(orgId: string): NeptorOrganizationInviteStats {
		const invites = this.listInvites(orgId);
		return {
			pending: invites.filter(i => i.status === 'pending').length,
			accepted: invites.filter(i => i.status === 'accepted').length,
			rejected: invites.filter(i => i.status === 'rejected').length,
			revoked: invites.filter(i => i.status === 'revoked').length,
			expired: invites.filter(i => i.status === 'expired').length,
		};
	}

	async sendInvite(email: string, orgId?: string): Promise<NeptorOrganizationInvite> {
		const user = this._requireUser();
		const targetOrgId = orgId ?? this._snapshot.activeOrgId;
		if (!targetOrgId) {
			throw new Error('Select an organization before sending invites.');
		}
		const org = this._orgById(targetOrgId);
		if (!org) {
			throw new Error('Organization not found.');
		}
		if (!this._canManageOrg(targetOrgId)) {
			throw new Error('Only owners and admins can send invites.');
		}
		const trimmed = email.trim().toLowerCase();
		if (!emailOk(trimmed)) {
			throw new Error('Enter a valid email address.');
		}
		if (this._snapshot.members.some(m => m.orgId === targetOrgId && m.email === trimmed)) {
			throw new Error('That email is already a member.');
		}
		if (this._snapshot.invites.some(i => i.orgId === targetOrgId && i.email === trimmed && i.status === 'pending')) {
			throw new Error('An invite is already pending for that email.');
		}
		const now = Date.now();
		const invite: NeptorOrganizationInvite = {
			id: `invite-${generateUuid()}`,
			orgId: targetOrgId,
			email: trimmed,
			role: 'member',
			token: generateUuid(),
			status: 'pending',
			invitedByUserId: user.id,
			sentAtIso: new Date(now).toISOString(),
			expiresAtIso: new Date(now + INVITE_TTL_MS).toISOString(),
		};
		this._snapshot = { ...this._snapshot, invites: [...this._snapshot.invites, invite] };
		this._persist();
		void this._syncInviteToDatabase(invite);
		await this._dispatchInviteEmail(invite, org);
		return invite;
	}

	async resendInvite(inviteId: string): Promise<NeptorOrganizationInvite> {
		this._requireUser();
		const invite = this._snapshot.invites.find(i => i.id === inviteId);
		if (!invite || invite.status !== 'pending') {
			throw new Error('Pending invite not found.');
		}
		if (!this._canManageOrg(invite.orgId)) {
			throw new Error('Only owners and admins can resend invites.');
		}
		const org = this._orgById(invite.orgId);
		if (!org) {
			throw new Error('Organization not found.');
		}
		const now = Date.now();
		const updated: NeptorOrganizationInvite = {
			...invite,
			sentAtIso: new Date(now).toISOString(),
			expiresAtIso: new Date(now + INVITE_TTL_MS).toISOString(),
		};
		this._snapshot = {
			...this._snapshot,
			invites: this._snapshot.invites.map(i => i.id === inviteId ? updated : i),
		};
		this._persist();
		void this._syncInviteToDatabase(updated);
		await this._dispatchInviteEmail(updated, org);
		return updated;
	}

	async revokeInvite(inviteId: string): Promise<void> {
		const invite = this._snapshot.invites.find(i => i.id === inviteId);
		if (!invite || invite.status !== 'pending') {
			throw new Error('Pending invite not found.');
		}
		if (!this._canManageOrg(invite.orgId)) {
			throw new Error('Only owners and admins can revoke invites.');
		}
		this._snapshot = {
			...this._snapshot,
			invites: this._snapshot.invites.map(i => i.id === inviteId ? { ...i, status: 'revoked' } : i),
		};
		this._persist();
		void this._patchInviteStatusInDatabase({ ...invite, status: 'revoked' });
	}

	resolveInviteToken(raw: string): string {
		const trimmed = raw.trim();
		const tokenFromUrl = trimmed.match(/[?&]token=([^&]+)/)?.[1];
		return tokenFromUrl ? decodeURIComponent(tokenFromUrl) : trimmed;
	}

	private _findInviteByToken(token: string): NeptorOrganizationInvite | undefined {
		this._expireStaleInvites();
		const resolved = this.resolveInviteToken(token);
		return this._snapshot.invites.find(i => i.token === resolved);
	}

	getInvitePreview(token: string): NeptorOrganizationInvitePreview | null {
		const invite = this._findInviteByToken(token);
		if (!invite) {
			return null;
		}
		const org = this._orgById(invite.orgId);
		const inviterMember = this._snapshot.members.find(
			m => m.orgId === invite.orgId && m.userId === invite.invitedByUserId,
		);
		return {
			invite,
			orgName: org?.name ?? 'Organization',
			inviterDisplayName: inviterMember?.displayName ?? 'A teammate',
		};
	}

	listIncomingInvites(): NeptorOrganizationInvite[] {
		const user = this._snapshot.currentUser;
		if (!user) {
			return [];
		}
		this._expireStaleInvites();
		return this._snapshot.invites.filter(i => i.status === 'pending' && i.email === user.email);
	}

	async acceptInvite(token: string): Promise<NeptorOrganizationMember> {
		const user = this._requireUser();
		const invite = this._findInviteByToken(token);
		if (!invite) {
			throw new Error('Invite not found.');
		}
		if (invite.status !== 'pending') {
			throw new Error(`Invite is ${invite.status}.`);
		}
		if (invite.email !== user.email) {
			throw new Error('Sign in with the email address that received the invite.');
		}
		const existing = this._memberForUser(invite.orgId, user.id);
		if (existing) {
			this._snapshot = {
				...this._snapshot,
				invites: this._snapshot.invites.map(i =>
					i.id === invite.id ? { ...i, status: 'accepted', acceptedAtIso: new Date().toISOString() } : i),
				activeOrgId: invite.orgId,
			};
			this._persist();
			void this._patchInviteStatusInDatabase({ ...invite, status: 'accepted', acceptedAtIso: new Date().toISOString() });
			return existing;
		}
		const now = new Date().toISOString();
		const member: NeptorOrganizationMember = {
			id: `member-${generateUuid()}`,
			orgId: invite.orgId,
			userId: user.id,
			email: user.email,
			displayName: user.displayName,
			role: invite.role,
			joinedAtIso: now,
		};
		this._snapshot = {
			...this._snapshot,
			members: [...this._snapshot.members, member],
			invites: this._snapshot.invites.map(i =>
				i.id === invite.id ? { ...i, status: 'accepted', acceptedAtIso: now } : i),
			activeOrgId: invite.orgId,
		};
		this._persist();
		void this._patchInviteStatusInDatabase({ ...invite, status: 'accepted', acceptedAtIso: now });
		const org = this._orgById(invite.orgId);
		orgActivityBus.fire({
			kind: 'member_joined',
			summary: `${user.displayName} joined ${org?.name ?? 'the organization'}`,
			orgId: invite.orgId,
			memberId: member.id,
		});
		return member;
	}

	async rejectInvite(token: string): Promise<void> {
		const user = this._requireUser();
		const invite = this._findInviteByToken(token);
		if (!invite) {
			throw new Error('Invite not found.');
		}
		if (invite.status !== 'pending') {
			throw new Error(`Invite is ${invite.status}.`);
		}
		if (invite.email !== user.email) {
			throw new Error('Sign in with the email address that received the invite.');
		}
		const now = new Date().toISOString();
		this._snapshot = {
			...this._snapshot,
			invites: this._snapshot.invites.map(i =>
				i.id === invite.id ? { ...i, status: 'rejected', rejectedAtIso: now } : i),
		};
		this._persist();
		void this._patchInviteStatusInDatabase({ ...invite, status: 'rejected', rejectedAtIso: now });
	}

	getInviteAcceptUrl(token: string): string {
		const base = this._snapshot.backend.appBaseUrl.trim();
		const path = `/invite/accept?token=${encodeURIComponent(token)}`;
		if (base) {
			return `${base.replace(/\/$/, '')}${path}`;
		}
		return `neptor://invite/accept?token=${encodeURIComponent(token)}`;
	}

	getBackendSettings(): NeptorOrganizationBackendSettings {
		return { ...this._snapshot.backend };
	}

	async updateBackendSettings(patch: Partial<NeptorOrganizationBackendSettings>): Promise<void> {
		this._snapshot = {
			...this._snapshot,
			backend: { ...this._snapshot.backend, ...patch },
		};
		this._persist();
	}
}

registerSingleton(INeptorOrganizationService, NeptorOrganizationService, InstantiationType.Delayed);
