/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { useAccessor } from '../../util/services.js';
import type { INeptorOrganizationService } from '../../../../../common/neptorOrganizationService.js';
import type { NeptorOrganizationSnapshot } from '../../../../../common/neptorOrganizationService.js';

export function useNeptorOrganization(): INeptorOrganizationService {
	const { get } = useAccessor();
	return get('INeptorOrganizationService');
}

export function useOrganizationSnapshot(): NeptorOrganizationSnapshot {
	const orgService = useNeptorOrganization();
	const [snapshot, setSnapshot] = useState(() => orgService.getSnapshot());

	useEffect(() => {
		setSnapshot(orgService.getSnapshot());
		const sub = orgService.onDidChange(() => setSnapshot(orgService.getSnapshot()));
		return () => sub.dispose();
	}, [orgService]);

	return snapshot;
}
