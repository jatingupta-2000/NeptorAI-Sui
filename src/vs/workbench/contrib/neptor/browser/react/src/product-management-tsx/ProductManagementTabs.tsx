/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';

export const PM_SECTION_TABS = ['Roadmap', 'PRD', 'Flow', 'Docs', 'User Stories', 'Specs', 'Wireframes'] as const;
export type PMSectionTab = typeof PM_SECTION_TABS[number];

export const ProductManagementTabs = ({
	activeTab,
	onChange,
}: {
	activeTab: PMSectionTab;
	onChange: (tab: PMSectionTab) => void;
}) => {
	return (
		<div
			style={{
				display: 'flex',
				gap: '2px',
				padding: '0 14px',
				borderBottom: '1px solid var(--neptor-border-3, #3a3a3a)',
				background: 'color-mix(in srgb, var(--neptor-bg-2, #252526) 94%, #0b1330 6%)',
			}}
		>
			{PM_SECTION_TABS.map((tab) => {
				const isActive = tab === activeTab;
				return (
					<button
						key={tab}
						type="button"
						onClick={() => onChange(tab)}
						style={{
							padding: '10px 12px 9px',
							borderRadius: '0',
							border: 'none',
							borderBottom: isActive ? '2px solid var(--neptor-accent-primary, #FF3B30)' : '2px solid transparent',
							background: 'transparent',
							color: isActive ? '#fff' : 'var(--neptor-fg-2, #b8b8b8)',
							fontSize: '11px',
							fontWeight: 600,
							letterSpacing: '0.01em',
							cursor: 'pointer',
						}}
					>
						{tab}
					</button>
				);
			})}
		</div>
	);
};

