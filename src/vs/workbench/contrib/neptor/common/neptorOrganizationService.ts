/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export type NeptorOrganizationRole = 'owner' | 'admin' | 'member';

export type NeptorOrganizationInviteStatus = 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired';

export interface NeptorOrganizationUser {
	id: string;
	email: string;
	displayName: string;
}

export interface NeptorOrganization {
	id: string;
	name: string;
	slug: string;
	description: string;
	ownerId: string;
	createdAtIso: string;
	updatedAtIso: string;
}

export interface NeptorOrganizationMember {
	id: string;
	orgId: string;
	userId: string;
	email: string;
	displayName: string;
	role: NeptorOrganizationRole;
	joinedAtIso: string;
}

export interface NeptorOrganizationInvite {
	id: string;
	orgId: string;
	email: string;
	role: NeptorOrganizationRole;
	token: string;
	status: NeptorOrganizationInviteStatus;
	invitedByUserId: string;
	sentAtIso: string;
	expiresAtIso: string;
	acceptedAtIso?: string;
	rejectedAtIso?: string;
}

export interface NeptorOrganizationInvitePreview {
	invite: NeptorOrganizationInvite;
	orgName: string;
	inviterDisplayName: string;
}

export interface NeptorOrganizationBackendSettings {
	appBaseUrl: string;
	inviteApiUrl: string;
	inviteFromEmail: string;
	/** Base URL for org API (e.g. http://localhost:8788). Team rules + activity. */
	orgApiUrl: string;
}

export interface NeptorOrganizationInviteStats {
	pending: number;
	accepted: number;
	rejected: number;
	revoked: number;
	expired: number;
}

export interface NeptorOrganizationSnapshot {
	currentUser: NeptorOrganizationUser | null;
	organizations: NeptorOrganization[];
	members: NeptorOrganizationMember[];
	invites: NeptorOrganizationInvite[];
	activeOrgId: string | null;
	backend: NeptorOrganizationBackendSettings;
}

export const INeptorOrganizationService = createDecorator<INeptorOrganizationService>('neptorOrganizationService');

export interface INeptorOrganizationService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;

	getSnapshot(): NeptorOrganizationSnapshot;
	getCurrentUser(): NeptorOrganizationUser | null;
	getActiveOrganization(): NeptorOrganization | null;
	listMyOrganizations(): NeptorOrganization[];

	signInLocal(input: { email: string; displayName: string }): Promise<NeptorOrganizationUser>;
	signOut(): Promise<void>;

	createOrganization(input: { name: string; description?: string }): Promise<NeptorOrganization>;
	updateOrganization(orgId: string, input: { name?: string; description?: string }): Promise<NeptorOrganization>;
	deleteOrganization(orgId: string): Promise<void>;
	setActiveOrganization(orgId: string): Promise<void>;

	listMembers(orgId?: string): NeptorOrganizationMember[];
	listInvites(orgId?: string): NeptorOrganizationInvite[];
	listPendingInvites(orgId?: string): NeptorOrganizationInvite[];
	getMemberCount(orgId: string): number;
	getInviteStats(orgId: string): NeptorOrganizationInviteStats;

	sendInvite(email: string, orgId?: string): Promise<NeptorOrganizationInvite>;
	resendInvite(inviteId: string): Promise<NeptorOrganizationInvite>;
	revokeInvite(inviteId: string): Promise<void>;
	resolveInviteToken(raw: string): string;
	getInvitePreview(token: string): NeptorOrganizationInvitePreview | null;
	listIncomingInvites(): NeptorOrganizationInvite[];
	acceptInvite(token: string): Promise<NeptorOrganizationMember>;
	rejectInvite(token: string): Promise<void>;
	getInviteAcceptUrl(token: string): string;

	getBackendSettings(): NeptorOrganizationBackendSettings;
	updateBackendSettings(patch: Partial<NeptorOrganizationBackendSettings>): Promise<void>;

	/** Load organizations, memberships, and invites for the signed-in user from org-api. */
	refreshMyOrganizationsFromDatabase(): Promise<boolean>;
}
