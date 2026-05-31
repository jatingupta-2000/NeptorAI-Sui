/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useState } from 'react';
import { SidebarChat } from '../sidebar-tsx/SidebarChat.js';
import { PmBootstrapWizard } from './memory/PmBootstrapWizard.js';
import type { WorkspaceMemoryStatusFile } from '../../../../common/memory/workspaceMemoryStatus.js';
import { useAccessor } from '../util/services.js';

const PM_SKIP_WIZARD_KEY = 'neptor.pm.skipMemoryWizard';

export const ProductManagementChat = () => {
	const accessor = useAccessor();
	const projectMemory = accessor.get('INeptorProjectMemoryService');

	const [wizardDismissed, setWizardDismissed] = useState(false);
	const [showWizard, setShowWizard] = useState(false);
	const [diskBootstrapStatus, setDiskBootstrapStatus] = useState<WorkspaceMemoryStatusFile | null>(null);

	const refreshWizardFlag = useCallback(async () => {
		if (typeof window !== 'undefined' && window.localStorage.getItem(PM_SKIP_WIZARD_KEY) === '1') {
			setShowWizard(false);
			return;
		}
		const st = await projectMemory.getBootstrapStatusForFirstFolder();
		setDiskBootstrapStatus(st.workspaceMemoryStatus ?? null);
		setShowWizard(st.needsBootstrap && !wizardDismissed);
	}, [projectMemory, wizardDismissed]);

	useEffect(() => {
		void refreshWizardFlag();
	}, [refreshWizardFlag]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}
		const fn = () => void refreshWizardFlag();
		window.addEventListener('neptor-pm-memory-updated', fn);
		return () => window.removeEventListener('neptor-pm-memory-updated', fn);
	}, [refreshWizardFlag]);

	return (
		<div
			className="neptor-pm-chat-ltr h-full w-full flex flex-col overflow-hidden"
			dir="ltr"
			style={{ direction: 'ltr', unicodeBidi: 'isolate', minHeight: 0, minWidth: 0 }}
		>
			{showWizard ? (
				<div
					style={{
						flexShrink: 0,
						maxHeight: 'min(58vh, 520px)',
						overflowY: 'auto',
						padding: '10px 12px 0',
						borderBottom: '1px solid var(--neptor-border-3, #3a3a3a)',
					}}
				>
					<PmBootstrapWizard
						placement="chat"
						diskStatus={diskBootstrapStatus}
						onCompleted={() => { void refreshWizardFlag(); }}
						onSkip={() => {
							if (typeof window !== 'undefined') {
								window.localStorage.setItem(PM_SKIP_WIZARD_KEY, '1');
							}
							setWizardDismissed(true);
							setShowWizard(false);
						}}
					/>
				</div>
			) : null}
			<div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
				<SidebarChat />
			</div>
		</div>
	);
};
