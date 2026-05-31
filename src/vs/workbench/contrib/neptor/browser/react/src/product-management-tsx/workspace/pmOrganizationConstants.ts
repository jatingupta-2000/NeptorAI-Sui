/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** PM sidebar / canvas tab label (keeps react bundle self-contained). */
export const NEPTOR_PM_ORGANIZATIONS_TAB_LABEL = 'Organizations' as const;

/** Window event: review organization invite after sign-in (matches common/neptorPmUiEvents). */
export const NEPTOR_ORG_ACCEPT_INVITE_EVENT = 'neptor-org-accept-invite';

export type NeptorOrgAcceptInviteDetail = { token: string };
