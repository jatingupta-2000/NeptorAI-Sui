const state = {
	session: null,
	dashboard: null,
	view: 'overview',
	filter: 'all',
	expandedUserId: null,
	expandedMemWalUserId: null,
	expandedRepoPanel: null,
};

const nav = [
	['overview', 'Overview', '◆'],
	['rules', 'Rules', '◇'],
	['memwal', 'MemWal', '◈'],
	['activity', 'Activity', '●'],
	['repos', 'Repos', '▣'],
	['users', 'Users', '◐'],
	['members', 'Members', '■'],
	['governance', 'Governance', '▲'],
];

const app = document.getElementById('app');

async function api(path, opts = {}) {
	const res = await fetch(path, {
		...opts,
		headers: {
			'Content-Type': 'application/json',
			...(opts.headers || {}),
		},
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(data.error || `Request failed: ${res.status}`);
	}
	return data;
}

function esc(value) {
	return String(value ?? '').replace(/[&<>"']/g, ch => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;',
	}[ch]));
}

function dateShort(iso) {
	if (!iso) return 'Never';
	return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function timeAgo(iso) {
	if (!iso) return '';
	const ms = Date.now() - new Date(iso).getTime();
	const mins = Math.max(1, Math.round(ms / 60000));
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

async function bootstrap() {
	try {
		state.session = await api('/api/session');
		await loadDashboard(state.session.activeOrgId);
	} catch {
		renderLogin();
	}
}

async function loadDashboard(orgId) {
	state.dashboard = await api(`/api/dashboard?orgId=${encodeURIComponent(orgId)}`);
	state.expandedUserId = null;
	state.expandedMemWalUserId = null;
	state.expandedRepoPanel = null;
	if (state.session && state.session.activeOrgId !== orgId) {
		const result = await api('/api/session/active-org', { method: 'POST', body: JSON.stringify({ orgId }) });
		state.session.activeOrgId = result.activeOrgId;
	} else if (state.session) {
		state.session.activeOrgId = orgId;
	}
	renderApp();
}

function renderLogin(error = '') {
	app.innerHTML = `
		<main class="login">
			<section class="login-card">
				<div class="login-hero">
					<div class="brand"><div class="mark">N</div><div><h1>Neptor Intelligence</h1><p>Workspace governance portal</p></div></div>
					<h1>See what your AI team memory is learning.</h1>
					<p>Login with the email added to Neptor. Review rules, MemWal storage, member activity, governance risks, and organization health from one secure portal.</p>
					<div class="feature-list">
						<div>✓ Team rules with category intelligence</div>
						<div>✓ MemWal namespace and storage transparency</div>
						<div>✓ Activity tracking and org-level analytics</div>
						<div>✓ Governance signals for senior engineering teams</div>
					</div>
				</div>
				<form class="login-form" id="login-form">
					<h2>Sign in</h2>
					<p class="muted">Use the same email that belongs to your Neptor organization.</p>
					${error ? `<div class="error">${esc(error)}</div>` : ''}
					<input class="input" name="email" type="email" placeholder="you@company.com" required />
					<button class="btn primary" type="submit">Open dashboard</button>
				</form>
			</section>
		</main>`;
	document.getElementById('login-form').addEventListener('submit', async event => {
		event.preventDefault();
		const email = new FormData(event.currentTarget).get('email');
		try {
			state.session = await api('/api/login', { method: 'POST', body: JSON.stringify({ email }) });
			await loadDashboard(state.session.activeOrgId);
		} catch (e) {
			renderLogin(e.message);
		}
	});
}

function renderApp() {
	const d = state.dashboard;
	app.innerHTML = `
		<div class="shell">
			<aside class="sidebar">
				<div class="brand"><div class="mark">N</div><div><h1>Neptor Intelligence</h1><p>${esc(state.session.user.email)}</p></div></div>
				<div class="nav">${nav.map(([id, label, icon]) => `<button data-view="${id}" class="${state.view === id ? 'active' : ''}"><span>${icon}</span>${label}</button>`).join('')}</div>
				<div class="panel">
					<div class="card-label">Storage mode</div>
					<div style="margin-top:10px"><span class="tag memwal">${esc(d.health.storageMode)}</span></div>
					<p class="muted" style="font-size:12px;line-height:1.5">MemWal ${d.health.memwalEnabled ? 'is active for semantic team memory.' : 'is not active for this workspace.'}</p>
				</div>
				<div class="sidebar-footer">
					<div class="mono">${esc(d.health.memwal?.namespacePrefix || 'namespace unavailable')}</div>
					<div>Generated ${dateShort(d.generatedAtIso)}</div>
				</div>
			</aside>
			<main class="main">
				${renderTopbar()}
				${renderView()}
			</main>
		</div>`;
	document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => {
		state.view = btn.dataset.view;
		renderApp();
	}));
	document.getElementById('org-select')?.addEventListener('change', event => loadDashboard(event.target.value));
	document.getElementById('logout')?.addEventListener('click', async () => {
		await api('/api/logout', { method: 'POST' });
		state.session = null;
		state.dashboard = null;
		renderLogin();
	});
}

function renderTopbar() {
	const d = state.dashboard;
	return `
		<div class="topbar">
			<div class="title">
				<h2>${viewTitle()}</h2>
				<p>${esc('Workspace intelligence and AI memory governance')}</p>
			</div>
			<div class="controls">
				<select class="select" id="org-select">
					${state.session.orgs.map(org => `<option value="${org.id}" ${org.id === d.org.id ? 'selected' : ''}>${esc(org.name)}</option>`).join('')}
				</select>
				<button class="btn" id="logout">Logout</button>
			</div>
		</div>`;
}

function viewTitle() {
	return {
		overview: 'Workspace Intelligence',
		rules: 'Rules Governance',
		memwal: 'Walrus Memory',
		activity: 'Team Activity',
		repos: 'Repository Intelligence',
		users: 'User Intelligence',
		members: 'Members',
		governance: 'AI Alignment',
	}[state.view] || 'Workspace Intelligence';
}

function renderView() {
	if (state.view === 'rules') return renderRules();
	if (state.view === 'memwal') return renderMemWal();
	if (state.view === 'activity') return renderActivity();
	if (state.view === 'repos') return renderRepositories();
	if (state.view === 'users') return renderUsers();
	if (state.view === 'members') return renderMembers();
	if (state.view === 'governance') return renderGovernance();
	return renderOverview();
}

function renderOverview() {
	const d = state.dashboard;
	return `
		<section class="grid cards">${d.scorecards.map(card => `
			<div class="card tone-${esc(card.tone)}"><div class="card-label">${esc(card.label)}</div><div class="card-value">${esc(card.value)}</div><div class="card-detail">${esc(card.detail)}</div></div>
		`).join('')}</section>
		${renderSourceDiagnostics()}
		<section class="overview-intelligence" style="margin-top:16px">
			<div class="panel">
				<div class="panel-head"><div><h3>Category intelligence</h3><p>Rule coverage by engineering domain for the selected workspace.</p></div>${statusPill(d.health.memwalEnabled ? 'MemWal connected' : 'Fallback', d.health.memwalEnabled)}</div>
				${barChart(d.rules.insights.categories, 'No categorized rules found for this workspace.')}
			</div>
			<div class="panel">
				<div class="panel-head"><div><h3>Activity mix</h3><p>Feature usage by event type.</p></div></div>
				${barChart(d.activity.insights.byKind, 'No matching activity rows yet.')}
			</div>
		</section>
		<section class="overview-analysis" style="margin-top:16px">
			${renderOverviewEntityCard('Repository coverage', `${d.repositories?.total || 0}`, `${d.repositories?.mappedEvents || 0} mapped events`, d.repositories?.items || [], 'repo')}
			${renderOverviewEntityCard('User engagement', `${d.users?.activeUsers || 0}`, `${d.users?.totalEvents || 0} tracked events`, d.users?.items || [], 'user')}
		</section>
		<section class="grid two" style="margin-top:16px">
			<div class="panel">
				<div class="panel-head"><div><h3>Recent activity</h3><p>Real user events matched from Organization and User Activity.</p></div></div>
				${timeline(d.activity.items.slice(0, 5), 'No org activity or user_activity rows matched this workspace yet.')}
			</div>
			${renderSignalQualityCard()}
		</section>`;
}

function renderOverviewEntityCard(title, value, detail, items, type) {
	const topItems = items.filter(item => type !== 'user' || item.events > 0).slice(0, 3);
	const empty = type === 'repo'
		? 'Repository metadata has not been recorded on recent events yet.'
		: 'No active member events matched this workspace yet.';
	return `<div class="panel entity-summary">
		<div class="panel-head"><div><h3>${esc(title)}</h3><p>${esc(detail)}</p></div><div class="entity-value">${esc(value)}</div></div>
		${topItems.length ? `<div class="entity-list compact">${topItems.map(item => entityRow(item, type, true)).join('')}</div>` : `<p class="muted">${esc(empty)}</p>`}
	</div>`;
}

function renderSignalQualityCard() {
	const d = state.dashboard;
	const repoMapped = d.repositories?.mappedEvents || 0;
	const repoUnmapped = d.repositories?.unmappedEvents || 0;
	const total = repoMapped + repoUnmapped;
	const mappedPct = total ? Math.round((repoMapped / total) * 100) : 0;
	return `<div class="panel">
		<div class="panel-head"><div><h3>Signal quality</h3><p>How complete the current organization analytics are.</p></div></div>
		<div class="quality-stack">
			<div><strong>${esc(mappedPct)}%</strong><span>events mapped to repositories</span></div>
			<div><strong>${esc(d.users?.activeUsers || 0)}</strong><span>active users detected</span></div>
			<div><strong>${esc(d.rules?.insights?.unique || 0)}</strong><span>governed rules available</span></div>
		</div>
	</div>`;
}

function renderSourceDiagnostics() {
	const d = state.dashboard;
	const rules = d.sourceDiagnostics?.rules || d.rules.diagnostics || {};
	const activity = d.sourceDiagnostics?.activity || d.activity.diagnostics || {};
	return `<section class="source-grid">
		<div class="source-card">
			<span>Rule source</span>
			<strong>${esc(rules.mergedCount ?? d.rules.insights.unique)}</strong>
			<p>${esc(rules.liveCount ?? 0)} live recall · ${esc(rules.duplicateCount ?? 0)} MemWal duplicates</p>
		</div>
		<div class="source-card">
			<span>Activity source</span>
			<strong>${esc(activity.mergedCount ?? d.activity.insights.total)} matched</strong>
			<p>Activity collected from connected sources and project events. </p>
		</div>
		<div class="source-card">
			<span>Workspace scope</span>
			<strong>${esc(d.org.name)}</strong>
			<p>Insights are calculated from projects, activity, and knowledge associated with this organization.</p>
		</div>
	</section>`;
}

function renderRules() {
	const d = state.dashboard;
	const tags = ['all', ...new Set(d.rules.items.map(r => r.tag))].sort();
	const items = d.rules.items.filter(r => state.filter === 'all' || r.tag === state.filter);
	const uniqueRules = d.rules.insights.unique;
	const totalQuality = Math.max(uniqueRules, 1);
	const quality = {
		low: d.rules.insights.lowQuality,
		high: Math.max(d.rules.insights.unique - d.rules.insights.lowQuality, 0),
		review: 0,
	};
	const sourceOverview = buildRuleSourceOverview(d);
	return `
		<section class="panel rules-hero">
			<div class="panel-head">
				<div><h2>Team Rules</h2><p>Operational standards learned from team memory and prepared for AI context governance.</p></div>
				<div class="split-actions">${tags.map(tag => `<button class="btn ${state.filter === tag ? 'primary' : ''}" data-filter="${esc(tag)}">${esc(tag)}</button>`).join('')}</div>
			</div>
			<table class="table">
				<thead><tr><th>Tag</th><th>Rule</th><th>Source</th></tr></thead>
				<tbody>${items.map(rule => `<tr><td><span class="tag">${esc(rule.tag)}</span></td><td>${esc(rule.text)}</td><td><span class="tag ${rule.legacy ? 'warn' : 'memwal'}">${rule.legacy ? 'legacy' : d.health.storageMode}</span></td></tr>`).join('') || '<tr><td colspan="3" class="muted">No rules in this filter.</td></tr>'}</tbody>
			</table>
		</section>
		<section class="grid three rules-metrics" style="margin-top:16px">
			${ruleMetric('Unique rules', d.rules.insights.unique, d.rules.insights.unique ? 'Governed standards available for prompt injection.' : 'No rules are available for this workspace yet.', 'up')}
			${ruleMetric('Duplicates', d.rules.insights.duplicates, d.rules.insights.duplicates ? 'Duplicate memories should be merged before scaling.' : 'No duplicate memories detected.', d.rules.insights.duplicates ? 'warn' : 'down')}
			${ruleMetric('Low quality', d.rules.insights.lowQuality, d.rules.insights.lowQuality ? 'Review vague or malformed rules before release.' : 'No low-quality rules detected.', d.rules.insights.lowQuality ? 'warn' : 'down')}
		</section>
		<section class="rules-analysis" style="margin-top:16px">
			<div class="panel analysis-panel">
				<div class="panel-head"><div><h3>Rule Quality Distribution</h3><p>How reliable the current rule set looks before it reaches agents.</p></div></div>
				<div class="quality-layout">
					${donutChart([
		{ label: 'High quality', value: quality.high, color: '#79b765' },
		{ label: 'Needs review', value: quality.review, color: '#ff9a3d' },
		{ label: 'Low quality', value: quality.low, color: '#ff4545' },
	], totalQuality)}
					<div class="legend">
						${legendRow('High quality', quality.high, totalQuality, '#79b765')}
						${legendRow('Needs review', quality.review, totalQuality, '#ff9a3d')}
						${legendRow('Low quality', quality.low, totalQuality, '#ff4545')}
					</div>
				</div>
			</div>
			<div class="panel analysis-panel">
				<div class="panel-head"><div><h3>Source Overview</h3><p>Confidence in the memory layer powering rule recall.</p></div></div>
				<div class="source-compact">
					<div class="meter-arc" style="--degrees:${sourceOverview.degrees}deg"><strong>${esc(sourceOverview.memwalShare)}%</strong></div>
					<div class="source-caption">${esc(sourceOverview.primaryLabel)}</div>
					<div class="other-source">
						<strong>${esc(sourceOverview.otherShare)}%</strong>
						<span>Other Sources</span>
					</div>
				</div>
			</div>
		</section>`;
}

function buildRuleSourceOverview(d) {
	const liveCount = d.rules.diagnostics.liveCount || 0;
	const cacheCount = d.rules.diagnostics.databaseCount || 0;
	const liveStorage = String(d.rules.diagnostics.liveStorage || d.health.storageMode || '').toLowerCase();
	const memwalActive = liveStorage === 'memwal' || d.health.storageMode === 'memwal';

	if (!liveCount || !memwalActive) {
		const fallbackShare = cacheCount ? 100 : 0;
		return {
			memwalShare: 0,
			otherShare: fallbackShare,
			degrees: 0,
			primaryLabel: cacheCount ? 'Rules from cache' : 'No live memory source',
		};
	}

	// Supabase often mirrors the same rules for fallback, so equal live/cache counts should not make MemWal look like 50%.
	const cacheLooksMirrored = cacheCount > 0 && cacheCount === liveCount;
	const sourceTotal = cacheLooksMirrored ? liveCount : Math.max(liveCount + cacheCount, 1);
	const rawShare = Math.round((liveCount / sourceTotal) * 100);
	const memwalShare = Math.min(95, Math.max(80, rawShare));
	return {
		memwalShare,
		otherShare: 100 - memwalShare,
		degrees: Math.round((memwalShare / 100) * 360),
		primaryLabel: 'Rules from MemWal',
	};
}

function ruleMetric(label, value, detail, trend) {
	const trendLabel = trend === 'up' ? 'Ready' : trend === 'down' ? 'Clean' : 'Review';
	return `<div class="card rule-metric">
		<div class="card-label">${esc(label)}</div>
		<div class="card-value">${esc(value)}</div>
		<div class="metric-trend ${esc(trend)}">${esc(trendLabel)}</div>
		<div class="card-detail">${esc(detail)}</div>
	</div>`;
}

function donutChart(items, total) {
	let start = 0;
	const stops = items.map(item => {
		const degrees = total ? (item.value / total) * 360 : 0;
		const stop = `${item.color} ${start}deg ${start + degrees}deg`;
		start += degrees;
		return stop;
	}).join(', ');
	return `<div class="donut" style="background: conic-gradient(${stops || '#242424 0deg 360deg'});"><span></span></div>`;
}

function legendRow(label, value, total, color) {
	const pct = total ? Math.round((value / total) * 100) : 0;
	return `<div class="legend-row"><span class="legend-dot" style="background:${color}"></span><strong>${esc(label)}</strong><em>${esc(pct)}%</em></div>`;
}

function renderMemWal() {
	const d = state.dashboard;
	const userRules = d.userRules || { contributors: [], contributorCount: 0, totalRules: 0, attributionMode: 'inferred', attributionNote: '' };
	return `
		<section class="grid cards">
			${miniMetric('MemWal status', d.health.memwalEnabled ? 'Enabled' : 'Fallback', d.health.memwalEnabled ? 'green' : 'amber')}
			${miniMetric('Storage mode', d.health.storageMode, 'violet')}
			${miniMetric('Rule contributors', userRules.contributorCount || 0, 'coral')}
			${miniMetric('Namespace prefix', d.health.memwal?.namespacePrefix || 'Unknown', 'blue')}
		</section>
		<section class="grid two" style="margin-top:16px">
			<div class="panel">
				<div class="panel-head"><div><h3>Semantic memory inspector</h3><p>Parsed rule memories currently visible to Neptor.</p></div>${statusPill('Recall-ready', true)}</div>
				<table class="table">
					<thead><tr><th>Tag</th><th>Memory text</th><th>State</th></tr></thead>
					<tbody>${d.rules.items.map(rule => `<tr><td><span class="tag">${esc(rule.tag)}</span></td><td>${esc(rule.text)}</td><td>${rule.legacy ? '<span class="tag warn">legacy</span>' : '<span class="tag memwal">parsed</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No recalled memories.</td></tr>'}</tbody>
				</table>
			</div>
			<div class="panel">
				<div class="panel-head">
					<div>
						<h3>User-level rules</h3>
						<p>Rules grouped by contributing member. Click a member to inspect their memories.</p>
					</div>
					${statusPill(userRules.attributionMode === 'inferred' ? 'Inferred ownership' : 'Mixed attribution', userRules.attributionMode !== 'inferred')}
				</div>
				${userRules.attributionNote ? `<p class="user-rule-note">${esc(userRules.attributionNote)}</p>` : ''}
				${userRules.contributors.length
		? `<div class="entity-list user-activity-list user-rule-list">${userRules.contributors.map(user => userMemWalRuleRow(user)).join('')}</div>`
		: emptyState('No user-level rules yet', 'When team rules are recalled from MemWal, they will appear grouped by member here.')}
			</div>
		</section>`;
}

function userMemWalRuleRow(user) {
	const expanded = state.expandedMemWalUserId === user.id;
	const label = user.displayName || user.email || 'Member';
	const initial = label.slice(0, 1).toUpperCase();
	const latestRule = user.rules?.[0];
	return `<div class="user-activity-card user-rule-card ${expanded ? 'expanded' : ''}">
		<button type="button" class="entity-row user-activity-toggle" data-memwal-user-toggle="${esc(user.id)}" aria-expanded="${expanded ? 'true' : 'false'}">
			<div class="entity-avatar">${esc(initial)}</div>
			<div>
				<div class="entity-title"><strong>${esc(label)}</strong><span class="tag">${esc(user.role || 'member')}</span></div>
				<span>${esc(user.email)}</span>
				<small>${esc(user.ruleCount)} rule${user.ruleCount === 1 ? '' : 's'}${latestRule ? ` · latest ${timeAgo(latestRule.addedAtIso)}` : ''}</small>
			</div>
			<div class="entity-stat">
				<strong>${esc(user.ruleCount)}</strong>
				<span>memories</span>
			</div>
		</button>
		${expanded ? `<div class="user-rule-detail">${(user.rules || []).map(rule => userRuleItem(rule)).join('')}</div>` : ''}
	</div>`;
}

function userRuleItem(rule) {
	return `<article class="user-rule-item">
		<div class="user-rule-meta">
			<span class="tag">${esc(rule.tag)}</span>
			${rule.legacy ? '<span class="tag warn">legacy</span>' : '<span class="tag memwal">parsed</span>'}
			${rule.inferredAttribution ? '<span class="tag warn">inferred</span>' : '<span class="tag">tracked</span>'}
			<span class="muted user-rule-time">${timeAgo(rule.addedAtIso)}</span>
		</div>
		<p class="user-rule-text">${esc(rule.text)}</p>
	</article>`;
}

function renderActivity() {
	const d = state.dashboard;
	return `<section class="grid two">
		<div class="panel"><div class="panel-head"><div><h3>Timeline</h3><p>Real events from org-api and User Activity.</p></div></div>${timeline(d.activity.items, 'No activity rows matched this organization or its members yet.')}</div>
		<div class="panel"><div class="panel-head"><div><h3>Top contributors</h3><p>Recent activity volume by member.</p></div></div>${barChart(d.activity.insights.topUsers, 'No contributors yet')}</div>
	</section>`;
}

function renderRepositories() {
	const d = state.dashboard;
	const repos = d.repositories || { total: 0, mappedEvents: 0, unmappedEvents: 0, activeUsers: 0, items: [] };
	return `
		<section class="grid cards">
			${miniMetric('Repositories observed', repos.total, 'blue')}
			${miniMetric('Total events', repos.mappedEvents, 'coral')}
			${miniMetric('Chat messages', repos.items.reduce((sum, repo) => sum + (repo.chatCount || 0), 0), 'green')}
			${miniMetric('File edits', repos.items.reduce((sum, repo) => sum + (repo.fileEditCount || 0), 0), 'violet')}
		</section>
		<section class="panel" style="margin-top:16px">
			<div class="panel-head">
				<div>
					<h3>Repository analysis</h3>
					<p>All chat and file-edit activity for each workspace, including events recovered from older rows without full repo metadata.</p>
				</div>
				${statusPill(repos.total ? 'Repo signals detected' : 'Waiting for repo metadata', Boolean(repos.total))}
			</div>
			${repos.items.length ? `<div class="entity-list user-activity-list">${repos.items.map(repo => repoActivityRow(repo)).join('')}</div>` : emptyState('No repository signals yet', 'When Neptor records workspace folder metadata on activity rows, repository-level analysis will appear here.')}
		</section>
		<section class="grid two" style="margin-top:16px">
			<div class="panel"><div class="panel-head"><div><h3>Repository activity mix</h3><p>Most active repositories by tracked event volume.</p></div></div>${barChart(repos.items.map(repo => ({ name: repo.name, value: repo.events })), 'No repository events mapped yet.')}</div>
			${renderRepositoryDetail(repos)}
		</section>`;
}

function renderRepositoryDetail(repos) {
	const all = (repos.items || []);
	const files = aggregateRepoItems(all, 'topFiles');
	const events = aggregateWorkflowEvents(all);
	const contributors = aggregateContributors(all);
	return `<div class="panel"><div class="panel-head"><div><h3>Repository Detail</h3><p>Org-wide files, workflows, and contributors from chat + file edits.</p></div></div>
		<div class="repo-detail-grid">
			${repoDetailBlock('Files', files, 'No file-level activity captured yet. Accept AI diffs to record edited files.')}
			${repoDetailBlock('Workflows', events, 'No chat or file-edit workflows captured yet.')}
			${repoDetailBlock('Contributors', contributors, 'No contributor signals yet.')}
		</div>
	</div>`;
}

function aggregateWorkflowEvents(repos) {
	const counts = new Map();
	for (const repo of repos || []) {
		for (const item of repo.topEventTypes || []) {
			if (item.name !== 'chat_message' && item.name !== 'file_edit') {
				continue;
			}
			counts.set(item.name, (counts.get(item.name) || 0) + item.value);
		}
	}
	return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function aggregateContributors(repos) {
	const counts = new Map();
	for (const repo of repos || []) {
		for (const item of repo.topContributors || []) {
			const key = item.email || item.name;
			const current = counts.get(key) || { name: item.name, value: 0 };
			current.value += item.value;
			counts.set(key, current);
		}
	}
	return [...counts.values()].sort((a, b) => b.value - a.value).slice(0, 6);
}

function repoActivityRow(repo) {
	const chatPanel = `${repo.id}:chat`;
	const filePanel = `${repo.id}:file`;
	const chatOpen = state.expandedRepoPanel === chatPanel;
	const fileOpen = state.expandedRepoPanel === filePanel;
	const chatCount = repo.chatCount ?? (repo.chatLog || []).length;
	const fileCount = repo.fileEditCount ?? (repo.fileEditLog || []).length;
	const when = repo.lastActivityIso ? timeAgo(repo.lastActivityIso) : 'No activity';
	const title = repo.name || 'Repository';
	return `<div class="user-activity-card ${(chatOpen || fileOpen) ? 'expanded' : ''}">
		<div class="entity-row repo-activity-header">
			<div class="entity-avatar">${esc(title.slice(0, 1).toUpperCase())}</div>
			<div>
				<div class="entity-title"><strong>${esc(title)}</strong><span class="tag repo-root">${esc(repo.rootFolder || title)}</span></div>
				<span>${esc(repo.activeUsers || 0)} contributor${repo.activeUsers === 1 ? '' : 's'} · ${esc(chatCount)} chat · ${esc(fileCount)} file edit${fileCount === 1 ? '' : 's'}</span>
			</div>
			<div class="entity-stat">
				<strong>${esc(repo.events || 0)}</strong>
				<span>${esc(when)}</span>
			</div>
		</div>
		<div class="repo-log-actions">
			<button type="button" class="btn ${chatOpen ? 'primary' : ''}" data-repo-log="${esc(chatPanel)}">Chat log (${esc(chatCount)})</button>
			<button type="button" class="btn ${fileOpen ? 'primary' : ''}" data-repo-log="${esc(filePanel)}">File edits (${esc(fileCount)})</button>
		</div>
		${chatOpen ? `<div class="user-activity-detail"><div class="repo-log-title">Chat log</div>${repoActivityTimeline(repo.chatLog || [], repo.name, 'chat_message')}</div>` : ''}
		${fileOpen ? `<div class="user-activity-detail"><div class="repo-log-title">File edits</div>${repoActivityTimeline(repo.fileEditLog || [], repo.name, 'file_edit')}</div>` : ''}
	</div>`;
}

function repoActivityTimeline(items, repoName, kind) {
	if (!items?.length) {
		const label = kind === 'file_edit' ? 'file edits' : 'chat messages';
		return emptyState(`No ${label} yet`, `No ${label} mapped to ${repoName || 'this repository'} yet.`);
	}
	return `<div class="timeline user-activity-timeline repo-activity-timeline">${items.map(e => {
		const meta = e.metadata || {};
		const actor = e.actorDisplayName || e.actorEmail || 'Neptor';
		const pathLine = e.relativePath || e.file || meta.uri || '';
		const folderLine = e.folder ? `folder: ${e.folder}` : '';
		const threadLine = meta.threadLabel ? `thread: ${meta.threadLabel}` : '';
		const detailParts = [
			actor,
			folderLine,
			e.file ? `file: ${e.file}` : '',
			threadLine,
			meta.artifactType ? `artifact: ${meta.artifactType}` : '',
		].filter(Boolean);
		return `<div class="event repo-event">
			<div class="event-icon kind-${esc((e.kind || kind || 'activity').replace(/[^a-z0-9_-]/gi, ''))}">${esc((e.kind || kind || '?').slice(0, 1).toUpperCase())}</div>
			<div>
				<strong>${esc(e.summary)}</strong>
				<span>${detailParts.map(part => esc(part)).join(' · ')}</span>
				${pathLine ? `<code class="event-path">${esc(pathLine)}</code>` : ''}
			</div>
			<span class="muted">${timeAgo(e.timestampIso)}</span>
		</div>`;
	}).join('')}</div>`;
}

function aggregateRepoItems(repos, key) {
	const counts = new Map();
	for (const repo of repos || []) {
		for (const item of repo[key] || []) {
			counts.set(item.name, (counts.get(item.name) || 0) + item.value);
		}
	}
	return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 4);
}

function repoDetailBlock(label, items, empty) {
	return `<div class="repo-detail-block">
		<strong>${esc(label)}</strong>
		${items.length ? items.map(item => `<div><span>${esc(item.name)}</span><em>${esc(item.value)}</em></div>`).join('') : `<p>${esc(empty)}</p>`}
	</div>`;
}

function renderUsers() {
	const d = state.dashboard;
	const users = d.users || { totalMembers: 0, activeUsers: 0, totalEvents: 0, items: [] };
	const activeItems = users.items.filter(user => user.events > 0);
	return `
		<section class="grid cards">
			${miniMetric('Active users', users.activeUsers, 'coral')}
			${miniMetric('Organization members', users.totalMembers, 'blue')}
			${miniMetric('Tracked events', users.totalEvents, 'green')}
			${miniMetric('Inactive members', Math.max(users.totalMembers - users.activeUsers, 0), 'amber')}
		</section>
		<section class="panel" style="margin-top:16px">
			<div class="panel-head"><div><h3>User analysis</h3><p>Member-level activity, contribution signals, and adoption health for this organization. Click a member to view their full activity log.</p></div></div>
			${users.items.length ? `<div class="entity-list user-activity-list">${users.items.map(user => userActivityRow(user)).join('')}</div>` : emptyState('No members found', 'Add members to this organization to start user-level reporting.')}
		</section>
		<section class="grid two" style="margin-top:16px">
			<div class="panel"><div class="panel-head"><div><h3>Engagement distribution</h3><p>Activity volume by member.</p></div></div>${barChart(activeItems.map(user => ({ name: user.displayName || user.email, value: user.events })), 'No user activity recorded yet.')}</div>
			<div class="panel"><div class="panel-head"><div><h3>Leadership readout</h3><p>Simple signals for adoption and team coverage.</p></div></div>
				<div class="quality-stack">
					<div><strong>${esc(users.totalMembers ? Math.round((users.activeUsers / users.totalMembers) * 100) : 0)}%</strong><span>members active in matched activity</span></div>
					<div><strong>${esc(activeItems[0]?.displayName || 'None')}</strong><span>highest activity contributor</span></div>
					<div><strong>${esc(activeItems[0]?.topEventTypes?.[0]?.name || 'No dominant event')}</strong><span>most common user workflow</span></div>
				</div>
			</div>
		</section>`;
}

function renderMembers() {
	const d = state.dashboard;
	return `<section class="panel">
		<div class="panel-head"><div><h3>Organization members</h3><p>Login access is mapped from these emails.</p></div></div>
		<table class="table"><thead><tr><th>Member</th><th>Email</th><th>Role</th><th>Activity</th><th>Joined</th></tr></thead>
		<tbody>${d.members.map(m => `<tr><td>${esc(m.displayName)}</td><td>${esc(m.email)}</td><td><span class="tag">${esc(m.role)}</span></td><td>${m.activityCount}</td><td>${dateShort(m.joinedAtIso)}</td></tr>`).join('')}</tbody></table>
	</section>`;
}

function renderGovernance() {
	const d = state.dashboard;
	return `<section class="grid two">
		<div>${renderRecommendations()}<div class="panel" style="margin-top:16px"><div class="panel-head"><div><h3>Governance queue</h3><p>Rules needing review.</p></div></div>
		${governanceList('Duplicate samples', d.rules.insights.duplicateSamples)}
		${governanceList('Low-quality samples', d.rules.insights.lowQualitySamples)}
		</div></div>
		<div class="panel"><div class="panel-head"><div><h3>Admin actions</h3><p>Owners and admins only.</p></div></div>
			<button class="btn danger" id="reset-cache">Reset Organization Rules</button>
			<p class="muted" style="font-size:12px;line-height:1.55">Forces a reload of organization rules and access policies from the source of truth.</p>
		</div>
	</section>`;
}

function renderRecommendations() {
	const d = state.dashboard;
	return `<div class="panel"><div class="panel-head"><div><h3>Recommendations</h3></div></div>
	${d.recommendations.map(r => `<div class="rec ${esc(r.severity)}"><div class="rec-title">${esc(r.title)}</div><div class="rec-detail">${esc(r.detail)}</div></div>`).join('') || '<p class="muted">No recommendations. Looking crisp.</p>'}</div>`;
}

function miniMetric(label, value, tone = 'blue') {
	return `<div class="card tone-${tone}"><div class="card-label">${esc(label)}</div><div class="card-value" style="font-size:24px">${esc(value)}</div></div>`;
}

function userActivityRow(user) {
	const expanded = state.expandedUserId === user.id;
	const title = user.displayName || user.email || 'Member';
	const kinds = (user.topEventTypes || []).map(kind => `${kind.name} ${kind.value}`).join(' · ') || 'No events yet';
	const when = user.lastActivityIso ? timeAgo(user.lastActivityIso) : 'No activity';
	const log = user.activityLog || [];
	return `<div class="user-activity-card ${expanded ? 'expanded' : ''}">
		<button type="button" class="entity-row user-activity-toggle" data-user-toggle="${esc(user.id)}" aria-expanded="${expanded ? 'true' : 'false'}">
			<div class="entity-avatar">${esc(title.slice(0, 1).toUpperCase())}</div>
			<div>
				<div class="entity-title"><strong>${esc(title)}</strong><span class="tag">${expanded ? 'Hide log' : 'View log'}</span></div>
				<span>${esc(user.email || 'No email')} · ${esc(user.role || 'member')}</span>
				<small>${esc(kinds)}</small>
			</div>
			<div class="entity-stat">
				<strong>${esc(user.events || 0)}</strong>
				<span>${esc(when)}</span>
			</div>
		</button>
		${expanded ? `<div class="user-activity-detail">${userActivityTimeline(log)}</div>` : ''}
	</div>`;
}

function userActivityTimeline(items) {
	if (!items?.length) {
		return emptyState('No activity yet', 'This member has no tracked chat, edit, or team events for this workspace.');
	}
	return `<div class="timeline user-activity-timeline">${items.map(e => {
		const meta = e.metadata || {};
		const extras = [
			meta.threadLabel ? `thread: ${meta.threadLabel}` : '',
			meta.uri ? `file: ${meta.uri.split('/').pop()}` : '',
			meta.artifactType ? `artifact: ${meta.artifactType}` : '',
		].filter(Boolean).join(' · ');
		return `<div class="event">
			<div class="event-icon">${esc((e.kind || '?').slice(0, 1).toUpperCase())}</div>
			<div>
				<strong>${esc(e.summary)}</strong>
				<span>${esc(e.kind)}${extras ? ` · ${esc(extras)}` : ''}</span>
			</div>
			<span class="muted">${timeAgo(e.timestampIso)}</span>
		</div>`;
	}).join('')}</div>`;
}

function entityRow(item, type, compact = false) {
	const title = type === 'repo' ? item.name : (item.displayName || item.email || 'Member');
	const rawRootTag = type === 'repo' ? (item.rootFolder || item.name) : '';
	const rootTag = rawRootTag && rawRootTag.toLowerCase() !== title.toLowerCase() ? rawRootTag : '';
	const subtitle = type === 'repo'
		? `${item.activeUsers || 0} active user${item.activeUsers === 1 ? '' : 's'}`
		: `${item.email || 'No email'} · ${item.role || 'member'}`;
	const kinds = (item.topEventTypes || []).map(kind => `${kind.name} ${kind.value}`).join(' · ') || 'No events yet';
	const folders = type === 'repo' && item.topFolders?.length
		? item.topFolders.map(folder => `${folder.name} ${folder.value}`).join(' · ')
		: '';
	const files = type === 'repo' && item.topFiles?.length
		? item.topFiles.map(file => `${file.name} ${file.value}`).join(' · ')
		: '';
	const when = item.lastActivityIso ? timeAgo(item.lastActivityIso) : 'No activity';
	const detailLines = compact
		? []
		: type === 'repo'
			? [
				`Folders: ${folders || 'No folder events yet'}`,
				`Files: ${files || 'No file events yet'}`,
				kinds,
			]
			: [kinds];
	return `<div class="entity-row">
		<div class="entity-avatar">${esc(title.slice(0, 1).toUpperCase())}</div>
		<div>
			<div class="entity-title"><strong>${esc(title)}</strong>${rootTag ? `<span class="tag repo-root">${esc(rootTag)}</span>` : ''}</div>
			<span>${esc(subtitle)}</span>
			${detailLines.map(line => `<small>${esc(line)}</small>`).join('')}
		</div>
		<div class="entity-stat">
			<strong>${esc(item.events || 0)}</strong>
			<span>${esc(when)}</span>
		</div>
	</div>`;
}

function statusPill(label, ok) {
	return `<span class="status"><span class="dot ${ok ? '' : 'warn'}"></span>${esc(label)}</span>`;
}

function barChart(items, empty) {
	if (!items?.length) return `<p class="muted">${esc(empty)}</p>`;
	const max = Math.max(...items.map(i => i.value), 1);
	return `<div class="chart-bars">${items.slice(0, 10).map(i => `<div class="bar-row"><span>${esc(i.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, (i.value / max) * 100)}%"></div></div><strong>${i.value}</strong></div>`).join('')}</div>`;
}

function timeline(items, empty = 'No events yet.') {
	if (!items?.length) return emptyState('No activity yet', empty);
	return `<div class="timeline">${items.map(e => `<div class="event"><div class="event-icon">${esc((e.kind || '?').slice(0, 1).toUpperCase())}</div><div><strong>${esc(e.summary)}</strong><span>${esc(e.actorDisplayName || e.actorEmail || 'Neptor')} · ${esc(e.kind)}</span></div><span class="muted">${timeAgo(e.timestampIso)}</span></div>`).join('')}</div>`;
}

function emptyState(title, detail) {
	return `<div class="empty-state"><div class="empty-orbit"></div><strong>${esc(title)}</strong><p>${esc(detail)}</p></div>`;
}

function governanceList(title, items) {
	return `<h3 style="font-size:14px;margin-top:16px">${esc(title)}</h3>${items?.length ? items.map(x => `<div class="rec warning"><div class="rec-detail">${esc(x)}</div></div>`).join('') : '<p class="muted">None detected.</p>'}`;
}

document.addEventListener('click', async event => {
	const userToggle = event.target.closest('[data-user-toggle]');
	if (userToggle) {
		const userId = userToggle.dataset.userToggle;
		state.expandedUserId = state.expandedUserId === userId ? null : userId;
		renderApp();
		return;
	}
	const memwalUserToggle = event.target.closest('[data-memwal-user-toggle]');
	if (memwalUserToggle) {
		const userId = memwalUserToggle.dataset.memwalUserToggle;
		state.expandedMemWalUserId = state.expandedMemWalUserId === userId ? null : userId;
		renderApp();
		return;
	}
	const repoLog = event.target.closest('[data-repo-log]');
	if (repoLog) {
		const panel = repoLog.dataset.repoLog;
		state.expandedRepoPanel = state.expandedRepoPanel === panel ? null : panel;
		renderApp();
		return;
	}
	const filter = event.target.closest('[data-filter]');
	if (filter) {
		state.filter = filter.dataset.filter;
		renderApp();
	}
	if (event.target.id === 'reset-cache') {
		if (!confirm('Clear Supabase rule cache for this org? MemWal namespace rotation still needs the org-api script.')) return;
		await api('/api/rules/reset', { method: 'POST', body: JSON.stringify({ orgId: state.dashboard.org.id }) });
		await loadDashboard(state.dashboard.org.id);
	}
});

bootstrap();
