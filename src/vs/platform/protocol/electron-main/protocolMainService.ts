/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { session } from 'electron';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { realpathSync } from '../../../base/node/extpath.js';
import { isEqualOrParent, toSlashes } from '../../../base/common/extpath.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { normalizeNFC } from '../../../base/common/normalization.js';
import { COI, FileAccess, Schemas, CacheControlheaders, DocumentPolicyheaders } from '../../../base/common/network.js';
import { basename, extname, join, normalize } from '../../../base/common/path.js';
import { isLinux, isMacintosh } from '../../../base/common/platform.js';
import { TernarySearchTree } from '../../../base/common/ternarySearchTree.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { validatedIpcMain } from '../../../base/parts/ipc/electron-main/ipcMain.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { ILogService } from '../../log/common/log.js';
import { IIPCObjectUrl, IProtocolMainService } from './protocol.js';
import { IUserDataProfilesService } from '../../userDataProfile/common/userDataProfile.js';

type ProtocolCallback = { (result: string | Electron.FilePathWithHeaders | { error: number }): void };

export class ProtocolMainService extends Disposable implements IProtocolMainService {

	declare readonly _serviceBrand: undefined;

	private readonly validRoots = TernarySearchTree.forPaths<boolean>(!isLinux);
	private readonly validExtensions = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.mp4', '.otf', '.ttf']); // https://github.com/microsoft/vscode/issues/119384

	constructor(
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IUserDataProfilesService userDataProfilesService: IUserDataProfilesService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Define an initial set of roots we allow loading from
		// - appRoot	: all files installed as part of the app
		// - extensions : all files shipped from extensions
		// - storage    : all files in global and workspace storage (https://github.com/microsoft/vscode/issues/116735)
		this.addValidFileRoot(environmentService.appRoot);
		this.addValidFileRoot(environmentService.extensionsPath);
		this.addValidFileRoot(userDataProfilesService.defaultProfile.globalStorageHome.with({ scheme: Schemas.file }).fsPath);
		this.addValidFileRoot(environmentService.workspaceStorageHome.with({ scheme: Schemas.file }).fsPath);

		// Handle protocols
		this.handleProtocols();
	}

	private handleProtocols(): void {
		const { defaultSession } = session;

		// Electron 25+: use `protocol.handle` for Fetch / dynamic `import()`. Read bytes with `fs`
		// (do not use `net.fetch(file:...)`): `interceptFileProtocol(file)` aborts every `file:` load.
		defaultSession.protocol.handle(Schemas.vscodeFileResource, async request => {
			try {
				return await this.handleVsCodeFileRequest(request.url);
			} catch (error) {
				this.logService.error(`${Schemas.vscodeFileResource}: Handler error for ${request.url}: ${String(error)}`);
				return new Response(null, { status: 500 });
			}
		});

		// Block any file:// access
		defaultSession.protocol.interceptFileProtocol(Schemas.file, (request, callback) => this.handleFileRequest(request, callback));

		// Cleanup
		this._register(toDisposable(() => {
			defaultSession.protocol.unhandle(Schemas.vscodeFileResource);
			defaultSession.protocol.uninterceptProtocol(Schemas.file);
		}));
	}

	addValidFileRoot(root: string): IDisposable {

		// Pass to `normalize` because we later also do the
		// same for all paths to check against.
		const normalizedRoot = normalize(root);

		const registeredKeys: string[] = [];
		const register = (key: string) => {
			if (!this.validRoots.get(key)) {
				this.validRoots.set(key, true);
				registeredKeys.push(key);
			}
		};

		register(normalizedRoot);
		if (isMacintosh) {
			const nfcRoot = normalizeNFC(normalizedRoot);
			register(nfcRoot);
		}
		try {
			const canonicalRoot = normalize(realpathSync(normalizedRoot));
			if (canonicalRoot !== normalizedRoot) {
				register(canonicalRoot);
			}
			if (isMacintosh) {
				const nfcCanonical = normalizeNFC(canonicalRoot);
				register(nfcCanonical);
			}
		} catch {
			// ignore: path not yet resolvable
		}

		if (registeredKeys.length === 0) {
			return Disposable.None;
		}

		return toDisposable(() => {
			for (const k of registeredKeys) {
				this.validRoots.delete(k);
			}
		});
	}

	//#region file://

	private handleFileRequest(request: Electron.ProtocolRequest, callback: ProtocolCallback) {
		const uri = URI.parse(request.url);

		this.logService.error(`Refused to load resource ${uri.fsPath} from ${Schemas.file}: protocol (original URL: ${request.url})`);

		return callback({ error: -3 /* ABORTED */ });
	}

	//#endregion

	//#region vscode-file://

	private async handleVsCodeFileRequest(url: string): Promise<Response> {
		const fsPath = this.requestToNormalizedFilePath(url);
		const extraHeaders = this.buildVsCodeFileExtraHeaders(url, fsPath);

		let allowed =
			this.isPathUnderValidRoot(fsPath)
			|| this.validExtensions.has(extname(fsPath).toLowerCase());

		if (!allowed
			&& (!this.environmentService.isBuilt || this.isDevelopmentSourcesCheckout())
			&& existsSync(fsPath)
			&& this.isPathUnderAppRoot(fsPath)) {
			this.logService.trace(`${Schemas.vscodeFileResource}: Serving via dev-checkout fallback (${fsPath})`);
			allowed = true;
		}

		if (!allowed) {
			this.logService.error(`${Schemas.vscodeFileResource}: Refused to load resource ${fsPath} from ${Schemas.vscodeFileResource}: protocol (original URL: ${url})`);
			return new Response(null, { status: 404 });
		}

		return this.fetchAuthorizedVsCodeFile(fsPath, extraHeaders);
	}

	private buildVsCodeFileExtraHeaders(url: string, fsPath: string): Record<string, string> | undefined {
		const pathBasename = basename(fsPath);
		let headers: Record<string, string> | undefined;
		if (this.environmentService.crossOriginIsolated) {
			if (pathBasename === 'workbench.html' || pathBasename === 'workbench-dev.html') {
				headers = { ...COI.CoopAndCoep };
			} else {
				const coiFromQuery = COI.getHeadersFromQuery(url);
				if (coiFromQuery) {
					headers = { ...coiFromQuery };
				}
			}
		}

		if (!this.environmentService.isBuilt) {
			headers = { ...headers, ...CacheControlheaders };
		}

		if (pathBasename === 'workbench.html' || pathBasename === 'workbench-dev.html') {
			headers = { ...headers, ...DocumentPolicyheaders };
		}

		return headers;
	}

	private async fetchAuthorizedVsCodeFile(fsPath: string, extraHeaders?: Record<string, string>): Promise<Response> {
		let body: Buffer;
		try {
			body = await readFile(fsPath);
		} catch (error) {
			this.logService.error(`${Schemas.vscodeFileResource}: Failed to read ${fsPath}: ${String(error)}`);
			return new Response(null, { status: 404 });
		}

		const headers = new Headers();
		const contentType = this.getVsCodeFileMimeType(fsPath);
		if (contentType) {
			headers.set('Content-Type', contentType);
		}
		if (extraHeaders) {
			for (const [key, value] of Object.entries(extraHeaders)) {
				headers.set(key, value);
			}
		}

		return new Response(body, { status: 200, headers });
	}

	private getVsCodeFileMimeType(fsPath: string): string | undefined {
		switch (extname(fsPath).toLowerCase()) {
			case '.js':
			case '.mjs':
			case '.cjs':
				return 'text/javascript; charset=utf-8';
			case '.html':
			case '.htm':
				return 'text/html; charset=utf-8';
			case '.css':
				return 'text/css; charset=utf-8';
			case '.json':
				return 'application/json; charset=utf-8';
			case '.wasm':
				return 'application/wasm';
			case '.svg':
				return 'image/svg+xml';
			case '.png':
				return 'image/png';
			case '.jpg':
			case '.jpeg':
				return 'image/jpeg';
			case '.gif':
				return 'image/gif';
			case '.bmp':
				return 'image/bmp';
			case '.webp':
				return 'image/webp';
			case '.mp4':
				return 'video/mp4';
			case '.otf':
				return 'font/otf';
			case '.ttf':
				return 'font/ttf';
			default:
				return undefined;
		}
	}

	private normalizeFilesystemPath(fsPath: string): string {
		let p = normalize(fsPath);
		if (isMacintosh) {
			p = normalizeNFC(p);
		}
		return p;
	}

	/** Matches checkout layouts without shipped `src/` (see app.ts `isDevelopmentSourcesLayout`). */
	private isDevelopmentSourcesCheckout(): boolean {
		const root = this.environmentService.appRoot;
		try {
			return existsSync(join(root, 'package.json'))
				&& existsSync(join(root, 'src', 'bootstrap-window.ts'));
		} catch {
			return false;
		}
	}

	private isPathUnderAppRoot(fsPath: string): boolean {
		const nPath = toSlashes(this.normalizeFilesystemPath(fsPath));
		const roots: string[] = [];
		const pushRoot = (r: string) => {
			roots.push(toSlashes(this.normalizeFilesystemPath(normalize(r))));
		};
		pushRoot(this.environmentService.appRoot);
		try {
			pushRoot(realpathSync(normalize(this.environmentService.appRoot)));
		} catch {
			// ignore
		}
		for (const root of roots) {
			if (isEqualOrParent(nPath, root, !isLinux, '/')) {
				return true;
			}
		}
		return false;
	}

	private requestToNormalizedFilePath(url: string): string {

		// 1.) Use `URI.parse()` util from us to convert the raw
		//     URL into our URI.
		const requestUri = URI.parse(url);

		// 2.) Use `FileAccess.asFileUri` to convert back from a
		//     `vscode-file:` URI to a `file:` URI.
		const unnormalizedFileUri = FileAccess.uriToFileUri(requestUri);

		// 3.) Strip anything from the URI that could result in
		//     relative paths (such as "..") by using `normalize`
		return this.normalizeFilesystemPath(normalize(unnormalizedFileUri.fsPath));
	}

	private isPathUnderValidRoot(path: string): boolean {
		if (this.validRoots.findSubstr(path)) {
			return true;
		}
		try {
			return Boolean(this.validRoots.findSubstr(this.normalizeFilesystemPath(normalize(realpathSync(path)))));
		} catch {
			return false;
		}
	}

	//#endregion

	//#region IPC Object URLs

	createIPCObjectUrl<T>(): IIPCObjectUrl<T> {
		let obj: T | undefined = undefined;

		// Create unique URI
		const resource = URI.from({
			scheme: 'vscode', // used for all our IPC communication (vscode:<channel>)
			path: generateUuid()
		});

		// Install IPC handler
		const channel = resource.toString();
		const handler = async (): Promise<T | undefined> => obj;
		validatedIpcMain.handle(channel, handler);

		this.logService.trace(`IPC Object URL: Registered new channel ${channel}.`);

		return {
			resource,
			update: updatedObj => obj = updatedObj,
			dispose: () => {
				this.logService.trace(`IPC Object URL: Removed channel ${channel}.`);

				validatedIpcMain.removeHandler(channel);
			}
		};
	}

	//#endregion
}
