/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


export const PMBriefing = {
	bgDeep: '#0a0a0a',
	bgPanel: '#141414',
	bgLift: 'rgba(255,255,255,0.03)',
	border: '#2E2E2E',
	borderSoft: 'rgba(46,46,46,0.7)',
	text: '#EDEDED',
	textMuted: '#8B8B8B',
	textFaint: '#636366',
	brandStart: '#FF3B30',
	radiusCard: '14px',
	radiusChip: '999px',
	shadowLift: '0 10px 28px rgba(0,0,0,0.38)',
	fontMono: '"JetBrains Mono", var(--monaco-monospace-font, ui-monospace, monospace)',
} as const;

/** Anchor id for Quick jump chips (slug-safe). */
export const briefingSectionAnchorId = (sectionId: string): string =>
	`neptor-pm-brief-${sectionId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
