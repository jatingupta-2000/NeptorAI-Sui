/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export interface ParsedMemorySection {
	id: string;
	title: string;
	tags: string[];
	body: string;
}

export function parseSimpleYamlishFrontmatter(md: string): { attrs: Record<string, string>; body: string } {
	if (!md.startsWith('---\n')) {
		return { attrs: {}, body: md };
	}
	const end = md.indexOf('\n---\n', 4);
	if (end === -1) {
		return { attrs: {}, body: md };
	}
	const fmBlock = md.slice(4, end);
	const body = md.slice(end + 5);
	const attrs: Record<string, string> = {};
	for (const line of fmBlock.split('\n')) {
		const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
		if (m) {
			attrs[m[1]] = m[2].trim();
		}
	}
	return { attrs, body };
}

function slugTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'section';
}

/**
 * Parse markdown body using ## headings as section boundaries.
 */
export function parseMemorySectionsFromBody(body: string): ParsedMemorySectionsResult {
	const sections: ParsedMemorySection[] = [];
	const parts = body.split(/\n(?=## )/);
	for (const part of parts) {
		const lines = part.split('\n');
		const head = lines[0] ?? '';
		if (!head.startsWith('## ')) {
			continue;
		}
		const title = head.slice(3).trim();
		const id = slugTitle(title);
		const bodyText = lines.slice(1).join('\n').trim();
		const tagMatch = bodyText.match(/^<!--\s*neptor:tags\s+([^>]+)\s*-->/);
		let tags: string[] = [];
		let rest = bodyText;
		if (tagMatch) {
			tags = tagMatch[1].split(',').map(t => t.trim()).filter(Boolean);
			rest = bodyText.slice(tagMatch[0].length).trim();
		}
		sections.push({ id, title, tags, body: rest });
	}
	return { sections };
}

export interface ParsedMemorySectionsResult {
	sections: ParsedMemorySection[];
}

export function parseTaggedMemoryDocument(md: string): {
	attrs: Record<string, string>;
	sections: ParsedMemorySection[];
} {
	const { attrs, body } = parseSimpleYamlishFrontmatter(md);
	const { sections } = parseMemorySectionsFromBody(body);
	return { attrs, sections };
}
