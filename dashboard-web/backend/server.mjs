/*--------------------------------------------------------------------------------------
 *  Neptor Dashboard Web
 *  Standalone portal for org analytics, rules, activity, and MemWal visibility.
 *--------------------------------------------------------------------------------------*/

import http from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = resolve(rootDir, 'frontend/public');
const envPath = resolve(rootDir, '.env');

function loadEnv() {
	if (!existsSync(envPath)) {
		return;
	}
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const eq = trimmed.indexOf('=');
		if (eq <= 0) {
			continue;
		}
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

loadEnv();

const PORT = Number(process.env.PORT || 8790);
const ORG_API_URL = (process.env.ORG_API_URL || 'http://localhost:8788').replace(/\/$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DASHBOARD_SESSION_SECRET = process.env.DASHBOARD_SESSION_SECRET || 'local-dev-secret';
const DASHBOARD_DEFAULT_ORG_ID = String(process.env.DASHBOARD_DEFAULT_ORG_ID || '').trim();
const DASHBOARD_DEFAULT_ORG_SLUG = String(process.env.DASHBOARD_DEFAULT_ORG_SLUG || '').trim().toLowerCase();
const DASHBOARD_DEFAULT_ORG_NAME = String(process.env.DASHBOARD_DEFAULT_ORG_NAME || 'AutoPay Organization').trim();

const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && !SUPABASE_URL.includes('your-project'));

function normalizeOrgToken(value) {
	return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function resolveDefaultOrgId(orgs) {
	if (!Array.isArray(orgs) || orgs.length === 0) {
		return undefined;
	}
	if (DASHBOARD_DEFAULT_ORG_ID) {
		const byId = orgs.find(org => org.id === DASHBOARD_DEFAULT_ORG_ID);
		if (byId) {
			return byId.id;
		}
	}
	if (DASHBOARD_DEFAULT_ORG_SLUG) {
		const bySlug = orgs.find(org => String(org.slug || '').trim().toLowerCase() === DASHBOARD_DEFAULT_ORG_SLUG);
		if (bySlug) {
			return bySlug.id;
		}
	}
	const preferredNorm = normalizeOrgToken(DASHBOARD_DEFAULT_ORG_NAME);
	const preferredTokens = preferredNorm ? [preferredNorm] : [];
	if (preferredNorm.includes('autopay')) {
		preferredTokens.push('autopay');
	}
	for (const org of orgs) {
		const nameNorm = normalizeOrgToken(org.name);
		const slugNorm = normalizeOrgToken(org.slug);
		if (preferredTokens.some(token => nameNorm.includes(token) || slugNorm.includes(token))) {
			return org.id;
		}
	}
	for (const org of orgs) {
		const name = String(org.name || '').toLowerCase();
		const slug = String(org.slug || '').toLowerCase();
		const needle = DASHBOARD_DEFAULT_ORG_NAME.toLowerCase();
		if (needle && (name.includes(needle) || slug.includes(needle))) {
			return org.id;
		}
	}
	return orgs[0].id;
}

function resolveSessionActiveOrgId(session) {
	const allowed = session.orgs.some(org => org.id === session.activeOrgId);
	if (allowed) {
		return session.activeOrgId;
	}
	return resolveDefaultOrgId(session.orgs);
}

const sessions = new Map();

const memoryType = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.ico': 'image/x-icon',
};

function nowIso() {
	return new Date().toISOString();
}

function hashToken(value) {
	return createHash('sha256').update(`${value}:${DASHBOARD_SESSION_SECRET}`).digest('hex');
}

function sendJson(res, status, body) {
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	});
	res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
	sendJson(res, status, { error: message });
}

async function readJson(req) {
	let raw = '';
	for await (const chunk of req) {
		raw += chunk;
	}
	if (!raw.trim()) {
		return {};
	}
	return JSON.parse(raw);
}

function parseCookies(req) {
	const header = req.headers.cookie || '';
	const out = new Map();
	for (const part of header.split(';')) {
		const [k, ...rest] = part.trim().split('=');
		if (k) {
			out.set(k, decodeURIComponent(rest.join('=')));
		}
	}
	return out;
}

function setSessionCookie(res, token) {
	res.setHeader('Set-Cookie', `neptor_dashboard_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 12}`);
}

function clearSessionCookie(res) {
	res.setHeader('Set-Cookie', 'neptor_dashboard_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function getSession(req) {
	const token = parseCookies(req).get('neptor_dashboard_session');
	if (!token) {
		return null;
	}
	const session = sessions.get(hashToken(token));
	if (!session || Date.now() > session.expiresAt) {
		if (session) {
			sessions.delete(hashToken(token));
		}
		return null;
	}
	session.lastSeenAt = Date.now();
	return session;
}

async function requireSession(req, res) {
	const session = getSession(req);
	if (!session) {
		sendError(res, 401, 'Sign in with an email that belongs to a Neptor organization.');
		return null;
	}
	return session;
}

function requireSupabase(res) {
	if (!supabaseConfigured) {
		sendError(res, 503, 'Dashboard Supabase is not configured. Copy dashboard-web/.env.example to .env.');
		return false;
	}
	return true;
}

async function supabaseRest(path, opts = {}) {
	const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
		...opts,
		headers: {
			apikey: SUPABASE_SERVICE_ROLE_KEY,
			Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
			'Content-Type': 'application/json',
			Prefer: 'return=representation',
			...(opts.headers || {}),
		},
	});
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}
	if (!res.ok) {
		throw new Error(typeof data === 'object' && data?.message ? data.message : `Supabase REST failed: ${res.status}`);
	}
	return data;
}

function q(value) {
	return encodeURIComponent(String(value));
}

function dayKey(iso) {
	return new Date(iso).toISOString().slice(0, 10);
}

function normalizeRuleText(rule) {
	return String(rule || '').trim().replace(/\s+/g, ' ');
}

function parseTaggedRule(text) {
	const m = String(text || '').match(/^(?:Neptor rule tag=([a-z-]+)|Team coding rule \[([^\]]+)\]):\s*(.+)$/i);
	if (!m) {
		return { tag: inferRuleTag(text), text: String(text || ''), legacy: false };
	}
	return { tag: (m[1] || m[2] || 'general').toLowerCase(), text: m[3].trim(), legacy: false };
}

function inferRuleTag(text) {
	const t = String(text || '').toLowerCase();
	if (/\b(test|tests|testing|coverage|spec)\b/.test(t)) return 'testing';
	if (/\b(frontend|front-end|ui|react|component|accessib|keyboard|screen reader|css|html)\b/.test(t)) return 'frontend';
	if (/\b(backend|handler|server|controller)\b/.test(t)) return 'backend';
	if (/\b(api|endpoint|contract|rest|graphql)\b/.test(t)) return 'api';
	if (/\b(database|migration|schema|sql|postgres|supabase|rollback)\b/.test(t)) return 'database';
	if (/\b(devops|deploy|deployment|ci|cd|pipeline)\b/.test(t)) return 'devops';
	if (/\b(cloud|environment-specific|environment|aws|gcp|azure)\b/.test(t)) return 'cloud';
	if (/\b(secret|token|credential|security|auth|permission)\b/.test(t)) return 'security';
	if (/\b(performance|cache|latency|network call)\b/.test(t)) return 'performance';
	if (/\b(log|metric|observability|alert)\b/.test(t)) return 'observability';
	if (/\b(ai|model|prompt|agent)\b/.test(t)) return 'ai';
	if (/\b(architecture|business logic|transport layer|separate|separation)\b/.test(t)) return 'architecture';
	return 'coding';
}

function normalizeRuleRecord(raw, source) {
	if (raw && typeof raw === 'object' && typeof raw.text === 'string') {
		return {
			text: normalizeRuleText(raw.text),
			tag: String(raw.category || raw.tag || 'general').trim().toLowerCase() || 'general',
			source,
			legacy: false,
		};
	}
	const parsed = parseTaggedRule(String(raw || ''));
	return {
		...parsed,
		text: normalizeRuleText(parsed.text),
		source,
	};
}

function mergeRuleSources(liveRules, ruleRow) {
	const records = [];
	const liveRecords = [];
	const liveStorage = liveRules?.storage || 'org-api';
	for (const rule of Array.isArray(liveRules?.rules) ? liveRules.rules : []) {
		const record = normalizeRuleRecord(rule, liveStorage);
		if (record.text) {
			liveRecords.push(record);
			records.push(record);
		}
	}
	for (const rule of Array.isArray(ruleRow?.rules) ? ruleRow.rules : []) {
		const record = normalizeRuleRecord(rule, 'database-cache');
		if (record.text) {
			records.push(record);
		}
	}

	const liveDuplicateSamples = [];
	const liveKeys = new Set();
	for (const record of liveRecords) {
		const key = record.text.toLowerCase();
		if (liveKeys.has(key)) {
			liveDuplicateSamples.push(record.text);
			continue;
		}
		liveKeys.add(key);
	}

	const byKey = new Map();
	for (const record of records) {
		const key = record.text.toLowerCase();
		if (byKey.has(key)) {
			const existing = byKey.get(key);
			if (existing.source === 'database-cache' && record.source !== 'database-cache') {
				byKey.set(key, record);
			}
			continue;
		}
		byKey.set(key, record);
	}
	return {
		records: [...byKey.values()],
		diagnostics: {
				liveCount: Array.isArray(liveRules?.rules) ? liveRules.rules.length : 0,
				databaseCount: Array.isArray(ruleRow?.rules) ? ruleRow.rules.length : 0,
				mergedCount: byKey.size,
				duplicateCount: liveDuplicateSamples.length,
				duplicateSamples: liveDuplicateSamples.slice(0, 8),
				liveStorage,
			},
		};
	}

async function fetchOrgApi(path, opts = {}) {
	const res = await fetch(`${ORG_API_URL}${path}`, {
		...opts,
		headers: {
			'Content-Type': 'application/json',
			...(opts.headers || {}),
		},
	});
	const text = await res.text();
	let data = {};
	try {
		data = text ? JSON.parse(text) : {};
	} catch {
		data = { raw: text };
	}
	if (!res.ok) {
		throw new Error(data.error || `Org API failed: ${res.status}`);
	}
	return data;
}

async function getMembershipsByEmail(email) {
	const normalizedEmail = email.toLowerCase();
	const exactMembers = await supabaseRest(`org_members?email=eq.${q(normalizedEmail)}&select=id,org_id,user_id,email,display_name,role,joined_at`).catch(() => []);
	const fuzzyMembers = await supabaseRest(`org_members?email=ilike.${q(normalizedEmail)}&select=id,org_id,user_id,email,display_name,role,joined_at`).catch(() => []);
	const membersById = new Map();
	for (const member of [...(exactMembers || []), ...(fuzzyMembers || [])]) {
		if (member?.id) {
			membersById.set(member.id, member);
		}
	}
	const members = [...membersById.values()];
	if (!members?.length) {
		return [];
	}
	const ids = [...new Set(members.map(m => m.org_id))];
	const orgs = await supabaseRest(`organizations?id=in.(${ids.map(q).join(',')})&select=id,name,slug,description,owner_user_id,created_at,updated_at`);
	const orgById = new Map((orgs || []).map(org => [org.id, org]));
	return members.map(member => ({
		...member,
		organizations: orgById.get(member.org_id),
	})).filter(member => member.organizations);
}

async function getAllowedOrg(session, orgId) {
	const found = session.orgs.find(org => org.id === orgId);
	if (!found) {
		throw new Error('You do not have access to this organization.');
	}
	return found;
}

async function loadOrgBundle(orgId) {
	const [membersRes, rulesRes, orgApiActivityRes, orgActivityRes, healthRes] = await Promise.all([
		supabaseRest(`org_members?org_id=eq.${q(orgId)}&select=*`),
		supabaseRest(`org_rules?org_id=eq.${q(orgId)}&select=*&limit=1`),
		fetchOrgApi(`/v1/orgs/${encodeURIComponent(orgId)}/activity?limit=120`).catch(() => ({ events: [] })),
		fetchOrgActivityRows(orgId),
		fetchOrgApi('/health').catch(e => ({ ok: false, error: e.message })),
	]);
	const members = membersRes || [];
	const userActivity = await fetchUserActivityRows(orgId, members);

	let liveRules = null;
	try {
		liveRules = await fetchOrgApi(`/v1/orgs/${encodeURIComponent(orgId)}/rules`);
	} catch (e) {
		liveRules = { error: e.message, rules: rulesRes[0]?.rules || [], storage: 'database' };
	}
	const activity = mergeActivitySources(orgApiActivityRes?.events || [], orgActivityRes.rows, userActivity.rows, userActivity.mode);

	return {
		members,
		ruleRow: rulesRes[0] || null,
		activity: activity.items,
		activityDiagnostics: activity.diagnostics,
		liveRules,
		health: healthRes,
	};
}

function rowMatchesOrgOrMembers(row, orgId, members) {
	const memberEmails = new Set(members.map(member => String(member.email || '').toLowerCase()).filter(Boolean));
	const memberUserIds = new Set(members.map(member => String(member.user_id || '')).filter(Boolean));
	const nested = nestedActivityData(row);
	const actor = row.actor || nested.actor || {};
	const rowOrgId = String(row.org_id || row.orgId || row.organization_id || row.organizationId || nested.org_id || nested.orgId || nested.organization_id || nested.organizationId || '');
	const rowEmail = String(row.actor_email || row.actorEmail || row.user_email || row.userEmail || row.email || actor.email || nested.actor_email || nested.user_email || nested.email || '').toLowerCase();
	const rowUserId = String(row.user_id || row.userId || actor.id || nested.user_id || nested.userId || '');
	return rowOrgId === String(orgId) || memberEmails.has(rowEmail) || memberUserIds.has(rowUserId);
}

function nestedActivityData(row) {
	const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
	const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
	const properties = row.properties && typeof row.properties === 'object' ? row.properties : {};
	const event = row.event && typeof row.event === 'object' ? row.event : {};
	return { ...metadata, ...payload, ...properties, ...event };
}

async function fetchOrgActivityRows(orgId) {
	const rows = await supabaseRest(`org_activity?org_id=eq.${q(orgId)}&select=*&order=created_at.desc&limit=120`).catch(() => []);
	return {
		rows: Array.isArray(rows) ? rows : [],
		mode: 'org_activity',
	};
}

async function fetchUserActivityRows(orgId, members) {
	const direct = await supabaseRest(`user_activity?org_id=eq.${q(orgId)}&select=*&order=created_at.desc&limit=120`).catch(() => null);
	if (Array.isArray(direct) && direct.length > 0) {
		return { rows: direct, mode: 'org_id' };
	}

	const recent = await fetchRecentUserActivityRows();
	const rows = Array.isArray(recent)
		? recent.filter(row => rowMatchesOrgOrMembers(row, orgId, members)).slice(0, 120)
		: [];
	return {
		rows,
		mode: Array.isArray(direct) ? 'member-match' : 'member-match-after-org-filter-error',
	};
}

async function fetchRecentUserActivityRows() {
	const attempts = [
		'user_activity?select=*&order=created_at.desc&limit=500',
		'user_activity?select=*&order=timestamp.desc&limit=500',
		'user_activity?select=*&order=createdAt.desc&limit=500',
		'user_activity?select=*&limit=500',
	];
	for (const path of attempts) {
		const rows = await supabaseRest(path).catch(() => null);
		if (Array.isArray(rows)) {
			return rows;
		}
	}
	return [];
}

function normalizeActivityRow(row, source) {
	const nested = nestedActivityData(row);
	const actor = row.actor || nested.actor || {};
	const createdAt = row.timestampIso || row.created_at || row.createdAtIso || row.created_at_iso || row.timestamp || row.time || nested.timestampIso || nested.created_at || nested.timestamp || nowIso();
	const kind = row.kind || row.event_type || row.eventType || row.action || row.type || nested.kind || nested.event_type || nested.eventType || nested.action || nested.type || 'activity';
	const summary = row.summary || row.description || row.title || row.message || nested.summary || nested.description || nested.title || nested.message || kind;
	return {
		id: row.id || `${source}-${createHash('sha1').update(`${createdAt}:${summary}`).digest('hex').slice(0, 12)}`,
		org_id: row.orgId || row.org_id || row.organization_id || nested.orgId || nested.org_id || nested.organization_id || null,
		user_id: row.userId || row.user_id || actor.id || nested.userId || nested.user_id || null,
		actor_email: row.actorEmail || row.actor_email || actor.email || row.email || nested.actorEmail || nested.actor_email || nested.user_email || nested.email || null,
		actor_display_name: row.actorDisplayName || row.actor_display_name || actor.displayName || row.display_name || row.name || nested.actorDisplayName || nested.actor_display_name || nested.display_name || nested.name || 'Teammate',
		kind,
		summary,
		metadata: { ...nested, source },
		created_at: createdAt,
	};
}

function mergeActivitySources(orgApiEvents, orgActivityRows, userActivityRows, userActivityMode = 'unknown') {
	const merged = new Map();
	for (const row of orgApiEvents) {
		const normalized = normalizeActivityRow(row, 'org-api');
		merged.set(normalized.id, normalized);
	}
	for (const row of orgActivityRows) {
		const normalized = normalizeActivityRow(row, 'org_activity');
		merged.set(normalized.id, normalized);
	}
	for (const row of userActivityRows) {
		const normalized = normalizeActivityRow(row, 'user_activity');
		merged.set(normalized.id, normalized);
	}
	const items = [...merged.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	return {
		items,
		diagnostics: {
			orgApiCount: Array.isArray(orgApiEvents) ? orgApiEvents.length : 0,
			orgActivityCount: Array.isArray(orgActivityRows) ? orgActivityRows.length : 0,
			userActivityCount: Array.isArray(userActivityRows) ? userActivityRows.length : 0,
			userActivityMode,
			mergedCount: items.length,
		},
	};
}

function buildRuleInsights(ruleRecords, sourceDuplicateCount = 0, sourceDuplicateSamples = []) {
	const unique = new Map();
	const duplicates = [];
	const categoryCounts = new Map();
	const lowQuality = [];

	for (const record of ruleRecords) {
		const text = normalizeRuleText(record.text);
		const key = text.toLowerCase();
		if (!text) {
			continue;
		}
		if (unique.has(key)) {
			duplicates.push(text);
			continue;
		}
		unique.set(key, text);
		const tag = record.tag || parseTaggedRule(text).tag;
		categoryCounts.set(tag, (categoryCounts.get(tag) || 0) + 1);
		if (/^[a-z]{20,}$/.test(key) || text.length < 8 || /write good code/i.test(text)) {
			lowQuality.push(text);
		}
	}

	return {
		total: ruleRecords.length,
		unique: unique.size,
		duplicates: duplicates.length + sourceDuplicateCount,
		lowQuality: lowQuality.length,
		categories: [...categoryCounts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
		duplicateSamples: [...sourceDuplicateSamples, ...duplicates].slice(0, 8),
		lowQualitySamples: lowQuality.slice(0, 8),
	};
}

function buildDerivedActivity(org, bundle, ruleRecords) {
	const derived = [];
	if (org.createdAtIso) {
		derived.push({
			id: `derived-org-${org.id}`,
			org_id: org.id,
			user_id: null,
			actor_email: null,
			actor_display_name: 'Neptor',
			kind: 'org_connected',
			summary: `${org.name} workspace connected`,
			metadata: { derived: true },
			created_at: org.createdAtIso,
		});
	}
	for (const member of bundle.members) {
		derived.push({
			id: `derived-member-${member.id}`,
			org_id: org.id,
			user_id: member.user_id,
			actor_email: member.email,
			actor_display_name: member.display_name,
			kind: 'member_available',
			summary: `${member.display_name} is available as ${member.role}`,
			metadata: { derived: true },
			created_at: member.joined_at,
		});
	}
	if (bundle.ruleRow?.updated_at) {
		derived.push({
			id: `derived-rules-${org.id}`,
			org_id: org.id,
			user_id: null,
			actor_email: null,
			actor_display_name: 'Rules Engine',
			kind: ruleRecords.length ? 'rules_available' : 'rules_empty',
			summary: ruleRecords.length ? `${ruleRecords.length} team rule${ruleRecords.length === 1 ? '' : 's'} available` : 'Rule cache exists but current dashboard sources are empty',
			metadata: { derived: true, storage: bundle.liveRules.storage || 'database' },
			created_at: bundle.ruleRow.updated_at,
		});
	}
	if (bundle.health?.memwal?.enabled) {
		derived.push({
			id: `derived-memwal-${org.id}`,
			org_id: org.id,
			user_id: null,
			actor_email: null,
			actor_display_name: 'Walrus Memory',
			kind: 'memwal_health',
			summary: `MemWal connected on namespace prefix ${bundle.health.memwal.namespacePrefix || 'default'}`,
			metadata: { derived: true },
			created_at: nowIso(),
		});
	}
	return derived;
}

function buildActivityInsights(activity) {
	const kindCounts = new Map();
	const days = new Map();
	const users = new Map();
	for (const row of activity) {
		kindCounts.set(row.kind, (kindCounts.get(row.kind) || 0) + 1);
		const day = dayKey(row.created_at);
		days.set(day, (days.get(day) || 0) + 1);
		const email = row.actor_email || row.user_id || 'unknown';
		users.set(email, (users.get(email) || 0) + 1);
	}
	return {
		total: activity.length,
		byKind: [...kindCounts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
		byDay: [...days.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)),
		topUsers: [...users.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
	};
}

function firstString(...values) {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return '';
}

function pathParts(value) {
	return String(value || '')
		.replace(/^file:\/\//, '')
		.replace(/\\/g, '/')
		.split('/')
		.filter(Boolean);
}

function basenameFromPath(value) {
	const parts = pathParts(value);
	return parts.at(-1) || '';
}

function rootFolderFromPath(value) {
	const parts = pathParts(value);
	if (!parts.length) {
		return '';
	}
	if (/^https?:\/\//i.test(String(value || ''))) {
		return '';
	}

	const codeRootMarkers = new Set([
		'src',
		'app',
		'lib',
		'packages',
		'apps',
		'components',
		'pages',
		'routes',
		'server',
		'client',
		'backend',
		'frontend',
		'api',
		'database',
		'db',
		'test',
		'tests',
		'__tests__',
		'.neptor',
	]);
	for (let i = 0; i < parts.length; i++) {
		if (codeRootMarkers.has(parts[i]) && parts[i - 1]) {
			return parts[i - 1];
		}
	}

	const workspaceMarkers = ['Projects', 'Product', 'Documents', 'Workspace', 'workspaces'];
	for (const marker of workspaceMarkers) {
		const index = parts.indexOf(marker);
		if (index >= 0) {
			if (parts[index + 2] && (parts[index + 1] === 'Projects' || parts[index + 1] === 'Product')) {
				return parts[index + 2];
			}
			if (parts[index + 1]) {
				return parts[index + 1];
			}
		}
	}

	const leaf = parts.at(-1) || '';
	const leafLooksLikeFile = /\.[a-z0-9]+$/i.test(leaf);
	return leafLooksLikeFile && parts.length > 1 ? parts.at(-2) : leaf;
}

function isLowSignalRepositoryName(value) {
	const name = String(value || '').trim().toLowerCase();
	return !name || ['relayer', 'src', 'app', 'lib', 'api', 'server', 'client', 'backend', 'frontend'].includes(name);
}

function folderUnderRepository(pathValue, repositoryName, workspaceFsPath = '') {
	const normalizedPath = String(pathValue || '').replace(/^file:\/\//, '').replace(/\\/g, '/');
	const normalizedWs = String(workspaceFsPath || '').replace(/\\/g, '/').replace(/\/$/, '');
	if (normalizedWs && normalizedPath.startsWith(normalizedWs)) {
		const rel = normalizedPath.slice(normalizedWs.length).replace(/^\//, '');
		const parts = rel.split('/').filter(Boolean);
		if (parts.length === 0) {
			return '';
		}
		if (parts.length === 1) {
			return 'root';
		}
		return parts.slice(0, -1).join('/') || parts[0];
	}

	const parts = pathParts(pathValue);
	const repoIndex = parts.findIndex(part => part.toLowerCase() === String(repositoryName || '').toLowerCase());
	if (repoIndex < 0 || !parts[repoIndex + 1]) {
		return '';
	}
	const next = parts[repoIndex + 1];
	if (/\.[a-z0-9]+$/i.test(next)) {
		return 'root';
	}
	return next;
}

function fileNameFromActivityPath(pathValue) {
	const fileName = basenameFromPath(pathValue);
	return /\.[a-z0-9]+$/i.test(fileName) ? fileName : '';
}

function fileNameFromActivity(row) {
	const fromPath = fileNameFromActivityPath(activityPath(row));
	if (fromPath) {
		return fromPath;
	}
	const summary = String(row.summary || '');
	const match = summary.match(/\b([\w.-]+\.[a-z0-9]{1,12})\b/i);
	return match?.[1] || '';
}

function repositoryNameFromActivity(row) {
	const metadata = row.metadata || {};
	const folderName = firstString(
		metadata.workspaceFolderName,
		metadata.workspaceName,
		metadata.projectName,
		metadata.project,
		metadata.repoName,
		metadata.repositoryName,
	);
	if (folderName && !isLowSignalRepositoryName(folderName)) {
		return folderName;
	}

	const workspaceFs = firstString(metadata.workspaceFolderFsPath, metadata.workspaceRoot, metadata.projectRoot);
	if (workspaceFs) {
		const workspaceBase = basenameFromPath(workspaceFs.replace(/\\/g, '/'));
		if (workspaceBase && !isLowSignalRepositoryName(workspaceBase)) {
			return workspaceBase;
		}
	}

	const uri = firstString(metadata.uri, metadata.fileUri, metadata.file, metadata.path, metadata.filePath);
	const uriRoot = rootFolderFromPath(uri);
	if (uriRoot && !isLowSignalRepositoryName(uriRoot)) {
		return uriRoot;
	}

	const rootPath = firstString(
		metadata.workspaceFolderFsPath,
		metadata.workspaceRoot,
		metadata.rootPath,
		metadata.rootFolder,
		metadata.projectRoot,
		metadata.cwd,
		metadata.folderPath,
	);
	if (rootPath) {
		const rootName = rootFolderFromPath(rootPath);
		if (rootName) {
			return rootName;
		}
	}

	const direct = firstString(
		metadata.repoName,
		metadata.repositoryName,
		metadata.repository,
		metadata.repo,
		metadata.projectName,
		metadata.project,
		metadata.workspaceName,
		metadata.workspace,
		row.repository,
		row.project,
	);
	if (direct && !isLowSignalRepositoryName(direct)) {
		return direct;
	}

	return '';
}

function activityPath(row) {
	const metadata = row.metadata || {};
	return firstString(metadata.uri, metadata.fileUri, metadata.file, metadata.path, metadata.filePath);
}

function relativePathUnderRepository(pathValue, repositoryName) {
	const parts = pathParts(pathValue);
	const repoIndex = parts.findIndex(part => part.toLowerCase() === String(repositoryName || '').toLowerCase());
	if (repoIndex >= 0 && repoIndex < parts.length - 1) {
		return parts.slice(repoIndex + 1).join('/');
	}
	return '';
}

function mapRepoActivityItem(row, repoName) {
	const metadata = row.metadata || {};
	const path = activityPath(row);
	const workspaceFsPath = firstString(metadata.workspaceFolderFsPath, metadata.workspaceRoot, metadata.projectRoot);
	const folder = folderUnderRepository(path, repoName, workspaceFsPath);
	const file = fileNameFromActivity(row);
	const relativePath = relativePathUnderRepository(path, repoName)
		|| (workspaceFsPath && path ? path.replace(/^file:\/\//, '').replace(/\\/g, '/').replace(String(workspaceFsPath).replace(/\\/g, '/').replace(/\/$/, ''), '').replace(/^\//, '') : '')
		|| (file || '');
	return {
		id: row.id,
		kind: row.kind,
		summary: row.summary,
		timestampIso: row.created_at,
		actorDisplayName: row.actor_display_name,
		actorEmail: row.actor_email,
		folder: folder || null,
		file: file || null,
		relativePath: relativePath || null,
		metadata: {
			uri: path || null,
			threadLabel: metadata.threadLabel || null,
			workspaceFolderFsPath: metadata.workspaceFolderFsPath || null,
			workspaceFolderName: metadata.workspaceFolderName || null,
			artifactType: metadata.artifactType || null,
			source: metadata.source || null,
		},
	};
}

function emptyRepoBucket(name, id = null) {
	const key = id || name.toLowerCase();
	return {
		id: key,
		name,
		rootFolder: name,
		events: 0,
		activeUsers: new Set(),
		contributors: new Map(),
		eventTypes: new Map(),
		folders: new Map(),
		files: new Map(),
		activityLog: [],
		lastActivityIso: null,
		unmapped: id === '__unmapped__',
	};
}

function recordRepoActivity(bucket, row, repoName) {
	if (row.metadata?.derived || row.kind === 'team_event') {
		return false;
	}
	bucket.events++;
	if (row.actor_email || row.user_id) {
		bucket.activeUsers.add(row.actor_email || row.user_id);
		const contributorKey = row.actor_email || row.user_id || row.actor_display_name;
		const existing = bucket.contributors.get(contributorKey) || {
			displayName: row.actor_display_name || row.actor_email || 'Contributor',
			email: row.actor_email || '',
			count: 0,
		};
		existing.count += 1;
		bucket.contributors.set(contributorKey, existing);
	}
	bucket.eventTypes.set(row.kind, (bucket.eventTypes.get(row.kind) || 0) + 1);
	const metadata = row.metadata || {};
	const workspaceFsPath = firstString(metadata.workspaceFolderFsPath, metadata.workspaceRoot, metadata.projectRoot);
	const path = activityPath(row);
	const changedFolder = folderUnderRepository(path, repoName, workspaceFsPath);
	if (changedFolder) {
		bucket.folders.set(changedFolder, (bucket.folders.get(changedFolder) || 0) + 1);
	}
	const changedFile = fileNameFromActivity(row);
	if (changedFile) {
		bucket.files.set(changedFile, (bucket.files.get(changedFile) || 0) + 1);
	}
	bucket.activityLog.push(mapRepoActivityItem(row, repoName));
	if (!bucket.lastActivityIso || new Date(row.created_at) > new Date(bucket.lastActivityIso)) {
		bucket.lastActivityIso = row.created_at;
	}
	return true;
}

function visibleEventTypes(eventTypes) {
	return [...eventTypes.entries()]
		.filter(([name]) => name === 'chat_message' || name === 'file_edit')
		.map(([name, value]) => ({ name, value }))
		.sort((a, b) => b.value - a.value);
}

function serializeRepoBucket(repo) {
	const sorted = repo.activityLog
		.sort((a, b) => new Date(b.timestampIso).getTime() - new Date(a.timestampIso).getTime());
	const chatLog = sorted.filter(entry => entry.kind === 'chat_message').slice(0, 100);
	const fileEditLog = sorted.filter(entry => entry.kind === 'file_edit').slice(0, 100);
	return {
		id: repo.id,
		name: repo.name,
		rootFolder: repo.rootFolder,
		events: repo.events,
		chatCount: chatLog.length,
		fileEditCount: fileEditLog.length,
		activeUsers: repo.activeUsers.size,
		unmapped: Boolean(repo.unmapped),
		topEventTypes: visibleEventTypes(repo.eventTypes).slice(0, 6),
		topFolders: [...repo.folders.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
		topFiles: [...repo.files.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
		topContributors: [...repo.contributors.values()]
			.map(c => ({ name: c.displayName, email: c.email, value: c.count }))
			.sort((a, b) => b.value - a.value)
			.slice(0, 8),
		lastActivityIso: repo.lastActivityIso,
		chatLog,
		fileEditLog,
		activityLog: sorted.slice(0, 150),
	};
}

function mergeRepoBucket(target, source) {
	if (!source || target === source) {
		return;
	}
	target.events += source.events;
	for (const user of source.activeUsers) {
		target.activeUsers.add(user);
	}
	for (const [key, contributor] of source.contributors) {
		const existing = target.contributors.get(key);
		if (existing) {
			existing.count += contributor.count;
		} else {
			target.contributors.set(key, { ...contributor });
		}
	}
	for (const [key, value] of source.eventTypes) {
		target.eventTypes.set(key, (target.eventTypes.get(key) || 0) + value);
	}
	for (const [key, value] of source.folders) {
		target.folders.set(key, (target.folders.get(key) || 0) + value);
	}
	for (const [key, value] of source.files) {
		target.files.set(key, (target.files.get(key) || 0) + value);
	}
	target.activityLog.push(...source.activityLog);
	if (!target.lastActivityIso || (source.lastActivityIso && new Date(source.lastActivityIso) > new Date(target.lastActivityIso))) {
		target.lastActivityIso = source.lastActivityIso;
	}
}

function inferPrimaryRepoName(bucket) {
	for (const entry of bucket.activityLog) {
		const name = firstString(
			entry.metadata?.workspaceFolderName,
			entry.metadata?.workspaceFolderFsPath ? basenameFromPath(entry.metadata.workspaceFolderFsPath.replace(/\\/g, '/')) : '',
		);
		if (name && !isLowSignalRepositoryName(name)) {
			return name;
		}
	}
	return bucket.name === 'Unmapped activity' ? null : bucket.name;
}

function buildRepositoryInsights(activity) {
	const repos = new Map();
	const unmappedKey = '__unmapped__';

	for (const row of activity) {
		const name = repositoryNameFromActivity(row);
		const bucketName = name || 'Unmapped activity';
		const bucketKey = name ? name.toLowerCase() : unmappedKey;
		if (!repos.has(bucketKey)) {
			repos.set(bucketKey, emptyRepoBucket(bucketName, name ? null : unmappedKey));
		}
		recordRepoActivity(repos.get(bucketKey), row, name || bucketName);
	}

	const unmappedBucket = repos.get(unmappedKey);
	if (unmappedBucket) {
		const mappedEntries = [...repos.entries()].filter(([key]) => key !== unmappedKey);
		if (mappedEntries.length > 0) {
			mappedEntries.sort((a, b) => b[1].events - a[1].events);
			mergeRepoBucket(mappedEntries[0][1], unmappedBucket);
		} else {
			const inferred = inferPrimaryRepoName(unmappedBucket);
			if (inferred) {
				unmappedBucket.name = inferred;
				unmappedBucket.rootFolder = inferred;
				unmappedBucket.id = inferred.toLowerCase();
			}
			unmappedBucket.unmapped = false;
		}
		repos.delete(unmappedKey);
	}

	const items = [...repos.values()]
		.filter(repo => !repo.unmapped)
		.map(serializeRepoBucket)
		.sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));

	const absorbedUnmapped = unmappedBucket?.events || 0;

	return {
		total: items.length,
		mappedEvents: items.reduce((sum, repo) => sum + repo.events, 0),
		unmappedEvents: 0,
		absorbedUnmappedEvents: absorbedUnmapped,
		activeUsers: new Set(activity.filter(row => !row.metadata?.derived && row.kind !== 'team_event').map(row => row.actor_email || row.user_id).filter(Boolean)).size,
		items,
	};
}

function memberLookupKeys(member) {
	const keys = [];
	const email = String(member.email || '').trim().toLowerCase();
	const userId = String(member.user_id || '').trim();
	const id = String(member.id || '').trim();
	if (email) {
		keys.push(email);
	}
	if (userId) {
		keys.push(userId);
	}
	if (id) {
		keys.push(id);
	}
	return keys;
}

function resolveActivityUserKey(row, members) {
	const email = String(row.actor_email || '').trim().toLowerCase();
	if (email) {
		const member = members.find(m => String(m.email || '').trim().toLowerCase() === email);
		if (member) {
			return member.email || member.user_id || member.id;
		}
		return email;
	}
	const userId = String(row.user_id || '').trim();
	if (userId) {
		const member = members.find(m => String(m.user_id || '') === userId);
		if (member) {
			return member.email || member.user_id || member.id;
		}
		return userId;
	}
	return 'unknown';
}

function mapUserActivityItem(row) {
	const metadata = row.metadata || {};
	return {
		id: row.id,
		kind: row.kind,
		summary: row.summary,
		timestampIso: row.created_at,
		metadata: {
			uri: metadata.uri || metadata.fileUri || metadata.path || null,
			threadLabel: metadata.threadLabel || null,
			artifactType: metadata.artifactType || null,
			source: metadata.source || null,
		},
	};
}

function buildUserInsights(activity, members) {
	const byUser = new Map();
	const aliasToKey = new Map();

	for (const member of members) {
		const key = member.email || member.user_id || member.id;
		if (!key) {
			continue;
		}
		for (const alias of memberLookupKeys(member)) {
			aliasToKey.set(alias, key);
		}
		byUser.set(key, {
			id: key,
			displayName: member.display_name || member.email || 'Member',
			email: member.email || '',
			role: member.role || 'member',
			eventCount: 0,
			eventTypes: new Map(),
			activityLog: [],
			lastActivityIso: null,
		});
	}

	for (const row of activity) {
		if (row.metadata?.derived) {
			continue;
		}
		const resolvedKey = resolveActivityUserKey(row, members);
		const key = aliasToKey.get(resolvedKey) || aliasToKey.get(String(resolvedKey).toLowerCase()) || resolvedKey;
		const current = byUser.get(key) || {
			id: key,
			displayName: row.actor_display_name || row.actor_email || 'Unassigned user',
			email: row.actor_email || '',
			role: 'activity',
			eventCount: 0,
			eventTypes: new Map(),
			activityLog: [],
			lastActivityIso: null,
		};
		current.eventCount++;
		current.eventTypes.set(row.kind, (current.eventTypes.get(row.kind) || 0) + 1);
		current.activityLog.push(mapUserActivityItem(row));
		if (!current.lastActivityIso || new Date(row.created_at) > new Date(current.lastActivityIso)) {
			current.lastActivityIso = row.created_at;
		}
		byUser.set(key, current);
	}

	const items = [...byUser.values()]
		.map(user => ({
			id: user.id,
			displayName: user.displayName,
			email: user.email,
			role: user.role,
			events: user.eventCount,
			topEventTypes: [...user.eventTypes.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 3),
			lastActivityIso: user.lastActivityIso,
			activityLog: user.activityLog
				.sort((a, b) => new Date(b.timestampIso).getTime() - new Date(a.timestampIso).getTime())
				.slice(0, 100),
		}))
		.sort((a, b) => b.events - a.events || a.displayName.localeCompare(b.displayName));

	return {
		totalMembers: members.length,
		activeUsers: items.filter(user => user.events > 0).length,
		totalEvents: activity.filter(row => !row.metadata?.derived).length,
		items,
	};
}

function stableRuleIndex(seed, size) {
	if (!size) {
		return 0;
	}
	let hash = 0;
	const value = String(seed);
	for (let i = 0; i < value.length; i += 1) {
		hash = ((hash << 5) - hash) + value.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash) % size;
}

function buildUserLevelRules(ruleItems, members, activity = []) {
	const roster = (members || [])
		.filter(member => member.email)
		.map(member => ({
			id: member.id || member.user_id || member.email,
			userId: member.user_id || null,
			email: member.email,
			displayName: member.display_name || member.email.split('@')[0] || member.email,
			role: member.role || 'member',
			rules: [],
		}));

	if (!roster.length) {
		roster.push({
			id: 'team',
			userId: null,
			email: 'team@neptor.local',
			displayName: 'Team',
			role: 'member',
			rules: [],
		});
	}

	const activityByRule = new Map();
	for (const row of activity || []) {
		const summary = String(row.summary || '').trim();
		if (!summary) {
			continue;
		}
		const actorEmail = String(row.actor_email || '').trim().toLowerCase();
		if (!actorEmail) {
			continue;
		}
		activityByRule.set(summary.toLowerCase(), {
			email: actorEmail,
			displayName: row.actor_display_name || actorEmail,
			timestampIso: row.created_at || null,
		});
	}

	const now = Date.now();
	let attributedFromActivity = 0;

	for (const [index, rule] of (ruleItems || []).entries()) {
		const activityMatch = activityByRule.get(String(rule.text || '').trim().toLowerCase());
		let owner = activityMatch
			? roster.find(member => member.email.toLowerCase() === activityMatch.email)
			: null;
		let addedAtIso = activityMatch?.timestampIso || null;
		let inferredAttribution = true;

		if (owner && addedAtIso) {
			attributedFromActivity += 1;
			inferredAttribution = false;
		} else {
			owner = roster[stableRuleIndex(`${rule.text}:${rule.tag}`, roster.length)];
			const daysAgo = 1 + stableRuleIndex(rule.text, 21);
			addedAtIso = new Date(now - (daysAgo * 24 * 60 * 60 * 1000) - (index * 45 * 60 * 1000)).toISOString();
		}

		owner.rules.push({
			id: rule.id || `user-rule-${index}`,
			tag: rule.tag || 'general',
			text: rule.text,
			source: rule.source || 'memwal',
			legacy: Boolean(rule.legacy),
			addedAtIso,
			inferredAttribution,
		});
	}

	const contributors = roster
		.map(user => ({
			...user,
			ruleCount: user.rules.length,
			rules: user.rules
				.slice()
				.sort((a, b) => new Date(b.addedAtIso).getTime() - new Date(a.addedAtIso).getTime()),
		}))
		.filter(user => user.ruleCount > 0)
		.sort((a, b) => b.ruleCount - a.ruleCount || a.displayName.localeCompare(b.displayName));

	return {
		attributionMode: attributedFromActivity > 0 ? 'mixed' : 'inferred',
		attributionNote: attributedFromActivity > 0
			? 'Some rules were matched to members from activity rows. Remaining rules use inferred ownership until MemWal stores author metadata.'
			: 'Per-user ownership is inferred for display until MemWal stores author metadata on each memory.',
		totalRules: ruleItems.length,
		contributorCount: contributors.length,
		contributors,
	};
}

function buildDashboard(org, bundle) {
	const mergedRules = mergeRuleSources(bundle.liveRules, bundle.ruleRow);
	const rules = mergedRules.records;
	const ruleItems = rules.map((rule, index) => ({ id: `rule-${index}`, ...rule }));
	const ruleInsights = buildRuleInsights(rules, mergedRules.diagnostics.duplicateCount, mergedRules.diagnostics.duplicateSamples);
	const realActivity = bundle.activity;
	const systemSignals = buildDerivedActivity(org, bundle, rules);
	const activityInsights = buildActivityInsights(realActivity);
	const repositoryInsights = buildRepositoryInsights(realActivity);
	const userInsights = buildUserInsights(realActivity, bundle.members);
	const memberCount = bundle.members.length;
	const activeMembers = new Set(realActivity.map(row => row.actor_email).filter(Boolean)).size;
	const memwalEnabled = Boolean(bundle.health?.memwal?.enabled);
	const storageMode = bundle.liveRules.storage || (bundle.ruleRow?.walrus_blob_id ? 'memwal' : 'database');
	const memoryState = memwalEnabled && storageMode === 'memwal'
		? 'Semantic'
		: memwalEnabled ? 'Ready' : 'Fallback';

	return {
		generatedAtIso: nowIso(),
		org,
		health: {
			orgApi: Boolean(bundle.health?.ok),
			memwalEnabled,
			memwal: bundle.health?.memwal || null,
			supabase: supabaseConfigured,
			storageMode,
		},
		scorecards: [
			{ label: 'Team members', value: memberCount, tone: 'blue', detail: activeMembers ? `${activeMembers} active member${activeMembers === 1 ? '' : 's'} in recent activity` : 'Members synced from Supabase' },
			{ label: 'Rules learned', value: ruleInsights.unique, tone: 'green', detail: ruleInsights.unique ? `${mergedRules.diagnostics.liveCount} active team rules` : 'No rules found for this selected workspace' },
			{ label: 'User activity', value: activityInsights.total, tone: 'coral', detail: activityInsights.total ? `${activityInsights.byKind.length} event type${activityInsights.byKind.length === 1 ? '' : 's'} tracked` : 'No matching user_activity rows yet' },
			{ label: 'Memory layer', value: memoryState, tone: memwalEnabled ? 'violet' : 'amber', detail: storageMode === 'memwal' ? 'Rules recalled through MemWal' : 'MemWal connected; database cache is the active fallback' },
		],
		sourceDiagnostics: {
			rules: mergedRules.diagnostics,
			activity: bundle.activityDiagnostics || { orgApiCount: 0, orgActivityCount: 0, userActivityCount: 0, userActivityMode: 'unknown', mergedCount: 0 },
		},
		rules: {
			items: ruleItems,
			insights: ruleInsights,
			diagnostics: mergedRules.diagnostics,
			version: bundle.liveRules.version ?? bundle.ruleRow?.version ?? 0,
			updatedAtIso: bundle.liveRules.updatedAtIso ?? bundle.ruleRow?.updated_at ?? null,
			walrusBlobId: bundle.liveRules.walrusBlobId ?? bundle.ruleRow?.walrus_blob_id ?? null,
		},
		userRules: buildUserLevelRules(ruleItems, bundle.members, realActivity),
		members: bundle.members.map(row => ({
			id: row.id,
			userId: row.user_id,
			email: row.email,
			displayName: row.display_name,
			role: row.role,
			joinedAtIso: row.joined_at,
			activityCount: realActivity.filter(a => a.actor_email === row.email || a.user_id === row.user_id).length,
		})),
		activity: {
			items: realActivity.map(row => ({
				id: row.id,
				kind: row.kind,
				summary: row.summary,
				actorEmail: row.actor_email,
				actorDisplayName: row.actor_display_name,
				timestampIso: row.created_at,
				metadata: row.metadata || {},
				derived: Boolean(row.metadata?.derived),
			})),
			insights: activityInsights,
			diagnostics: bundle.activityDiagnostics || { orgApiCount: 0, orgActivityCount: 0, userActivityCount: 0, userActivityMode: 'unknown', mergedCount: 0 },
			systemSignals: systemSignals.map(row => ({
				id: row.id,
				kind: row.kind,
				summary: row.summary,
				actorEmail: row.actor_email,
				actorDisplayName: row.actor_display_name,
				timestampIso: row.created_at,
				metadata: row.metadata || {},
				derived: true,
			})),
		},
		repositories: repositoryInsights,
		users: userInsights,
		recommendations: buildRecommendations(ruleInsights, activityInsights, bundle),
	};
}

function buildRecommendations(ruleInsights, activityInsights, bundle) {
	const out = [];
	if (!bundle.health?.memwal?.enabled) {
		out.push({ severity: 'warning', title: 'MemWal is not enabled', detail: 'Rules are using the database fallback. Configure MemWal credentials for durable semantic recall.' });
	}
	if (ruleInsights.duplicates > 0) {
		out.push({ severity: 'warning', title: 'Duplicate rules detected', detail: `${ruleInsights.duplicates} recalled rules appear duplicated. Rotate the namespace or clean older memories.` });
	}
	if (ruleInsights.lowQuality > 0) {
		out.push({ severity: 'danger', title: 'Low-quality rules detected', detail: 'Some rules look malformed or too vague. Review them before injecting into AI context.' });
	}
	if (ruleInsights.unique === 0) {
		out.push({ severity: 'info', title: 'No rules for this workspace', detail: 'The selected organization has no merged rules from live MemWal/org-api recall or the Supabase rule cache.' });
	} else if (!ruleInsights.categories.some(c => c.name === 'testing')) {
		out.push({ severity: 'info', title: 'Testing rules are missing', detail: 'Teams usually benefit from explicit testing expectations.' });
	}
	if (activityInsights.total === 0) {
		out.push({ severity: 'info', title: 'No matching activity rows', detail: 'No org activity or user_activity rows matched this workspace and its members yet.' });
	}
	return out.slice(0, 6);
}

async function handleApi(req, res, url) {
	if (!requireSupabase(res)) {
		return;
	}

	if (req.method === 'POST' && url.pathname === '/api/login') {
		const body = await readJson(req);
		const email = String(body.email || '').trim().toLowerCase();
		if (!email || !email.includes('@')) {
			sendError(res, 400, 'Enter a valid email address.');
			return;
		}
		const memberships = await getMembershipsByEmail(email);
		if (memberships.length === 0) {
			sendError(res, 403, 'That email is not a member of any Neptor organization.');
			return;
		}
		const orgs = memberships.map(m => ({
			id: m.organizations.id,
			name: m.organizations.name,
			slug: m.organizations.slug,
			description: m.organizations.description,
			role: m.role,
			memberId: m.id,
			displayName: m.display_name,
			createdAtIso: m.organizations.created_at,
		}));
		const activeOrgId = resolveDefaultOrgId(orgs);
		const token = randomUUID();
		sessions.set(hashToken(token), {
			email,
			displayName: memberships[0].display_name,
			orgs,
			activeOrgId,
			createdAt: Date.now(),
			lastSeenAt: Date.now(),
			expiresAt: Date.now() + 1000 * 60 * 60 * 12,
		});
		setSessionCookie(res, token);
		sendJson(res, 200, { user: { email, displayName: memberships[0].display_name }, orgs, activeOrgId });
		return;
	}

	if (req.method === 'POST' && url.pathname === '/api/logout') {
		const token = parseCookies(req).get('neptor_dashboard_session');
		if (token) {
			sessions.delete(hashToken(token));
		}
		clearSessionCookie(res);
		sendJson(res, 200, { ok: true });
		return;
	}

	const session = await requireSession(req, res);
	if (!session) {
		return;
	}

	if (req.method === 'GET' && url.pathname === '/api/session') {
		session.activeOrgId = resolveSessionActiveOrgId(session);
		sendJson(res, 200, {
			user: { email: session.email, displayName: session.displayName },
			orgs: session.orgs,
			activeOrgId: session.activeOrgId,
		});
		return;
	}

	if (req.method === 'POST' && url.pathname === '/api/session/active-org') {
		const body = await readJson(req);
		const orgId = String(body.orgId || '').trim();
		if (!orgId) {
			sendError(res, 400, 'Organization id is required.');
			return;
		}
		try {
			const org = await getAllowedOrg(session, orgId);
			session.activeOrgId = org.id;
			sendJson(res, 200, { activeOrgId: session.activeOrgId });
		} catch {
			sendError(res, 403, 'You do not have access to that organization.');
		}
		return;
	}

	if (req.method === 'GET' && url.pathname === '/api/dashboard') {
		const orgId = url.searchParams.get('orgId') || session.activeOrgId;
		const org = await getAllowedOrg(session, orgId);
		const bundle = await loadOrgBundle(orgId);
		sendJson(res, 200, buildDashboard(org, bundle));
		return;
	}

	if (req.method === 'GET' && url.pathname === '/api/memwal/inspect') {
		const orgId = url.searchParams.get('orgId') || session.activeOrgId;
		await getAllowedOrg(session, orgId);
		const query = url.searchParams.get('query') || 'team coding guidelines';
		const data = await fetchOrgApi(`/v1/orgs/${encodeURIComponent(orgId)}/rules`);
		sendJson(res, 200, {
			query,
			orgId,
			storage: data.storage,
			walrusBlobId: data.walrusBlobId,
			results: (data.rules || []).map((text, index) => ({ id: index, text, ...parseTaggedRule(text) })),
			raw: data,
		});
		return;
	}

	if (req.method === 'POST' && url.pathname === '/api/rules/reset') {
		const body = await readJson(req);
		const orgId = String(body.orgId || session.activeOrgId);
		const org = await getAllowedOrg(session, orgId);
		if (!['owner', 'admin'].includes(org.role)) {
			sendError(res, 403, 'Only owners and admins can reset rules.');
			return;
		}
		await supabaseRest(`org_rules?org_id=eq.${q(orgId)}`, {
			method: 'PATCH',
			body: JSON.stringify({ rules: [], walrus_blob_id: null, updated_at: nowIso() }),
		});
		sendJson(res, 200, { ok: true, message: 'Supabase rule cache cleared. Rotate MemWal namespace from org-api for a full reset.' });
		return;
	}

	sendError(res, 404, 'Not found');
}

function serveStatic(req, res, pathname) {
	const safePath = pathname === '/' ? '/index.html' : pathname;
	const target = resolve(join(publicDir, safePath));
	if (!target.startsWith(publicDir) || !existsSync(target) || !statSync(target).isFile()) {
		const fallback = resolve(publicDir, 'index.html');
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		createReadStream(fallback).pipe(res);
		return;
	}
	res.writeHead(200, {
		'Content-Type': memoryType[extname(target)] || 'application/octet-stream',
	});
	createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url || '/', `http://localhost:${PORT}`);
	try {
		if (url.pathname.startsWith('/api/')) {
			await handleApi(req, res, url);
			return;
		}
		serveStatic(req, res, url.pathname);
	} catch (e) {
		console.error(e);
		sendError(res, 500, e instanceof Error ? e.message : String(e));
	}
});

function listen(port, allowFallback = true) {
	server.once('error', err => {
		if (err?.code === 'EADDRINUSE' && allowFallback) {
			const nextPort = port + 1;
			console.warn(`Port ${port} is already in use. Trying ${nextPort}...`);
			listen(nextPort, false);
			return;
		}
		console.error(err?.code === 'EADDRINUSE'
			? `Port ${port} is already in use. Set PORT=${port + 1} npm start or stop the process using ${port}.`
			: err);
		process.exit(1);
	});
	server.listen(port, () => {
		console.log(`Neptor Dashboard Web listening on http://localhost:${port}`);
		console.log(`Org API: ${ORG_API_URL}`);
	});
}

listen(PORT);
