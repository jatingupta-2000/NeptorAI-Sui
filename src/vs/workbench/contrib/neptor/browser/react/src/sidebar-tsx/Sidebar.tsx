/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useIsDark } from '../util/services.js';
import { AGENT_SHELL } from '../shared/agentShell.js';

import '../styles.css'
import { SidebarChat } from './SidebarChat.js';
import ErrorBoundary from './ErrorBoundary.js';
import { TabProvider, ChatHeader } from './ChatTabs.js';

const UnifiedLayout = () =>
	<div
		className="flex-1 min-h-0 overflow-hidden flex flex-col"
		style={{
			display: 'flex',
			flexDirection: 'column',
			flex: '1 1 0%',
			minHeight: 0,
			overflow: 'hidden',
			padding: '10px',
		}}
	>
		<div style={{ flex: 1, minHeight: 0, overflow: 'hidden', marginBottom: '10px' }}>
			<ErrorBoundary>
				<SidebarChat />
			</ErrorBoundary>
		</div>
		<div
			style={{
				padding: '7px 16px',
				fontSize: '10px',
				color: 'var(--neptor-fg-4, #8c8c8c)',
				textAlign: 'center',
				borderTop: '1px solid var(--neptor-border-3, #383838)',
				background: AGENT_SHELL.bgPanel,
			}}
		>
		</div>
	</div>

export const Sidebar = ({ className }: { className: string }) => {

	const isDark = useIsDark()
	return <div
		className={`neptor-scope ${isDark ? 'dark' : ''}`}
		style={{
			width: '100%',
			height: '100%',
			['--neptor-bg-2' as any]: AGENT_SHELL.bgPanel,
			['--neptor-bg-2-alt' as any]: AGENT_SHELL.bgPanelAlt,
			['--neptor-bg-2-hover' as any]: '#1f1f1f',
			['--neptor-bg-3' as any]: AGENT_SHELL.bgApp,
			['--neptor-border-2' as any]: AGENT_SHELL.border,
			['--neptor-border-3' as any]: AGENT_SHELL.border,
		}}
	>
		<div
			className="w-full h-full flex flex-col p-2"
			style={{
				backgroundColor: AGENT_SHELL.bgApp,
				color: 'var(--neptor-fg-1, #cccccc)',
			}}
		>
			<TabProvider defaultTab="code">
				<div
					className="w-full h-full flex flex-col overflow-hidden"
					style={{
						borderRadius: AGENT_SHELL.radiusOuter,
						border: `1px solid ${AGENT_SHELL.border}`,
						backgroundColor: AGENT_SHELL.bgPanel,
						boxShadow: AGENT_SHELL.shadow,
					}}
				>
					<ErrorBoundary>
						<ChatHeader />
					</ErrorBoundary>

					<UnifiedLayout />
				</div>
			</TabProvider>
		</div>
	</div>
}
