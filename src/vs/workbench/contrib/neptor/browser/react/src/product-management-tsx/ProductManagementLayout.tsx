/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { Component, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { URI } from '../../../../../../../base/common/uri.js';
import { useAccessor } from '../util/services.js';
import {
	MemoryArtifactType,
	MEMORY_ARTIFACT_LABEL,
	MEMORY_ARTIFACT_TYPES,
	PM_JUMP_MEMORY_TAB_EVENT,
	PM_REQUEST_REFRESH_EVENT,
} from '../../../../common/memory/memoryConstants.js';
import { NEPTOR_PM_AGENTGIT_TAB_LABEL } from '../../../../common/neptorPmAgentGitConstants.js';
import { NEPTOR_PM_ORGANIZATIONS_TAB_LABEL } from './workspace/pmOrganizationConstants.js';
import { NEPTOR_AGENT_MODE_STORAGE_KEY } from '../../../../common/neptorAgentKindConstants.js';
import { ProductManagementChat } from './ProductManagementChat.js';
import { PmAgentGitTracker } from './memory/PmAgentGitTracker.js';
import { ProductMemoryView } from './memory/ProductMemoryView.js';
import { PmDeployWizard } from './workspace/PmDeployWizard.js';
import { PmTeamPanel } from './workspace/PmTeamPanel.js';
import { PmCollaborationActivityPanel } from './workspace/PmCollaborationActivityPanel.js';
import { PmOrganizationsView } from './workspace/PmOrganizationsView.js';
import { PmOrgSwitcher } from './workspace/PmOrgSwitcher.js';
import { NEPTOR_PM_OPEN_COLLABORATION_ACTIVITY_EVENT } from '../../../../common/neptorPmUiEvents.js';
import { AGENT_SHELL } from '../shared/agentShell.js';
import {
	BookMarked,
	Braces,
	ChevronDown,
	Compass,
	Cpu,
	FolderKanban,
	FolderOpen,
	GitBranch,
	Globe,
	Hammer,
	History,
	Lightbulb,
	ListTodo,
	Layers,
	Package,
	Plus,
	RefreshCw,
	Route,
	Share2,
	Target,
	Workflow,
	Zap,
	Sparkles,
	Building2,
	Rocket,
	Users,
	Activity,
} from 'lucide-react';

// ============================================================================
// Design tokens (scoped to PM EditorPane only)
// ============================================================================

const PM = {
	bgApp: '#0A0A0A',
	bgPanel: '#141414',
	bgPanelAlt: '#191919',
	border: '#2E2E2E',
	borderSubtle: 'rgba(46,46,46,0.6)',
	text: '#EDEDED',
	textMuted: '#8B8B8B',
	textFaint: '#5C5C5C',
	/** Typography recipe: body at ~85% opacity on white mix */
	textBody: 'rgba(237, 237, 237, 0.85)',
	surface: '#0d0d0e',
	surface2: '#161618',
	primary: '#FF3B30',
	accentBlue: '#0A84FF',
	accentAmber: '#FF9500',
	brandStart: '#FF3B30',
	brandEnd: '#FF9500',
	brandRedSoft: 'rgba(255, 59, 48, 0.12)',
	brandRedBorder: 'rgba(255, 59, 48, 0.85)',
	brandGradient: 'linear-gradient(135deg, #FF3B30 0%, #FF9500 100%)',
} as const;

const ALL_MEMORY_TAB = 'All memory' as const;
const PM_TABS = [ALL_MEMORY_TAB, NEPTOR_PM_AGENTGIT_TAB_LABEL, NEPTOR_PM_ORGANIZATIONS_TAB_LABEL, ...MEMORY_ARTIFACT_TYPES.map((t) => MEMORY_ARTIFACT_LABEL[t])] as const;
type PMTab = typeof PM_TABS[number];

/** Product vs engineering vs procedural memory (every `MemoryArtifactType` appears exactly once). */
const PM_PRODUCT_TYPES = ['overview', 'vision', 'roadmap', 'domain', 'user_journeys'] as const satisfies readonly MemoryArtifactType[];
const PM_ENGINEERING_TYPES = ['architecture', 'tech_stack', 'code_style', 'apis', 'flows', 'tasks', 'file_graph', 'fixes'] as const satisfies readonly MemoryArtifactType[];
const PM_KNOWLEDGE_TYPES = ['docs_index', 'decisions', 'workflow'] as const satisfies readonly MemoryArtifactType[];

class PmCanvasErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
	override state = { error: null as Error | null };

	static getDerivedStateFromError(error: Error): { error: Error } {
		return { error };
	}

	override componentDidCatch(error: Error): void {
		console.error('[Neptor PM] Center canvas render error', error);
	}

	override render(): ReactNode {
		if (this.state.error) {
			return (
				<div style={{ padding: '24px', display: 'grid', gap: '10px', maxWidth: '640px' }}>
					<div style={{ color: PM.text, fontWeight: 700, fontSize: '16px' }}>Product canvas failed to load</div>
					<div style={{ color: PM.textMuted, fontSize: '13px', lineHeight: 1.55 }}>
						The center editor hit a runtime error. Reload the window after rebuilding React. Details are in the developer console.
					</div>
					<pre style={{ margin: 0, padding: '12px', borderRadius: '8px', border: `1px solid ${PM.border}`, background: '#0f1012', color: '#FF9A93', fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
						{this.state.error.message}
					</pre>
				</div>
			);
		}
		return this.props.children;
	}
}

// ============================================================================
// Cross-surface state sync (sidebar nav <-> editor canvas)
// ============================================================================

const PM_ACTIVE_TAB_KEY = 'neptor.pm.activeTab';
const PM_ACTIVE_NAV_KEY = 'neptor.pm.activeNav';
const PM_MEMORY_FILTER_KEY = 'neptor.pm.memoryArtifactFilter';
const PM_VIEW_CHANGE_EVENT = 'neptor-pm-view-change';
const PM_TAB_SYNC_EVENT = 'neptor-pm-active-tab-sync';
const PM_MEMORY_TYPES_EVENT = 'neptor-pm-memory-types';
const PM_MEMORY_OVERVIEW_EVENT = 'neptor-pm-memory-overview';
const THREAD_SCOPE_KEY_PREFIX = 'neptor.chat.scope.threadId.';
const AGENT_MODE_EVENT = 'neptor-chat-mode-change';
type ChatScope = 'agent' | 'product';

function artifactNavIcon(type: MemoryArtifactType): React.ReactNode {
	switch (type) {
		case 'overview': return <Compass size={14} />;
		case 'vision': return <Target size={14} />;
		case 'roadmap': return <FolderKanban size={14} />;
		case 'domain': return <Globe size={14} />;
		case 'user_journeys': return <Route size={14} />;
		case 'architecture': return <Cpu size={14} />;
		case 'tech_stack': return <Package size={14} />;
		case 'code_style': return <Braces size={14} />;
		case 'apis': return <Share2 size={14} />;
		case 'flows': return <Workflow size={14} />;
		case 'tasks': return <ListTodo size={14} />;
		case 'file_graph': return <GitBranch size={14} />;
		case 'fixes': return <Hammer size={14} />;
		case 'docs_index': return <BookMarked size={14} />;
		case 'decisions': return <Lightbulb size={14} />;
		case 'workflow': return <Zap size={14} />;
	}
}

const readStoredMemoryFilter = (): MemoryArtifactType | 'all' => {
	if (typeof window === 'undefined') {
		return 'all';
	}
	const raw = window.localStorage.getItem(PM_MEMORY_FILTER_KEY);
	if (raw && MEMORY_ARTIFACT_TYPES.includes(raw as MemoryArtifactType)) {
		return raw as MemoryArtifactType;
	}
	return 'all';
};

const readStoredActiveTab = (): PMTab => {
	if (typeof window === 'undefined') {
		return ALL_MEMORY_TAB;
	}
	const stored = window.localStorage.getItem(PM_ACTIVE_TAB_KEY) as PMTab | null;
	if (stored && PM_TABS.includes(stored)) {
		return stored;
	}
	return ALL_MEMORY_TAB;
};

const dispatchPmTabChange = (tab: PMTab) => {
	if (typeof window === 'undefined') {
		return;
	}
	window.localStorage.setItem(PM_ACTIVE_NAV_KEY, tab);
	window.localStorage.setItem(PM_ACTIVE_TAB_KEY, tab);
	if (tab === NEPTOR_PM_AGENTGIT_TAB_LABEL || tab === NEPTOR_PM_ORGANIZATIONS_TAB_LABEL) {
		window.dispatchEvent(new CustomEvent(PM_VIEW_CHANGE_EVENT, {
			detail: { navId: tab, targetTab: tab, memoryFilter: readStoredMemoryFilter() },
		}));
		return;
	}
	const derived = tabToMemoryFilter(tab);
	window.localStorage.setItem(PM_MEMORY_FILTER_KEY, derived === 'all' ? 'all' : derived);
	window.dispatchEvent(new CustomEvent(PM_VIEW_CHANGE_EVENT, {
		detail: { navId: tab, targetTab: tab, memoryFilter: derived === 'all' ? 'all' : derived },
	}));
};

const tabToMemoryFilter = (tab: PMTab): MemoryArtifactType | 'all' => {
	if (tab === ALL_MEMORY_TAB) {
		return 'all';
	}
	const found = MEMORY_ARTIFACT_TYPES.find((t) => MEMORY_ARTIFACT_LABEL[t] === tab);
	return found ?? 'all';
};

export type PmSurface = 'editor' | 'sidebar' | 'agent';

export const ProductManagementLayout = ({ surface, agentVariant = 'product' }: { surface: PmSurface; agentVariant?: ChatScope }) => {
	if (surface === 'sidebar') {
		return <ProductManagementSidebarSurface />;
	}
	if (surface === 'agent') {
		return <ProductManagementAgentSurface scope={agentVariant} />;
	}
	return <ProductManagementEditorSurface />;
};

// ============================================================================
// Sidebar surface: the full PM navigation (Activity Bar > Product)
// ============================================================================

const ProductManagementSidebarSurface = () => {
	const accessor = useAccessor();
	const projectMemory = accessor.get('INeptorProjectMemoryService');
	const [activeTab, setActiveTabState] = useState<PMTab>(() => readStoredActiveTab());

	const syncOverviewFingerprint = useCallback(async () => {
		try {
			const overview = await projectMemory.readOverviewForUi();
			const rootsWithArtifacts = overview.roots.filter(root => root.artifacts.length > 0);
			const sourceRoot = rootsWithArtifacts[0] ?? overview.roots[0];
			const types = Array.from(
				new Set(
					(sourceRoot?.artifacts ?? []).map((artifact) => artifact.type)
				)
			).filter((t): t is MemoryArtifactType => MEMORY_ARTIFACT_TYPES.includes(t));
			const typesSorted = [...types].sort((a, b) => (a > b ? 1 : -1));
			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent(PM_MEMORY_OVERVIEW_EVENT, { detail: { types: typesSorted } }));
			}
		} catch {
			// Ignore; sidebar still lists every lane.
		}
	}, [projectMemory]);

	useEffect(() => {
		void syncOverviewFingerprint();
		const bump = () => { void syncOverviewFingerprint(); };
		window.addEventListener(PM_MEMORY_TYPES_EVENT, bump);
		window.addEventListener('neptor-pm-memory-updated', bump);
		window.addEventListener('focus', bump);
		return () => {
			window.removeEventListener(PM_MEMORY_TYPES_EVENT, bump);
			window.removeEventListener('neptor-pm-memory-updated', bump);
			window.removeEventListener('focus', bump);
		};
	}, [syncOverviewFingerprint]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const onSync = (event: Event) => {
			const tab = (event as CustomEvent<{ tab?: PMTab }>).detail?.tab;
			if (tab && PM_TABS.includes(tab)) {
				setActiveTabState(tab);
			}
		};
		window.addEventListener(PM_TAB_SYNC_EVENT, onSync);
		return () => window.removeEventListener(PM_TAB_SYNC_EVENT, onSync);
	}, []);

	const selectTab = (tab: PMTab) => {
		setActiveTabState(tab);
		dispatchPmTabChange(tab);
	};

	return (
		<div className="neptor-pm-pane" style={surfaceWrapperStyle}>
			<style>{paneScopedCSS}</style>
			<SidebarNavPanel activeTab={activeTab} selectTab={selectTab} />
		</div>
	);
};

// ============================================================================
// Agent surface: the Neptor AI Agent panel (Auxiliary Bar)
// ============================================================================

const ProductManagementAgentSurface = ({ scope }: { scope: ChatScope }) => {
	return (
		<div className="neptor-pm-pane" style={surfaceWrapperStyle}>
			<style>{paneScopedCSS}</style>
			<ContextPanel scope={scope} />
		</div>
	);
};

// ============================================================================
// Editor surface: ONLY the center canvas (no left nav, no right chat)
// ============================================================================

const ProductManagementEditorSurface = () => {
	const accessor = useAccessor();
	const projectMemory = accessor.get('INeptorProjectMemoryService');

	const [activeTab, setActiveTab] = useState<PMTab>(() => readStoredActiveTab());
	const [memoryArtifactFilter, setMemoryArtifactFilter] = useState<MemoryArtifactType | 'all'>(() => readStoredMemoryFilter());
	const visibleTabs = useMemo(() => [...PM_TABS] as PMTab[], []);

	const updateFromOverview = useCallback(async () => {
		try {
			const overview = await projectMemory.readOverviewForUi();
			const rootsWithArtifacts = overview.roots.filter(root => root.artifacts.length > 0);
			const sourceRoot = rootsWithArtifacts[0] ?? overview.roots[0];
			const types = Array.from(
				new Set(
					(sourceRoot?.artifacts ?? []).map((artifact) => artifact.type)
				)
			).filter((t): t is MemoryArtifactType => MEMORY_ARTIFACT_TYPES.includes(t));
			const typesSorted = [...types].sort((a, b) => (a > b ? 1 : -1));
			if (typeof window !== 'undefined') {
				window.dispatchEvent(new CustomEvent(PM_MEMORY_OVERVIEW_EVENT, { detail: { types: typesSorted } }));
			}
		} catch {
			// Editor canvas still renders briefing lanes; sidebar sync is best-effort.
		}
	}, [projectMemory]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		window.localStorage.setItem(PM_ACTIVE_TAB_KEY, activeTab);
		if (activeTab === NEPTOR_PM_AGENTGIT_TAB_LABEL || activeTab === NEPTOR_PM_ORGANIZATIONS_TAB_LABEL) {
			window.dispatchEvent(new CustomEvent(PM_TAB_SYNC_EVENT, { detail: { tab: activeTab } }));
			return;
		}
		const derived = tabToMemoryFilter(activeTab);
		window.localStorage.setItem(PM_MEMORY_FILTER_KEY, derived === 'all' ? 'all' : derived);
		setMemoryArtifactFilter(derived);
		window.dispatchEvent(new CustomEvent(PM_TAB_SYNC_EVENT, { detail: { tab: activeTab } }));
	}, [activeTab]);

	useEffect(() => {
		if (typeof window === 'undefined') { return; }
		const handler = (event: Event) => {
			const detail = (event as CustomEvent<{ navId?: string; targetTab?: PMTab | null; memoryFilter?: MemoryArtifactType | 'all' }>).detail;
			const next = detail?.targetTab ?? (window.localStorage.getItem(PM_ACTIVE_TAB_KEY) as PMTab | null);
			if (next && visibleTabs.includes(next as PMTab)) {
				setActiveTab(next as PMTab);
			} else if (next && PM_TABS.includes(next as PMTab)) {
				// Sidebar selects a briefing lane before the overview labels it visible in the manifest.
				setActiveTab(next as PMTab);
			}
			const mf = detail?.memoryFilter ?? readStoredMemoryFilter();
			setMemoryArtifactFilter(mf);
		};
		window.addEventListener(PM_VIEW_CHANGE_EVENT, handler);
		return () => window.removeEventListener(PM_VIEW_CHANGE_EVENT, handler);
	}, [visibleTabs]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		void updateFromOverview();
		const onMemoryUpdated = () => { void updateFromOverview(); };
		const onFocus = () => { void updateFromOverview(); };
		const onVisibility = () => {
			if (document.visibilityState === 'visible') {
				void updateFromOverview();
			}
		};
		window.addEventListener('neptor-pm-memory-updated', onMemoryUpdated);
		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onVisibility);
		/* Periodic sync only between explicit events — 3s was thrashing tabs and the canvas between identical overview reads. */
		const intervalMs = 120_000;
		const interval = window.setInterval(() => {
			if (document.visibilityState === 'visible') {
				void updateFromOverview();
			}
		}, intervalMs);
		const handler = (event: Event) => {
			// Always re-sync from disk-backed service to avoid stale tab state.
			void updateFromOverview();
		};
		window.addEventListener(PM_MEMORY_TYPES_EVENT, handler);
		return () => {
			window.removeEventListener(PM_MEMORY_TYPES_EVENT, handler);
			window.removeEventListener('neptor-pm-memory-updated', onMemoryUpdated);
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onVisibility);
			window.clearInterval(interval);
		};
	}, [updateFromOverview]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const onJumpTab = (event: Event) => {
			const tabLabel = (event as CustomEvent<{ tabLabel?: string }>).detail?.tabLabel;
			if (tabLabel && PM_TABS.includes(tabLabel as PMTab)) {
				setActiveTab(tabLabel as PMTab);
			}
		};
		window.addEventListener(PM_JUMP_MEMORY_TAB_EVENT, onJumpTab);
		return () => window.removeEventListener(PM_JUMP_MEMORY_TAB_EVENT, onJumpTab);
	}, []);

	return (
		<div className="neptor-pm-pane" style={paneRootStyle}>
			<style>{paneScopedCSS}</style>
			<PmCanvasErrorBoundary>
				<CenterCanvas activeTab={activeTab} memoryArtifactFilter={memoryArtifactFilter} onSelectTab={setActiveTab} />
			</PmCanvasErrorBoundary>
		</div>
	);
};

// ============================================================================
// Left navigation panel (~250px fixed)
// ============================================================================

const SidebarNavPanel = ({ activeTab, selectTab }: { activeTab: PMTab; selectTab: (tab: PMTab) => void }) => (
	<aside className="neptor-pm-pane__nav" style={navPanelStyle}>
		<div style={navHeaderStyle}>
			<PmOrgSwitcher onNavigateOrganizations={() => selectTab(NEPTOR_PM_ORGANIZATIONS_TAB_LABEL)} selectTab={(tab) => selectTab(tab as PMTab)} />
			<button type="button" style={navIconButtonStyle} aria-label="New organization" title="New organization" onClick={() => selectTab(NEPTOR_PM_ORGANIZATIONS_TAB_LABEL)}>
				<Plus size={14} />
			</button>
		</div>

		<div style={navGroupLabelStyle}>Overview</div>
		<div style={{ display: 'grid', gap: '2px' }}>
			<NavItem icon={<Layers size={14} />} label={ALL_MEMORY_TAB} active={activeTab === ALL_MEMORY_TAB} onClick={() => selectTab(ALL_MEMORY_TAB)} />
			<NavItem icon={<History size={14} />} label={NEPTOR_PM_AGENTGIT_TAB_LABEL} active={activeTab === NEPTOR_PM_AGENTGIT_TAB_LABEL} onClick={() => selectTab(NEPTOR_PM_AGENTGIT_TAB_LABEL)} />
		</div>

		<div style={navGroupLabelStyle}>Product</div>
		<div style={{ display: 'grid', gap: '2px' }}>
			<NavItem icon={<Building2 size={14} />} label={NEPTOR_PM_ORGANIZATIONS_TAB_LABEL} active={activeTab === NEPTOR_PM_ORGANIZATIONS_TAB_LABEL} onClick={() => selectTab(NEPTOR_PM_ORGANIZATIONS_TAB_LABEL)} />
			{PM_PRODUCT_TYPES.map((t) => {
				const label = MEMORY_ARTIFACT_LABEL[t] as PMTab;
				return (
					<NavItem key={t} icon={artifactNavIcon(t)} label={label} active={activeTab === label} onClick={() => selectTab(label)} />
				);
			})}
		</div>

		<div style={navGroupLabelStyle}>Engineering</div>
		<div style={{ display: 'grid', gap: '2px' }}>
			{PM_ENGINEERING_TYPES.map((t) => {
				const label = MEMORY_ARTIFACT_LABEL[t] as PMTab;
				return (
					<NavItem key={t} icon={artifactNavIcon(t)} label={label} active={activeTab === label} onClick={() => selectTab(label)} />
				);
			})}
		</div>

		<div style={navGroupLabelStyle}>Knowledge</div>
		<div style={{ display: 'grid', gap: '2px' }}>
			{PM_KNOWLEDGE_TYPES.map((t) => {
				const label = MEMORY_ARTIFACT_LABEL[t] as PMTab;
				return (
					<NavItem key={t} icon={artifactNavIcon(t)} label={label} active={activeTab === label} onClick={() => selectTab(label)} />
				);
			})}
		</div>

		<div style={{ flex: 1 }} />
	</aside>
);

const NavItem = ({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) => (
	<button type="button" onClick={onClick} className={`neptor-pm-pane__nav-item${active ? ' is-active' : ''}`} style={navItemStyle(active)}>
		<span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
			<span style={{ flexShrink: 0 }}>{icon}</span>
			<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
		</span>
	</button>
);

// ============================================================================
// Center canvas (flex 1, scrollable)
// ============================================================================

const CenterCanvas = ({
	activeTab,
	memoryArtifactFilter,
	onSelectTab,
}: {
	activeTab: PMTab;
	memoryArtifactFilter: MemoryArtifactType | 'all';
	onSelectTab?: (tab: PMTab) => void;
}) => {
	const accessor = useAccessor();
	const commandService = accessor.get('ICommandService');
	const workspaceService = accessor.get('IWorkspaceContextService');

	const contextLine =
		activeTab === ALL_MEMORY_TAB
			? `Command center · ${ALL_MEMORY_TAB}`
			: activeTab === NEPTOR_PM_AGENTGIT_TAB_LABEL
				? `${NEPTOR_PM_AGENTGIT_TAB_LABEL} · checkpoints & rollbacks`
				: activeTab === NEPTOR_PM_ORGANIZATIONS_TAB_LABEL
					? `${NEPTOR_PM_ORGANIZATIONS_TAB_LABEL} · teams & invites`
					: `Project briefing · ${activeTab}`;

	const [deployWizardOpen, setDeployWizardOpen] = useState(false);
	const [teamPanelOpen, setTeamPanelOpen] = useState(false);
	const [activityPanelOpen, setActivityPanelOpen] = useState(false);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const onOpenActivity = () => setActivityPanelOpen(true);
		window.addEventListener(NEPTOR_PM_OPEN_COLLABORATION_ACTIVITY_EVENT, onOpenActivity);
		return () => window.removeEventListener(NEPTOR_PM_OPEN_COLLABORATION_ACTIVITY_EVENT, onOpenActivity);
	}, []);

	const toolbarRefresh = useCallback(() => {
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent(PM_REQUEST_REFRESH_EVENT));
		}
	}, []);

	const toolbarRevealMemoryDir = useCallback(() => {
		const folders = workspaceService.getWorkspace().folders;
		if (!folders.length) {
			return;
		}
		const uri = URI.joinPath(folders[0].uri, '.neptor', 'memory');
		void commandService.executeCommand('revealInExplorer', uri);
	}, [commandService, workspaceService]);

	return (
		<section className="neptor-pm-pane__canvas" style={centerCanvasStyle}>
			<div style={canvasTopBarStyle}>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
					<span style={{ fontSize: '12px', color: PM.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
						{contextLine}
					</span>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
					<button type="button" style={ghostButtonStyle} title="Analyze and deploy" aria-label="Deploy workspace" onClick={() => setDeployWizardOpen(true)}>
						<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
							<Rocket size={14} />
							Deploy
						</span>
					</button>
					<button type="button" style={ghostButtonStyle} title="Invite collaborators" aria-label="Team invites" onClick={() => setTeamPanelOpen(true)}>
						<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
							<Users size={14} />
							Team
						</span>
					</button>
					<button type="button" style={ghostButtonStyle} title="Workspace activity feed" aria-label="Collaboration activity" onClick={() => setActivityPanelOpen(true)}>
						<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
							<Activity size={14} />
							Activity
						</span>
					</button>
					<button type="button" style={ghostButtonStyle} title="Reload memory manifest" aria-label="Refresh memory" onClick={toolbarRefresh}>
						<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
							<RefreshCw size={14} />
							Refresh
						</span>
					</button>
					<button type="button" style={ghostButtonStyle} title="Reveal folder in Explorer" aria-label="Open memory folder" onClick={toolbarRevealMemoryDir}>
						<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
							<FolderOpen size={14} />
							Memory folder
						</span>
					</button>
				</div>
			</div>

			<div style={canvasContentStyle}>
				<PmCanvasErrorBoundary>
					{activeTab === NEPTOR_PM_AGENTGIT_TAB_LABEL ? (
						<PmAgentGitTracker />
					) : activeTab === NEPTOR_PM_ORGANIZATIONS_TAB_LABEL ? (
						<PmOrganizationsView />
					) : (
						<ProductMemoryView artifactFilter={memoryArtifactFilter} />
					)}
				</PmCanvasErrorBoundary>
			</div>
			{deployWizardOpen ? <PmDeployWizard open onClose={() => setDeployWizardOpen(false)} /> : null}
			{teamPanelOpen ? (
				<PmTeamPanel
					open
					onClose={() => setTeamPanelOpen(false)}
					onOpenOrganizations={onSelectTab ? () => onSelectTab(NEPTOR_PM_ORGANIZATIONS_TAB_LABEL) : undefined}
				/>
			) : null}
			{activityPanelOpen ? <PmCollaborationActivityPanel open onClose={() => setActivityPanelOpen(false)} /> : null}
		</section>
	);
};


// ============================================================================
// Right context panel (~300px fixed)
// ============================================================================

const ContextPanel = ({ scope }: { scope: ChatScope }) => {
	const accessor = useAccessor();
	const chatThreadsService = accessor.get('IChatThreadService');
	const commandService = accessor.get('ICommandService');
	const title = scope === 'product' ? 'Neptor Product AI Agent' : 'Neptor AI Agent';
	const previousScopeRef = useRef<ChatScope | null>(null);
	const panelRef = useRef<HTMLElement | null>(null);
	const isScopeActive = () => {
		if (typeof window === 'undefined') {
			return false;
		}
		const mode = window.localStorage.getItem(NEPTOR_AGENT_MODE_STORAGE_KEY) === 'product' ? 'product' : 'code';
		return scope === 'product' ? mode === 'product' : mode === 'code';
	};

	const activateScopeThread = () => {
		if (typeof window === 'undefined') {
			return;
		}
		const scopedKey = `${THREAD_SCOPE_KEY_PREFIX}${scope}`;
		const savedThreadId = window.localStorage.getItem(scopedKey);
		if (savedThreadId && chatThreadsService.state.allThreads[savedThreadId]) {
			if (chatThreadsService.state.currentThreadId !== savedThreadId) {
				chatThreadsService.switchToThread(savedThreadId);
			}
		} else {
			chatThreadsService.openNewThread();
			const newThreadId = chatThreadsService.state.currentThreadId;
			if (newThreadId) {
				window.localStorage.setItem(scopedKey, newThreadId);
			}
		}
	};

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		if (!isScopeActive()) {
			return;
		}
		if (previousScopeRef.current !== scope) {
			const prevScope = previousScopeRef.current;
			const currentThreadId = chatThreadsService.state.currentThreadId;
			if (prevScope && currentThreadId) {
				window.localStorage.setItem(`${THREAD_SCOPE_KEY_PREFIX}${prevScope}`, currentThreadId);
			}
			previousScopeRef.current = scope;
		}
		activateScopeThread();
	}, [scope, chatThreadsService]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		if (!isScopeActive()) {
			return;
		}
		const currentThreadId = chatThreadsService.state.currentThreadId;
		if (currentThreadId) {
			window.localStorage.setItem(`${THREAD_SCOPE_KEY_PREFIX}${scope}`, currentThreadId);
		}
	}, [scope, chatThreadsService.state.currentThreadId]);

	useEffect(() => {
		const panel = panelRef.current;
		if (!panel || typeof window === 'undefined') {
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					activateScopeThread();
				}
			}
		}, { threshold: 0.6 });
		observer.observe(panel);
		return () => observer.disconnect();
	}, [scope, chatThreadsService]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const onModeChange = () => {
			if (isScopeActive()) {
				activateScopeThread();
			}
		};
		window.addEventListener(AGENT_MODE_EVENT, onModeChange);
		window.addEventListener('storage', onModeChange);
		return () => {
			window.removeEventListener(AGENT_MODE_EVENT, onModeChange);
			window.removeEventListener('storage', onModeChange);
		};
	}, [scope, chatThreadsService]);

	const openScopedThread = () => {
		if (typeof window === 'undefined') {
			chatThreadsService.openNewThread();
			return;
		}
		chatThreadsService.openNewThread();
		const newThreadId = chatThreadsService.state.currentThreadId;
		if (newThreadId) {
			window.localStorage.setItem(`${THREAD_SCOPE_KEY_PREFIX}${scope}`, newThreadId);
		}
	};

	return (
	<aside ref={panelRef} className="neptor-pm-pane__context" style={contextPanelStyle} onMouseDownCapture={activateScopeThread}>
		<div style={contextHeaderStyle}>
			<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
				<Sparkles size={14} color={PM.brandStart} />
				<span style={{ fontSize: '13px', fontWeight: 600, color: PM.text }}>{title}</span>
				<ChevronDown size={13} color={PM.textMuted} />
			</div>
			<div style={{ display: 'flex', gap: '4px' }}>
				<button type="button" style={navIconButtonStyle} aria-label="Add" onClick={openScopedThread}><Plus size={14} /></button>
				<button type="button" style={navIconButtonStyle} aria-label="History" onClick={() => { commandService.executeCommand('neptor.historyAction'); }}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M3 4v5h5" stroke="#FF3B30" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
						<path d="M3.8 9A9 9 0 1 1 6 18" stroke="#FF3B30" strokeWidth="2.4" strokeLinecap="round" />
						<path d="M12 8.5v3.8h3" stroke="#FF3B30" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
			</div>
		</div>

		<div style={contextChatSurfaceStyle}>
			<div style={contextChatFrameStyle}>
				<ProductManagementChat />
			</div>
			<div style={contextDisclaimerStyle}>
				Neptor AI Agent can make mistakes. Verify important info.
			</div>
		</div>
	</aside>
	);
};

// ============================================================================
// Style definitions (tokens; locally scoped + a small CSS string for hover)
// ============================================================================

const paneScopedCSS = `
.neptor-pm-pane, .neptor-pm-pane * { box-sizing: border-box; }
.neptor-pm-pane button { font-family: inherit; }
.neptor-pm-pane ::selection { background: rgba(255, 149, 0, 0.30); color: #fff; }

/* PM agent chat sits inside the workbench; RTL locales set dir=rtl on the shell, which
   reverses flex rows and biases bidirectional streaming text. Isolate LTR for normal typing order. */
.neptor-pm-pane .neptor-pm-chat-ltr {
	direction: ltr;
	unicode-bidi: isolate;
}

/* --- PM Markdown: shared typography recipe (pairs with MemoryMarkdownVisual) --- */
.neptor-pm-pane .neptor-pm-md {
	font-size: 15px;
	line-height: 1.75;
	color: ${PM.textBody};
	font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
	font-feature-settings: "ss01", "ss02", "cv05";
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
	user-select: text;
	max-width: 100%;
	min-width: 0;
	overflow-wrap: anywhere;
	word-break: break-word;
}
.neptor-pm-pane .neptor-pm-md h1,
.neptor-pm-pane .neptor-pm-md h2,
.neptor-pm-pane .neptor-pm-md h3,
.neptor-pm-pane .neptor-pm-md h4,
.neptor-pm-pane .neptor-pm-md p,
.neptor-pm-pane .neptor-pm-md li,
.neptor-pm-pane .neptor-pm-md blockquote {
	overflow-wrap: anywhere;
	word-break: break-word;
}
.neptor-pm-pane .neptor-pm-md h1 {
	font-size: 44px;
	line-height: 1.05;
	font-weight: 700;
	letter-spacing: -0.035em;
	margin: 0.45em 0 0.35em;
	color: #ffffff;
}
.neptor-pm-pane .neptor-pm-md h2 {
	font-size: 24px;
	line-height: 1.2;
	font-weight: 700;
	letter-spacing: -0.02em;
	margin: 0.9em 0 0.42em;
	color: #fafafa;
	border-bottom: none;
	padding-bottom: 0;
}
.neptor-pm-pane .neptor-pm-md h3.neptor-pm-md__h3 {
	font-size: 20px;
	line-height: 1.35;
	font-weight: 600;
	margin: 0.85em 0 0.38em;
	color: #f0f0f0;
	letter-spacing: -0.015em;
	display: flex;
	align-items: baseline;
	gap: 10px;
}
.neptor-pm-pane .neptor-pm-md h3.neptor-pm-md__h3::before {
	content: '';
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: ${PM.primary};
	flex-shrink: 0;
	align-self: center;
	box-shadow: 0 0 0 1.5px color-mix(in srgb, ${PM.primary} 55%, transparent);
}
.neptor-pm-pane .neptor-pm-md h4 {
	font-size: 16px;
	line-height: 1.4;
	font-weight: 600;
	margin: 0.75em 0 0.32em;
	color: #e6e6e6;
}

.neptor-pm-pane .neptor-pm-md hr {
	border: none;
	border-top: 1px solid ${PM.border};
	margin: 32px 0;
}

.neptor-pm-pane .neptor-pm-md blockquote {
	border-left: 2px solid ${PM.primary};
	background: rgba(255, 59, 48, 0.05);
	border-radius: 0 8px 8px 0;
	font-style: italic;
	padding: 12px 16px;
	margin: 14px 0;
	color: ${PM.textBody};
}

/* Unordered lists: 4px round bullets, 8px gap */
.neptor-pm-pane .neptor-pm-md ul.neptor-pm-md-list--unordered {
	list-style: none;
	padding-left: 0;
	margin: 8px 0;
}
.neptor-pm-pane .neptor-pm-md ul.neptor-pm-md-list--unordered > li {
	display: flex;
	flex-direction: row;
	align-items: flex-start;
	gap: 8px;
	margin: 0.4em 0;
	padding-left: 0;
}
.neptor-pm-pane .neptor-pm-md ul.neptor-pm-md-list--unordered > li::before {
	content: '';
	width: 4px;
	height: 4px;
	border-radius: 50%;
	background: rgba(237, 237, 237, 0.5);
	flex-shrink: 0;
	margin-top: 0.55em;
}
.neptor-pm-pane .neptor-pm-md ol.neptor-pm-md-list--ordered {
	padding-inline-start: 1.4em;
	margin: 8px 0;
	list-style-position: outside;
}
.neptor-pm-pane .neptor-pm-md ol.neptor-pm-md-list--ordered > li {
	margin: 0.4em 0;
	padding-left: 4px;
}

/* Repo-tree style lists */
.neptor-pm-pane .neptor-pm-md--repo-tree ul.neptor-pm-md-list--unordered {
	margin: 6px 0 10px;
	padding: 10px 14px 10px 1.5em;
	border-left: 2px solid rgba(90, 200, 250, 0.45);
	border-radius: 0 10px 10px 0;
	background: rgba(90, 200, 250, 0.05);
}
.neptor-pm-pane .neptor-pm-md--repo-tree ul.neptor-pm-md-list--unordered li {
	font-family: "JetBrains Mono", var(--monaco-monospace-font, ui-monospace, Menlo, monospace);
	font-size: 12px;
	margin: 0.22em 0;
	line-height: 1.5;
	color: ${PM.text};
}
.neptor-pm-pane .neptor-pm-md--repo-tree ul.neptor-pm-md-list--unordered > li::before {
	background: rgba(90, 200, 250, 0.75);
}

.neptor-pm-pane .neptor-pm-md ul:not(.neptor-pm-md-list--unordered),
.neptor-pm-pane .neptor-pm-md ol:not(.neptor-pm-md-list--ordered) {
	list-style-position: outside !important;
}
.neptor-pm-pane .neptor-pm-md li > p {
	margin: 0 0 0.35em 0;
}
.neptor-pm-pane .neptor-pm-md li > p:last-child {
	margin-bottom: 0;
}

/* Diagram + code block hover affordances */
.neptor-pm-pane .neptor-pm-md__copy-btn:hover { background: rgba(255,255,255,0.10) !important; color: #fff !important; }
.neptor-pm-pane .neptor-pm-md__copy-btn {
	font-family: "JetBrains Mono", var(--monaco-monospace-font, ui-monospace, Menlo, monospace);
}
.neptor-pm-pane .neptor-pm-md__mermaid svg { max-width: 100%; height: auto; }
.neptor-pm-pane .neptor-pm-md__mermaid .nodeLabel,
.neptor-pm-pane .neptor-pm-md__mermaid .edgeLabel,
.neptor-pm-pane .neptor-pm-md__mermaid text { font-family: "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif !important; }

.neptor-pm-pane__nav-item:hover { background: rgba(255,255,255,0.04); }
.neptor-pm-pane__nav-item.is-active { background: rgba(255, 59, 48, 0.12); color: ${PM.brandStart}; }
.neptor-pm-pane__nav-item.is-active::before { content: ''; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px; background: ${PM.brandStart}; border-radius: 0 2px 2px 0; }
.neptor-pm-pane__nav-item { position: relative; }

/* Artifact doc chrome */
.neptor-pm-pane .neptor-pm-doc-chrome__meta span + span::before {
	content: '\\00b7';
	margin: 0 8px;
	color: rgba(237,237,237,0.35);
}
`;

const paneRootStyle: CSSProperties = {
	width: '100%',
	height: '100%',
	display: 'flex',
	flexDirection: 'column',
	background: PM.bgApp,
	color: PM.text,
	fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
	overflow: 'hidden',
};

const surfaceWrapperStyle: CSSProperties = {
	width: '100%',
	height: '100%',
	display: 'flex',
	flexDirection: 'column',
	background: PM.bgApp,
	color: PM.text,
	fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
	overflow: 'hidden',
};

// ----- Nav panel ----

const navPanelStyle: CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	gap: '6px',
	padding: '14px 12px',
	background: PM.bgApp,
	overflow: 'auto',
	flex: 1,
	minHeight: 0,
};

const navHeaderStyle: CSSProperties = {
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	padding: '4px 4px 8px',
	borderBottom: `1px solid ${PM.borderSubtle}`,
};

const brandDotStyle: CSSProperties = {
	width: '14px',
	height: '14px',
	borderRadius: '4px',
	background: PM.brandGradient,
};

const navGroupLabelStyle: CSSProperties = {
	fontSize: '11px',
	fontWeight: 650,
	color: PM.textMuted,
	padding: '16px 8px 6px',
};

const navItemStyle = (active: boolean): CSSProperties => ({
	width: '100%',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'flex-start',
	gap: '8px',
	padding: '7px 10px 7px 12px',
	borderRadius: '6px',
	border: 'none',
	background: 'transparent',
	color: active ? PM.brandStart : PM.text,
	fontSize: '12px',
	fontWeight: active ? 600 : 500,
	cursor: 'pointer',
	transition: 'background 140ms ease, color 140ms ease',
});

const navIconButtonStyle: CSSProperties = {
	width: '24px',
	height: '24px',
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	border: `1px solid ${PM.border}`,
	borderRadius: '6px',
	background: 'transparent',
	color: PM.textMuted,
	cursor: 'pointer',
};

// ----- Center canvas ----

const centerCanvasStyle: CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	flex: 1,
	minHeight: 0,
	minWidth: 0,
	width: '100%',
	background: PM.bgApp,
};

const canvasTopBarStyle: CSSProperties = {
	height: '48px',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	padding: '0 16px',
	borderBottom: `1px solid ${PM.border}`,
	flexShrink: 0,
};

const canvasContentStyle: CSSProperties = {
	flex: 1,
	minHeight: 0,
	overflow: 'auto',
	padding: '16px',
	display: 'grid',
	gap: '16px',
	alignContent: 'start',
};


// ----- Context panel ----

const contextPanelStyle: CSSProperties = {
	display: 'flex',
	flexDirection: 'column',
	background: AGENT_SHELL.bgPanel,
	minWidth: 0,
	flex: 1,
	minHeight: 0,
	borderRadius: AGENT_SHELL.radiusOuter,
	border: `1px solid ${AGENT_SHELL.border}`,
	boxShadow: AGENT_SHELL.shadow,
	overflow: 'hidden',
};

const contextHeaderStyle: CSSProperties = {
	height: '58px',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'space-between',
	padding: '0 16px',
	borderBottom: `1px solid ${PM.border}`,
	flexShrink: 0,
	background: AGENT_SHELL.headerGradient,
};

const contextTabBarStyle: CSSProperties = {
	display: 'flex',
	gap: '4px',
	padding: '8px 12px 6px',
	borderBottom: `1px solid ${PM.border}`,
	flexShrink: 0,
};

const contextTabStyle = (active: boolean): CSSProperties => ({
	height: '28px',
	padding: '0 10px',
	border: 'none',
	background: 'transparent',
	color: active ? PM.text : PM.textMuted,
	fontSize: '12px',
	fontWeight: active ? 700 : 500,
	borderBottom: active ? `2px solid ${PM.brandStart}` : '2px solid transparent',
	cursor: 'pointer',
});

const contextChatSurfaceStyle: CSSProperties = {
	flex: 1,
	minHeight: 0,
	display: 'flex',
	flexDirection: 'column',
	padding: '14px',
	overflow: 'hidden',
};

const contextChatFrameStyle: CSSProperties = {
	flex: 1,
	minHeight: 0,
	minWidth: 0,
	overflow: 'hidden',
	borderRadius: AGENT_SHELL.radiusInner,
	border: `1px solid ${AGENT_SHELL.border}`,
	background: AGENT_SHELL.bgApp,
};

const contextDisclaimerStyle: CSSProperties = {
	padding: '7px 16px',
	fontSize: '10px',
	color: PM.textMuted,
	textAlign: 'center',
	borderTop: `1px solid ${PM.border}`,
	background: AGENT_SHELL.bgPanelAlt,
	marginTop: '12px',
	flexShrink: 0,
};


// ----- Buttons ----

const ghostButtonStyle: CSSProperties = {
	height: '30px',
	padding: '0 10px',
	border: `1px solid ${PM.border}`,
	background: 'transparent',
	color: PM.text,
	fontSize: '12px',
	fontWeight: 500,
	borderRadius: '7px',
	cursor: 'pointer',
};

const brandButtonStyle: CSSProperties = {
	height: '30px',
	padding: '0 12px',
	border: 'none',
	background: PM.brandGradient,
	color: '#fff',
	fontSize: '12px',
	fontWeight: 700,
	borderRadius: '7px',
	display: 'inline-flex',
	alignItems: 'center',
	gap: '6px',
	cursor: 'pointer',
	boxShadow: '0 6px 14px rgba(255, 59, 48, 0.25)',
};
