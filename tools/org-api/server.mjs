/*--------------------------------------------------------------------------------------
 *  Neptor org API — Supabase backend for team rules, activity, org sync.
 *  Credentials stay here; Neptor only calls this HTTP API.
 *--------------------------------------------------------------------------------------*/

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile() {
	const envPath = resolve(__dirname, '.env');
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

function errorMessage(e) {
	if (e instanceof Error) {
		return e.message;
	}
	if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') {
		return e.message;
	}
	return String(e);
}

loadEnvFile();

const {
	isMemWalEnabled,
	getMemWalStatus,
	readRulesFromMemWal,
	writeNewRulesToMemWal,
} = await import('./memWalRules.mjs');


const PORT = Number(process.env.PORT || 8788);
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
	? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
	: null;

function corsHeaders() {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'Content-Type, X-Neptor-User-Id, X-Neptor-User-Email, X-Neptor-Display-Name',
		'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
	};
}

function sendJson(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders() });
	res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
	let raw = '';
	for await (const chunk of req) {
		raw += chunk;
	}
	if (!raw.trim()) {
		return {};
	}
	return JSON.parse(raw);
}

function actorFromHeaders(req) {
	return {
		userId: req.headers['x-neptor-user-id']?.toString() || null,
		email: req.headers['x-neptor-user-email']?.toString() || null,
		displayName: req.headers['x-neptor-display-name']?.toString() || 'Teammate',
	};
}

function normalizeRule(rule) {
	return String(rule || '').trim().replace(/\s+/g, ' ');
}

function ruleText(rule) {
	return typeof rule === 'object' && rule !== null && typeof rule.text === 'string'
		? rule.text
		: String(rule || '');
}

function isUsableRule(rule) {
	const normalized = normalizeRule(rule).toLowerCase();
	if (!normalized) {
		return false;
	}
	return !/^[a-z]{20,}$/.test(normalized);
}

function ruleKey(rule) {
	return normalizeRule(rule).toLowerCase();
}

function normalizeCategory(category) {
	const c = String(category || 'general').trim().toLowerCase();
	const aliases = new Map([
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
	const mapped = aliases.get(c) ?? c;
	const valid = new Set([
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
	return valid.has(mapped) ? mapped : 'general';
}

function normalizeIncomingRule(item) {
	if (typeof item === 'string') {
		const text = normalizeRule(item);
		return isUsableRule(text) ? { text, category: 'general' } : null;
	}
	if (item && typeof item === 'object' && typeof item.text === 'string') {
		const text = normalizeRule(item.text);
		return isUsableRule(text) ? { text, category: normalizeCategory(item.category) } : null;
	}
	return null;
}

function normalizeIncomingRules(rules) {
	return (Array.isArray(rules) ? rules : [])
		.map(normalizeIncomingRule)
		.filter(Boolean);
}

function mergeRules(existing, incoming) {
	const map = new Map();
	for (const r of existing) {
		const n = normalizeRule(ruleText(r));
		if (n) {
			map.set(ruleKey(n), {
				text: n,
				category: normalizeCategory(typeof r === 'object' && r !== null ? r.category : 'general'),
			});
		}
	}
	const newlyAdded = [];
	for (const item of incoming) {
		const n = normalizeRule(item.text);
		if (!n) {
			continue;
		}
		const k = ruleKey(n);
		if (!map.has(k)) {
			const rule = { text: n, category: normalizeCategory(item.category) };
			map.set(k, rule);
			newlyAdded.push(rule);
		}
	}
	return { rules: [...map.values()], newlyAdded, added: newlyAdded.length };
}

async function upsertOrg(body) {
	const { id, name, slug, description, ownerId, createdAtIso, updatedAtIso } = body;
	if (!id || !name || !ownerId) {
		throw new Error('id, name, and ownerId are required');
	}
	const row = {
		id,
		name,
		slug: slug || id,
		description: description || '',
		owner_user_id: ownerId,
		created_at: createdAtIso || new Date().toISOString(),
		updated_at: updatedAtIso || new Date().toISOString(),
	};
	const { error } = await supabase.from('organizations').upsert(row, { onConflict: 'id' });
	if (error) {
		throw error;
	}
	await supabase.from('org_rules').upsert({
		org_id: id,
		rules: [],
		version: 1,
		updated_at: new Date().toISOString(),
	}, { onConflict: 'org_id', ignoreDuplicates: true });
	return row;
}

async function ensureOrgExists(orgId, fallback = {}) {
	const { data, error } = await supabase
		.from('organizations')
		.select('id')
		.eq('id', orgId)
		.maybeSingle();
	if (error) {
		throw error;
	}
	if (data?.id) {
		return;
	}
	const now = new Date().toISOString();
	const name = fallback.name || fallback.orgName || orgId;
	const ownerId = fallback.ownerId || fallback.userId || 'unknown';
	const { error: insertError } = await supabase.from('organizations').upsert({
		id: orgId,
		name,
		slug: fallback.slug || String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || orgId,
		description: fallback.description || '',
		owner_user_id: ownerId,
		created_at: fallback.createdAtIso || now,
		updated_at: fallback.updatedAtIso || now,
	}, { onConflict: 'id' });
	if (insertError) {
		throw insertError;
	}
	await supabase.from('org_rules').upsert({
		org_id: orgId,
		rules: [],
		version: 1,
		updated_at: now,
	}, { onConflict: 'org_id', ignoreDuplicates: true });
}

async function upsertMember(body) {
	const { id, orgId, userId, email, displayName, role, joinedAtIso } = body;
	if (!orgId || !userId || !email) {
		throw new Error('orgId, userId, and email are required');
	}
	await ensureOrgExists(orgId, {
		name: body.orgName,
		slug: body.orgSlug,
		description: body.orgDescription,
		ownerId: role === 'owner' ? userId : body.ownerId,
		userId,
	});
	const row = {
		id: id || `member-${randomUUID()}`,
		org_id: orgId,
		user_id: userId,
		email: email.toLowerCase(),
		display_name: displayName || email.split('@')[0],
		role: role || 'member',
		joined_at: joinedAtIso || new Date().toISOString(),
	};
	const { error } = await supabase.from('org_members').upsert(row, { onConflict: 'org_id,user_id' });
	if (error) {
		throw error;
	}
	return row;
}

function mapOrg(row) {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		description: row.description || '',
		ownerId: row.owner_user_id,
		createdAtIso: row.created_at,
		updatedAtIso: row.updated_at,
	};
}

function mapMember(row) {
	return {
		id: row.id,
		orgId: row.org_id,
		userId: row.user_id,
		email: row.email,
		displayName: row.display_name,
		role: row.role,
		joinedAtIso: row.joined_at,
	};
}

async function listMyOrganizations(actorEmail) {
	const email = String(actorEmail || '').trim().toLowerCase();
	if (!email || !email.includes('@')) {
		throw new Error('A valid X-Neptor-User-Email header is required.');
	}

	const { data: membershipRows, error: membershipError } = await supabase
		.from('org_members')
		.select('*')
		.ilike('email', email);
	if (membershipError) {
		throw membershipError;
	}

	const memberOrgIds = [...new Set((membershipRows || []).map(row => row.org_id))];

	const { data: incomingInviteRows, error: incomingInviteError } = await supabase
		.from('org_invites')
		.select('*')
		.ilike('email', email)
		.eq('status', 'pending');
	if (incomingInviteError) {
		throw incomingInviteError;
	}

	const inviteOrgIds = [...new Set((incomingInviteRows || []).map(row => row.org_id))];
	const allOrgIds = [...new Set([...memberOrgIds, ...inviteOrgIds])];

	let orgRows = [];
	if (allOrgIds.length) {
		const { data, error } = await supabase
			.from('organizations')
			.select('*')
			.in('id', allOrgIds);
		if (error) {
			throw error;
		}
		orgRows = data || [];
	}

	let allMemberRows = [];
	if (allOrgIds.length) {
		const { data, error } = await supabase
			.from('org_members')
			.select('*')
			.in('org_id', allOrgIds)
			.order('joined_at', { ascending: true });
		if (error) {
			throw error;
		}
		allMemberRows = data || [];
	}

	let allInviteRows = [];
	if (allOrgIds.length) {
		const { data, error } = await supabase
			.from('org_invites')
			.select('*')
			.in('org_id', allOrgIds)
			.order('sent_at', { ascending: false });
		if (error) {
			throw error;
		}
		allInviteRows = data || [];
	}

	return {
		organizations: orgRows.map(mapOrg),
		members: allMemberRows.map(mapMember),
		invites: allInviteRows.map(mapInvite),
	};
}

async function listMembers(orgId) {
	const { data, error } = await supabase
		.from('org_members')
		.select('*')
		.eq('org_id', orgId)
		.order('joined_at', { ascending: true });
	if (error) {
		throw error;
	}
	return (data || []).map(mapMember);
}

function mapInvite(row) {
	return {
		id: row.id,
		orgId: row.org_id,
		email: row.email,
		role: row.role,
		token: row.token,
		status: row.status,
		invitedByUserId: row.invited_by_user_id,
		sentAtIso: row.sent_at,
		expiresAtIso: row.expires_at,
		acceptedAtIso: row.accepted_at || undefined,
		rejectedAtIso: row.rejected_at || undefined,
	};
}

async function upsertInvite(orgId, body) {
	const email = String(body.email || '').trim().toLowerCase();
	if (!email) {
		throw new Error('email is required');
	}
	const status = body.status || 'pending';
	const row = {
		id: body.id || `invite-${randomUUID()}`,
		org_id: orgId,
		email,
		role: body.role || 'member',
		token: body.token || randomUUID(),
		status,
		invited_by_user_id: body.invitedByUserId || body.invited_by_user_id || null,
		sent_at: body.sentAtIso || body.sent_at || new Date().toISOString(),
		expires_at: body.expiresAtIso || body.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		accepted_at: body.acceptedAtIso || body.accepted_at || null,
		rejected_at: body.rejectedAtIso || body.rejected_at || null,
		revoked_at: body.revokedAtIso || body.revoked_at || null,
		updated_at: new Date().toISOString(),
	};
	const { data, error } = await supabase
		.from('org_invites')
		.upsert(row, { onConflict: 'id' })
		.select('*')
		.single();
	if (error) {
		throw error;
	}
	return mapInvite(data);
}

async function listInvites(orgId) {
	const { data, error } = await supabase
		.from('org_invites')
		.select('*')
		.eq('org_id', orgId)
		.order('sent_at', { ascending: false });
	if (error) {
		throw error;
	}
	return (data || []).map(mapInvite);
}

async function updateInvite(orgId, inviteId, body) {
	const status = body.status;
	if (!status) {
		throw new Error('status is required');
	}
	const now = new Date().toISOString();
	const patch = {
		status,
		updated_at: now,
	};
	if (status === 'accepted') {
		patch.accepted_at = body.acceptedAtIso || now;
	}
	if (status === 'rejected') {
		patch.rejected_at = body.rejectedAtIso || now;
	}
	if (status === 'revoked') {
		patch.revoked_at = body.revokedAtIso || now;
	}
	const { data, error } = await supabase
		.from('org_invites')
		.update(patch)
		.eq('org_id', orgId)
		.eq('id', inviteId)
		.select('*')
		.single();
	if (error) {
		throw error;
	}
	return mapInvite(data);
}

async function getRules(orgId) {
	const { data, error } = await supabase.from('org_rules').select('*').eq('org_id', orgId).maybeSingle();
	if (error) {
		throw error;
	}
	if (!data) {
		return { orgId, rules: [], version: 0, updatedAtIso: null, storage: 'none', walrusBlobId: null };
	}

	let rules = data.rules || [];
	let version = data.version ?? 0;
	let updatedAtIso = data.updated_at;
	let storage = 'database';

	if (isMemWalEnabled()) {
		const memwalData = await readRulesFromMemWal(orgId);
		if (memwalData?.rules?.length) {
			rules = memwalData.rules;
			updatedAtIso = memwalData.updatedAtIso || updatedAtIso;
			storage = 'memwal';
		}
	}

	return {
		orgId,
		rules,
		version,
		updatedAtIso,
		storage,
		walrusBlobId: data.walrus_blob_id || null,
	};
}

async function mergeOrgRules(orgId, incomingRules) {
	const incoming = normalizeIncomingRules(incomingRules);
	const current = await getRules(orgId);
	const { rules, newlyAdded, added } = mergeRules(current.rules, incoming);
	const version = (current.version || 0) + (added > 0 ? 1 : 0);
	const updated_at = new Date().toISOString();

	let walrus_blob_id = current.walrusBlobId || null;
	let storage = 'database';

	if (added > 0 && isMemWalEnabled()) {
		const memwalResult = await writeNewRulesToMemWal(orgId, newlyAdded);
		if (memwalResult?.blobId) {
			walrus_blob_id = memwalResult.blobId;
			storage = 'memwal';
		} else {
			console.warn(`[org-api] MemWal write skipped for ${orgId}; saving rules to Supabase only`);
		}
	}

	const { error } = await supabase.from('org_rules').upsert({
		org_id: orgId,
		rules,
		walrus_blob_id,
		version,
		updated_at,
	}, { onConflict: 'org_id' });
	if (error) {
		throw error;
	}
	return { orgId, rules, version, added, updatedAtIso: updated_at, storage, walrusBlobId: walrus_blob_id };
}

async function insertActivity(orgId, req, body) {
	const actor = actorFromHeaders(req);
	await ensureOrgExists(orgId, {
		name: body.orgName,
		slug: body.orgSlug,
		description: body.orgDescription,
		ownerId: body.ownerId,
		userId: body.userId || actor.userId,
	});
	const row = {
		id: body.id || `act-${randomUUID()}`,
		org_id: orgId,
		user_id: body.userId || actor.userId,
		actor_email: body.email || actor.email,
		actor_display_name: body.displayName || actor.displayName,
		kind: body.kind || 'team_event',
		summary: body.summary || 'Activity',
		metadata: body.metadata || {},
		created_at: body.createdAtIso || new Date().toISOString(),
	};
	const { error } = await supabase.from('org_activity').insert(row);
	if (error) {
		throw error;
	}
	return row;
}

async function listActivity(orgId, limit) {
	const { data, error } = await supabase
		.from('org_activity')
		.select('*')
		.eq('org_id', orgId)
		.order('created_at', { ascending: false })
		.limit(limit);
	if (error) {
		throw error;
	}
	return (data || []).map(row => ({
		id: row.id,
		orgId: row.org_id,
		userId: row.user_id,
		actor: {
			id: row.user_id || row.id,
			displayName: row.actor_display_name,
			email: row.actor_email,
		},
		kind: row.kind,
		summary: row.summary,
		metadata: row.metadata || {},
		timestampIso: row.created_at,
	}));
}

const server = http.createServer(async (req, res) => {
	if (req.method === 'OPTIONS') {
		res.writeHead(204, corsHeaders());
		res.end();
		return;
	}

	if (!supabase) {
		sendJson(res, 503, { error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in tools/org-api/.env' });
		return;
	}

	const url = new URL(req.url || '/', `http://localhost:${PORT}`);
	const path = url.pathname;

	try {
		if (req.method === 'GET' && path === '/health') {
			sendJson(res, 200, {
				ok: true,
				memwal: getMemWalStatus(),
				walrus: getMemWalStatus(),
				supabase: Boolean(supabase),
			});
			return;
		}

		if (req.method === 'GET' && path === '/v1/my-orgs') {
			const actor = actorFromHeaders(req);
			if (!actor.email) {
				sendJson(res, 400, { error: 'Missing X-Neptor-User-Email header.' });
				return;
			}
			const bundle = await listMyOrganizations(actor.email);
			sendJson(res, 200, bundle);
			return;
		}

		if (req.method === 'PUT' && path === '/v1/orgs') {
			const body = await readJsonBody(req);
			const org = await upsertOrg(body);
			sendJson(res, 200, { org: mapOrg(org) });
			return;
		}

		if (req.method === 'PUT' && path === '/v1/members') {
			const body = await readJsonBody(req);
			const member = await upsertMember(body);
			sendJson(res, 200, { member });
			return;
		}

		const membersList = path.match(/^\/v1\/orgs\/([^/]+)\/members$/);
		if (req.method === 'GET' && membersList) {
			const members = await listMembers(membersList[1]);
			sendJson(res, 200, { members });
			return;
		}

		const rulesGet = path.match(/^\/v1\/orgs\/([^/]+)\/rules$/);
		if (req.method === 'GET' && rulesGet) {
			const rules = await getRules(rulesGet[1]);
			sendJson(res, 200, rules);
			return;
		}

		const rulesMerge = path.match(/^\/v1\/orgs\/([^/]+)\/rules\/merge$/);
		if (req.method === 'POST' && rulesMerge) {
			const body = await readJsonBody(req);
			const result = await mergeOrgRules(rulesMerge[1], body.rules || []);
			sendJson(res, 200, result);
			return;
		}

		const inviteList = path.match(/^\/v1\/orgs\/([^/]+)\/invites$/);
		if (req.method === 'GET' && inviteList) {
			const invites = await listInvites(inviteList[1]);
			sendJson(res, 200, { invites });
			return;
		}

		if (req.method === 'POST' && inviteList) {
			const body = await readJsonBody(req);
			const invite = await upsertInvite(inviteList[1], body);
			sendJson(res, 201, { invite });
			return;
		}

		const inviteUpdate = path.match(/^\/v1\/orgs\/([^/]+)\/invites\/([^/]+)$/);
		if (req.method === 'PATCH' && inviteUpdate) {
			const body = await readJsonBody(req);
			const invite = await updateInvite(inviteUpdate[1], inviteUpdate[2], body);
			sendJson(res, 200, { invite });
			return;
		}

		const activityList = path.match(/^\/v1\/orgs\/([^/]+)\/activity$/);
		if (req.method === 'GET' && activityList) {
			const limit = Math.min(100, Number(url.searchParams.get('limit') || 50));
			const events = await listActivity(activityList[1], limit);
			sendJson(res, 200, { events });
			return;
		}

		if (req.method === 'POST' && activityList) {
			const body = await readJsonBody(req);
			const event = await insertActivity(activityList[1], req, body);
			sendJson(res, 201, { event });
			return;
		}

		sendJson(res, 404, { error: 'Not found' });
	} catch (e) {
		const message = errorMessage(e);
		console.error('[org-api]', message);
		sendJson(res, 500, { error: message });
	}
});

server.listen(PORT, () => {
	console.log(`Neptor org API listening on http://localhost:${PORT}`);
	if (!supabase) {
		console.warn('WARNING: Supabase not configured. Copy .env.example to .env and add credentials.');
	}
	const memwal = getMemWalStatus();
	if (memwal.enabled) {
		console.log(`MemWal rules storage: ${memwal.serverUrl} account ${memwal.accountId}`);
	} else {
		console.warn('WARNING: MemWal disabled. Set MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID in .env.');
	}
});
