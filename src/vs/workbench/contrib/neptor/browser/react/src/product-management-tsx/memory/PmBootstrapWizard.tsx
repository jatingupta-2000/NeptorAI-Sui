/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MemoryWorkspaceProfile, MEMORY_ARTIFACT_TYPES } from '../../../../common/memory/memoryConstants.js';
import type { WorkspaceMemoryStatusFile } from '../../../../common/memory/workspaceMemoryStatus.js';
import type { PmBootstrapProgress } from '../../../../common/pmWorkspaceBootstrapService.js';
import { useAccessor } from '../../util/services.js';
import { NEPTOR_REBUILD_PROJECT_MEMORY_COMMAND_ID } from '../../../../common/neptorProjectMemoryCommands.js';

const W = {
	border: '#2E2E2E',
	text: '#EDEDED',
	muted: '#8B8B8B',
	panel: '#141414',
	brand: '#FF3B30',
	thinking: '#B48CF0',
	tool: '#64B5F6',
	success: '#7BCF8E',
	error: '#FF6B6B',
	streamBg: '#0d0d0d',
} as const;

type ActVariant = 'context' | 'thinking' | 'tool' | 'success' | 'error';
type ActLine = { id: string; variant: ActVariant; text: string };
type LiveGen = { artifactType: string; label: string; stream: string; reasoning: string };

function rid(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function renderBoldSegments(text: string): React.ReactNode {
	const parts = text.split(/(\*\*[^*]+\*\*)/g);
	return parts.map((p, i) => {
		const m = /^\*\*([^*]+)\*\*$/.exec(p);
		if (m) {
			return <strong key={i}>{m[1]}</strong>;
		}
		return <span key={i}>{p}</span>;
	});
}

function variantLabel(v: ActLine['variant']): string {
	switch (v) {
		case 'context': return 'Read';
		case 'thinking': return 'Think';
		case 'tool': return 'Write';
		case 'success': return 'Done';
		case 'error': return 'Error';
	}
}

export const PmBootstrapWizard = ({
	onCompleted,
	onSkip,
	placement = 'editor',
	diskStatus = null,
}: {
	onCompleted: () => void;
	onSkip: () => void;
	placement?: 'editor' | 'chat';
	/** Last known workspace_memory_status.json snapshot (progress on disk). */
	diskStatus?: WorkspaceMemoryStatusFile | null;
}) => {
	const accessor = useAccessor();
	const bootstrap = accessor.get('IPmWorkspaceBootstrapService');
	const notification = accessor.get('INotificationService');
	const command = accessor.get('ICommandService');

	const [step, setStep] = useState(0);
	const [profile, setProfile] = useState<MemoryWorkspaceProfile>('new');
	const [targetUsers, setTargetUsers] = useState('');
	const [outcomes, setOutcomes] = useState('');
	const [constraints, setConstraints] = useState('');
	const [busy, setBusy] = useState(false);

	const [activity, setActivity] = useState<ActLine[]>([]);
	const [liveGen, setLiveGen] = useState<LiveGen | null>(null);
	const feedRef = useRef<HTMLDivElement>(null);

	const appendProgress = useCallback((p: PmBootstrapProgress) => {
		if (p.kind === 'line') {
			setActivity((a) => [...a, { id: rid(), variant: p.variant, text: p.text }]);
			return;
		}
		if (p.kind === 'stream') {
			setLiveGen((lg) => {
				if (lg && lg.artifactType === p.artifactType) {
					return { ...lg, stream: p.snippet };
				}
				return { artifactType: p.artifactType, label: p.label, stream: p.snippet, reasoning: '' };
			});
			return;
		}
		if (p.kind === 'reasoning') {
			setLiveGen((lg) => {
				if (lg && lg.artifactType === p.artifactType) {
					return { ...lg, reasoning: p.text };
				}
				return lg;
			});
			return;
		}
		if (p.kind === 'artifact_end') {
			setLiveGen((lg) => (lg?.artifactType === p.artifactType ? null : lg));
		}
	}, []);

	useEffect(() => {
		const el = feedRef.current;
		if (!el) {
			return;
		}
		el.scrollTop = el.scrollHeight;
	}, [activity, liveGen]);

	const runScaffold = async () => {
		setBusy(true);
		setActivity([{ id: rid(), variant: 'tool', text: 'Running **Rebuild Project Memory** (deterministic files, no LLM)…' }]);
		setLiveGen(null);
		try {
			await command.executeCommand(NEPTOR_REBUILD_PROJECT_MEMORY_COMMAND_ID);
			setActivity((a) => [...a, { id: rid(), variant: 'success', text: 'Scaffold wrote markdown + **index.json**. Use LLM when you want richer text.' }]);
			notification.info('Neptor created deterministic memory files. Complete the wizard to enrich them with LLM.');
			setStep(4);
		} catch (e) {
			setActivity((a) => [...a, { id: rid(), variant: 'error', text: String(e) }]);
			notification.error(String(e));
		} finally {
			setBusy(false);
		}
	};

	const runLlm = async () => {
		setBusy(true);
		setActivity([]);
		setLiveGen(null);
		try {
			const res = await bootstrap.runWizardBootstrap(
				{
					workspaceProfile: profile,
					targetUsers: targetUsers.trim() || '(not specified)',
					outcomes: outcomes.trim() || '(not specified)',
					constraints: constraints.trim() || '(not specified)',
				},
				appendProgress,
			);
			if (res.ok) {
				notification.info('PM workspace bootstrap finished.');
				onCompleted();
			} else {
				notification.warn(`Bootstrap completed with issues:\n${res.detail}`);
				onCompleted();
			}
		} catch (e) {
			setActivity((a) => [...a, { id: rid(), variant: 'error', text: String(e) }]);
			notification.error(String(e));
		} finally {
			setBusy(false);
			setLiveGen(null);
		}
	};

	const maxCopyW = placement === 'chat' ? '100%' : '640px';
	const pad = placement === 'chat' ? '12px 14px' : '16px 20px';
	const stepColMax = placement === 'chat' ? '100%' : '560px';
	const feedMaxH = placement === 'chat' ? 240 : 340;

	return (
		<div style={{
			borderBottom: placement === 'chat' ? 'none' : `1px solid ${W.border}`,
			borderRadius: placement === 'chat' ? '10px' : undefined,
			border: placement === 'chat' ? `1px solid ${W.border}` : undefined,
			background: W.panel,
			padding: pad,
		}}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
				<div>
					<div style={{ color: W.text, fontWeight: 700, fontSize: placement === 'chat' ? '13px' : '14px' }}>PM workspace setup</div>
					<div style={{ color: W.muted, fontSize: '11px', marginTop: '4px', maxWidth: maxCopyW, lineHeight: 1.45 }}>
						Generate curated markdown under <code style={{ color: W.text }}>.neptor/memory</code> or scaffold first, then LLM. Uses your Chat model from Neptor settings.
					</div>
					{diskStatus && diskStatus.generation.completedTypes.length > 0 ? (
						<div style={{ color: W.muted, fontSize: '10px', marginTop: '6px', lineHeight: 1.4 }}>
							On-disk progress (<code style={{ color: W.text }}>workspace_memory_status.json</code>):{' '}
							<span style={{ color: W.text }}>{diskStatus.generation.completedTypes.length}</span> / {MEMORY_ARTIFACT_TYPES.length} artifacts written
							{diskStatus.generation.failedTypes.length > 0 ? (
								<span style={{ color: W.error }}> · {diskStatus.generation.failedTypes.length} failed last run</span>
							) : null}
							{diskStatus.generation.currentArtifactType ? (
								<span> · current: {diskStatus.generation.currentArtifactType}</span>
							) : null}
						</div>
					) : null}
				</div>
				<div style={{ display: 'flex', gap: '8px' }}>
					<button type="button" disabled={busy} onClick={onSkip} style={ghostBtn}>Skip for now</button>
				</div>
			</div>

			{(busy || activity.length > 0) ? (
				<div
					ref={feedRef}
					style={{
						marginTop: '12px',
						maxHeight: feedMaxH,
						overflowY: 'auto',
						borderRadius: '8px',
						border: `1px solid ${W.border}`,
						background: W.streamBg,
						padding: '10px 12px',
						fontSize: '11px',
						lineHeight: 1.45,
						fontFamily: 'var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)',
					}}
				>
					<div style={{ color: W.muted, fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em', marginBottom: '8px' }}>ACTIVITY</div>
					{activity.map((row) => (
						<div key={row.id} style={{ marginBottom: '10px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
							<span style={{
								flexShrink: 0,
								fontSize: '9px',
								fontWeight: 700,
								textTransform: 'uppercase',
								padding: '2px 6px',
								borderRadius: '4px',
								background: chipBg(row.variant),
								color: chipFg(row.variant),
							}}>
								{variantLabel(row.variant)}
							</span>
							<div style={{ color: W.text, minWidth: 0 }}>{renderBoldSegments(row.text)}</div>
						</div>
					))}
					{liveGen ? (
						<div style={{ marginTop: '4px', paddingTop: '10px', borderTop: `1px solid ${W.border}` }}>
							<div style={{ color: W.thinking, fontWeight: 600, marginBottom: '6px', fontSize: '11px' }}>
								Generating: {liveGen.label}
							</div>
							{liveGen.reasoning.trim() ? (
								<details open style={{ marginBottom: '8px' }}>
									<summary style={{ color: W.muted, cursor: 'pointer', fontSize: '10px' }}>Model reasoning (optional)</summary>
									<pre style={{
										margin: '6px 0 0',
										whiteSpace: 'pre-wrap',
										wordBreak: 'break-word',
										color: '#c9b8e8',
										fontSize: '10px',
										maxHeight: '120px',
										overflowY: 'auto',
									}}>
										{liveGen.reasoning}
									</pre>
								</details>
							) : null}
							{liveGen.stream ? (
								<div>
									<div style={{ color: W.muted, fontSize: '10px', marginBottom: '4px' }}>Streaming output</div>
									<pre style={{
										margin: 0,
										whiteSpace: 'pre-wrap',
										wordBreak: 'break-word',
										color: '#9cdcfe',
										fontSize: '10px',
										maxHeight: '140px',
										overflowY: 'auto',
									}}>
										{liveGen.stream}
									</pre>
								</div>
							) : (
								<div style={{ color: W.muted, fontSize: '10px', fontStyle: 'italic' }}>Waiting for first tokens…</div>
							)}
						</div>
					) : null}
				</div>
			) : null}

			{step === 0 && (
				<div style={{ marginTop: '14px', display: 'grid', gap: '10px', maxWidth: stepColMax }}>
					<div style={{ color: W.text, fontSize: '12px', fontWeight: 600 }}>Is this a new idea or an existing product?</div>
					<div style={{ display: 'flex', gap: '8px' }}>
						<button type="button" style={profile === 'new' ? primaryBtn : ghostBtn} onClick={() => setProfile('new')}>New idea</button>
						<button type="button" style={profile === 'existing' ? primaryBtn : ghostBtn} onClick={() => setProfile('existing')}>Existing product</button>
					</div>
					<button type="button" style={primaryBtn} onClick={() => setStep(1)}>Continue</button>
				</div>
			)}

			{step === 1 && (
				<div style={{ marginTop: '14px', display: 'grid', gap: '10px', maxWidth: stepColMax }}>
					<label style={labelStyle}>Who is it for?</label>
					<textarea value={targetUsers} onChange={(e) => setTargetUsers(e.target.value)} rows={3} style={inputStyle} placeholder="Teams, personas, customers..." />
					<button type="button" style={primaryBtn} onClick={() => setStep(2)}>Continue</button>
				</div>
			)}

			{step === 2 && (
				<div style={{ marginTop: '14px', display: 'grid', gap: '10px', maxWidth: stepColMax }}>
					<label style={labelStyle}>Target outcomes (next 90 days)</label>
					<textarea value={outcomes} onChange={(e) => setOutcomes(e.target.value)} rows={3} style={inputStyle} />
					<button type="button" style={primaryBtn} onClick={() => setStep(3)}>Continue</button>
				</div>
			)}

			{step === 3 && (
				<div style={{ marginTop: '14px', display: 'grid', gap: '10px', maxWidth: stepColMax }}>
					<label style={labelStyle}>Constraints and risks</label>
					<textarea value={constraints} onChange={(e) => setConstraints(e.target.value)} rows={3} style={inputStyle} />
					<div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
						<button type="button" disabled={busy} style={ghostBtn} onClick={() => void runScaffold()}>Scaffold files only (no LLM)</button>
						<button type="button" disabled={busy} style={primaryBtn} onClick={() => void runLlm()}>{busy ? 'Working…' : 'Generate with LLM'}</button>
					</div>
				</div>
			)}

			{step === 4 && (
				<div style={{ marginTop: '14px', display: 'grid', gap: '10px', maxWidth: stepColMax }}>
					<div style={{ color: W.muted, fontSize: '12px' }}>Files are on disk. Run LLM enrichment when your Chat model is configured.</div>
					<button type="button" disabled={busy} style={primaryBtn} onClick={() => void runLlm()}>{busy ? 'Working…' : 'Run LLM enrichment now'}</button>
				</div>
			)}
		</div>
	);
};

function chipBg(v: ActLine['variant']): string {
	switch (v) {
		case 'context': return 'rgba(150,150,150,0.15)';
		case 'thinking': return 'rgba(180,140,240,0.2)';
		case 'tool': return 'rgba(100,181,246,0.2)';
		case 'success': return 'rgba(123,207,142,0.2)';
		case 'error': return 'rgba(255,107,107,0.2)';
	}
}

function chipFg(v: ActLine['variant']): string {
	switch (v) {
		case 'context': return '#bbb';
		case 'thinking': return W.thinking;
		case 'tool': return W.tool;
		case 'success': return W.success;
		case 'error': return W.error;
	}
}

const labelStyle: React.CSSProperties = { color: W.text, fontSize: '12px', fontWeight: 600 };
const inputStyle: React.CSSProperties = {
	width: '100%',
	resize: 'vertical' as const,
	borderRadius: '8px',
	border: `1px solid ${W.border}`,
	background: '#0f0f0f',
	color: W.text,
	padding: '10px',
	fontSize: '12px',
	fontFamily: 'var(--vscode-font-family)',
};
const primaryBtn: React.CSSProperties = {
	borderRadius: '8px',
	border: 'none',
	background: W.brand,
	color: '#fff',
	padding: '8px 14px',
	fontSize: '12px',
	fontWeight: 600,
	cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
	borderRadius: '8px',
	border: `1px solid ${W.border}`,
	background: 'transparent',
	color: W.text,
	padding: '8px 14px',
	fontSize: '12px',
	cursor: 'pointer',
};
