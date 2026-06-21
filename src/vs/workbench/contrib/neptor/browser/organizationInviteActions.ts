/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import * as nls from '../../../../nls.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { INeptorOrganizationService } from '../common/neptorOrganizationService.js';
import { NEPTOR_ORG_ACCEPT_INVITE_EVENT, type NeptorOrgAcceptInviteDetail } from '../common/neptorPmUiEvents.js';

export const NEPTOR_ACCEPT_ORG_INVITE_ACTION_ID = 'workbench.action.neptor.acceptOrganizationInvite';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: NEPTOR_ACCEPT_ORG_INVITE_ACTION_ID,
			title: nls.localize2('neptorAcceptOrgInvite', 'Neptor: Accept Organization Invite'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, token?: string): Promise<void> {
		const orgService = accessor.get(INeptorOrganizationService);
		const quickInput = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		let inviteToken = typeof token === 'string' ? token.trim() : '';
		if (!inviteToken) {
			inviteToken = await new Promise<string>((resolve) => {
				const input = quickInput.createInputBox();
				input.title = nls.localize('neptorAcceptOrgInviteTitle', 'Accept organization invite');
				input.placeholder = nls.localize('neptorAcceptOrgInvitePlaceholder', 'Paste invite token or accept link');
				input.ignoreFocusOut = true;
				input.onDidAccept(() => {
					const v = input.value.trim();
					input.dispose();
					resolve(v);
				});
				input.onDidHide(() => {
					input.dispose();
					resolve('');
				});
				input.show();
			});
		}

		if (!inviteToken) {
			return;
		}

		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent<NeptorOrgAcceptInviteDetail>(NEPTOR_ORG_ACCEPT_INVITE_EVENT, { detail: { token: inviteToken } }));
		}
		if (!orgService.getCurrentUser()) {
			notificationService.notify({
				severity: Severity.Info,
				message: nls.localize('neptorAcceptOrgInviteSignIn', 'Open Organizations to sign in, then accept or reject the invite.'),
			});
			return;
		}
		notificationService.notify({
			severity: Severity.Info,
			message: nls.localize('neptorReviewOrgInvite', 'Open Organizations to accept or reject the invite.'),
		});
	}
});
