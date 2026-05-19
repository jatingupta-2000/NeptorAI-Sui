/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface INeptorMemoryConsolidationService {
	readonly _serviceBrand: undefined;
	scheduleAfterPmAssistantMessage(opts: { lastUserMessage: string; assistantText: string }): void;
	/** toolDigest: capped recent successful tool result strings (code agent path). */
	scheduleAfterCodeAgentIdle(opts: { lastUserMessage: string; lastAssistantText: string; toolDigest?: string }): void;
}

export const INeptorMemoryConsolidationService = createDecorator<INeptorMemoryConsolidationService>('neptorMemoryConsolidationService');
