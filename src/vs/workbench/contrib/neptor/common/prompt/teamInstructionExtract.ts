/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Neptor AI All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for information.
 *--------------------------------------------------------------------------------------*/

export interface TeamExtractedRule {
	text: string;
	category: string;
}

export const teamInstructionExtractSystemMessage = `You extract persistent coding guidelines from a developer's chat message.

Return ONLY valid JSON:
{ "rules": [{ "text": string, "category": string }] }

Categories (use one per rule): coding, architecture, frontend, backend, fullstack, mobile, desktop, api, database, infrastructure, devops, cloud, security, blockchain, ai, machine-learning, data-engineering, analytics, testing, qa, networking, performance, observability, sre, platform-engineering, general

Include rules only when the user states a reusable preference for how code or text should be written, for example:
- general (no em dashes, answer style, naming conventions)
- architecture (SOLID, modular code, separation of concerns)
- testing (always add tests)
- frontend (component patterns, styling rules)
- backend/api/database/security/performance (domain-specific engineering preferences)

Do NOT include:
- one-off task requests ("fix bug in index.js", "add a button")
- questions
- file-specific instructions unless they generalize to a team rule

If nothing qualifies, return { "rules": [] }.`;

const VALID_CATEGORIES = new Set([
	'coding',
	'architecture',
	'frontend',
	'backend',
	'fullstack',
	'mobile',
	'desktop',
	'api',
	'database',
	'infrastructure',
	'devops',
	'cloud',
	'security',
	'blockchain',
	'ai',
	'machine-learning',
	'data-engineering',
	'analytics',
	'testing',
	'qa',
	'networking',
	'performance',
	'observability',
	'sre',
	'platform-engineering',
	'general',
]);
const CATEGORY_ALIASES = new Map([
	['style', 'general'],
	['quality', 'coding'],
	['test', 'testing'],
	['tests', 'testing'],
	['ml', 'machine-learning'],
	['data', 'data-engineering'],
	['infra', 'infrastructure'],
	['ops', 'devops'],
	['platform', 'platform-engineering'],
]);

function normalizeCategory(raw: unknown): string {
	if (typeof raw !== 'string') {
		return 'general';
	}
	const c = raw.trim().toLowerCase();
	const mapped = CATEGORY_ALIASES.get(c) ?? c;
	return VALID_CATEGORIES.has(mapped) ? mapped : 'general';
}

export function parseExtractedRulesJson(raw: string): TeamExtractedRule[] {
	const trimmed = raw.trim();
	const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		return [];
	}
	try {
		const parsed = JSON.parse(jsonMatch[0]) as { rules?: unknown };
		if (!Array.isArray(parsed.rules)) {
			return [];
		}
		const out: TeamExtractedRule[] = [];
		for (const entry of parsed.rules) {
			if (typeof entry === 'string') {
				const text = entry.trim();
				if (text) {
					out.push({ text, category: 'general' });
				}
				continue;
			}
			if (entry && typeof entry === 'object' && 'text' in entry && typeof (entry as { text: unknown }).text === 'string') {
				const text = (entry as { text: string }).text.trim();
				if (text) {
					out.push({
						text,
						category: normalizeCategory((entry as { category?: unknown }).category),
					});
				}
			}
		}
		return out;
	} catch {
		return [];
	}
}
