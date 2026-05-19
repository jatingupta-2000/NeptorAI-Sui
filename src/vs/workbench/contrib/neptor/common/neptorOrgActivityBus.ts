/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';

export type OrgActivityBusPayload = {
	kind: 'team_event' | 'member_joined' | 'org_created';
	summary: string;
	orgId?: string;
	memberId?: string;
};

/** Lightweight bus so org service can emit activity without DI cycle. */
export const orgActivityBus = new Emitter<OrgActivityBusPayload>();
