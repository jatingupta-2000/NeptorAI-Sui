/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Building2, Check, Copy, Mail, Pencil, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react';
import type { NeptorOrganization, NeptorOrganizationInvite, NeptorOrganizationInvitePreview } from '../../../../../common/neptorOrganizationService.js';
import { useAccessor } from '../../util/services.js';
import { useNeptorOrganization, useOrganizationSnapshot } from './useNeptorOrganization.js';
import { NEPTOR_ORG_ACCEPT_INVITE_EVENT, type NeptorOrgAcceptInviteDetail } from './pmOrganizationConstants.js';
import { WS } from './pmWorkspaceTokens.js';

const ghostBtn: CSSProperties = {
	height: '32px',
	padding: '0 12px',
	border: `1px solid ${WS.border}`,
	background: 'transparent',
	color: WS.text,
	fontSize: '12px',
	fontWeight: 500,
	borderRadius: '8px',
	cursor: 'pointer',
};

const primaryBtn: CSSProperties = {
	...ghostBtn,
	border: 'none',
	background: WS.brandGradient,
	color: '#fff',
	fontWeight: 700,
};

const smallBtn: CSSProperties = {
	...ghostBtn,
	height: '28px',
	padding: '0 10px',
	fontSize: '11px',
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	gap: '6px',
};

const inputStyle: CSSProperties = {
	width: '100%',
	height: '36px',
	borderRadius: '8px',
	border: `1px solid ${WS.border}`,
	background: '#0d0d0f',
	color: WS.text,
	padding: '0 12px',
	fontSize: '13px',
};

const textareaStyle: CSSProperties = {
	...inputStyle,
	height: '80px',
	padding: '10px 12px',
	resize: 'vertical' as const,
};

const cardStyle: CSSProperties = {
	borderRadius: '12px',
	border: `1px solid ${WS.borderSoft}`,
	background: '#0f1012',
	padding: '14px 16px',
};

const emailOk = (raw: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());

function formatDate(iso: string): string {
	try {
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	} catch {
		return iso;
	}
}

function statusColor(status: NeptorOrganizationInvite['status']): string {
	switch (status) {
		case 'pending': return '#FF9500';
		case 'accepted': return WS.ok;
		case 'rejected': return '#FF9A93';
		case 'revoked': return '#FF9A93';
		case 'expired': return WS.textFaint;
	}
}

const WS_ext = { ...WS, accentAmber: '#FF9500', ok: '#30D158' };

function OrgFormModal({
	open,
	title,
	initialName,
	initialDescription,
	busy,
	onClose,
	onSubmit,
}: {
	open: boolean;
	title: string;
	initialName: string;
	initialDescription: string;
	busy: boolean;
	onClose: () => void;
	onSubmit: (name: string, description: string) => void;
}) {
	const [name, setName] = useState(initialName);
	const [description, setDescription] = useState(initialDescription);
	const [err, setErr] = useState<string | null>(null);

	if (!open) {
		return null;
	}

	return (
		<div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
			<div onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 96vw)', borderRadius: '14px', border: `1px solid ${WS.border}`, background: WS.bgPanel, overflow: 'hidden' }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${WS.border}` }}>
					<div style={{ fontSize: '14px', fontWeight: 700, color: WS.text }}>{title}</div>
					<button type="button" onClick={onClose} style={{ ...ghostBtn, width: '32px', padding: 0 }}><X size={16} /></button>
				</div>
				<div style={{ padding: '16px 18px', display: 'grid', gap: '10px' }}>
					<input placeholder="Organization name" value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
					<textarea placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} style={textareaStyle} />
					{err ? <div style={{ color: '#FF9A93', fontSize: '12px' }}>{err}</div> : null}
					<div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
						<button type="button" style={ghostBtn} onClick={onClose}>Cancel</button>
						<button type="button" style={primaryBtn} disabled={busy} onClick={() => {
							if (!name.trim()) { setErr('Name is required.'); return; }
							setErr(null);
							onSubmit(name.trim(), description.trim());
						}}>{busy ? 'Saving…' : 'Save'}</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function InviteDecisionModal({
	open,
	preview,
	busy,
	error,
	onClose,
	onAccept,
	onReject,
}: {
	open: boolean;
	preview: NeptorOrganizationInvitePreview | null;
	busy: boolean;
	error: string | null;
	onClose: () => void;
	onAccept: () => void;
	onReject: () => void;
}) {
	if (!open) {
		return null;
	}

	const invite = preview?.invite;
	const orgName = preview?.orgName ?? 'Organization';
	const inviter = preview?.inviterDisplayName ?? 'A teammate';

	return (
		<div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
			<div onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 96vw)', borderRadius: '14px', border: `1px solid ${WS.border}`, background: WS.bgPanel, overflow: 'hidden' }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${WS.border}` }}>
					<div style={{ fontSize: '14px', fontWeight: 700, color: WS.text }}>Organization invite</div>
					<button type="button" onClick={onClose} style={{ ...ghostBtn, width: '32px', padding: 0 }}><X size={16} /></button>
				</div>
				<div style={{ padding: '16px 18px', display: 'grid', gap: '12px' }}>
					{invite ? (
						<>
							<div style={{ fontSize: '13px', color: WS.textMuted, lineHeight: 1.55 }}>
								<span style={{ color: WS.text, fontWeight: 650 }}>{inviter}</span> invited you to join{' '}
								<span style={{ color: WS.text, fontWeight: 650 }}>{orgName}</span> as{' '}
								<span style={{ color: WS.text, fontWeight: 650 }}>{invite.role}</span>.
							</div>
							<div style={{ fontSize: '12px', color: WS.textFaint }}>
								Invite sent to {invite.email} · Expires {formatDate(invite.expiresAtIso)}
							</div>
						</>
					) : (
						<div style={{ fontSize: '13px', color: WS.textMuted }}>Invite not found or no longer valid.</div>
					)}
					{error ? <div style={{ color: '#FF9A93', fontSize: '12px' }}>{error}</div> : null}
					<div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
						<button type="button" style={ghostBtn} onClick={onClose} disabled={busy}>Cancel</button>
						<button type="button" style={{ ...ghostBtn, color: '#FF9A93', borderColor: 'rgba(255,154,147,0.35)' }} disabled={busy || !invite} onClick={onReject}>Reject</button>
						<button type="button" style={primaryBtn} disabled={busy || !invite} onClick={onAccept}>{busy ? 'Working…' : 'Accept'}</button>
					</div>
				</div>
			</div>
		</div>
	);
}

export const PmOrganizationsView = () => {
	const orgService = useNeptorOrganization();
	const snapshot = useOrganizationSnapshot();
	const accessor = useAccessor();
	const collab = accessor.get('INeptorOrgCollaborationService');
	const clipboard = accessor.get('IClipboardService');

	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);
	const [selectedOrgId, setSelectedOrgId] = useState<string | null>(snapshot.activeOrgId);

	useEffect(() => {
		if (snapshot.activeOrgId) {
			setSelectedOrgId(snapshot.activeOrgId);
		}
	}, [snapshot.activeOrgId]);
	const [signInEmail, setSignInEmail] = useState('');
	const [signInName, setSignInName] = useState('');
	const [inviteEmail, setInviteEmail] = useState('');
	const [createOpen, setCreateOpen] = useState(false);
	const [editOrg, setEditOrg] = useState<NeptorOrganization | null>(null);
	const [deleteOrg, setDeleteOrg] = useState<NeptorOrganization | null>(null);
	const [emailSettingsOpen, setEmailSettingsOpen] = useState(false);
	const [appBaseUrl, setAppBaseUrl] = useState(snapshot.backend.appBaseUrl);
	const [inviteApiUrl, setInviteApiUrl] = useState(snapshot.backend.inviteApiUrl);
	const [inviteFromEmail, setInviteFromEmail] = useState(snapshot.backend.inviteFromEmail);
	const [orgApiUrl, setOrgApiUrl] = useState(snapshot.backend.orgApiUrl ?? '');
	const [reviewInviteToken, setReviewInviteToken] = useState<string | null>(null);
	const [reviewError, setReviewError] = useState<string | null>(null);

	const selectedOrg = snapshot.organizations.find(o => o.id === selectedOrgId) ?? null;
	const myOrgs = orgService.listMyOrganizations();
	const incomingInvites = orgService.listIncomingInvites();
	const reviewPreview = reviewInviteToken ? orgService.getInvitePreview(reviewInviteToken) : null;

	const run = useCallback(async (fn: () => Promise<void>) => {
		setBusy(true);
		setErr(null);
		try {
			await fn();
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, []);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const onReviewInvite = (event: Event) => {
			const token = (event as CustomEvent<NeptorOrgAcceptInviteDetail>).detail?.token?.trim();
			if (!token) {
				return;
			}
			setReviewInviteToken(token);
			setReviewError(null);
			const preview = orgService.getInvitePreview(token);
			if (preview?.invite.email) {
				setSignInEmail(preview.invite.email);
			}
		};
		window.addEventListener(NEPTOR_ORG_ACCEPT_INVITE_EVENT, onReviewInvite);
		return () => window.removeEventListener(NEPTOR_ORG_ACCEPT_INVITE_EVENT, onReviewInvite);
	}, [orgService]);

	useEffect(() => {
		if (!snapshot.currentUser) {
			return;
		}
		void orgService.refreshMyOrganizationsFromDatabase();
	}, [orgService, snapshot.currentUser?.email]);

	const openInviteReview = useCallback((token: string) => {
		setReviewInviteToken(token);
		setReviewError(null);
	}, []);

	const closeInviteReview = useCallback(() => {
		setReviewInviteToken(null);
		setReviewError(null);
	}, []);

	const copyLink = async (token: string) => {
		await clipboard.writeText(orgService.getInviteAcceptUrl(token));
		setInfo('Accept link copied.');
	};

	if (!snapshot.currentUser) {
		return (
			<div style={{ padding: '24px', maxWidth: '480px' }}>
				<div style={{ fontSize: '18px', fontWeight: 700, color: WS.text, marginBottom: '8px' }}>Sign in</div>
				<div style={{ fontSize: '13px', color: WS.textMuted, marginBottom: '16px', lineHeight: 1.55 }}>
					{reviewInviteToken
						? 'You have a pending organization invite. Sign in with the email address that received the invite, then choose Accept or Reject.'
						: 'Sign in with your work email to create organizations and invite teammates.'}
				</div>
				<div style={{ display: 'grid', gap: '10px' }}>
					<input type="email" placeholder="you@yourdomain.com" value={signInEmail} onChange={e => setSignInEmail(e.target.value)} style={inputStyle} />
					<input type="text" placeholder="Display name" value={signInName} onChange={e => setSignInName(e.target.value)} style={inputStyle} />
					<button type="button" style={primaryBtn} disabled={busy} onClick={() => void run(async () => {
						await orgService.signInLocal({ email: signInEmail, displayName: signInName });
					})}>Continue</button>
					{err ? <div style={{ color: '#FF9A93', fontSize: '12px' }}>{err}</div> : null}
					{info ? <div style={{ color: WS.textMuted, fontSize: '12px' }}>{info}</div> : null}
				</div>
			</div>
		);
	}

	return (
		<div style={{ padding: '20px 24px 32px', display: 'grid', gap: '20px', maxWidth: '960px' }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
				<div>
					<div style={{ fontSize: '18px', fontWeight: 700, color: WS.text }}>Organizations</div>
					<div style={{ fontSize: '13px', color: WS.textMuted, marginTop: '4px' }}>
						Signed in as {snapshot.currentUser.displayName} ({snapshot.currentUser.email})
					</div>
				</div>
				<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
					<button type="button" style={ghostBtn} disabled={busy} onClick={() => void run(async () => {
						const synced = await orgService.refreshMyOrganizationsFromDatabase(true);
						setInfo(synced ? 'Organizations synced from database.' : 'Could not sync organizations. Check org-api URL in Backend settings.');
					})}>
						<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><RefreshCw size={14} />Sync orgs</span>
					</button>
					<button type="button" style={ghostBtn} disabled={busy} onClick={() => void run(async () => {
						await orgService.signOut();
						setSelectedOrgId(null);
						setInfo('Signed out.');
					})}>Sign out</button>
					<button type="button" style={ghostBtn} onClick={() => {
						setAppBaseUrl(snapshot.backend.appBaseUrl);
						setInviteApiUrl(snapshot.backend.inviteApiUrl);
						setInviteFromEmail(snapshot.backend.inviteFromEmail);
						setOrgApiUrl(snapshot.backend.orgApiUrl ?? '');
						setEmailSettingsOpen(v => !v);
					}}>
						<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Mail size={14} />Backend settings</span>
					</button>
					<button type="button" style={primaryBtn} onClick={() => setCreateOpen(true)}>
						<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Plus size={14} />New organization</span>
					</button>
				</div>
			</div>

			{emailSettingsOpen ? (
				<div style={cardStyle}>
					<div style={{ fontSize: '13px', fontWeight: 650, color: WS.text, marginBottom: '10px' }}>Backend settings</div>
					<div style={{ fontSize: '12px', color: WS.textMuted, marginBottom: '12px', lineHeight: 1.5 }}>
						API keys stay on your servers. Neptor stores endpoints only.
					</div>
					<div style={{ display: 'grid', gap: '8px' }}>
						<input placeholder="Org API URL (http://localhost:8788)" value={orgApiUrl} onChange={e => setOrgApiUrl(e.target.value)} style={inputStyle} />
						<input placeholder="App base URL (http://localhost:8787 for local accept page)" value={appBaseUrl} onChange={e => setAppBaseUrl(e.target.value)} style={inputStyle} />
						<input placeholder="Invite API URL (http://localhost:8787/v1/send-invite)" value={inviteApiUrl} onChange={e => setInviteApiUrl(e.target.value)} style={inputStyle} />
						<input placeholder="From email (no-reply@noderails.com)" value={inviteFromEmail} onChange={e => setInviteFromEmail(e.target.value)} style={inputStyle} />
						<button type="button" style={primaryBtn} disabled={busy} onClick={() => void run(async () => {
							await orgService.updateBackendSettings({
								orgApiUrl: orgApiUrl.trim(),
								appBaseUrl: appBaseUrl.trim(),
								inviteApiUrl: inviteApiUrl.trim(),
								inviteFromEmail: inviteFromEmail.trim(),
							});
							await collab.refreshTeamInstructions();
							for (const org of orgService.listMyOrganizations()) {
								await collab.syncOrganization(org.id);
								for (const m of orgService.listMembers(org.id)) {
									await collab.syncMember(org.id, m.id);
								}
							}
							const synced = await orgService.refreshMyOrganizationsFromDatabase(true);
							setInfo(synced ? 'Backend settings saved and organizations synced.' : 'Backend settings saved. Organization sync failed; confirm org-api is running.');
						})}>Save settings</button>
					</div>
				</div>
			) : null}

			{incomingInvites.length > 0 ? (
				<div style={cardStyle}>
					<div style={{ fontSize: '13px', fontWeight: 650, color: WS.text, marginBottom: '10px' }}>Invites for you</div>
					<div style={{ display: 'grid', gap: '8px' }}>
						{incomingInvites.map(inv => {
							const preview = orgService.getInvitePreview(inv.token);
							return (
								<div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px', borderRadius: '8px', border: `1px solid ${WS.borderSoft}`, background: '#0d0d0f' }}>
									<div>
										<div style={{ fontSize: '13px', color: WS.text, fontWeight: 650 }}>{preview?.orgName ?? 'Organization'}</div>
										<div style={{ fontSize: '11px', color: WS.textMuted }}>From {preview?.inviterDisplayName ?? 'a teammate'} · Role {inv.role}</div>
									</div>
									<div style={{ display: 'flex', gap: '6px' }}>
										<button type="button" style={smallBtn} onClick={() => openInviteReview(inv.token)}>Review</button>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			) : null}

			{myOrgs.length === 0 ? (
				<div style={cardStyle}>
					<div style={{ fontSize: '14px', color: WS.textMuted }}>No organizations yet. Create one to start inviting teammates.</div>
				</div>
			) : (
				<div style={{ display: 'grid', gap: '10px' }}>
					{myOrgs.map(org => {
						const isActive = snapshot.activeOrgId === org.id;
						const memberCount = orgService.getMemberCount(org.id);
						const stats = orgService.getInviteStats(org.id);
						return (
							<div key={org.id} style={{ ...cardStyle, borderColor: selectedOrgId === org.id ? 'rgba(255,59,48,0.45)' : WS.borderSoft }}>
								<div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
									<div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', minWidth: 0 }}>
										<div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(255,59,48,0.12)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
											<Building2 size={18} color={WS.brandStart} />
										</div>
										<div style={{ minWidth: 0 }}>
											<div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
												<span style={{ fontSize: '15px', fontWeight: 700, color: WS.text }}>{org.name}</span>
												{isActive ? <span style={{ fontSize: '10px', fontWeight: 650, color: WS.ok, textTransform: 'uppercase' }}>Active</span> : null}
											</div>
											{org.description ? <div style={{ fontSize: '12px', color: WS.textMuted, marginTop: '4px' }}>{org.description}</div> : null}
											<div style={{ fontSize: '11px', color: WS.textFaint, marginTop: '6px' }}>
												{memberCount} members · Created {formatDate(org.createdAtIso)}
											</div>
										</div>
									</div>
									<div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
										<button type="button" style={smallBtn} onClick={() => void run(async () => { await orgService.setActiveOrganization(org.id); setSelectedOrgId(org.id); })}>
											{isActive ? <Check size={12} /> : 'Switch'}
										</button>
										<button type="button" style={smallBtn} onClick={() => { setSelectedOrgId(org.id); }}>Manage</button>
										<button type="button" style={smallBtn} onClick={() => setEditOrg(org)}><Pencil size={12} /></button>
										<button type="button" style={smallBtn} onClick={() => setDeleteOrg(org)}><Trash2 size={12} /></button>
									</div>
								</div>
								<div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
									<span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', background: 'rgba(255,149,0,0.12)', color: '#FF9500' }}>{stats.pending} pending</span>
									<span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', background: 'rgba(48,209,88,0.12)', color: WS.ok }}>{stats.accepted} accepted</span>
									<span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', background: 'rgba(255,154,147,0.12)', color: '#FF9A93' }}>{stats.rejected} rejected</span>
									<span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', background: 'rgba(92,92,92,0.2)', color: WS.textFaint }}>{stats.revoked + stats.expired} closed</span>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{selectedOrg ? (
				<div style={{ display: 'grid', gap: '16px' }}>
					<div style={{ fontSize: '14px', fontWeight: 700, color: WS.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
						<Users size={16} /> Team · {selectedOrg.name}
					</div>

					<div style={cardStyle}>
						<div style={{ fontSize: '12px', color: WS.textMuted, marginBottom: '10px' }}>Invite a collaborator by email. They join when they accept from their inbox.</div>
						<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
							<input type="email" placeholder="colleague@company.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} style={{ ...inputStyle, flex: '1 1 200px', width: 'auto' }} />
							<button type="button" style={primaryBtn} disabled={busy || !emailOk(inviteEmail)} onClick={() => void run(async () => {
								await orgService.sendInvite(inviteEmail.trim(), selectedOrg.id);
								setInviteEmail('');
								setInfo('Invite sent or queued.');
							})}>Send invite</button>
						</div>
					</div>

					<div>
						<div style={{ fontSize: '11px', fontWeight: 650, color: WS.textFaint, marginBottom: '8px', letterSpacing: '0.04em' }}>Invite status</div>
						<div style={{ display: 'grid', gap: '8px' }}>
							{orgService.listInvites(selectedOrg.id).length === 0 ? (
								<div style={{ fontSize: '12px', color: WS.textMuted }}>No invites yet.</div>
							) : orgService.listInvites(selectedOrg.id).map(inv => (
								<div key={inv.id} style={{ ...cardStyle, padding: '10px 12px' }}>
									<div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
										<div>
											<div style={{ fontSize: '13px', color: WS.text }}>{inv.email}</div>
											<div style={{ fontSize: '11px', color: WS.textFaint }}>Sent {formatDate(inv.sentAtIso)} · Expires {formatDate(inv.expiresAtIso)}</div>
										</div>
										<span style={{ fontSize: '10px', fontWeight: 700, color: statusColor(inv.status), textTransform: 'uppercase' }}>{inv.status}</span>
									</div>
									{inv.status === 'pending' ? (
										<div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
											<button type="button" style={smallBtn} onClick={() => void copyLink(inv.token)}><Copy size={12} /> Copy link</button>
											<button type="button" style={smallBtn} disabled={busy} onClick={() => void run(async () => { await orgService.resendInvite(inv.id); setInfo('Invite resent.'); })}>Resend</button>
											<button type="button" style={smallBtn} disabled={busy} onClick={() => void run(async () => { await orgService.revokeInvite(inv.id); })}>Revoke</button>
										</div>
									) : null}
								</div>
							))}
						</div>
					</div>

					<div>
						<div style={{ fontSize: '11px', fontWeight: 650, color: WS.textFaint, marginBottom: '8px', letterSpacing: '0.04em' }}>Members</div>
						<div style={{ display: 'grid', gap: '8px' }}>
							{orgService.listMembers(selectedOrg.id).map(m => (
								<div key={m.id} style={{ ...cardStyle, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
									<div>
										<div style={{ fontSize: '13px', fontWeight: 650, color: WS.text }}>{m.userId === snapshot.currentUser?.id ? 'You' : m.displayName}</div>
										<div style={{ fontSize: '11px', color: WS.textMuted }}>{m.email}</div>
									</div>
									<span style={{ fontSize: '10px', fontWeight: 650, color: WS.textFaint, textTransform: 'uppercase' }}>{m.role}</span>
								</div>
							))}
						</div>
					</div>
				</div>
			) : null}

			{err ? <div style={{ color: '#FF9A93', fontSize: '12px' }}>{err}</div> : null}
			{info ? <div style={{ color: WS.textMuted, fontSize: '12px' }}>{info}</div> : null}

			<OrgFormModal open={createOpen} title="Create organization" initialName="" initialDescription="" busy={busy} onClose={() => setCreateOpen(false)} onSubmit={(name, description) => void run(async () => {
				const org = await orgService.createOrganization({ name, description });
				setCreateOpen(false);
				setSelectedOrgId(org.id);
				if (!collab.isEnabled()) {
					setInfo(`Created ${org.name}. Open Backend settings and set Org API URL (http://localhost:8788) to save it to Supabase.`);
					return;
				}
				const orgSynced = await collab.syncOrganization(org.id);
				const ownerMember = orgService.listMembers(org.id).find(m => m.role === 'owner');
				const memberSynced = ownerMember ? await collab.syncMember(org.id, ownerMember.id) : true;
				if (orgSynced && memberSynced) {
					setInfo(`Created ${org.name} and synced to database.`);
				} else {
					setInfo(`Created ${org.name} locally. Database sync failed; confirm org-api is running on port 8788.`);
				}
			})} />

			<OrgFormModal open={!!editOrg} title="Edit organization" initialName={editOrg?.name ?? ''} initialDescription={editOrg?.description ?? ''} busy={busy} onClose={() => setEditOrg(null)} onSubmit={(name, description) => void run(async () => {
				if (!editOrg) { return; }
				await orgService.updateOrganization(editOrg.id, { name, description });
				setEditOrg(null);
				setInfo('Organization updated.');
			})} />

			{deleteOrg ? (
				<div role="dialog" aria-modal="true" onClick={() => setDeleteOrg(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
					<div onClick={e => e.stopPropagation()} style={{ width: 'min(400px, 96vw)', borderRadius: '14px', border: `1px solid ${WS.border}`, background: WS.bgPanel, padding: '18px' }}>
						<div style={{ fontSize: '14px', fontWeight: 700, color: WS.text, marginBottom: '8px' }}>Delete {deleteOrg.name}?</div>
						<div style={{ fontSize: '12px', color: WS.textMuted, marginBottom: '16px' }}>This removes all members and invites for this organization.</div>
						<div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
							<button type="button" style={ghostBtn} onClick={() => setDeleteOrg(null)}>Cancel</button>
							<button type="button" style={{ ...primaryBtn, background: '#FF3B30' }} disabled={busy} onClick={() => void run(async () => {
								await orgService.deleteOrganization(deleteOrg.id);
								setDeleteOrg(null);
								setSelectedOrgId(snapshot.activeOrgId);
								setInfo('Organization deleted.');
							})}>Delete</button>
						</div>
					</div>
				</div>
			) : null}

			<InviteDecisionModal
				open={!!reviewInviteToken}
				preview={reviewPreview}
				busy={busy}
				error={reviewError}
				onClose={closeInviteReview}
				onAccept={() => void run(async () => {
					if (!reviewInviteToken) { return; }
					try {
						setReviewError(null);
						await orgService.acceptInvite(reviewInviteToken);
						closeInviteReview();
						setInfo('Invite accepted. You joined the organization.');
					} catch (e) {
						setReviewError(e instanceof Error ? e.message : String(e));
					}
				})}
				onReject={() => void run(async () => {
					if (!reviewInviteToken) { return; }
					try {
						setReviewError(null);
						await orgService.rejectInvite(reviewInviteToken);
						closeInviteReview();
						setInfo('Invite rejected.');
					} catch (e) {
						setReviewError(e instanceof Error ? e.message : String(e));
					}
				})}
			/>
		</div>
	);
};
