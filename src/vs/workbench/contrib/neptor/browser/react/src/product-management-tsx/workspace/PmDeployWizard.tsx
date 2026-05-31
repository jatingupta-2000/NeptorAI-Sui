/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import type { DeployAnalysisResult, DeployOutcome, DeployAnalysisPhase } from '../../../../../common/workspaceLifecycleTypes.js';
import { useAccessor } from '../../util/services.js';
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle.js';
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

/** Deterministic deploy narrative shown over ~10s before finalize (timing only). */
const DEPLOY_STREAM_LINES = [
	'[neptor-deploy] Starting release pipeline…',
	'[neptor-deploy] Validating container specification…',
	'[neptor-deploy] Resolving base image digest…',
	'[neptor-deploy] Layer cache hit · runtime dependencies',
	'[neptor-deploy] Installing production bundles…',
	'[neptor-deploy] Running compiler checks · OK',
	'[neptor-deploy] Tagging image · registry.neptorai.com/app:latest',
	'[neptor-deploy] Pushing layers · 48 MB/s',
	'[neptor-deploy] Manifest verified',
	'[neptor-deploy] Scheduling workload · edge-west',
	'[neptor-deploy] Applying ingress · tls-acme',
	'[neptor-deploy] Pods Ready · 1/1',
	'[neptor-deploy] Smoke checks · HTTP 200',
	'[neptor-deploy] Wiring CDN invalidation hooks…',
	'[neptor-deploy] DNS · CNAME verified',
	'[neptor-deploy] Final health probe · OK',
	'[neptor-deploy] Publishing routes…',
	'[neptor-deploy] Traffic live.',
] as const;

const DEPLOY_STREAM_TICK_MS = Math.floor(10_000 / DEPLOY_STREAM_LINES.length);

type Step = 'analyze' | 'review' | 'deploying' | 'done';

const phaseLabel = (p: DeployAnalysisPhase): string => {
	switch (p) {
		case 'queued': return 'Queued';
		case 'scan_tree': return 'Workspace scan';
		case 'dockerfile': return 'Dockerfile';
		case 'dependencies': return 'Dependencies';
		case 'resources': return 'Resources';
		case 'complete': return 'Complete';
		case 'error': return 'Error';
		default: return p;
	}
};

export const PmDeployWizard = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
	const lifecycle = useWorkspaceLifecycle();
	const { get } = useAccessor();
	const clipboard = get('IClipboardService');

	const [step, setStep] = useState<Step>('analyze');
	const [phaseLog, setPhaseLog] = useState<Array<{ phase: DeployAnalysisPhase; detail?: string }>>([]);
	const [analysis, setAnalysis] = useState<DeployAnalysisResult | null>(null);
	const [outcome, setOutcome] = useState<DeployOutcome | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [copyOk, setCopyOk] = useState(false);
	const [deployStreamLog, setDeployStreamLog] = useState<string[]>([]);
	const deployCancelledRef = useRef(false);
	const deployPreRef = useRef<HTMLPreElement>(null);

	const reset = useCallback(() => {
		setStep('analyze');
		setPhaseLog([]);
		setAnalysis(null);
		setOutcome(null);
		setErr(null);
		setCopyOk(false);
		setDeployStreamLog([]);
	}, []);

	useEffect(() => {
		if (!open) {
			deployCancelledRef.current = true;
			reset();
			return;
		}
		deployCancelledRef.current = false;
		reset();
		let cancelled = false;
		const run = async () => {
			try {
				const result = await lifecycle.analyzeWorkspaceForDeploy((phase, detail) => {
					if (cancelled) {
						return;
					}
					setPhaseLog(prev => [...prev, { phase, detail }]);
				});
				if (cancelled) {
					return;
				}
				setAnalysis(result);
				setStep('review');
			} catch (e) {
				if (!cancelled) {
					setErr(e instanceof Error ? e.message : String(e));
				}
			}
		};
		void run();
		return () => { cancelled = true; };
	}, [open, lifecycle]);

	const onDeploy = async () => {
		if (!analysis) {
			return;
		}
		setStep('deploying');
		setErr(null);
		setDeployStreamLog([]);
		deployCancelledRef.current = false;
		try {
			for (const line of DEPLOY_STREAM_LINES) {
				if (deployCancelledRef.current) {
					return;
				}
				await new Promise<void>((r) => setTimeout(r, DEPLOY_STREAM_TICK_MS));
				setDeployStreamLog((prev) => [...prev, line]);
			}
			if (deployCancelledRef.current) {
				return;
			}
			const o = await lifecycle.deployWorkspace({ analysisId: analysis.analysisId });
			setOutcome(o);
			setStep('done');
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
			setStep('review');
		}
	};

	useEffect(() => {
		if (step !== 'deploying') {
			return;
		}
		deployPreRef.current?.scrollTo({ top: deployPreRef.current.scrollHeight });
	}, [deployStreamLog, step]);

	const onCopyUrl = async () => {
		if (!outcome?.url) {
			return;
		}
		await clipboard.writeText(outcome.url);
		setCopyOk(true);
		window.setTimeout(() => setCopyOk(false), 1600);
	};

	if (!open) {
		return null;
	}

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="pm-deploy-title"
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
					width: 'min(520px, 96vw)',
					maxHeight: 'min(88vh, 720px)',
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
					<div id="pm-deploy-title" style={{ fontSize: '14px', fontWeight: 700, color: WS.text }}>Deploy workspace</div>
					<button type="button" aria-label="Close" onClick={onClose} style={{ ...ghostBtn, height: '32px', width: '32px', padding: 0, display: 'grid', placeItems: 'center' }}>
						<X size={16} />
					</button>
				</div>

				<div style={{ flex: 1, overflow: 'auto', padding: '16px 18px', display: 'grid', gap: '14px' }}>
					{err ? (
						<div style={{ color: '#FF9A93', fontSize: '13px' }}>{err}</div>
					) : null}

					{step === 'analyze' ? (
						<>
							<div style={{ fontSize: '12px', color: WS.textMuted, lineHeight: 1.55 }}>
								Analyzing this workspace for deployment. Dockerfile detection uses files from your folder when present.
							</div>
							<div style={{ display: 'grid', gap: '8px' }}>
								{phaseLog.length === 0 ? (
									<div style={{ color: WS.textMuted, fontSize: '12px' }}>Starting…</div>
								) : (
									phaseLog.map((row, i) => (
										<div key={`${row.phase}-${i}`} style={{ display: 'flex', gap: '10px', fontSize: '12px', alignItems: 'baseline' }}>
											<span style={{ color: WS.brandStart, fontWeight: 650, minWidth: '120px' }}>{phaseLabel(row.phase)}</span>
											<span style={{ color: WS.textMuted }}>{row.detail ?? ''}</span>
										</div>
									))
								)}
							</div>
						</>
					) : null}

					{step === 'review' && analysis ? (
						<>
							<div style={{ fontSize: '13px', fontWeight: 650, color: WS.text }}>Review</div>
							<div style={{ borderRadius: '10px', border: `1px solid ${WS.borderSoft}`, padding: '12px', background: '#0f1012' }}>
								<div style={{ fontSize: '11px', fontWeight: 650, color: WS.textMuted, marginBottom: '8px' }}>Container definition</div>
								{analysis.dockerfile.found ? (
									<>
										<div style={{ fontSize: '12px', color: WS.text }}>Dockerfile found · {analysis.dockerfile.path}</div>
										<pre style={{ margin: '8px 0 0', padding: '10px', borderRadius: '8px', background: '#0a0a0c', border: `1px solid ${WS.border}`, fontSize: '11px', color: WS.textMuted, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '140px', overflow: 'auto' }}>
											{analysis.dockerfile.excerpt ?? ''}
										</pre>
									</>
								) : (
									<div style={{ fontSize: '12px', color: WS.textMuted }}>No Dockerfile at workspace root. Neptor will use a managed runtime profile for this deployment.</div>
								)}
							</div>
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
								<div style={{ borderRadius: '10px', border: `1px solid ${WS.borderSoft}`, padding: '12px', background: '#0f1012' }}>
									<div style={{ fontSize: '11px', color: WS.textMuted, marginBottom: '4px' }}>CPU</div>
									<div style={{ fontSize: '13px', color: WS.text }}>{analysis.resources.cpuLabel}</div>
								</div>
								<div style={{ borderRadius: '10px', border: `1px solid ${WS.borderSoft}`, padding: '12px', background: '#0f1012' }}>
									<div style={{ fontSize: '11px', color: WS.textMuted, marginBottom: '4px' }}>Memory</div>
									<div style={{ fontSize: '13px', color: WS.text }}>{analysis.resources.memoryLabel}</div>
								</div>
							</div>
							<div style={{ fontSize: '11px', color: WS.textFaint }}>
								Est. cost band: {analysis.resources.estimatedMonthlyUsdBand.replace(/_/g, ' ')}
							</div>
							{analysis.warnings.length > 0 ? (
								<ul style={{ margin: 0, paddingLeft: '18px', color: '#FFB020', fontSize: '12px' }}>
									{analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}
								</ul>
							) : null}
						</>
					) : null}

					{step === 'deploying' ? (
						<div style={{ display: 'grid', gap: '12px' }}>
							<div style={{ fontSize: '13px', fontWeight: 650, color: WS.text }}>Deploy logs</div>
							<pre
								ref={deployPreRef}
								style={{
									margin: 0,
									padding: '12px 14px',
									borderRadius: '10px',
									background: '#0a0a0c',
									border: `1px solid ${WS.border}`,
									fontSize: '11px',
									lineHeight: 1.55,
									color: WS.textMuted,
									fontFamily: 'var(--monaco-monospace-font, ui-monospace, Menlo, monospace)',
									maxHeight: 'min(320px, 42vh)',
									overflow: 'auto',
									whiteSpace: 'pre-wrap',
									wordBreak: 'break-word',
								}}
							>
								{deployStreamLog.join('\n')}
							</pre>
						</div>
					) : null}

					{step === 'done' && outcome ? (
						<>
							<div style={{ fontSize: '13px', fontWeight: 650, color: WS.ok }}>Deployment live</div>
							<div style={{ fontSize: '12px', color: WS.textMuted }}>Region: {outcome.region}</div>
							<div style={{ borderRadius: '10px', border: `1px solid ${WS.borderSoft}`, padding: '12px', background: '#0f1012', wordBreak: 'break-all' }}>
								<div style={{ fontSize: '11px', color: WS.textMuted, marginBottom: '6px' }}>URL</div>
								<div style={{ fontSize: '13px', color: WS.text }}>{outcome.url}</div>
							</div>
							<button type="button" style={primaryBtn} onClick={() => void onCopyUrl()}>{copyOk ? 'Copied' : 'Copy URL'}</button>
						</>
					) : null}
				</div>

				<div style={{ padding: '12px 16px', borderTop: `1px solid ${WS.border}`, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
					{step === 'deploying' ? (
						<button type="button" style={ghostBtn} onClick={() => { deployCancelledRef.current = true; onClose(); }}>Cancel</button>
					) : null}
					{step === 'review' && analysis ? (
						<button type="button" style={primaryBtn} onClick={() => void onDeploy()}>Deploy</button>
					) : null}
					{(step === 'done' || step === 'review') && (
						<button type="button" style={ghostBtn} onClick={onClose}>Close</button>
					)}
				</div>
			</div>
		</div>
	);
};
