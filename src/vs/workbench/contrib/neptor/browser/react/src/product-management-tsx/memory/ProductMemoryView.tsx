/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { URI } from '../../../../../../../base/common/uri.js';
import {
	MemoryArtifactType,
	MEMORY_ARTIFACT_BRIEFING_TAGLINE,
	MEMORY_ARTIFACT_LABEL,
	MEMORY_ARTIFACT_TYPES,
	PM_JUMP_MEMORY_TAB_EVENT,
	PM_REQUEST_REFRESH_EVENT,
} from '../../../../common/memory/memoryConstants.js';
import { ParsedMemorySection } from '../../../../common/memory/parseMemoryMarkdown.js';
import { PmMemoryArtifactView, PmMemoryOverview, PmMemoryRootView } from '../../../../common/neptorProjectMemoryService.js';
import { useAccessor } from '../../util/services.js';
import { MemorySectionBody } from './MemoryMarkdownVisual.js';
import { PmProjectBriefingShell } from './PmProjectBriefingShell.js';
import { briefingSectionAnchorId, PMBriefing } from './pmWorkspaceBriefingTokens.js';

const PM = {
	bgPanel: '#141414',
	border: '#2E2E2E',
	text: '#EDEDED',
	textMuted: '#8B8B8B',
} as const;
const PM_MEMORY_OVERVIEW_EVENT = 'neptor-pm-memory-overview';

const MEMORY_TYPE_COUNT = MEMORY_ARTIFACT_TYPES.length;

/** Restrained rail accents (avoid rainbow cueing on every artifact lane). */
const ARTIFACT_BORDER_RAIL = 'rgba(237,237,237,0.22)';

function countArtifactWords(art: PmMemoryArtifactView): number {
	let n = 0;
	for (const s of art.sections) {
		const blob = `${s.title} ${s.body}`.trim();
		if (!blob) {
			continue;
		}
		n += blob.split(/\s+/).filter(Boolean).length;
	}
	return n;
}

function artifactNeedsReview(art: PmMemoryArtifactView): boolean {
	return art.sections.some((s: ParsedMemorySection) => /todo|tbd|unknown/i.test(`${s.title} ${s.body}`));
}

function dispatchJumpToMemoryTab(type: MemoryArtifactType): void {
	if (typeof window === 'undefined') {
		return;
	}
	window.dispatchEvent(new CustomEvent(PM_JUMP_MEMORY_TAB_EVENT, {
		detail: { tabLabel: MEMORY_ARTIFACT_LABEL[type] },
	}));
}

function fixesSignal(body: string): { label: string; bg: string; fg: string } | null {
	const blob = body.slice(0, 520);
	if (/critical|P0\b|SEV-?0|blocker/i.test(blob)) {
		return { label: 'Hot path', bg: 'rgba(255,69,58,0.18)', fg: '#FF9A93' };
	}
	if (/high|P1\b|SEV-?1|urgent/i.test(blob)) {
		return { label: 'Elevated', bg: 'rgba(255,176,32,0.14)', fg: '#FFD38A' };
	}
	if (/resolved|fixed|shipped|closed/i.test(blob)) {
		return { label: 'Wrapped', bg: 'rgba(48,209,88,0.12)', fg: '#8EFFC3' };
	}
	return null;
}

function roadmapLaneHint(title: string): string | null {
	const t = title.trim();
	if (!t) {
		return null;
	}
	if (/\b(milestone|phase|q[1-4]|epic)\b/i.test(t)) {
		return 'Milestone lane';
	}
	return null;
}

function aggregateLatestIso(arts: PmMemoryArtifactView[]): string {
	const isos = arts.map(a => a.updatedIso).filter((iso): iso is string => typeof iso === 'string' && iso.length > 0);
	if (isos.length === 0) {
		return new Date().toISOString();
	}
	const sorted = isos.slice().sort((a, b) => Date.parse(b) - Date.parse(a));
	return sorted[0] ?? new Date().toISOString();
}

function deriveArtifactTypes(next: PmMemoryOverview): MemoryArtifactType[] {
	return Array.from(
		new Set(
			next.roots.flatMap((r: PmMemoryRootView) => r.artifacts.map((a: PmMemoryArtifactView) => a.type)),
		),
	).filter((t): t is MemoryArtifactType => MEMORY_ARTIFACT_TYPES.includes(t));
}

function artifactTypesFingerprint(types: MemoryArtifactType[]): string {
	return [...types].sort().join(',');
}

function insightSurface(spotlight: boolean, accent: string): React.CSSProperties {
	return {
		scrollMarginTop: '88px',
		borderRadius: PMBriefing.radiusCard,
		border: `1px solid ${PMBriefing.borderSoft}`,
		padding: spotlight ? '16px 18px' : '12px 14px',
		background: spotlight
			? 'linear-gradient(125deg, rgba(255,255,255,0.05) 0%, #0d0f12 56%)'
			: '#0d0f12',
		borderLeft: `4px solid ${accent}`,
		boxShadow: spotlight ? PMBriefing.shadowLift : '0 4px 18px rgba(0,0,0,0.22)',
		minWidth: 0,
	};
}

export const ProductMemoryView = ({ artifactFilter }: { artifactFilter: MemoryArtifactType | 'all' }) => {
	const accessor = useAccessor();
	const projectMemory = accessor.get('INeptorProjectMemoryService');
	const commandService = accessor.get('ICommandService');
	const workspaceService = accessor.get('IWorkspaceContextService');

	const [overview, setOverview] = useState<PmMemoryOverview | null>(null);
	const [loading, setLoading] = useState(false);
	const [lastRefreshedAtIso, setLastRefreshedAtIso] = useState<string | null>(null);

	/** Avoid readOverview reacting while we are mid deep refresh (writes already broadcast events). */
	const deepRefreshInFlightRef = useRef(false);
	const lastPublishedTypesKeyRef = useRef<string>('');

	const publishOverviewTypesIfChanged = useCallback((next: PmMemoryOverview) => {
		if (typeof window === 'undefined') {
			return;
		}
		const types = deriveArtifactTypes(next);
		const key = artifactTypesFingerprint(types);
		if (key === lastPublishedTypesKeyRef.current) {
			return;
		}
		lastPublishedTypesKeyRef.current = key;
		window.dispatchEvent(new CustomEvent('neptor-pm-memory-types', { detail: { types } }));
		window.dispatchEvent(new CustomEvent(PM_MEMORY_OVERVIEW_EVENT, { detail: { types } }));
	}, []);

	const reloadOverviewOnly = useCallback(async (): Promise<boolean> => {
		if (deepRefreshInFlightRef.current) {
			return false;
		}
		try {
			const next = await projectMemory.readOverviewForUi();
			setOverview(next);
			publishOverviewTypesIfChanged(next);
			return true;
		} catch {
			return false;
		}
	}, [projectMemory, publishOverviewTypesIfChanged]);

	const refresh = useCallback(async () => {
		deepRefreshInFlightRef.current = true;
		setLoading(true);
		try {
			for (const folder of workspaceService.getWorkspace().folders) {
				try {
					await projectMemory.refreshMemoryManifestForFolder(folder.uri);
				} catch {
					// keep UI refresh resilient
				}
			}
			const next = await projectMemory.readOverviewForUi();
			setOverview(next);
			setLastRefreshedAtIso(new Date().toISOString());
			publishOverviewTypesIfChanged(next);
			/* refreshMemoryManifestForFolder already emits neptor-pm-memory-updated once per scan; omit duplicate to prevent refresh chains and flicker. */
		} finally {
			setLoading(false);
			deepRefreshInFlightRef.current = false;
		}
	}, [projectMemory, workspaceService, publishOverviewTypesIfChanged]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const onDiskChanged = () => {
			void reloadOverviewOnly();
		};
		window.addEventListener('neptor-pm-memory-updated', onDiskChanged);
		return () => window.removeEventListener('neptor-pm-memory-updated', onDiskChanged);
	}, [reloadOverviewOnly]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const onRefreshRequest = () => { void refresh(); };
		window.addEventListener(PM_REQUEST_REFRESH_EVENT, onRefreshRequest);
		return () => window.removeEventListener(PM_REQUEST_REFRESH_EVENT, onRefreshRequest);
	}, [refresh]);

	const openMarkdown = (u: URI) => {
		void commandService.executeCommand('vscode.open', u);
	};

	const roots = overview?.roots ?? [];
	const allArtifacts = roots.flatMap((r: PmMemoryRootView) => r.artifacts);
	const filteredArtifacts = allArtifacts.filter((a: PmMemoryArtifactView) => artifactFilter === 'all' || a.type === artifactFilter);
	const presentTypes = new Set(allArtifacts.map((a: PmMemoryArtifactView) => a.type));
	const sectionCount = allArtifacts.reduce((sum: number, a: PmMemoryArtifactView) => sum + a.sections.length, 0);
	const coveragePct = Math.round((presentTypes.size / MEMORY_TYPE_COUNT) * 100);
	const needsReview = allArtifacts.filter((a: PmMemoryArtifactView) =>
		a.sections.some((s: ParsedMemorySection) => /todo|tbd|unknown/i.test(s.title + ' ' + s.body))
	).length;
	const staleDocs = allArtifacts.filter((a: PmMemoryArtifactView) => (Date.now() - Date.parse(a.updatedIso)) > (14 * 24 * 60 * 60 * 1000)).length;
	const recentEdits = allArtifacts.filter((a: PmMemoryArtifactView) => (Date.now() - Date.parse(a.updatedIso)) <= (24 * 60 * 60 * 1000)).length;
	const latestArtifactUpdatedIso = allArtifacts
		.map((a: PmMemoryArtifactView) => a.updatedIso)
		.filter((iso: unknown): iso is string => typeof iso === 'string' && iso.length > 0)
		.sort((a: string, b: string) => Date.parse(b) - Date.parse(a))[0];
	const updatedLabel = latestArtifactUpdatedIso
		? `${timeAgo(latestArtifactUpdatedIso)} ago`
		: (lastRefreshedAtIso ? `${timeAgo(lastRefreshedAtIso)} ago` : 'just now');

	if (loading && !overview) {
		return <div style={{ color: PM.textMuted, padding: '16px' }}>Loading project memory…</div>;
	}

	if (!overview || roots.length === 0) {
		return (
			<div style={{ padding: '16px', display: 'grid', gap: '12px' }}>
				<div style={{ color: PM.text, fontWeight: 700, fontSize: '28px' }}>Memory Insights</div>
				<div style={{ color: PM.textMuted }}>No memory files found in <code style={{ color: PM.text }}>.neptor/memory</code>.</div>
				<button type="button" onClick={() => void refresh()} style={ghostBtn}>Refresh memory</button>
			</div>
		);
	}

	if (artifactFilter !== 'all' && filteredArtifacts.length === 0) {
		const label = MEMORY_ARTIFACT_LABEL[artifactFilter];
		return (
			<div style={{ padding: '24px', display: 'grid', gap: '14px', maxWidth: '520px' }}>
				<div style={{ color: PM.text, fontWeight: 700, fontSize: '22px' }}>Briefing waiting on files</div>
				<div style={{ color: PM.textMuted, fontSize: '14px', lineHeight: 1.58 }}>
					No <span style={{ color: PM.text, fontWeight: 650 }}>{label}</span> artifact is in <code style={{ color: PM.text }}>.neptor/memory</code> yet. Generate or paste the markdown, then refresh.
				</div>
				<button type="button" onClick={() => void refresh()} style={ghostBtn}>Refresh briefing</button>
			</div>
		);
	}

	if (artifactFilter === 'all') {
		const allTypes = [...MEMORY_ARTIFACT_TYPES];
		const artifactFileCount = allArtifacts.length || 1;
		const sortedArtifacts = allArtifacts.slice().sort((a: PmMemoryArtifactView, b: PmMemoryArtifactView) => Date.parse(b.updatedIso) - Date.parse(a.updatedIso));
		const signalMixRows = allTypes.filter((t) => presentTypes.has(t)).slice().sort((t1, t2) => (
			allArtifacts.filter((aa: PmMemoryArtifactView) => aa.type === t2).length - allArtifacts.filter((aa: PmMemoryArtifactView) => aa.type === t1).length
		));
		return (
			<div style={{ padding: '8px', display: 'grid', gap: '16px' }}>
				<div style={allMemoryHero}>
					<div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
						<div>
							<div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: PMBriefing.brandStart, marginBottom: '8px' }}>
								Command center
							</div>
							<div style={{ color: PM.text, fontWeight: 700, fontSize: '32px', lineHeight: 1.08 }}>All project memory</div>
							<div style={{ color: PM.textMuted, fontSize: '14px', marginTop: '8px', lineHeight: 1.55 }}>
								Coverage, gaps, and fast jumps into each briefing lane. Open a focused lane in the Product sidebar for the full paper.
							</div>
						</div>
						<div style={{ display: 'grid', gap: '8px', justifyItems: 'end' }}>
							<button type="button" onClick={() => void refresh()} style={ghostBtn}>Refresh</button>
							<div style={{ color: PM.textMuted, fontSize: '12px' }}>Freshness {updatedLabel}</div>
						</div>
					</div>
					<div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '10px' }}>
						<StatCard label="Artifacts" value={String(allArtifacts.length)} sub={`${sectionCount} sections`} color={PM.text} />
						<StatCard label="Coverage" value={`${coveragePct}%`} sub={`${presentTypes.size}/${MEMORY_TYPE_COUNT} types`} color="#FFB020" />
						<StatCard label="Needs Review" value={String(needsReview)} sub="TODO / TBD / unknown" color="#30D158" />
						<StatCard label="Aging Docs" value={String(staleDocs)} sub="older than 14 days" color="#30D158" />
						<StatCard label="Recent Edits" value={String(recentEdits)} sub="last 24h" color="#30D158" />
					</div>
				</div>

				<div style={splitWideNarrow}>
					<div style={panelCard}>
						<div style={panelTitle}>Where memory sits</div>
						<div style={{ color: PM.textMuted, fontSize: '13px', marginTop: '8px', lineHeight: 1.5 }}>
							Each row jumps to the same briefing surface you see on individual tabs. Markdown stays the source; this screen is the launch pad.
						</div>
						<div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
							{sortedArtifacts.map((a: PmMemoryArtifactView) => (
								<div
									key={a.id + a.relPath}
									style={{
										display: 'flex',
										justifyContent: 'space-between',
										gap: '12px',
										alignItems: 'flex-start',
										padding: '10px 12px',
										borderRadius: '12px',
										border: `1px solid ${PMBriefing.borderSoft}`,
										background: '#0f1014',
										minWidth: 0,
									}}
								>
									<div style={{ display: 'grid', gap: '4px', minWidth: 0 }}>
										<div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
											<span
												style={{
													fontSize: '10px',
													fontWeight: 700,
													letterSpacing: '0.06em',
													textTransform: 'uppercase',
													color: PM.textMuted,
													border: `1px solid rgba(237,237,237,0.14)`,
													background: 'rgba(237,237,237,0.035)',
													padding: '3px 8px',
													borderRadius: '6px',
												}}
											>
												{MEMORY_ARTIFACT_LABEL[a.type]}
											</span>
											<span style={{ color: PM.text, fontWeight: 650, fontSize: '14px' }}>{a.title}</span>
										</div>
										<div style={{ fontSize: '11px', color: PM.textMuted, fontFamily: PMBriefing.fontMono, wordBreak: 'break-word' }}>
											{a.relPath} · {timeAgo(a.updatedIso)} ago · {countArtifactWords(a).toLocaleString()} words
										</div>
									</div>
									<div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
										<button type="button" style={ghostBtn} onClick={() => dispatchJumpToMemoryTab(a.type)}>Open briefing</button>
										<button type="button" style={ghostBtn} onClick={() => openMarkdown(a.resource)}>Open file</button>
									</div>
								</div>
							))}
						</div>
					</div>

					<div style={{ display: 'grid', gap: '14px' }}>
						<div style={panelCard}>
							<div style={panelTitle}>Signal mix</div>
							<div style={{ color: PM.textMuted, fontSize: '12px', marginTop: '6px', lineHeight: 1.45 }}>
								Each bar is the share of captured files in that lane (normalized to the total number of memory files on disk).
							</div>
							<div style={{ display: 'grid', gap: '12px', marginTop: '10px' }}>
								{signalMixRows.map((t) => {
									const count = allArtifacts.filter((aa: PmMemoryArtifactView) => aa.type === t).length;
									const sharePct = Math.round((count / artifactFileCount) * 100);
									const widthPct = Math.min(100, Math.max(sharePct > 0 ? 6 : 0, sharePct));
									return (
										<div key={t} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 40px', alignItems: 'center', gap: '10px' }}>
											<div style={{ color: PM.textMuted }}>{MEMORY_ARTIFACT_LABEL[t]}</div>
											<div style={{ height: '8px', borderRadius: '999px', background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
												<div
													style={{
														width: `${widthPct}%`,
														height: '100%',
														borderRadius: '999px',
														background: 'linear-gradient(90deg, rgba(237,237,237,0.28) 0%, rgba(237,237,237,0.45) 100%)',
													}}
												/>
											</div>
											<div style={{ color: PM.text, textAlign: 'right', fontSize: '12px', fontVariantNumeric: 'tabular-nums' }} title={`${sharePct}% of files`}>
												{count}
											</div>
										</div>
									);
								})}
							</div>
						</div>

						<div style={panelCard}>
							<div style={panelTitle}>Coverage ledger</div>
							<div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
								{allTypes.map((t) => {
									const ready = presentTypes.has(t);
									return (
										<div key={t} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
											<div style={{ color: PM.textMuted, fontSize: '13px' }}>{MEMORY_ARTIFACT_LABEL[t]}</div>
											<div
												style={{
													color: ready ? '#30D158' : PM.textMuted,
													fontWeight: 650,
													fontSize: '12px',
													padding: '2px 8px',
													borderRadius: '999px',
													border: `1px solid ${ready ? 'rgba(48,209,88,0.5)' : PM.border}`,
													background: ready ? 'rgba(48,209,88,0.08)' : 'transparent',
												}}
											>
												{ready ? 'Captured' : 'Gap'}
											</div>
										</div>
									);
								})}
							</div>
						</div>
					</div>
				</div>

				<div style={panelCard}>
					<div style={panelTitle}>Gaps worth filling</div>
					<div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
						{allTypes.filter((t) => !presentTypes.has(t)).slice(0, 8).map((t) => (
							<div key={t} style={{ color: '#ffb086', fontWeight: 600, fontSize: '13px' }}>
								Missing · {MEMORY_ARTIFACT_LABEL[t]}
							</div>
						))}
						{allTypes.every((t) => presentTypes.has(t)) ? (
							<div style={{ color: '#30D158', fontWeight: 600 }}>Every memory lane has at least one file</div>
						) : null}
					</div>
				</div>
			</div>
		);
	}

	const focusedType = artifactFilter as MemoryArtifactType;
	const totalWords = filteredArtifacts.reduce((sum: number, art: PmMemoryArtifactView) => sum + countArtifactWords(art), 0);
	const totalSections = filteredArtifacts.reduce((sum: number, art: PmMemoryArtifactView) => sum + art.sections.length, 0);
	const pulseUpdated = `${timeAgo(aggregateLatestIso(filteredArtifacts))} ago`;
	const needsPulseReview = filteredArtifacts.some(artifactNeedsReview);
	const heroTitle = filteredArtifacts.length === 1
		? filteredArtifacts[0].title
		: `${MEMORY_ARTIFACT_LABEL[focusedType]} (${filteredArtifacts.length} files)`;
	const sectionJumpModel = filteredArtifacts.flatMap((art: PmMemoryArtifactView) =>
		art.sections.map((sec: ParsedMemorySection) => ({
			id: `${art.id}-${sec.id}`,
			title:
				filteredArtifacts.length > 1
					? `${sec.title || 'Insight'} · ${art.relPath.split('/').pop() ?? art.relPath}`
					: (sec.title || 'Insight'),
		}))
	);

	const microMuted: React.CSSProperties = {
		fontSize: '10px',
		fontWeight: 700,
		letterSpacing: '0.08em',
		textTransform: 'uppercase',
		color: PMBriefing.textFaint,
	};

	return (
		<div style={{ padding: '8px 8px 20px', minWidth: 0 }}>
			<PmProjectBriefingShell
				pulse={{
					updatedLabel: pulseUpdated,
					sectionCount: totalSections,
					wordCount: totalWords,
					needsReview: needsPulseReview,
				}}
				hero={{
					typeLabel: MEMORY_ARTIFACT_LABEL[focusedType],
					title: heroTitle,
					tagline: MEMORY_ARTIFACT_BRIEFING_TAGLINE[focusedType],
				}}
				sectionJumps={sectionJumpModel}
				heroActions={(
					<>
						{filteredArtifacts.length === 1 ? (
							<button type="button" style={ghostBtn} onClick={() => openMarkdown(filteredArtifacts[0].resource)}>Open markdown</button>
						) : (
							filteredArtifacts.map((art: PmMemoryArtifactView) => (
								<button key={art.id + art.relPath} type="button" style={ghostBtn} onClick={() => openMarkdown(art.resource)} title={art.relPath}>
									Open · {(art.relPath.split('/').pop() ?? art.relPath).slice(0, 24)}
								</button>
							))
						)}
					</>
				)}
			>
				{filteredArtifacts.map((art: PmMemoryArtifactView, artIdx: number) => (
					<React.Fragment key={art.id + art.relPath}>
						{filteredArtifacts.length > 1 ? (
							<div style={{ fontSize: '12px', color: PM.textMuted, fontFamily: PMBriefing.fontMono, marginBottom: '4px', wordBreak: 'break-word' }}>
								Source · {art.relPath}
							</div>
						) : null}
						{art.sections.length > 0 ? (
							<div style={{ display: 'grid', gap: '12px' }}>
								{art.sections.map((sec: ParsedMemorySection, secIdx: number) => {
									const anchorId = `${art.id}-${sec.id}`;
									const spotlight = art.type === 'architecture' && artIdx === 0 && secIdx === 0;
									const fixCue = art.type === 'fixes' ? fixesSignal(sec.body) : null;
									const roadmapCue = art.type === 'roadmap' ? roadmapLaneHint(sec.title) : null;
									return (
										<div key={anchorId} id={briefingSectionAnchorId(anchorId)} style={insightSurface(spotlight, fixCue?.fg ?? ARTIFACT_BORDER_RAIL)}>
											<div style={{ marginBottom: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
												<div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
													{art.type === 'tasks' ? (
														<span style={microMuted}>Action board</span>
													) : null}
													{fixCue ? (
														<span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', border: `1px solid ${fixCue.fg}`, background: fixCue.bg, color: fixCue.fg }}>
															{fixCue.label}
														</span>
													) : null}
													{roadmapCue ? (
														<span style={{ fontSize: '10px', fontWeight: 650, padding: '2px 8px', borderRadius: '999px', border: `1px solid ${PMBriefing.borderSoft}`, color: PMBriefing.textMuted }}>
															{roadmapCue}
														</span>
													) : null}
													<span style={{ fontSize: '14px', fontWeight: 650, color: PM.text }}>
														{sec.title || 'Untitled highlight'}
													</span>
												</div>
												{sec.tags.length > 0 ? (
													<div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
														{sec.tags.map((tg: string) => (
															<span key={tg} style={tagPill}>{tg}</span>
														))}
													</div>
												) : null}
											</div>
											<MemorySectionBody body={sec.body} segmentKey={anchorId} variant="briefing" />
										</div>
									);
								})}
							</div>
						) : (
							<div style={{ color: PM.textMuted, fontSize: '13px' }}>Sections will appear once the markdown uses Neptor headings.</div>
						)}
					</React.Fragment>
				))}
			</PmProjectBriefingShell>
		</div>
	);
};

const allMemoryHero: React.CSSProperties = {
	border: `1px solid ${PM.border}`,
	borderRadius: '14px',
	padding: '14px',
	background: PM.bgPanel,
};

const splitWideNarrow: React.CSSProperties = {
	display: 'grid',
	gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, 0.85fr)',
	gap: '14px',
};

const panelCard: React.CSSProperties = {
	border: `1px solid ${PM.border}`,
	borderRadius: '14px',
	padding: '14px',
	background: PM.bgPanel,
};

const panelTitle: React.CSSProperties = {
	color: PM.text,
	fontSize: '16px',
	fontWeight: 700,
};

const tagPill: React.CSSProperties = {
	display: 'inline-block',
	padding: '2px 8px',
	borderRadius: '999px',
	border: `1px solid ${PM.border}`,
	fontSize: '10px',
	fontWeight: 500,
	color: PM.textMuted,
};

const ghostBtn: React.CSSProperties = {
	background: 'transparent',
	color: PM.text,
	border: `1px solid ${PM.border}`,
	borderRadius: '8px',
	padding: '6px 10px',
	cursor: 'pointer',
	fontSize: '12px',
};

const StatCard = ({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) => (
	<div style={panelStatCard}>
		<div style={{ color: PM.textMuted, fontSize: '13px', fontWeight: 650 }}>{label}</div>
		<div style={{ color, fontSize: '34px', fontWeight: 800, lineHeight: 1.1, marginTop: '8px' }}>{value}</div>
		<div style={{ color: PM.textMuted, fontSize: '12px', marginTop: '6px' }}>{sub}</div>
	</div>
);

const panelStatCard: React.CSSProperties = {
	border: `1px solid ${PM.border}`,
	borderRadius: '12px',
	padding: '14px',
	background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.18))',
	minHeight: '128px',
};

function timeAgo(iso: string): string {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) {
		return 'just now';
	}
	const delta = Math.max(0, Date.now() - then);
	const mins = Math.floor(delta / 60000);
	if (mins < 1) { return 'just now'; }
	if (mins < 60) { return `${mins}m`; }
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) { return `${hrs}h`; }
	const days = Math.floor(hrs / 24);
	return `${days}d`;
}
