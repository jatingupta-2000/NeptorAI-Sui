/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Plus } from 'lucide-react';
import { NEPTOR_PM_ORGANIZATIONS_TAB_LABEL } from './pmOrganizationConstants.js';
import { useNeptorOrganization, useOrganizationSnapshot } from './useNeptorOrganization.js';

const PM = {
	text: '#EDEDED',
	textMuted: '#8B8B8B',
	border: '#2E2E2E',
	bgPanel: '#141414',
	brandStart: '#FF3B30',
} as const;

export const PmOrgSwitcher = ({
	onNavigateOrganizations,
	selectTab,
}: {
	onNavigateOrganizations: () => void;
	selectTab?: (tab: string) => void;
}) => {
	const orgService = useNeptorOrganization();
	const snapshot = useOrganizationSnapshot();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	const activeOrg = snapshot.organizations.find(o => o.id === snapshot.activeOrgId) ?? null;
	const myOrgs = orgService.listMyOrganizations();

	useEffect(() => {
		if (!open) {
			return;
		}
		const onDoc = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [open]);

	return (
		<div ref={ref} style={{ position: 'relative' }}>
			<button
				type="button"
				onClick={() => setOpen(v => !v)}
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: '8px',
					background: 'transparent',
					border: 'none',
					cursor: 'pointer',
					padding: 0,
					color: PM.text,
				}}
			>
				<div style={{ width: '8px', height: '8px', borderRadius: '50%', background: PM.brandStart, flexShrink: 0 }} />
				<span style={{ fontSize: '13px', fontWeight: 600, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
					{activeOrg?.name ?? 'Product'}
				</span>
				<ChevronDown size={13} color={PM.textMuted} />
			</button>

			{open ? (
				<div
					style={{
						position: 'absolute',
						top: 'calc(100% + 6px)',
						left: 0,
						minWidth: '220px',
						borderRadius: '10px',
						border: `1px solid ${PM.border}`,
						background: PM.bgPanel,
						boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
						zIndex: 2000,
						padding: '6px',
					}}
				>
					<div style={{ fontSize: '10px', fontWeight: 650, color: PM.textMuted, padding: '6px 8px', letterSpacing: '0.04em' }}>Switch organization</div>
					{myOrgs.length === 0 ? (
						<div style={{ fontSize: '12px', color: PM.textMuted, padding: '8px' }}>No organizations yet</div>
					) : myOrgs.map(org => (
						<button
							key={org.id}
							type="button"
							onClick={() => {
								void orgService.setActiveOrganization(org.id);
								setOpen(false);
							}}
							style={{
								width: '100%',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								gap: '8px',
								padding: '8px 10px',
								border: 'none',
								borderRadius: '8px',
								background: org.id === snapshot.activeOrgId ? 'rgba(255,59,48,0.1)' : 'transparent',
								color: PM.text,
								fontSize: '12px',
								cursor: 'pointer',
								textAlign: 'left',
							}}
						>
							<span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
								<Building2 size={14} color={PM.textMuted} />
								<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{org.name}</span>
							</span>
							{org.id === snapshot.activeOrgId ? <Check size={14} color={PM.brandStart} /> : null}
						</button>
					))}
					<div style={{ height: '1px', background: PM.border, margin: '6px 0' }} />
					<button
						type="button"
						onClick={() => {
							setOpen(false);
							if (selectTab) {
								selectTab(NEPTOR_PM_ORGANIZATIONS_TAB_LABEL);
							} else {
								onNavigateOrganizations();
							}
						}}
						style={{
							width: '100%',
							display: 'flex',
							alignItems: 'center',
							gap: '8px',
							padding: '8px 10px',
							border: 'none',
							borderRadius: '8px',
							background: 'transparent',
							color: PM.textMuted,
							fontSize: '12px',
							cursor: 'pointer',
						}}
					>
						<Plus size={14} />
						Manage organizations
					</button>
				</div>
			) : null}
		</div>
	);
};
