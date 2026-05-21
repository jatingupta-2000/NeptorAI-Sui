/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


// register inline diffs
import './editCodeService.js'

// register Sidebar pane, state, actions (keybinds, menus) (Ctrl+L)
import './sidebarActions.js'
import './sidebarPane.js'
import './productManagementPane.js'

// register quick edit (Ctrl+K)
import './quickEditActions.js'


// register Autocomplete
import './autocompleteService.js'

// register Context services
// import './contextGatheringService.js'
// import './contextUserChangesService.js'

// settings pane
import './neptorSettingsPane.js'

// register css
import './media/neptor.css'

// update (frontend part, also see platform/)
import './neptorUpdateActions.js'

// project memory (.neptor/memory) - must be registered before convertToLLMMessageService
import './neptorProjectMemoryService.js'
import './neptorProjectMemoryActions.js'

import './neptorOrganizationService.js'
import '../common/neptorOrganizationService.js'
import './neptorOrgCollaborationService.js'
import '../common/neptorOrgCollaborationService.js'

import './convertToLLMMessageWorkbenchContrib.js'
import './convertToLLMMessageService.js'

// tools
import './toolsService.js'
import './terminalToolService.js'

import './neptorMemoryConsolidationService.js'
import './pmWorkspaceBootstrapService.js'
import './workspaceLifecycleLocalService.js'
import './organizationInviteActions.js'
import './organizationInviteUrlHandler.js'

// register Thread History
import './chatThreadService.js'

// ping
import './metricsPollService.js'

// helper services
import './helperServices/consistentItemService.js'

// register selection helper
import './neptorSelectionHelperWidget.js'

// register tooltip service
import './tooltipService.js'

// register onboarding service
import './neptorOnboardingService.js'

// register misc service
import './miscWokrbenchContrib.js'

// register file service (for explorer context menu)
import './fileService.js'

// register source control management
import './neptorSCMService.js'

// ---------- common (unclear if these actually need to be imported, because they're already imported wherever they're used) ----------

// llmMessage
import '../common/sendLLMMessageService.js'

// neptorSettings
import '../common/neptorSettingsService.js'

// refreshModel
import '../common/refreshModelService.js'

// metrics
import '../common/metricsService.js'

// updates
import '../common/neptorUpdateService.js'

// model service
import '../common/neptorModelService.js'
