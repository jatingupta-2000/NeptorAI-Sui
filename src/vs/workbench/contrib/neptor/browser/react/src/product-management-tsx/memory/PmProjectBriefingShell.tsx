/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { PMBriefing, briefingSectionAnchorId } from './pmWorkspaceBriefingTokens.js';

export type BriefingPulseProps = {
	updatedLabel: string;
	sectionCount: number;
	wordCount: number;
	needsReview: boolean;
};

export const BriefingPulseRow = ({ updatedLabel, sectionCount, wordCount, needsReview }: BriefingPulseProps) => (
	<div
		style={{
			display: 'flex',
			flexWrap: 'wrap',
			alignItems: 'center',
			gap: '10px 16px',
			padding: '12px 14px',
			borderRadius: '12px',
			border: `1px solid ${PMBriefing.border}`,
			background: `linear-gradient(135deg, rgba(255,59,48,0.08) 0%, ${PMBriefing.bgPanel} 52%)`,
		}}
	>
		<PulsePill label="Freshness" value={`Updated ${updatedLabel}`} emphasis />
		<PulsePill label="Highlights" value={`${sectionCount} section${sectionCount === 1 ? '' : 's'}`} />
		<PulsePill label="Scope" value={`${wordCount.toLocaleString()} words`} />
		<PulsePill
			label="Health"
			value={needsReview ? 'Needs polish' : 'Looks current'}
			accent={needsReview ? '#FFB020' : '#30D158'}
		/>
	</div>
);

const PulsePill = ({ label, value, emphasis, accent }: { label: string; value: string; emphasis?: boolean; accent?: string }) => (
	<div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
		<span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: PMBriefing.textFaint }}>
			{label}
		</span>
		<span
			style={{
				fontSize: emphasis ? '14px' : '13px',
				fontWeight: emphasis ? 650 : 550,
				color: accent ?? PMBriefing.text,
				whiteSpace: 'nowrap',
				overflow: 'hidden',
				textOverflow: 'ellipsis',
			}}
		>
			{value}
		</span>
	</div>
);

export type BriefingHeroProps = {
	typeLabel: string;
	title: string;
	tagline: string;
};

export const BriefingHero = ({ typeLabel, title, tagline }: BriefingHeroProps) => (
	<div style={{ padding: '4px 2px 12px', maxWidth: '720px' }}>
		<div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: PMBriefing.brandStart, marginBottom: '8px' }}>
			Project briefing · {typeLabel}
		</div>
		<h1 style={{ margin: 0, fontSize: '26px', fontWeight: 700, lineHeight: 1.22, letterSpacing: '-0.025em', color: PMBriefing.text }}>
			{title}
		</h1>
		<p style={{ margin: '10px 0 0', fontSize: '15px', lineHeight: 1.62, color: PMBriefing.textMuted }}>
			{tagline}
		</p>
	</div>
);

export type SectionJumpItem = { id: string; title: string };

export const BriefingQuickJumps = ({ sections }: { sections: SectionJumpItem[] }) => {
	if (sections.length < 2) {
		return null;
	}
	return (
		<div style={{ padding: '0 0 8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
			<span style={{ fontSize: '11px', fontWeight: 650, color: PMBriefing.textFaint }}>Quick jumps</span>
			<div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
				{sections.map((sec) => (
					<button
						key={sec.id}
						type="button"
						onClick={() => {
							const el = document.getElementById(briefingSectionAnchorId(sec.id));
							el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
						}}
						style={{
							border: `1px solid ${PMBriefing.border}`,
							background: 'rgba(255,255,255,0.04)',
							color: PMBriefing.text,
							borderRadius: PMBriefing.radiusChip,
							padding: '5px 12px',
							fontSize: '12px',
							fontWeight: 550,
							cursor: 'pointer',
							maxWidth: '100%',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{sec.title}
					</button>
				))}
			</div>
		</div>
	);
};

export type PmProjectBriefingShellProps = {
	pulse: BriefingPulseProps;
	hero: BriefingHeroProps;
	sectionJumps?: SectionJumpItem[];
	heroActions?: React.ReactNode;
	children: React.ReactNode;
};

/**
 * Dashboard-style wrapper for a single memory artifact briefing (pulse, hero, optional chips, insight stack).
 */
export const PmProjectBriefingShell = ({ pulse, hero, sectionJumps, heroActions, children }: PmProjectBriefingShellProps) => (
	<div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
		<BriefingPulseRow {...pulse} />
		<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
			<BriefingHero {...hero} />
			{heroActions ? (
				<div style={{ flexShrink: 0, display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-start', paddingTop: '8px' }}>
					{heroActions}
				</div>
			) : null}
		</div>
		{sectionJumps?.length ? <BriefingQuickJumps sections={sectionJumps} /> : null}
		<div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
			{children}
		</div>
	</div>
);
