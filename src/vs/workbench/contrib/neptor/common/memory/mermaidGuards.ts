/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { MemoryArtifactType } from './memoryConstants.js';

const MERMAID_FENCE_RE = /```mermaid\s*([\s\S]*?)```/gi;
const ANY_FENCE_RE = /```[\s\S]*?```/g;
const MERMAID_HEADER_RE = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|gantt|journey|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|sankey-beta|block-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/i;
const ORPHAN_HEADER_LINE_RE = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|gantt|journey|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|sankey-beta|block-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b[^\n]*$/im;

export const ARTIFACTS_REQUIRING_MERMAID: ReadonlySet<MemoryArtifactType> = new Set<MemoryArtifactType>([
	'architecture',
	'domain',
	'apis',
	'flows',
	'user_journeys',
	'file_graph',
]);

/**
 * After all fenced blocks (any language) are removed, the remaining text
 * should not contain a Mermaid diagram header on its own line. If it does,
 * the LLM emitted a diagram without fencing it and the renderer will not
 * pick it up.
 */
function detectOrphanDiagram(markdown: string): boolean {
	const stripped = markdown.replace(ANY_FENCE_RE, '');
	return ORPHAN_HEADER_LINE_RE.test(stripped);
}

export function normalizeMermaidSource(src: string): string {
	let s = src.replace(/\r\n/g, '\n').trim();
	const singleLine = !s.includes('\n');
	if (singleLine) {
		const m = s.match(/^(flowchart|graph)\s+(TD|TB|BT|RL|LR)\s+/i);
		if (m) {
			s = s.replace(/^(flowchart|graph)\s+(TD|TB|BT|RL|LR)\s+/i, `${m[1]} ${m[2]}\n`);
		}
	}
	return s.replace(/\n+$/, '');
}

function validateMermaidSource(src: string): string | null {
	const lines = src.split('\n').map(l => l.trim()).filter(Boolean);
	if (lines.length === 0) {
		return 'diagram is empty';
	}
	const m = lines[0].match(MERMAID_HEADER_RE);
	if (!m) {
		return 'missing valid Mermaid diagram header on first line';
	}
	const kind = m[1].toLowerCase();
	const body = lines.slice(1).join('\n');
	if ((kind === 'flowchart' || kind === 'graph') && (lines.length < 2 || !/-->|---|==>|-.->|<--/.test(body))) {
		return 'flowchart/graph must include at least one edge statement on subsequent lines';
	}
	if (kind === 'sequencediagram' && (lines.length < 2 || !/->>|-->>|->|--x|x--/.test(body))) {
		return 'sequenceDiagram must include at least one message line';
	}
	if ((kind === 'statediagram-v2' || kind === 'statediagram') && lines.length < 2) {
		return 'state diagram must include state transitions or declarations';
	}
	if (kind === 'erdiagram' && lines.length < 2) {
		return 'erDiagram must include entities or relationships';
	}
	return null;
}

export function normalizeAndValidateMermaidMarkdown(markdown: string, opts?: { requireDiagram?: boolean; requireSections?: boolean }): {
	markdown: string;
	diagramCount: number;
	issues: string[];
} {
	let count = 0;
	const issues: string[] = [];
	const normalized = markdown.replace(MERMAID_FENCE_RE, (_full, code: string) => {
		count += 1;
		const cleaned = normalizeMermaidSource(code);
		const err = validateMermaidSource(cleaned);
		if (err) {
			issues.push(`diagram #${count}: ${err}`);
		}
		return `\`\`\`mermaid\n${cleaned}\n\`\`\``;
	});
	if (opts?.requireDiagram && count === 0) {
		issues.push('missing required mermaid diagram for this artifact');
	}
	if (detectOrphanDiagram(normalized)) {
		issues.push('found a Mermaid diagram header outside of a ```mermaid fence');
	}
	if (opts?.requireSections) {
		const bodyAfterFrontmatter = normalized.replace(/^---[\s\S]*?\n---\s*/m, '');
		const hasH2 = /^##\s+/m.test(bodyAfterFrontmatter);
		if (!hasH2) {
			issues.push('artifact has no ## sections; required structural scaffold is missing');
		}
	}
	return { markdown: normalized, diagramCount: count, issues };
}
