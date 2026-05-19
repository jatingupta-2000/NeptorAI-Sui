/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/** Window event: open Product workspace collaboration activity panel (editor surface listens). */
export const NEPTOR_PM_OPEN_COLLABORATION_ACTIVITY_EVENT = 'neptor-pm-open-collaboration-activity';

/** Window event: review organization invite by token (Product Management shows Accept/Reject). */
export const NEPTOR_ORG_ACCEPT_INVITE_EVENT = 'neptor-org-accept-invite';

export type NeptorOrgAcceptInviteDetail = { token: string };
