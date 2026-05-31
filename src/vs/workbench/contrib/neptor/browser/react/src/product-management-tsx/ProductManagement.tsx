/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useIsDark } from '../util/services.js';
import '../styles.css';
import { PmTypographyRoot } from './PmTypographyRoot.js';
import { ProductManagementLayout } from './ProductManagementLayout.js';

type ProductManagementSurface = 'editor' | 'sidebar' | 'agent';
type ProductAgentVariant = 'agent' | 'product';

export const ProductManagement = ({ surface = 'editor', agentVariant = 'agent' }: { surface?: ProductManagementSurface; agentVariant?: ProductAgentVariant }) => {
	const isDark = useIsDark();

	return (
		<div
			className={`@@neptor-scope ${isDark ? 'dark' : ''}`}
			style={{ width: '100%', height: '100%' }}
		>
			<PmTypographyRoot>
				<ProductManagementLayout surface={surface} agentVariant={agentVariant} />
			</PmTypographyRoot>
		</div>
	);
};
