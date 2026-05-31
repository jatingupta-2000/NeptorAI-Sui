/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { MessageSquare, Pencil, Database, Rocket, Users, X } from 'lucide-react';
import type { CollaborationActivityEvent } from '../../../../../common/workspaceLifecycleTypes.js';
import type { OrgCollaborationActivityEvent } from '../../../../../common/neptorOrgCollaborationService.js';
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle.js';
import { useAccessor } from '../../util/services.js';
import { useNeptorOrganization } from './useNeptorOrganization.js';
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

type ActivityRow = CollaborationActivityEvent | OrgCollaborationActivityEvent;

function kindIcon(kind: ActivityRow['kind']) {
	const s = 15;
	switch (kind) {
		case 'chat_message': return <MessageSquare size={s} color={WS.brandStart} />;
		case 'file_edit': return <Pencil size={s} color="#5AC8FA" />;
		case 'memory_save': return <Database size={s} color="#30D158" />;
		case 'deploy_event': return <Rocket size={s} color="#FF9500" />;
		case 'team_event': return <Users size={s} color="#BF5AF2" />;
	}
}

function formatTime(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	} catch {
		return iso;
	}
}

export const PmCollaborationActivityPanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
	const lifecycle = useWorkspaceLifecycle();
	const orgService = useNeptorOrganization();
	const accessor = useAccessor();
	const collab = accessor.get('INeptorOrgCollaborationService');
	const [events, setEvents] = useState<ActivityRow[]>([]);
	const [live, setLive] = useState(false);

	const loadEvents = useCallback(async () => {
		if (collab.isEnabled() && orgService.getActiveOrganization()) {
			const remote = await collab.fetchRecentActivity(50);
			setEvents(remote);
			setLive(true);
			return;
		}
		setLive(false);
		setEvents(lifecycle.getRecentActivity(25).slice().reverse());
	}, [collab, orgService, lifecycle]);

	useEffect(() => {
		if (!open) {
			return;
		}
		void loadEvents();
	}, [open, loadEvents]);

	useEffect(() => {
		if (!open || !live) {
			return;
		}
		const id = setInterval(() => void loadEvents(), 12_000);
		const sub = collab.onDidChange(() => void loadEvents());
		return () => {
			clearInterval(id);
			sub.dispose();
		};
	}, [open, live, loadEvents, collab]);

	useEffect(() => {
		if (!open || live) {
			return;
		}
		const sub = lifecycle.subscribeActivityFeed((ev) => {
			setEvents((prev) => [ev, ...prev].slice(0, 80));
		});
		return () => sub.dispose();
	}, [open, live, lifecycle]);

	if (!open) {
		return null;
	}

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="pm-activity-title"
			onClick={onClose}
			style={{
				position: 'fixed',
				inset: 0,
				background: 'rgba(0,0,0,0.72)',
				zIndex: 3000,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				padding: '20px',
			}}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					width: 'min(640px, 96vw)',
					height: 'min(82vh, 720px)',
					borderRadius: '14px',
					border: `1px solid ${WS.border}`,
					background: WS.bgPanel,
					display: 'flex',
					flexDirection: 'column',
					overflow: 'hidden',
					boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
				}}
			>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: `1px solid ${WS.border}` }}>
					<div>
						<div id="pm-activity-title" style={{ fontSize: '14px', fontWeight: 700, color: WS.text }}>Team activity</div>
						<div style={{ fontSize: '11px', color: WS.textMuted, marginTop: '3px' }}>
							{live
								? `Live feed · ${orgService.getActiveOrganization()?.name ?? 'organization'}`
								: 'Configure Org API URL in Organizations to enable live team feed'}
						</div>
					</div>
					<button type="button" aria-label="Close" onClick={onClose} style={{ ...ghostBtn, height: '32px', width: '32px', padding: 0, display: 'grid', placeItems: 'center' }}>
						<X size={16} />
					</button>
				</div>

				<div style={{ flex: 1, overflow: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
					{events.length === 0 ? (
						<div style={{ color: WS.textMuted, fontSize: '13px', padding: '24px', textAlign: 'center' }}>No activity yet.</div>
					) : (
						events.map((ev) => (
							<div
								key={ev.id}
								style={{
									display: 'grid',
									gridTemplateColumns: '28px 1fr',
									gap: '10px',
									alignItems: 'start',
									padding: '10px 12px',
									borderRadius: '12px',
									border: `1px solid ${WS.borderSoft}`,
									background: '#0f1012',
								}}
							>
								<div style={{
									width: '28px',
									height: '28px',
									borderRadius: '999px',
									background: `hsla(${ev.actor.avatarHue}, 65%, 42%, 0.35)`,
									display: 'grid',
									placeItems: 'center',
									flexShrink: 0,
								}}
								>
									{kindIcon(ev.kind)}
								</div>
								<div style={{ minWidth: 0 }}>
									<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'baseline', justifyContent: 'space-between' }}>
										<span style={{ fontSize: '13px', fontWeight: 650, color: WS.text }}>{ev.actor.displayName}</span>
										<span style={{ fontSize: '10px', color: WS.textFaint }}>{formatTime(ev.timestampIso)}</span>
									</div>
									<div style={{ fontSize: '12px', color: WS.textMuted, marginTop: '4px', lineHeight: 1.45 }}>{ev.summary}</div>
									{ev.kind === 'chat_message' && 'threadLabel' in ev && ev.threadLabel ? (
										<div style={{ fontSize: '10px', color: WS.textFaint, marginTop: '6px' }}>Thread · {ev.threadLabel}</div>
									) : null}
									{ev.kind === 'file_edit' && 'uri' in ev && ev.uri ? (
										<div style={{ fontSize: '10px', color: WS.textFaint, marginTop: '6px' }}>{ev.uri.split('/').pop()}</div>
									) : null}
									{ev.kind === 'memory_save' && 'artifactType' in ev && ev.artifactType ? (
										<div style={{ fontSize: '10px', color: WS.textFaint, marginTop: '6px' }}>Memory · {ev.artifactType}</div>
									) : null}
								</div>
							</div>
						))
					)}
				</div>

				<div style={{ padding: '10px 16px', borderTop: `1px solid ${WS.border}`, fontSize: '10px', color: WS.textFaint, textAlign: 'center' }}>
					{live ? 'Synced from org database (Supabase).' : 'Connect Org API to load live collaboration activity.'}
				</div>
			</div>
		</div>
	);
};
