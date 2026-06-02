/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { matchesScheme } from '../../../../base/common/network.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IOpenURLOptions, IURLHandler, IURLService } from '../../../../platform/url/common/url.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { NEPTOR_ACCEPT_ORG_INVITE_ACTION_ID } from './organizationInviteActions.js';

function isOrganizationInviteAcceptUri(uri: URI): boolean {
	return uri.path === '/invite/accept' || (uri.authority === 'invite' && uri.path === '/accept');
}

export class OrganizationInviteUrlHandler extends Disposable implements IWorkbenchContribution, IURLHandler {
	constructor(
		@IURLService urlService: IURLService,
		@IProductService private readonly productService: IProductService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this._register(urlService.registerHandler(this));
	}

	async handleURL(uri: URI, _options?: IOpenURLOptions): Promise<boolean> {
		if (!matchesScheme(uri, this.productService.urlProtocol)) {
			return false;
		}
		if (!isOrganizationInviteAcceptUri(uri)) {
			return false;
		}
		const token = new URLSearchParams(uri.query).get('token');
		if (!token?.trim()) {
			return false;
		}
		await this.commandService.executeCommand(NEPTOR_ACCEPT_ORG_INVITE_ACTION_ID, token.trim());
		return true;
	}
}

registerWorkbenchContribution2('neptorOrganizationInviteUrlHandler', OrganizationInviteUrlHandler, WorkbenchPhase.AfterRestored);
