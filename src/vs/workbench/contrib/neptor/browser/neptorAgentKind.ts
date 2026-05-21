/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { NEPTOR_AGENT_MODE_STORAGE_KEY, NeptorAgentKind } from '../common/neptorAgentKindConstants.js';

export function getNeptorAgentKind(): NeptorAgentKind {
	try {
		return mainWindow.localStorage.getItem(NEPTOR_AGENT_MODE_STORAGE_KEY) === 'product' ? 'product' : 'code';
	} catch {
		return 'code';
	}
}
