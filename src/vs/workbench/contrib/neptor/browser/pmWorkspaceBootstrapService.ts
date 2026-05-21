/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { dirname } from '../../../../base/common/resources.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { INeptorSettingsService } from '../common/neptorSettingsService.js';
import { INeptorProjectMemoryService } from '../common/neptorProjectMemoryService.js';
import { IPmWorkspaceBootstrapService, PmBootstrapProgress, PmWizardAnswers } from '../common/pmWorkspaceBootstrapService.js';
import {
	pm_workspace_bootstrap_chunkUserMessage,
	pm_workspace_bootstrap_systemMessage,
	pmDiagramRepair_userMessage,
} from '../common/prompt/prompts.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import {
	MAX_MEMORY_ARTIFACT_FILE_CHARS,
	MEMORY_ARTIFACT_FILE_NAMES,
	MEMORY_ARTIFACT_LABEL,
	MemoryArtifactType,
	MEMORY_ARTIFACT_TYPES,
	NEPTOR_MEMORY_SCHEMA_VERSION,
} from '../common/memory/memoryConstants.js';
import { ARTIFACTS_REQUIRING_MERMAID, normalizeAndValidateMermaidMarkdown } from '../common/memory/mermaidGuards.js';

/**
 * Strip a single outer ```markdown fence ONLY when the entire response is
 * wrapped in one. The regex must be anchored to start AND end of the whole
 * string (no `m` flag) so we never accidentally strip an inner ```mermaid
 * fence and leave the diagram as bare text.
 */
function stripOuterCodeFence(s: string): string {
	const t = s.trim();
	const m = t.match(/^```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/);
	return m ? m[1].trim() : t;
}

export class PmWorkspaceBootstrapService extends Disposable implements IPmWorkspaceBootstrapService {
	readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IDirectoryStrService private readonly directoryStrService: IDirectoryStrService,
		@INeptorProjectMemoryService private readonly projectMemory: INeptorProjectMemoryService,
		@IConvertToLLMMessageService private readonly convertToLLM: IConvertToLLMMessageService,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
		@INeptorSettingsService private readonly neptorSettingsService: INeptorSettingsService,
	) {
		super();
	}

	private async ensureDir(uri: URI): Promise<void> {
		if (await this.fileService.exists(uri)) {
			return;
		}
		const parent = dirname(uri);
		if (parent.toString() !== uri.toString()) {
			await this.ensureDir(parent);
		}
		if (!(await this.fileService.exists(uri))) {
			await this.fileService.createFolder(uri);
		}
	}

	private async llmCompleteMarkdown(user: string, onStream?: (fullText: string, fullReasoning: string) => void): Promise<string> {
		const modelSelection = this.neptorSettingsService.state.modelSelectionOfFeature['Chat'] ?? null;
		const modelSelectionOptions = modelSelection
			? this.neptorSettingsService.state.optionsOfModelSelection['Chat'][modelSelection.providerName]?.[modelSelection.modelName]
			: undefined;
		const system = `${pm_workspace_bootstrap_systemMessage}\n\nGeneration timestamp: ${new Date().toISOString()}`;
		const { messages, separateSystemMessage } = this.convertToLLM.prepareLLMSimpleMessages({
			simpleMessages: [{ role: 'user', content: user }],
			systemMessage: system,
			modelSelection,
			featureName: 'Chat',
		});
		return await new Promise<string>((resolve, reject) => {
			const token = this.llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages,
				separateSystemMessage,
				modelSelection,
				modelSelectionOptions,
				overridesOfModel: this.neptorSettingsService.state.overridesOfModel,
				chatMode: null,
				logging: { loggingName: 'Neptor PM workspace bootstrap' },
				onText: ({ fullText, fullReasoning }) => {
					onStream?.(fullText, fullReasoning ?? '');
				},
				onFinalMessage: ({ fullText }) => resolve(fullText),
				onError: (e) => reject(new Error(e.message)),
				onAbort: () => reject(new Error('aborted')),
			});
			if (!token) {
				reject(new Error('LLM request not started'));
			}
		});
	}

	private async enforceMermaidQuality(type: MemoryArtifactType, label: string, markdown: string, emit: (e: PmBootstrapProgress) => void): Promise<string> {
		let candidate = markdown;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const checked = normalizeAndValidateMermaidMarkdown(candidate, {
				requireDiagram: ARTIFACTS_REQUIRING_MERMAID.has(type),
				requireSections: true,
			});
			if (checked.issues.length === 0) {
				return checked.markdown;
			}
			if (attempt > 0) {
				throw new Error(`${label} diagram validation failed: ${checked.issues.join('; ')}`);
			}
			emit({
				kind: 'line',
				variant: 'thinking',
				text: `Repairing Mermaid in **${label}** (${checked.issues.join('; ')})…`,
			});
			const repairPrompt = pmDiagramRepair_userMessage({
				artifactType: type,
				issues: checked.issues,
				currentMarkdown: checked.markdown,
			});
			candidate = stripOuterCodeFence(await this.llmCompleteMarkdown(repairPrompt));
		}
		return candidate;
	}

	async runWizardBootstrap(
		answers: PmWizardAnswers,
		onProgress?: (e: PmBootstrapProgress) => void,
	): Promise<{ ok: boolean; detail: string }> {
		const emit = (e: PmBootstrapProgress) => {
			try {
				onProgress?.(e);
			} catch {
				// React or host must not break bootstrap
			}
		};

		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) {
			return { ok: false, detail: 'Open a workspace folder first.' };
		}
		const folderUri = folders[0].uri;
		const memRoot = URI.joinPath(folderUri, '.neptor', 'memory');
		await this.ensureDir(URI.joinPath(folderUri, '.neptor'));
		await this.ensureDir(memRoot);

		await this.projectMemory.touchWorkspaceBootstrapProgress(folderUri, { kind: 'start' });

		emit({ kind: 'line', variant: 'context', text: 'Reading workspace folder tree and file layout…' });
		let treeSample: string;
		try {
			treeSample = await this.directoryStrService.getDirectoryStrTool(folderUri);
		} catch {
			treeSample = '(tree unavailable)';
		}
		if (treeSample.length > 35_000) {
			treeSample = `${treeSample.slice(0, 35_000)}\n_(truncated)_\n`;
		}
		emit({ kind: 'line', variant: 'success', text: `Extracted directory overview (${Math.round(treeSample.length / 1024)} KB). Building prompts from your answers.` });

		const wizardSummary = [
			`Workspace profile: ${answers.workspaceProfile}`,
			`Target users: ${answers.targetUsers}`,
			`Outcomes: ${answers.outcomes}`,
			`Constraints: ${answers.constraints}`,
		].join('\n');

		const lines: string[] = [];
		let ok = true;

		for (const type of MEMORY_ARTIFACT_TYPES) {
			const label = MEMORY_ARTIFACT_LABEL[type];
			const fileName = MEMORY_ARTIFACT_FILE_NAMES[type];
			try {
				emit({ kind: 'line', variant: 'thinking', text: `Planning and generating **${label}** (${fileName})…` });
				await this.projectMemory.touchWorkspaceBootstrapProgress(folderUri, { kind: 'artifact_begin', artifactType: type });
				const prompt = pm_workspace_bootstrap_chunkUserMessage({
					artifactType: type,
					title: label,
					wizardSummary,
					treeSample,
				});
				const maxSnip = 1800;
				let lastReasoningLen = 0;
				let md = stripOuterCodeFence(
					await this.llmCompleteMarkdown(prompt, (fullText, fullReasoning) => {
						const r = (fullReasoning ?? '').trim();
						if (r.length > 0 && (lastReasoningLen === 0 || r.length >= lastReasoningLen + 320)) {
							lastReasoningLen = r.length;
							const rs = r.length > 1200 ? r.slice(-1200) : r;
							emit({ kind: 'reasoning', artifactType: type, text: rs });
						}
						const sn = fullText.length > maxSnip ? `…${fullText.slice(-maxSnip)}` : fullText;
						emit({ kind: 'stream', artifactType: type, label, snippet: sn });
					}),
				);
				if (!md.includes('neptor_memory_schema:')) {
					const iso = new Date().toISOString();
					const header = `---
neptor_memory_schema: ${NEPTOR_MEMORY_SCHEMA_VERSION}
artifact_type: ${type}
artifact_id: ${type}
title: ${label}
updated_iso: ${iso}
source_fingerprint: bootstrap
chars_approx: 0
section_tags: generated
---

`;
					md = header + md;
				}
				md = await this.enforceMermaidQuality(type, label, md, emit);
				if (md.length > MAX_MEMORY_ARTIFACT_FILE_CHARS) {
					md = `${md.slice(0, MAX_MEMORY_ARTIFACT_FILE_CHARS)}\n\n_(truncated)_\n`;
				}
				emit({ kind: 'line', variant: 'tool', text: `Writing \`${fileName}\` to .neptor/memory…` });
				const target = URI.joinPath(memRoot, fileName);
				await this.fileService.writeFile(target, VSBuffer.fromString(md));
				emit({ kind: 'line', variant: 'success', text: `Saved **${fileName}** (${Math.round(md.length / 1024)} KB).` });
				await this.projectMemory.touchWorkspaceBootstrapProgress(folderUri, { kind: 'artifact_saved', artifactType: type });
			} catch (e) {
				ok = false;
				const err = String(e);
				lines.push(`Failed ${type}: ${err}`);
				emit({ kind: 'line', variant: 'error', text: `${label}: ${err}` });
				await this.projectMemory.touchWorkspaceBootstrapProgress(folderUri, {
					kind: 'artifact_failed',
					artifactType: type,
					message: err,
				});
			} finally {
				emit({ kind: 'artifact_end', artifactType: type });
			}
		}

		await this.projectMemory.touchWorkspaceBootstrapProgress(folderUri, {
			kind: 'finish',
			ok,
			summary: lines.length > 0 ? lines.join('\n') : undefined,
		});

		emit({ kind: 'line', variant: 'tool', text: 'Updating index.json manifest and retrieval metadata…' });
		const isoDone = new Date().toISOString();
		await this.projectMemory.refreshMemoryManifestForFolder(folderUri, {
			bootstrapCompletedAtIso: isoDone,
			workspaceProfile: answers.workspaceProfile,
		});
		emit({ kind: 'line', variant: 'success', text: 'PM memory workspace is ready.' });

		return { ok, detail: lines.length > 0 ? lines.join('\n') : 'All artifacts generated.' };
	}
}

registerSingleton(IPmWorkspaceBootstrapService, PmWorkspaceBootstrapService, InstantiationType.Delayed);
