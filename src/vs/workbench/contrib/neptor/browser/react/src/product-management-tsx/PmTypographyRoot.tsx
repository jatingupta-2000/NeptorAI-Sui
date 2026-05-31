/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect } from 'react';

const SHEET_ID = 'neptor-pm-google-fonts';
const CSS_HREF =
	'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';

/**
 * Loads Inter + JetBrains Mono for the PM workspace. Requires CSP to allow
 * fonts.googleapis.com (style-src) and fonts.gstatic.com (font-src) on workbench pages.
 */
export const PmTypographyRoot = ({ children }: { children: React.ReactNode }) => {
	useEffect(() => {
		if (typeof document === 'undefined') {
			return;
		}
		if (document.getElementById(SHEET_ID)) {
			return;
		}

		const preG = document.createElement('link');
		preG.rel = 'preconnect';
		preG.href = 'https://fonts.googleapis.com';

		const preS = document.createElement('link');
		preS.rel = 'preconnect';
		preS.href = 'https://fonts.gstatic.com';
		preS.crossOrigin = 'anonymous';

		const sheet = document.createElement('link');
		sheet.id = SHEET_ID;
		sheet.rel = 'stylesheet';
		sheet.href = CSS_HREF;

		document.head.appendChild(preG);
		document.head.appendChild(preS);
		document.head.appendChild(sheet);
	}, []);

	return <>{children}</>;
};
