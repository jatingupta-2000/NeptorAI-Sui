/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import {
	Extensions as ViewContainerExtensions,
	IViewContainersRegistry,
	ViewContainerLocation,
	IViewsRegistry,
	Extensions as ViewExtensions,
	IViewDescriptorService,
} from '../../../common/views.js';
import * as nls from '../../../../nls.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Orientation } from '../../../../base/browser/ui/sash/sash.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { mountProductManagement } from './react/out/product-management-tsx/index.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { URI } from '../../../../base/common/uri.js';
import { EditorExtensions, EditorInputCapabilities } from '../../../common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { MEMORY_ARTIFACT_LABEL, MEMORY_ARTIFACT_TYPES, type MemoryArtifactType } from '../common/memory/memoryConstants.js';
import { NEPTOR_PM_AGENTGIT_TAB_LABEL } from '../common/neptorPmAgentGitConstants.js';
import { NEPTOR_PM_ORGANIZATIONS_TAB_LABEL } from '../common/neptorPmOrganizationConstants.js';
import { NEPTOR_PM_OPEN_COLLABORATION_ACTIVITY_EVENT } from '../common/neptorPmUiEvents.js';
import { NEPTOR_VIEW_ID } from './sidebarPane.js';

// =============================================================================
// Primary Side Bar pane: PM navigation grouped by Product · Engineering · Knowledge.
// Clicks mirror the center briefing tab via window events + shared localStorage keys.
// =============================================================================
class ProductManagementViewPane extends ViewPane {
	private static readonly AGENT_MODE_STORAGE_KEY = 'neptor.chat.agentMode';
	private static readonly AGENT_MODE_EVENT = 'neptor-chat-mode-change';
	private hasRenderedShell = false;
	private isProductViewVisible = false;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
		@IEditorService private readonly editorService: IEditorService,
		@IViewsService private readonly viewsService: IViewsService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// If the PM editor is closed manually while the Product activity is visible,
		// reopen it so the workspace stays attached to the navigation context.
		this._register(this.editorService.onDidCloseEditor((event) => {
			const closedResource = event.editor?.resource;
			const isProductEditor = closedResource?.toString() === PRODUCT_MANAGEMENT_EDITOR_RESOURCE.toString();
			if (this.isProductViewVisible && isProductEditor) {
				void this.commandService.executeCommand(NEPTOR_OPEN_PRODUCT_MANAGEMENT_WORKSPACE_ACTION_ID);
			}
		}));
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		if (this.hasRenderedShell) {
			return;
		}
		this.hasRenderedShell = true;
		parent.style.padding = '0';
		parent.style.userSelect = 'text';
		parent.style.height = '100%';
		parent.style.width = '100%';

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn: (() => void) | undefined = mountProductManagement(parent, accessor, { surface: 'sidebar' })?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
		this.setProductAgentMode();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.element.style.height = `${height}px`;
		this.element.style.width = `${width}px`;
	}

	override setVisible(visible: boolean): void {
		super.setVisible(visible);
		this.isProductViewVisible = visible;
		if (visible) {
			this.setProductAgentMode();
			this.requestWorkspaceOpen();
			// Reveal the Neptor AI Agent in the auxiliary bar so the user gets the
			// full PM experience (left nav + center editor + right agent) on first
			// activation. The user can still hide it manually.
			void this.viewsService.openView(PRODUCT_MANAGEMENT_AGENT_VIEW_ID, false);
		} else {
			localStorage.setItem(ProductManagementViewPane.AGENT_MODE_STORAGE_KEY, 'code');
			window.dispatchEvent(new Event(ProductManagementViewPane.AGENT_MODE_EVENT));
			this.viewsService.closeView(PRODUCT_MANAGEMENT_AGENT_VIEW_ID);
			void this.viewsService.openView(NEPTOR_VIEW_ID, false);

			const productEditors = this.editorService.findEditors(PRODUCT_MANAGEMENT_EDITOR_RESOURCE);
			if (productEditors.length > 0) {
				void this.editorService.closeEditors(productEditors);
			}
		}
	}

	private requestWorkspaceOpen(): void {
		void this.commandService.executeCommand(NEPTOR_OPEN_PRODUCT_MANAGEMENT_WORKSPACE_ACTION_ID);
	}

	private setProductAgentMode(): void {
		localStorage.setItem(ProductManagementViewPane.AGENT_MODE_STORAGE_KEY, 'product');
		window.dispatchEvent(new Event(ProductManagementViewPane.AGENT_MODE_EVENT));
	}
}

// =============================================================================
// Auxiliary Bar pane: Neptor AI Agent (Plan / Context / References + chat input).
// This persists independently of the center editor; closing or splitting the
// editor does not affect this view's state.
// =============================================================================
class ProductManagementAgentViewPane extends ViewPane {
	private hasRenderedShell = false;
	private static readonly AGENT_MODE_STORAGE_KEY = 'neptor.chat.agentMode';
	private static readonly AGENT_MODE_EVENT = 'neptor-chat-mode-change';

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		if (this.hasRenderedShell) {
			return;
		}
		this.hasRenderedShell = true;
		parent.style.padding = '0';
		parent.style.userSelect = 'text';
		parent.style.height = '100%';
		parent.style.width = '100%';

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn = mountProductManagement(parent, accessor, { surface: 'agent', agentVariant: 'product' })?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.element.style.height = `${height}px`;
		this.element.style.width = `${width}px`;
	}

	override setVisible(visible: boolean): void {
		super.setVisible(visible);
		if (visible) {
			localStorage.setItem(ProductManagementAgentViewPane.AGENT_MODE_STORAGE_KEY, 'product');
			window.dispatchEvent(new Event(ProductManagementAgentViewPane.AGENT_MODE_EVENT));
		}
	}
}

export const PRODUCT_MANAGEMENT_VIEW_CONTAINER_ID = 'workbench.view.productManagement';
export const PRODUCT_MANAGEMENT_VIEW_ID = 'workbench.productManagement.mainView';
const PRODUCT_MANAGEMENT_EDITOR_INPUT_ID = 'workbench.input.neptor.productManagement';
const PRODUCT_MANAGEMENT_EDITOR_PANE_ID = 'workbench.editor.neptor.productManagementPane';
const PRODUCT_MANAGEMENT_EDITOR_RESOURCE = URI.from({ scheme: 'neptor', path: 'product-management-workspace' });
let productWorkspaceOpenPromise: Promise<void> | null = null;

class ProductManagementEditorInput extends EditorInput {
	static readonly ID = PRODUCT_MANAGEMENT_EDITOR_INPUT_ID;
	static readonly RESOURCE = PRODUCT_MANAGEMENT_EDITOR_RESOURCE;
	readonly resource = ProductManagementEditorInput.RESOURCE;

	override get typeId(): string {
		return ProductManagementEditorInput.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		// Singleton: only one instance across all groups (also avoids accidental dupes from Split Editor).
		// Readonly: prevents any Save/SaveAs paths from running on this virtual workspace.
		return EditorInputCapabilities.Singleton | EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return nls.localize('productManagementWorkspaceName', 'Product Management');
	}

	override getIcon() {
		return Codicon.symbolStructure;
	}

	override isDirty(): boolean {
		return false;
	}

	override matches(other: unknown): boolean {
		if (other === this) {
			return true;
		}
		return other instanceof ProductManagementEditorInput;
	}
}

class ProductManagementEditorPane extends EditorPane {
	private workspaceElement: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(PRODUCT_MANAGEMENT_EDITOR_PANE_ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		parent.style.height = '100%';
		parent.style.width = '100%';
		parent.style.overflow = 'hidden';

		const workspaceElement = document.createElement('div');
		workspaceElement.style.height = '100%';
		workspaceElement.style.width = '100%';
		workspaceElement.style.overflow = 'hidden';
		parent.appendChild(workspaceElement);
		this.workspaceElement = workspaceElement;

		this.instantiationService.invokeFunction(accessor => {
			const disposeFn = mountProductManagement(workspaceElement, accessor, { surface: 'editor' })?.dispose;
			this._register(toDisposable(() => disposeFn?.()));
		});
	}

	layout(dimension: Dimension): void {
		if (this.workspaceElement) {
			this.workspaceElement.style.width = `${dimension.width}px`;
			this.workspaceElement.style.height = `${dimension.height}px`;
		}
	}
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(ProductManagementEditorPane, PRODUCT_MANAGEMENT_EDITOR_PANE_ID, nls.localize('ProductManagementEditorPane', 'Product Management Workspace')),
	[new SyncDescriptor(ProductManagementEditorInput)],
);

export const NEPTOR_OPEN_PRODUCT_MANAGEMENT_WORKSPACE_ACTION_ID = 'workbench.action.openProductManagementWorkspace';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: NEPTOR_OPEN_PRODUCT_MANAGEMENT_WORKSPACE_ACTION_ID,
			title: nls.localize2('openProductManagementWorkspace', 'Neptor: Open Product Management Workspace'),
			f1: true,
			icon: Codicon.symbolStructure,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		if (productWorkspaceOpenPromise) {
			await productWorkspaceOpenPromise;
			return;
		}

		const editorService = accessor.get(IEditorService);
		const editorGroupService = accessor.get(IEditorGroupsService);
		const instantiationService = accessor.get(IInstantiationService);
		localStorage.setItem('neptor.chat.agentMode', 'product');
		window.dispatchEvent(new Event('neptor-chat-mode-change'));

		productWorkspaceOpenPromise = (async () => {
			const existingEditors = editorService.findEditors(ProductManagementEditorInput.RESOURCE);
			if (existingEditors.length > 0) {
				await editorGroupService.activeGroup.openEditor(existingEditors[0].editor, { pinned: true, sticky: true });
				return;
			}

			const input = instantiationService.createInstance(ProductManagementEditorInput);
			await editorGroupService.activeGroup.openEditor(input, { pinned: true, sticky: true });
		})().finally(() => {
			productWorkspaceOpenPromise = null;
		});

		await productWorkspaceOpenPromise;
	}
});

// =============================================================================
// View container registrations (Primary Side Bar + Auxiliary Bar).
// =============================================================================

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

// --- Primary Side Bar: PM navigation ---
const container = viewContainerRegistry.registerViewContainer({
	id: PRODUCT_MANAGEMENT_VIEW_CONTAINER_ID,
	title: nls.localize2('productManagementContainer', 'Product'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [PRODUCT_MANAGEMENT_VIEW_CONTAINER_ID, {
		mergeViewWithContainerWhenSingleView: true,
		orientation: Orientation.HORIZONTAL,
	}]),
	hideIfEmpty: false,
	order: 7,
	icon: Codicon.symbolStructure,
	rejectAddedViews: true,
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: false });

viewsRegistry.registerViews([{
	id: PRODUCT_MANAGEMENT_VIEW_ID,
	name: nls.localize2('productManagementView', 'Product Workspace'),
	ctorDescriptor: new SyncDescriptor(ProductManagementViewPane),
	canToggleVisibility: false,
	canMoveView: false,
	weight: 70,
	order: 1,
	hideByDefault: false,
}], container);

// --- Auxiliary Bar (Secondary Side Bar): Neptor AI Agent for PM ---
export const PRODUCT_MANAGEMENT_AGENT_VIEW_CONTAINER_ID = 'workbench.view.productManagementAgent';
export const PRODUCT_MANAGEMENT_AGENT_VIEW_ID = 'workbench.productManagement.agentView';

const agentContainer = viewContainerRegistry.registerViewContainer({
	id: PRODUCT_MANAGEMENT_AGENT_VIEW_CONTAINER_ID,
	title: nls.localize2('productManagementAgentContainer', 'Neptor Product AI Agent'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [PRODUCT_MANAGEMENT_AGENT_VIEW_CONTAINER_ID, {
		mergeViewWithContainerWhenSingleView: true,
		orientation: Orientation.HORIZONTAL,
	}]),
	hideIfEmpty: false,
	order: 5,
	icon: Codicon.commentDiscussion,
	rejectAddedViews: true,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: false });

viewsRegistry.registerViews([{
	id: PRODUCT_MANAGEMENT_AGENT_VIEW_ID,
	name: nls.localize2('productManagementAgentView', 'Neptor Product AI Agent'),
	ctorDescriptor: new SyncDescriptor(ProductManagementAgentViewPane),
	canToggleVisibility: false,
	canMoveView: true,
	weight: 100,
	order: 1,
	hideByDefault: false,
}], agentContainer);

// =============================================================================
// Cross-surface command: PM navigation -> center editor tab change.
// The Sidebar React surface dispatches `neptor-pm-view-change` and writes to
// localStorage; this command is the canonical programmatic entry point so other
// extensions / commands can drive the center editor too.
// =============================================================================
export const NEPTOR_PM_SET_VIEW_ACTION_ID = 'workbench.action.neptor.pm.setView';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: NEPTOR_PM_SET_VIEW_ACTION_ID,
			title: nls.localize2('neptorPmSetView', 'Neptor: Set Product Management View'),
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, navId?: string): Promise<void> {
		void accessor;
		if (!navId) {
			return;
		}
		const tab = mapPmNavToTab(navId);
		if (!tab) {
			return;
		}
		const memoryFilter = pmMemoryFilterFromTab(tab);
		localStorage.setItem('neptor.pm.activeNav', navId);
		localStorage.setItem('neptor.pm.activeTab', tab);
		if (tab !== NEPTOR_PM_AGENTGIT_TAB_LABEL && tab !== NEPTOR_PM_ORGANIZATIONS_TAB_LABEL) {
			localStorage.setItem('neptor.pm.memoryArtifactFilter', memoryFilter === 'all' ? 'all' : memoryFilter);
		}
		window.dispatchEvent(new CustomEvent('neptor-pm-view-change', { detail: { navId, targetTab: tab, memoryFilter } }));
	}
});

const ALL_MEMORY_TAB_LABEL = 'All memory';

function readPmStoredMemoryFilter(): MemoryArtifactType | 'all' {
	const raw = localStorage.getItem('neptor.pm.memoryArtifactFilter');
	if (!raw || raw === 'all') {
		return 'all';
	}
	if (MEMORY_ARTIFACT_TYPES.includes(raw as MemoryArtifactType)) {
		return raw as MemoryArtifactType;
	}
	return 'all';
}

function pmMemoryFilterFromTab(tab: string): MemoryArtifactType | 'all' {
	if (tab === NEPTOR_PM_AGENTGIT_TAB_LABEL || tab === NEPTOR_PM_ORGANIZATIONS_TAB_LABEL) {
		return readPmStoredMemoryFilter();
	}
	if (tab === ALL_MEMORY_TAB_LABEL) {
		return 'all';
	}
	const found = MEMORY_ARTIFACT_TYPES.find((t) => MEMORY_ARTIFACT_LABEL[t] === tab);
	return found ?? 'all';
}

function mapPmNavToTab(navId: string): string | null {
	const legacyDiscover: Record<string, MemoryArtifactType> = {
		Overview: 'overview',
		Vision: 'vision',
		Roadmap: 'roadmap',
		PRD: 'docs_index',
	};
	if (legacyDiscover[navId]) {
		return MEMORY_ARTIFACT_LABEL[legacyDiscover[navId]];
	}
	const legacyKnowledge: Record<string, MemoryArtifactType | 'all'> = {
		ProjectMemory: 'all',
		Docs: 'docs_index',
		Decisions: 'decisions',
		APIs: 'apis',
	};
	const memoryLane = legacyKnowledge[navId];
	if (memoryLane) {
		return memoryLane === 'all' ? ALL_MEMORY_TAB_LABEL : MEMORY_ARTIFACT_LABEL[memoryLane];
	}
	if (navId === ALL_MEMORY_TAB_LABEL) {
		return ALL_MEMORY_TAB_LABEL;
	}
	if (navId === NEPTOR_PM_ORGANIZATIONS_TAB_LABEL || navId === 'Organizations' || navId === 'organizations') {
		return NEPTOR_PM_ORGANIZATIONS_TAB_LABEL;
	}
	if (navId === NEPTOR_PM_AGENTGIT_TAB_LABEL || navId === 'AgentGit' || navId === 'agentgit') {
		return NEPTOR_PM_AGENTGIT_TAB_LABEL;
	}
	const bySlug = MEMORY_ARTIFACT_TYPES.find((t) => t === navId);
	if (bySlug) {
		return MEMORY_ARTIFACT_LABEL[bySlug];
	}
	const byLabel = MEMORY_ARTIFACT_TYPES.find((t) => MEMORY_ARTIFACT_LABEL[t] === navId);
	if (byLabel) {
		return MEMORY_ARTIFACT_LABEL[byLabel];
	}
	return null;
}

// =============================================================================
// Open Collaboration Activity panel in the Product editor surface (mock feed).
// =============================================================================
export const NEPTOR_PM_OPEN_COLLABORATION_ACTIVITY_ACTION_ID = 'workbench.action.neptor.pm.openCollaborationActivity';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: NEPTOR_PM_OPEN_COLLABORATION_ACTIVITY_ACTION_ID,
			title: nls.localize2('neptorPmOpenCollaborationActivity', 'Neptor: Show Workspace Collaboration Activity'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		void accessor;
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent(NEPTOR_PM_OPEN_COLLABORATION_ACTIVITY_EVENT));
		}
	}
});
