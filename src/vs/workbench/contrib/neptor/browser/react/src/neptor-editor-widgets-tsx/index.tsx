/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { mountFnGenerator } from '../util/mountFnGenerator.js'
import { NeptorCommandBarMain } from './NeptorCommandBar.js'
import { NeptorSelectionHelperMain } from './NeptorSelectionHelper.js'

export const mountNeptorCommandBar = mountFnGenerator(NeptorCommandBarMain)

export const mountNeptorSelectionHelper = mountFnGenerator(NeptorSelectionHelperMain)

