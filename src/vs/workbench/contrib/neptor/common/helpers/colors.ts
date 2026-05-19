/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Color, RGBA } from '../../../../../base/common/color.js';
import { registerColor } from '../../../../../platform/theme/common/colorUtils.js';

// editCodeService colors
const sweepBG = new Color(new RGBA(100, 100, 100, .2));
const highlightBG = new Color(new RGBA(100, 100, 100, .1));
const sweepIdxBG = new Color(new RGBA(100, 100, 100, .5));

const acceptBG = new Color(new RGBA(155, 185, 85, .1)); // default is RGBA(155, 185, 85, .2)
const rejectBG = new Color(new RGBA(255, 0, 0, .1)); // default is RGBA(255, 0, 0, .2)

// Widget colors
export const acceptAllBg = 'rgb(30, 133, 56)'
export const acceptBg = 'rgb(26, 116, 48)'
export const acceptBorder = '1px solid rgb(20, 86, 38)'

export const rejectAllBg = 'rgb(207, 40, 56)'
export const rejectBg = 'rgb(180, 35, 49)'
export const rejectBorder = '1px solid rgb(142, 28, 39)'

export const buttonFontSize = '11px'
export const buttonTextColor = 'white'



const configOfBG = (color: Color) => {
	return { dark: color, light: color, hcDark: color, hcLight: color, }
}

const configByTheme = (dark: string, light: string, hcDark: string, hcLight: string) => {
	return {
		dark: Color.fromHex(dark),
		light: Color.fromHex(light),
		hcDark: Color.fromHex(hcDark),
		hcLight: Color.fromHex(hcLight),
	};
};

// gets converted to --vscode-neptor-greenBG, see neptor.css, asCssVariable
registerColor('neptor.greenBG', configOfBG(acceptBG), '', true);
registerColor('neptor.redBG', configOfBG(rejectBG), '', true);
registerColor('neptor.sweepBG', configOfBG(sweepBG), '', true);
registerColor('neptor.highlightBG', configOfBG(highlightBG), '', true);
registerColor('neptor.sweepIdxBG', configOfBG(sweepIdxBG), '', true);

// Shell tokens used across workbench and neptor surfaces.
// Locked to the PM design system: app #0A0A0A, panel #141414, border #2E2E2E,
// text #EDEDED / #8B8B8B, brand gradient #FF3B30 -> #FF9500.
registerColor('neptor.surfacePrimary', configByTheme('#0A0A0A', '#FFFFFF', '#000000', '#FFFFFF'), '', true);
registerColor('neptor.surfaceSecondary', configByTheme('#141414', '#FAFAFA', '#000000', '#FFFFFF'), '', true);
registerColor('neptor.surfaceTertiary', configByTheme('#191919', '#F2F2F2', '#000000', '#FFFFFF'), '', true);
registerColor('neptor.surfaceOverlay', configByTheme('#1F1F1F', '#FFFFFF', '#000000', '#FFFFFF'), '', true);

registerColor('neptor.borderSubtle', configByTheme('#2E2E2E', '#E5E5E5', '#FFFFFF', '#000000'), '', true);
registerColor('neptor.borderStrong', configByTheme('#3A3A3A', '#CFCFCF', '#FFFFFF', '#000000'), '', true);

registerColor('neptor.textPrimary', configByTheme('#EDEDED', '#1F1F1F', '#FFFFFF', '#000000'), '', true);
registerColor('neptor.textSecondary', configByTheme('#B5B5B5', '#4A4A4A', '#FFFFFF', '#000000'), '', true);
registerColor('neptor.textMuted', configByTheme('#8B8B8B', '#6B6B6B', '#FFFFFF', '#000000'), '', true);

registerColor('neptor.accentPrimary', configByTheme('#FF3B30', '#E63E22', '#FF6A4D', '#C93116'), '', true);
registerColor('neptor.accentSecondary', configByTheme('#FF9500', '#FF9500', '#FFB073', '#D9572F'), '', true);
registerColor('neptor.success', configByTheme('#34D399', '#059669', '#34D399', '#059669'), '', true);
