/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Copy, X } from 'lucide-react';
import { NEPTOR_PM_ORGANIZATIONS_TAB_LABEL } from './pmOrganizationConstants.js';
import { useAccessor } from '../../util/services.js';
import { useNeptorOrganization, useOrganizationSnapshot } from './useNeptorOrganization.js';
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

const emailOk = (raw: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());

export const PmTeamPanel = ({ open, onClose, onOpenOrganizations }: { open: boolean; onClose: () => void; onOpenOrganizations?: () => void }) => {
	const orgService = useNeptorOrganization();
	const snapshot = useOrganizationSnapshot();
	const accessor = useAccessor();
	const clipboard = accessor.get('IClipboardService');

	const activeOrg = snapshot.organizations.find(o => o.id === snapshot.activeOrgId) ?? null;
	const [email, setEmail] = useState('');
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);

	const refresh = useCallback(() => {
		// snapshot hook auto-refreshes
	}, []);

	useEffect(() => {
		if (open) {
			setErr(null);
			setInfo(null);
			setEmail('');
			refresh();
		}
	}, [open, refresh, snapshot]);

	const send = async () => {
		if (!emailOk(email)) {
			setErr('Enter a valid email address.');
			return;
		}
		setBusy(true);
		setErr(null);
		try {
			await orgService.sendInvite(email.trim());
			setEmail('');
			setInfo('Invite created. Email sends when invite API URL is configured.');
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	if (!open) {
		return null;
	}

	const members = activeOrg ? orgService.listMembers(activeOrg.id) : [];
	const pending = activeOrg ? orgService.listPendingInvites(activeOrg.id) : [];

	return (
		<div role="dialog" aria-modal="true" aria-labelledby="pm-team-title" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
			<div onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 96vw)', maxHeight: 'min(88vh, 680px)', borderRadius: '14px', border: `1px solid ${WS.border}`, background: WS.bgPanel, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.55)' }}>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${WS.border}` }}>
					<div>
						<div id="pm-team-title" style={{ fontSize: '14px', fontWeight: 700, color: WS.text }}>Team</div>
						{activeOrg ? <div style={{ fontSize: '11px', color: WS.textMuted, marginTop: '2px' }}>{activeOrg.name}</div> : null}
					</div>
					<button type="button" aria-label="Close" onClick={onClose} style={{ ...ghostBtn, height: '32px', width: '32px', padding: 0, display: 'grid', placeItems: 'center' }}><X size={16} /></button>
				</div>

				<div style={{ padding: '16px 18px', display: 'grid', gap: '12px', overflow: 'auto', flex: 1 }}>
					{!snapshot.currentUser || !activeOrg ? (
						<div style={{ display: 'grid', gap: '10px' }}>
							<div style={{ fontSize: '12px', color: WS.textMuted, lineHeight: 1.55 }}>Sign in and create an organization in {NEPTOR_PM_ORGANIZATIONS_TAB_LABEL} before inviting teammates.</div>
							{onOpenOrganizations ? <button type="button" style={primaryBtn} onClick={() => { onClose(); onOpenOrganizations(); }}>Open {NEPTOR_PM_ORGANIZATIONS_TAB_LABEL}</button> : null}
						</div>
					) : (
						<>
							<div style={{ fontSize: '12px', color: WS.textMuted, lineHeight: 1.55 }}>Invite a collaborator by email. They receive access when they accept from their inbox.</div>
							<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
								<input type="email" autoComplete="email" placeholder="colleague@company.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: '1 1 200px', minWidth: 0, height: '36px', borderRadius: '8px', border: `1px solid ${WS.border}`, background: '#0d0d0f', color: WS.text, padding: '0 12px', fontSize: '13px' }} />
								<button type="button" style={primaryBtn} disabled={busy || !emailOk(email)} onClick={() => void send()}>{busy ? 'Sending…' : 'Send invite'}</button>
							</div>

							{pending.length > 0 ? (
								<div>
									<div style={{ fontSize: '11px', fontWeight: 650, color: WS.textFaint, marginBottom: '8px', letterSpacing: '0.04em' }}>Pending invites</div>
									<div style={{ display: 'grid', gap: '8px' }}>
										{pending.map((inv) => (
											<div key={inv.id} style={{ padding: '10px 12px', borderRadius: '10px', border: `1px solid ${WS.borderSoft}`, background: '#0f1012' }}>
												<div style={{ fontSize: '12px', color: WS.text }}>{inv.email}</div>
												<button type="button" style={smallBtn} onClick={() => void clipboard.writeText(orgService.getInviteAcceptUrl(inv.token))}><Copy size={12} /> Copy link</button>
											</div>
										))}
									</div>
								</div>
							) : null}

							<div>
								<div style={{ fontSize: '11px', fontWeight: 650, color: WS.textFaint, marginBottom: '8px', letterSpacing: '0.04em' }}>Members</div>
								<div style={{ display: 'grid', gap: '8px' }}>
									{members.map((m) => (
										<div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${WS.borderSoft}`, background: '#0f1012' }}>
											<div style={{ minWidth: 0 }}>
												<div style={{ fontSize: '13px', fontWeight: 650, color: WS.text }}>{m.userId === snapshot.currentUser?.id ? 'You' : m.displayName}</div>
												<div style={{ fontSize: '11px', color: WS.textMuted, wordBreak: 'break-all' }}>{m.email}</div>
											</div>
											<span style={{ fontSize: '10px', fontWeight: 650, color: WS.textFaint, textTransform: 'uppercase' }}>{m.role}</span>
										</div>
									))}
								</div>
							</div>
						</>
					)}
					{err ? <div style={{ color: '#FF9A93', fontSize: '12px' }}>{err}</div> : null}
					{info ? <div style={{ color: WS.textMuted, fontSize: '12px' }}>{info}</div> : null}
				</div>

				<div style={{ padding: '12px 16px', borderTop: `1px solid ${WS.border}`, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
					{onOpenOrganizations ? <button type="button" style={ghostBtn} onClick={() => { onClose(); onOpenOrganizations(); }}>Full management</button> : null}
					<button type="button" style={ghostBtn} onClick={onClose}>Close</button>
				</div>
			</div>
		</div>
	);
};
