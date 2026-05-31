/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *--------------------------------------------------------------------------------------*/

import React from 'react';
import { GitBranch, History } from 'lucide-react';
import { NEPTOR_PM_AGENTGIT_TAB_LABEL } from '../../../../common/neptorPmAgentGitConstants.js';

const TOK = {
	bg: '#0d0f12',
	border: 'rgba(46,46,46,0.95)',
	text: '#EDEDED',
	textMuted: '#8B8B8B',
	textFaint: '#5C5C5C',
	brandGradient: 'linear-gradient(135deg, #FF3B30 0%, #FF9500 100%)',
} as const;

export const PmAgentGitTracker = () => {
	return (
		<div
			className="neptor-pm-agentgit"
			style={{
				minHeight: '100%',
				background: TOK.bg,
				color: TOK.text,
				padding: '28px 32px 48px',
				boxSizing: 'border-box',
			}}
		>
			<div style={{ maxWidth: '920px', margin: '0 auto', display: 'grid', gap: '28px' }}>
				<header style={{ display: 'grid', gap: '12px' }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
						<div
							style={{
								width: '38px',
								height: '38px',
								borderRadius: '12px',
								background: TOK.brandGradient,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								boxShadow: '0 12px 36px rgba(255,59,48,0.22)',
							}}
							aria-hidden
						>
							<GitBranch size={20} color="#fff" strokeWidth={2.2} />
						</div>
						<div style={{ display: 'grid', gap: '4px', minWidth: 0 }}>
							<h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15 }}>
								{NEPTOR_PM_AGENTGIT_TAB_LABEL}
							</h1>
							<p style={{ margin: 0, fontSize: '13px', color: TOK.textMuted, lineHeight: 1.55, maxWidth: '720px' }}>
								Version-style timeline for coding agents: each checkpoint captures intent, touched paths, and a short diff-shaped summary.
							</p>
						</div>
					</div>
					<div
						style={{
							display: 'flex',
							flexWrap: 'wrap',
							gap: '10px',
							alignItems: 'center',
							padding: '12px 14px',
							borderRadius: '12px',
							border: `1px solid ${TOK.border}`,
							background: 'linear-gradient(115deg, rgba(255,255,255,0.045) 0%, rgba(13,15,18,0.98) 52%)',
						}}
					>
						<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600, color: TOK.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
							<History size={13} /> Timeline
						</span>
						<span style={{ width: '4px', height: '4px', borderRadius: '50%', background: TOK.textFaint }} />
						<span style={{ fontSize: '12px', color: TOK.textMuted }}>0 checkpoints</span>
					</div>
				</header>

				<section
					aria-label="Agent checkpoints timeline"
					style={{
						display: 'grid',
						placeItems: 'center',
						padding: '48px 24px',
						borderRadius: '14px',
						border: `1px solid ${TOK.border}`,
						background: 'rgba(255,255,255,0.02)',
					}}
				>
					<div style={{ textAlign: 'center', maxWidth: '420px', display: 'grid', gap: '10px' }}>
						<p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: TOK.text }}>No agent checkpoints yet</p>
						<p style={{ margin: 0, fontSize: '13px', color: TOK.textMuted, lineHeight: 1.55 }}>
							Checkpoints appear here when coding agents save workspace snapshots during product development sessions.
						</p>
					</div>
				</section>
			</div>
		</div>
	);
};
