/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useAccessor } from '../../util/services.js';
import type { IWorkspaceLifecycleService } from '../../../../../common/workspaceLifecycleService.js';

export function useWorkspaceLifecycle(): IWorkspaceLifecycleService {
	const { get } = useAccessor();
	return get('IWorkspaceLifecycleService');
}
