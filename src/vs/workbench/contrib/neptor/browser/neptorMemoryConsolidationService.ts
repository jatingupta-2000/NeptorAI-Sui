/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { INeptorSettingsService } from '../common/neptorSettingsService.js';
import { INeptorProjectMemoryService } from '../common/neptorProjectMemoryService.js';
import { INeptorMemoryConsolidationService } from '../common/neptorMemoryConsolidationService.js';
import { neptor_memory_consolidation_systemMessage } from '../common/prompt/prompts.js';
import { readFile as readFileLimited } from '../common/prompt/prompts.js';
import {
	MAX_MEMORY_ARTIFACT_FILE_CHARS,
	MEMORY_ARTIFACT_FILE_NAMES,
	NEPTOR_MEMORY_DIR,
} from '../common/memory/memoryConstants.js';
import { applyConsolidationOpsToMarkdown, parseConsolidationJson } from '../common/memory/memoryPatchApply.js';
import { MemoryArtifactType } from '../common/memory/memoryConstants.js';
import { normalizeAndValidateMermaidMarkdown } from '../common/memory/mermaidGuards.js';

const MIN_INTERVAL_MS = 3000;
const WINDOW_MS = 60_000;
const MAX_RUNS_PER_WINDOW = 6;
const MAX_OPS = 12;
const MAX_OP_CONTENT = 8000;

export class NeptorMemoryConsolidationService extends Disposable implements INeptorMemoryConsolidationService {
	readonly _serviceBrand: undefined;

	private _running = false;
	private _lastRun = 0;
	private _runTimes: number[] = [];

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@INeptorSettingsService private readonly neptorSettingsService: INeptorSettingsService,
		@INeptorProjectMemoryService private readonly projectMemory: INeptorProjectMemoryService,
		@IConvertToLLMMessageService private readonly convertToLLM: IConvertToLLMMessageService,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
	) {
		super();
	}

	private _modeAllowsPm(): boolean {
		const m = this.neptorSettingsService.state.globalSettings.memoryConsolidationMode;
		return m === 'aggressive' || m === 'pm_only';
	}

	private _modeAllowsCode(): boolean {
		return this.neptorSettingsService.state.globalSettings.memoryConsolidationMode === 'aggressive';
	}

	private _guardOk(): boolean {
		const now = Date.now();
		if (now - this._lastRun < MIN_INTERVAL_MS) {
			return false;
		}
		this._runTimes = this._runTimes.filter(t => now - t < WINDOW_MS);
		if (this._runTimes.length >= MAX_RUNS_PER_WINDOW) {
			return false;
		}
		return true;
	}

	private async _runModel(user: string): Promise<string> {
		const modelSelection = this.neptorSettingsService.state.modelSelectionOfFeature['Chat'] ?? null;
		const modelSelectionOptions = modelSelection
			? this.neptorSettingsService.state.optionsOfModelSelection['Chat'][modelSelection.providerName]?.[modelSelection.modelName]
			: undefined;
		const { messages, separateSystemMessage } = this.convertToLLM.prepareLLMSimpleMessages({
			simpleMessages: [{ role: 'user', content: user }],
			systemMessage: neptor_memory_consolidation_systemMessage,
			modelSelection,
			featureName: 'Chat',
		});
		const result = await new Promise<string>((resolve, reject) => {
			const token = this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages,
				separateSystemMessage,
				modelSelection,
				modelSelectionOptions,
				overridesOfModel: this.neptorSettingsService.state.overridesOfModel,
				chatMode: null,
				logging: { loggingName: 'Neptor PM memory consolidation' },
				onText: () => { },
				onFinalMessage: ({ fullText }) => resolve(fullText),
				onError: (e) => reject(new Error(e.message)),
				onAbort: () => reject(new Error('aborted')),
			});
			if (!token) {
				reject(new Error('LLM request not started'));
			}
		});
		return result;
	}

	private async _applyToFolder(folderUri: URI, ops: import('../common/memory/memoryPatchApply.js').ConsolidationOp[]): Promise<boolean> {
		const memRoot = URI.joinPath(folderUri, ...NEPTOR_MEMORY_DIR.split('/'));
		let touched = false;
		const iso = new Date().toISOString();
		for (const op of ops.slice(0, MAX_OPS)) {
			if (op.op !== 'append' && op.op !== 'replace_section') {
				continue;
			}
			const rel = MEMORY_ARTIFACT_FILE_NAMES[op.artifact as MemoryArtifactType];
			if (!rel) {
				continue;
			}
			const target = URI.joinPath(memRoot, rel);
			if (!(await this.fileService.exists(target))) {
				continue;
			}
			const read = await readFileLimited(this.fileService, target, MAX_MEMORY_ARTIFACT_FILE_CHARS);
			if (!read.val) {
				continue;
			}
			const applied = applyConsolidationOpsToMarkdown(read.val, [op], { maxContentLen: MAX_OP_CONTENT });
			if (applied.error || !applied.touched) {
				continue;
			}
			const next = applied.md;
			if (next.length > MAX_MEMORY_ARTIFACT_FILE_CHARS) {
				continue;
			}
			const checked = normalizeAndValidateMermaidMarkdown(next);
			if (checked.issues.length > 0) {
				continue;
			}
			await this.fileService.writeFile(target, VSBuffer.fromString(checked.markdown));
			touched = true;
		}
		if (touched) {
			await this.projectMemory.refreshMemoryManifestForFolder(folderUri, { lastConsolidationAtIso: iso });
		}
		return touched;
	}

	private async _execute(userContent: string): Promise<void> {
		if (this._running) {
			return;
		}
		if (!this._guardOk()) {
			return;
		}
		this._running = true;
		try {
			const response = await this._runModel(userContent);
			const parsed = parseConsolidationJson(response);
			if (!parsed.ok) {
				return;
			}
			const ops = parsed.payload.ops.filter(o => o.op !== 'noop');
			if (ops.length === 0) {
				return;
			}
			const folders = this.workspaceContextService.getWorkspace().folders;
			if (folders.length === 0) {
				return;
			}
			await this._applyToFolder(folders[0].uri, ops);
			this._lastRun = Date.now();
			this._runTimes.push(this._lastRun);
		} catch {
			// ignore consolidation failures
		} finally {
			this._running = false;
		}
	}

	scheduleAfterPmAssistantMessage(opts: { lastUserMessage: string; assistantText: string }): void {
		if (!this._modeAllowsPm()) {
			return;
		}
		void this._scheduleBody({ lastUserMessage: opts.lastUserMessage, lastAssistantText: opts.assistantText }, 'pm');
	}

	scheduleAfterCodeAgentIdle(opts: { lastUserMessage: string; lastAssistantText: string; toolDigest?: string }): void {
		if (!this._modeAllowsCode()) {
			return;
		}
		void this._scheduleBody(opts, 'code');
	}

	private async _scheduleBody(
		opts: { lastUserMessage: string; lastAssistantText?: string; assistantText?: string; toolDigest?: string },
		_source: 'pm' | 'code',
	): Promise<void> {
		const assistant = (opts.assistantText ?? opts.lastAssistantText ?? '').slice(0, 12_000);
		const user = (opts.lastUserMessage ?? '').slice(0, 8000);
		if (!assistant && !user) {
			return;
		}
		let memorySlice = '';
		try {
			memorySlice = await this.projectMemory.getRetrievalContextForPrompt(user || assistant);
		} catch {
			memorySlice = '';
		}
		const digest = _source === 'code' && opts.toolDigest?.trim()
			? `\n\nRecent tool results (truncated):\n${opts.toolDigest.trim().slice(0, 4000)}`
			: '';
		const userContent = `Source: ${_source}\n\nLatest user message:\n${user}\n\nLatest assistant message:\n${assistant}${digest}\n\nCurrent memory slices:\n${memorySlice.slice(0, 14_000)}`;
		await this._execute(userContent);
	}
}

registerSingleton(INeptorMemoryConsolidationService, NeptorMemoryConsolidationService, InstantiationType.Delayed);
