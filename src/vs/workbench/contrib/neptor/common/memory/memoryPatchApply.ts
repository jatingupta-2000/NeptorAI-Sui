/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { MemoryArtifactType } from './memoryConstants.js';
import { ParsedMemorySection, parseSimpleYamlishFrontmatter, parseMemorySectionsFromBody } from './parseMemoryMarkdown.js';

export type ConsolidationOp =
	| { op: 'noop' }
	| { op: 'append'; artifact: MemoryArtifactType; sectionId: string; content: string; rationale?: string }
	| { op: 'replace_section'; artifact: MemoryArtifactType; sectionId: string; content: string; rationale?: string };

export interface ConsolidationPayload {
	ops: ConsolidationOp[];
}

function slugTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'section';
}

/** Extract H1 line after frontmatter (first line starting with "# ") */
export function extractMarkdownH1(bodyAfterFrontmatter: string): string | null {
	const lines = bodyAfterFrontmatter.split('\n');
	for (const line of lines) {
		if (line.startsWith('# ')) {
			return line.slice(2).trim();
		}
		if (line.startsWith('## ')) {
			return null;
		}
	}
	return null;
}

/** Body for section parser: drop leading H1 block so ## sections align with parseMemorySectionsFromBody */
function bodyForSectionParse(bodyAfterFrontmatter: string): string {
	const lines = bodyAfterFrontmatter.split('\n');
	let i = 0;
	while (i < lines.length && lines[i].trim() === '') {
		i += 1;
	}
	if (i < lines.length && lines[i].startsWith('# ')) {
		i += 1;
		while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('## ')) {
			i += 1;
		}
		return lines.slice(i).join('\n').trimStart();
	}
	return bodyAfterFrontmatter;
}

export function serializeTaggedMemoryDocument(opts: {
	attrs: Record<string, string>;
	h1Title: string;
	sections: ParsedMemorySection[];
}): string {
	const attrLines = Object.entries(opts.attrs).map(([k, v]) => `${k}: ${v}`);
	const fm = `---\n${attrLines.join('\n')}\n---\n\n# ${opts.h1Title}\n\n`;
	const chunks = opts.sections.map(sec => {
		const tagStr = sec.tags.length > 0 ? `\n<!-- neptor:tags ${sec.tags.join(', ')} -->\n` : '\n';
		return `## ${sec.title}${tagStr}${sec.body.trimEnd()}`;
	});
	return `${fm}${chunks.join('\n\n')}\n`;
}

export function splitMarkdownForPatch(md: string): { attrs: Record<string, string>; h1Title: string; sections: ParsedMemorySection[]; tail: string } {
	const { attrs, body } = parseSimpleYamlishFrontmatter(md);
	const h1 = extractMarkdownH1(body) ?? (attrs.title?.trim() || 'Memory');
	const sectionBody = bodyForSectionParse(body);
	const { sections } = parseMemorySectionsFromBody(sectionBody);
	return { attrs, h1Title: h1, sections, tail: '' };
}

export function applyConsolidationOpsToMarkdown(md: string, ops: ConsolidationOp[], opts: { maxContentLen: number }): { md: string; touched: boolean; error?: string } {
	let working = md;
	let touched = false;
	for (const rawOp of ops) {
		if (rawOp.op === 'noop') {
			continue;
		}
		if (rawOp.op !== 'append' && rawOp.op !== 'replace_section') {
			return { md: working, touched, error: `Unknown op: ${(rawOp as ConsolidationOp).op}` };
		}
		const content = rawOp.content ?? '';
		if (content.length > opts.maxContentLen) {
			return { md: working, touched, error: `Content exceeds cap (${content.length})` };
		}
		const { attrs, h1Title, sections } = splitMarkdownForPatch(working);
		const sid = slugTitle(rawOp.sectionId);
		const idx = sections.findIndex(s => slugTitle(s.id) === sid || slugTitle(s.title) === sid);
		let nextSections: ParsedMemorySection[];
		if (idx === -1) {
			const title = rawOp.sectionId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			nextSections = [
				...sections,
				{
					id: slugTitle(title),
					title,
					tags: [],
					body: content.trim(),
				},
			];
		} else {
			const copy = sections.slice();
			const prev = copy[idx];
			if (rawOp.op === 'append') {
				const piece = content.trim();
				if (piece.length === 0) {
					continue;
				}
				if (prev.body.includes(piece)) {
					continue;
				}
				const add = prev.body.trim().length === 0 ? content : `${prev.body.trimEnd()}\n\n${content}`;
				copy[idx] = { ...prev, body: add };
			} else {
				copy[idx] = { ...prev, body: content.trim() };
			}
			nextSections = copy;
		}
		const iso = new Date().toISOString();
		const mergedAttrs = {
			...attrs,
			updated_iso: iso,
			chars_approx: String(serializeTaggedMemoryDocument({ attrs, h1Title, sections: nextSections }).length),
		};
		working = serializeTaggedMemoryDocument({ attrs: mergedAttrs, h1Title, sections: nextSections });
		touched = true;
	}
	return { md: working, touched };
}

export function parseConsolidationJson(text: ConsolidationPayload | string): { ok: true; payload: ConsolidationPayload } | { ok: false; error: string } {
	let raw: unknown = text;
	if (typeof text === 'string') {
		const trimmed = text.trim();
		const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
		const candidate = fence ? fence[1].trim() : trimmed;
		try {
			raw = JSON.parse(candidate);
		} catch (e) {
			return { ok: false, error: `JSON parse error: ${e}` };
		}
	}
	if (!raw || typeof raw !== 'object' || !Array.isArray((raw as ConsolidationPayload).ops)) {
		return { ok: false, error: 'Payload must be an object with ops[]' };
	}
	const ops: ConsolidationOp[] = [];
	for (const o of (raw as ConsolidationPayload).ops) {
		if (!o || typeof o !== 'object') {
			return { ok: false, error: 'Invalid op entry' };
		}
		const op = (o as { op?: string }).op;
		if (op === 'noop') {
			ops.push({ op: 'noop' });
			continue;
		}
		const ARTIFACT_TYPES = new Set<string>([
			'overview', 'vision', 'architecture', 'domain', 'apis', 'tech_stack', 'flows',
			'user_journeys', 'docs_index', 'roadmap', 'decisions',
		]);
		const artifact = (o as { artifact?: string }).artifact;
		const sectionId = (o as { sectionId?: string }).sectionId;
		const content = (o as { content?: string }).content ?? '';
		const rationale = (o as { rationale?: string }).rationale;
		if (op === 'append' || op === 'replace_section') {
			if (typeof artifact !== 'string' || !ARTIFACT_TYPES.has(artifact)) {
				return { ok: false, error: 'append/replace_section requires artifact' };
			}
			if (typeof sectionId !== 'string' || !sectionId.trim()) {
				return { ok: false, error: 'append/replace_section requires sectionId' };
			}
			if (typeof content !== 'string') {
				return { ok: false, error: 'append/replace_section requires content string' };
			}
			ops.push(op === 'append'
				? { op: 'append', artifact: artifact as MemoryArtifactType, sectionId, content, rationale }
				: { op: 'replace_section', artifact: artifact as MemoryArtifactType, sectionId, content, rationale });
			continue;
		}
		return { ok: false, error: `Unknown op ${String(op)}` };
	}
	return { ok: true, payload: { ops } };
}
