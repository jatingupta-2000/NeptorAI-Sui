/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { NEPTOR_REBUILD_PROJECT_MEMORY_COMMAND_ID } from '../common/neptorProjectMemoryCommands.js';
import { INeptorProjectMemoryService } from '../common/neptorProjectMemoryService.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: NEPTOR_REBUILD_PROJECT_MEMORY_COMMAND_ID,
			title: localize2('neptor.rebuildProjectMemory', 'Neptor: Rebuild Project Memory'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const memoryService = accessor.get(INeptorProjectMemoryService);
		const notifications = accessor.get(INotificationService);
		const res = await memoryService.rebuildProjectMemory();
		if (res.ok) {
			notifications.info(res.detail);
		} else {
			notifications.warn(res.detail);
		}
	}
});
