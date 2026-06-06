/*--------------------------------------------------------------------------------------
 *  Walrus Memory (MemWal) storage for org team rules.
 *  One memory per rule (semantic recall), with optional category prefix.
 *--------------------------------------------------------------------------------------*/

import { MemWal } from '@mysten-incubation/memwal';

/** Legacy snapshot marker (backward-compatible reads). */
const RULES_MARKER = 'NEPTOR_ORG_RULES';
const RULE_PREFIX = 'Neptor rule';
const RULE_MEMORY_RE = /^(?:Team coding rule \[([^\]]+)\]|Neptor rule tag=([a-z-]+)):\s*(.+)$/i;

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

let _client = null;

function memWalPrivateKey() {
	return process.env.MEMWAL_PRIVATE_KEY || '';
}

function memWalAccountId() {
	return process.env.MEMWAL_ACCOUNT_ID || '';
}

function memWalServerUrl() {
	return process.env.MEMWAL_SERVER_URL || 'https://relayer.memwal.ai';
}

function orgNamespace(orgId) {
	const prefix = process.env.MEMWAL_NAMESPACE_PREFIX || 'neptor-org';
	return `${prefix}-${orgId}`;
}

function normalizeCategory(category) {
	const c = String(category || 'general').trim().toLowerCase();
	const mapped = CATEGORY_ALIASES.get(c) ?? c;
	return VALID_CATEGORIES.has(mapped) ? mapped : 'general';
}

function getClient() {
	if (_client) {
		return _client;
	}
	if (!isMemWalEnabled()) {
		return null;
	}
	_client = MemWal.create({
		key: memWalPrivateKey().trim(),
		accountId: memWalAccountId().trim(),
		serverUrl: memWalServerUrl(),
	});
	return _client;
}

export function isMemWalEnabled() {
	return Boolean(memWalPrivateKey().trim() && memWalAccountId().trim());
}

/** @deprecated alias kept for server import compatibility */
export const isWalrusEnabled = isMemWalEnabled;

export function getMemWalStatus() {
	return {
		enabled: isMemWalEnabled(),
		serverUrl: memWalServerUrl(),
		accountId: memWalAccountId() || null,
		namespacePrefix: process.env.MEMWAL_NAMESPACE_PREFIX || 'neptor-org',
		storageMode: 'per-rule',
	};
}

/** @deprecated alias kept for /health response */
export const getWalrusStatus = getMemWalStatus;

/** @param {{ text: string, category?: string }} rule */
export function formatRuleMemory(rule) {
	return `${RULE_PREFIX} tag=${normalizeCategory(rule.category)}: ${String(rule.text).trim()}`;
}

function ruleKey(text) {
	return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isUsableRuleText(text) {
	const normalized = ruleKey(text);
	if (!normalized) {
		return false;
	}
	// Reject accidental collapsed phrases like "makexplanationsshortandtopoint".
	if (/^[a-z]{20,}$/.test(normalized)) {
		return false;
	}
	return true;
}

function inferCategoryFromRuleText(text) {
	const t = ruleKey(text);
	if (/\b(test|tests|testing|spec|coverage)\b/.test(t)) {
		return 'testing';
	}
	if (/\b(modular|architecture|solid|separation|module|small functions?)\b/.test(t)) {
		return 'architecture';
	}
	if (/\b(component|react|vue|angular|css|html|ui|ux|frontend|front-end)\b/.test(t)) {
		return 'frontend';
	}
	if (/\b(api|endpoint|rest|graphql|rpc|contract)\b/.test(t)) {
		return 'api';
	}
	if (/\b(database|sql|postgres|supabase|schema|migration)\b/.test(t)) {
		return 'database';
	}
	if (/\b(security|auth|permission|secret|token|encryption)\b/.test(t)) {
		return 'security';
	}
	if (/\b(performance|latency|throughput|memory|cache)\b/.test(t)) {
		return 'performance';
	}
	if (/\b(error|validation|quality|robust|safe|maintainable)\b/.test(t)) {
		return 'coding';
	}
	return 'general';
}

/** @returns {{ text: string, category: string } | null} */
function parseRuleMemory(text) {
	if (!text?.trim()) {
		return null;
	}
	const match = text.trim().match(RULE_MEMORY_RE);
	if (match) {
		const ruleText = match[3].trim();
		if (!isUsableRuleText(ruleText)) {
			return null;
		}
		return {
			category: normalizeCategory(match[1] ?? match[2]),
			text: ruleText,
		};
	}
	return null;
}

function parseLegacySnapshot(text, expectedOrgId) {
	if (!text?.includes(RULES_MARKER)) {
		return null;
	}
	const jsonMatch = text.match(/\{[\s\S]*\}/);
	if (!jsonMatch) {
		return null;
	}
	try {
		const parsed = JSON.parse(jsonMatch[0]);
		if (expectedOrgId && parsed.orgId !== expectedOrgId) {
			return null;
		}
		if (!Array.isArray(parsed.rules)) {
			return null;
		}
		return parsed.rules
			.map(rule => String(rule).trim())
			.filter(isUsableRuleText)
			.map(rule => ({ text: rule, category: inferCategoryFromRuleText(rule) }));
	} catch {
		return null;
	}
}

const pendingWritesByNamespace = new Map();

/** @returns {{ rules: { text: string, category: string }[], updatedAtIso: string | null } | null} */
export async function readRulesFromMemWal(orgId) {
	const client = getClient();
	if (!client || !orgId?.trim()) {
		return null;
	}
	try {
		const ns = orgNamespace(orgId);
		const recalled = await client.recall({
			query: 'team coding guidelines style architecture quality testing',
			namespace: ns,
			limit: 50,
			maxDistance: 1.2,
		});

		console.log('recalled from memwal:', recalled.results);
		const map = new Map();
		const taggedKeys = new Set();
		for (const row of recalled.results ?? []) {
			const parsed = parseRuleMemory(row.text);
			if (parsed?.text) {
				const key = ruleKey(parsed.text);
				taggedKeys.add(key);
				map.set(key, parsed);
				continue;
			}
			const legacyRules = parseLegacySnapshot(row.text, orgId);
			if (legacyRules) {
				for (const rule of legacyRules) {
					const key = ruleKey(rule.text);
					if (!map.has(key)) {
						map.set(key, rule);
					}
				}
			}
		}
		if (map.size === 0) {
			return null;
		}

		const missingTaggedRules = [...map.values()].filter(rule => !taggedKeys.has(ruleKey(rule.text)));
		if (missingTaggedRules.length && process.env.MEMWAL_AUTO_BACKFILL_TAGS === '1') {
			void writeNewRulesToMemWal(orgId, missingTaggedRules);
		}

		return {
			rules: [...map.values()],
			updatedAtIso: new Date().toISOString(),
		};
	} catch (e) {
		console.error('[memwal] recall failed:', e instanceof Error ? e.message : e);
		return null;
	}
}

/**
 * Store each new rule as its own MemWal memory (like remember("I'm allergic to peanuts")).
 * @param {string} orgId
 * @param {{ text: string, category?: string }[]} newRules
 * @returns {Promise<{ blobId: string, stored: number, updatedAtIso: string } | null>}
 */
export async function writeNewRulesToMemWal(orgId, newRules) {
	const client = getClient();
	if (!client || !newRules?.length) {
		return null;
	}
	try {
		const ns = orgNamespace(orgId);
		const pending = pendingWritesByNamespace.get(ns) ?? new Set();
		pendingWritesByNamespace.set(ns, pending);
		const deduped = new Map();
		for (const rule of newRules) {
			if (!isUsableRuleText(rule.text)) {
				continue;
			}
			const key = ruleKey(rule.text);
			if (!pending.has(key)) {
				deduped.set(key, rule);
			}
		}
		if (deduped.size === 0) {
			return null;
		}
		for (const key of deduped.keys()) {
			pending.add(key);
		}
		const items = [...deduped.values()].map(rule => ({
			text: formatRuleMemory(rule),
			namespace: ns,
		}));

		let lastBlobId = null;
		let stored = 0;

		if (items.length === 1) {
			const result = await client.rememberAndWait(items[0].text, ns, {
				timeoutMs: 120_000,
				pollIntervalMs: 1500,
			});
			lastBlobId = result.blob_id;
			stored = 1;
		} else {
			const bulk = await client.rememberBulkAndWait(items, {
				timeoutMs: 180_000,
				pollIntervalMs: 1500,
			});
			const done = bulk.results.filter(r => r.status === 'done' && r.blob_id);
			stored = done.length;
			if (stored === 0) {
				console.error('[memwal] rememberBulkAndWait: no items succeeded', bulk.failed);
				return null;
			}
			lastBlobId = done[done.length - 1].blob_id;
		}

		return {
			blobId: lastBlobId,
			stored,
			updatedAtIso: new Date().toISOString(),
		};
	} catch (e) {
		console.error('[memwal] writeNewRules failed:', e instanceof Error ? e.message : e);
		return null;
	} finally {
		const ns = orgNamespace(orgId);
		const pending = pendingWritesByNamespace.get(ns);
		for (const rule of newRules ?? []) {
			pending?.delete(ruleKey(rule.text));
		}
	}
}

/** @deprecated use writeNewRulesToMemWal */
export async function writeRulesToMemWal(orgId, _allRules, _version, newRules) {
	return writeNewRulesToMemWal(orgId, newRules ?? []);
}
