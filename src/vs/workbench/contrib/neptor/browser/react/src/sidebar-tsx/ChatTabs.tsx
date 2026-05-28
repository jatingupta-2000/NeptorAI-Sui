/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { Sparkles, ChevronDown, Plus } from 'lucide-react';
import { AGENT_SHELL } from '../shared/agentShell.js';

export type TabId = 'code' | 'plan' | 'debug' | 'ask' | 'context' | 'references';
type AgentMode = 'code' | 'product';

interface TabDefinition {
	id: TabId;
	label: string;
}

const CODE_TAB_DEFINITIONS: TabDefinition[] = [
	{ id: 'code', label: 'Code' },
	{ id: 'plan', label: 'Plan' },
	{ id: 'debug', label: 'Debug' },
	{ id: 'ask', label: 'Ask' },
];

const PRODUCT_TAB_DEFINITIONS: TabDefinition[] = [
	{ id: 'context', label: 'Product' },
];

import { NEPTOR_AGENT_MODE_STORAGE_KEY } from '../../../../common/neptorAgentKindConstants.js';
const AGENT_MODE_EVENT = 'neptor-chat-mode-change';
const OPEN_NEW_THREAD_EVENT = 'neptor-open-new-thread';
const OPEN_HISTORY_EVENT = 'neptor-open-history';

const getAgentMode = (): AgentMode => {
	if (typeof window === 'undefined') {
		return 'code';
	}
	return window.localStorage.getItem(NEPTOR_AGENT_MODE_STORAGE_KEY) === 'product' ? 'product' : 'code';
};

const useAgentMode = () => {
	const [mode, setMode] = React.useState<AgentMode>(getAgentMode);

	React.useEffect(() => {
		const syncMode = () => setMode(getAgentMode());
		window.addEventListener('storage', syncMode);
		window.addEventListener(AGENT_MODE_EVENT, syncMode);
		return () => {
			window.removeEventListener('storage', syncMode);
			window.removeEventListener(AGENT_MODE_EVENT, syncMode);
		};
	}, []);

	return mode;
};

interface TabContextType {
	activeTab: TabId;
	setActiveTab: (tab: TabId) => void;
}

const TabContext = createContext<TabContextType | null>(null);

export const useTabContext = () => {
	const context = useContext(TabContext);
	if (!context) {
		throw new Error('useTabContext must be used within a TabProvider');
	}
	return context;
};

interface TabProviderProps {
	children: ReactNode;
	defaultTab?: TabId;
}

export const TabProvider: React.FC<TabProviderProps> = ({ children, defaultTab = 'code' }) => {
	const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
	
	return (
		<TabContext.Provider value={{ activeTab, setActiveTab }}>
			{children}
		</TabContext.Provider>
	);
};

interface ChatHeaderProps {
	className?: string;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ className = '' }) => {
	const title = 'Neptor AI Agent';

	return (
		<div 
			className={`
				flex items-center justify-between 
				px-4 py-2.5
				border-b border-neptor-border-3
				bg-neptor-bg-2
				${className}
			`}
			style={{
				background: AGENT_SHELL.headerGradient,
			}}
		>
			<div className="flex items-center gap-2.5 cursor-pointer group">
				<div className="flex items-center justify-center w-5 h-5">
					<Sparkles size={16} className="text-[#FF3B30]" style={{ color: '#FF3B30' }} />
				</div>
				<span className="text-[14px] font-semibold tracking-tight text-neptor-fg-1">{title}</span>
				<ChevronDown 
					size={14} 
					className="text-neptor-fg-3 group-hover:text-neptor-fg-2 transition-colors" 
				/>
			</div>
			<div className="flex items-center gap-1">
				<button 
					type="button"
					onClick={() => {
						window.dispatchEvent(new CustomEvent(OPEN_NEW_THREAD_EVENT));
					}}
					className="
						p-1.5 rounded-md
						text-neptor-fg-3 
						hover:text-neptor-fg-1 
						hover:bg-neptor-bg-1 
						active:bg-neptor-bg-1-alt
						transition-colors duration-150
					"
				>
					<Plus size={16} />
				</button>
				<button 
					type="button"
					onClick={() => {
						window.dispatchEvent(new CustomEvent(OPEN_HISTORY_EVENT));
					}}
					className="
						p-1.5 rounded-md
						text-neptor-fg-3 
						hover:text-neptor-fg-1 
						hover:bg-neptor-bg-1 
						active:bg-neptor-bg-1-alt
						transition-colors duration-150
					"
				>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M3 4v5h5" stroke="#FF3B30" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
						<path d="M3.8 9A9 9 0 1 1 6 18" stroke="#FF3B30" strokeWidth="2.4" strokeLinecap="round" />
						<path d="M12 8.5v3.8h3" stroke="#FF3B30" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
			</div>
		</div>
	);
};

interface CurrentFocusProps {
	title?: string;
	subtitle?: string;
	status?: 'in-progress' | 'completed' | 'pending';
	className?: string;
}

export const CurrentFocus: React.FC<CurrentFocusProps> = ({ 
	title,
	subtitle,
	status = 'in-progress',
	className = '' 
}) => {
	const mode = useAgentMode();
	const resolvedTitle = title ?? (mode === 'product' ? 'Product Workspace' : 'Current Coding Session');
	const resolvedSubtitle = subtitle ?? (mode === 'product' ? 'Project Manager Agent' : 'Working on code implementation');

	const statusConfig = {
		'in-progress': { 
			label: 'In Progress', 
			bgClass: 'bg-[#FF3B30]/20',
			textClass: 'text-[#FF3B30]',
			style: { backgroundColor: 'rgba(255, 59, 48, 0.2)', color: '#FF3B30' }
		},
		'completed': { 
			label: 'Completed', 
			bgClass: 'bg-green-500/20', 
			textClass: 'text-green-400',
			style: { backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80' }
		},
		'pending': { 
			label: 'Pending', 
			bgClass: 'bg-yellow-500/20', 
			textClass: 'text-yellow-400',
			style: { backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#facc15' }
		},
	};

	const { label, style } = statusConfig[status];

	return (
		<div 
			className={`
				px-4 py-3 
				border-b border-neptor-border-3
				bg-neptor-bg-2
				${className}
			`}
			style={{
				backgroundColor: 'color-mix(in srgb, var(--neptor-bg-2, #252526) 88%, black 12%)',
			}}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex-1 min-w-0">
					<div 
						className="text-[10px] uppercase tracking-wider mb-1.5"
						style={{ color: 'var(--neptor-fg-4, #8c8c8c)' }}
					>
						Current Focus
					</div>
					<div 
						className="text-[14px] font-semibold leading-tight tracking-tight"
						style={{ color: 'var(--neptor-fg-1, #cccccc)' }}
					>
						{resolvedTitle}
					</div>
					<div 
						className="text-xs mt-1 truncate flex items-center gap-1.5"
						style={{ color: 'var(--neptor-fg-3, #a0a0a0)' }}
					>
						<span style={{ fontSize: '9px', color: 'var(--neptor-accent-primary, #FF3B30)' }}>◆</span>
						{resolvedSubtitle}
					</div>
				</div>
				<div 
					className="px-2.5 py-1 rounded-md text-[10px] font-medium whitespace-nowrap flex-shrink-0"
					style={style}
				>
					{label}
				</div>
			</div>
		</div>
	);
};

interface TabBarProps {
	className?: string;
}

export const TabBar: React.FC<TabBarProps> = ({ className = '' }) => {
	const { activeTab, setActiveTab } = useTabContext();
	const mode = useAgentMode();
	const tabs = mode === 'product' ? PRODUCT_TAB_DEFINITIONS : CODE_TAB_DEFINITIONS;

	React.useEffect(() => {
		const activeExists = tabs.some(tab => tab.id === activeTab);
		if (!activeExists) {
			setActiveTab(tabs[0].id);
		}
	}, [activeTab, setActiveTab, tabs]);
	
	return (
		<div 
			className={`
				flex items-center 
				px-2 
				border-b border-neptor-border-3
				bg-neptor-bg-2
				${className}
			`}
			style={{
				backgroundColor: 'color-mix(in srgb, var(--neptor-bg-2, #252526) 82%, black 18%)',
			}}
		>
			{tabs.map((tab) => {
				const isActive = activeTab === tab.id;
				return (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className="relative px-3 py-2 transition-colors duration-150"
						style={{
							color: isActive 
								? 'var(--neptor-fg-1, #cccccc)' 
								: 'var(--neptor-fg-3, #a0a0a0)',
							fontSize: '11px',
							fontWeight: isActive ? 600 : 500,
							letterSpacing: '0.2px',
						}}
					>
						{tab.label}
						{isActive && (
							<div 
								className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
								style={{ backgroundColor: '#FF3B30' }}
							/>
						)}
					</button>
				);
			})}
		</div>
	);
};
