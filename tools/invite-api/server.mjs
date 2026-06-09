/*--------------------------------------------------------------------------------------
 *  Local invite API for Neptor Organizations (AWS SES).
 *  Credentials stay here — Neptor only POSTs to this endpoint.
 *--------------------------------------------------------------------------------------*/

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

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

loadEnvFile();

const PORT = Number(process.env.PORT || 8787);
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || '';
const INVITE_PATH = '/v1/send-invite';
const ACCEPT_PATH = '/invite/accept';
const NEPTOR_URL_PROTOCOL = process.env.NEPTOR_URL_PROTOCOL || 'neptor';

const hasStaticKeys = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
const ses = new SESClient({
	region: AWS_REGION,
	...(hasStaticKeys
		? {
			credentials: {
				accessKeyId: process.env.AWS_ACCESS_KEY_ID,
				secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
			},
		}
		: {}),
});

function corsHeaders() {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function formatInviteExpiry(expiresAtIso) {
	if (!expiresAtIso) {
		return '7 days';
	}
	const ms = Date.parse(expiresAtIso) - Date.now();
	if (!Number.isFinite(ms) || ms <= 0) {
		return 'soon';
	}
	const days = Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
	return days === 1 ? '1 day' : `${days} days`;
}

function buildInviteEmailHtml({ orgName, acceptUrl, inviterDisplayName, expiresAtIso }) {
	const safeOrgName = escapeHtml(orgName);
	const safeAcceptUrl = escapeHtml(acceptUrl);
	const safeInviter = inviterDisplayName ? escapeHtml(inviterDisplayName.trim()) : '';
	const expiryLabel = formatInviteExpiry(expiresAtIso);
	const inviterLine = safeInviter
		? `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#4a4a4f;text-align:center;"><strong style="color:#111111;">${safeInviter}</strong> invited you to collaborate on Neptor.</p>`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<meta name="color-scheme" content="light" />
	<meta name="supported-color-schemes" content="light" />
	<title>Organization invite</title>
</head>
<body style="margin:0;padding:0;background-color:#ececee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
	<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Join ${safeOrgName} on Neptor.</div>
	<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ececee;padding:32px 16px;">
		<tr>
			<td align="center">
				<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;border:1px solid #dedee3;border-radius:14px;overflow:hidden;background-color:#ffffff;">
					<tr>
						<td style="padding:28px 28px 24px;background:linear-gradient(135deg,#ff3b30 0%,#ff9500 100%);background-color:#ff3b30;text-align:center;">
							<div style="font-size:30px;line-height:1.1;font-weight:800;letter-spacing:-0.03em;color:#ffffff;">Neptor</div>
							<div style="margin-top:8px;font-size:14px;line-height:1.4;color:rgba(255,255,255,0.92);">Organization invite</div>
							<div style="margin-top:14px;display:inline-block;padding:4px 10px;border-radius:999px;background:rgba(0,0,0,0.18);font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ffffff;">AI-native development workspace</div>
						</td>
					</tr>
					<tr>
						<td style="padding:28px 28px 10px;">
							<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4a4a4f;text-align:center;">You've been invited to join</p>
							<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;">
								<tr>
									<td align="center" style="padding:18px 20px;border:1px solid #ffd4cf;border-radius:12px;background-color:#fff4f2;">
										<div style="font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:#ff3b30;">${safeOrgName}</div>
									</td>
								</tr>
							</table>
							${inviterLine}
							<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#4a4a4f;text-align:center;">Accept the invite to access shared team rules, activity, and workspace intelligence in Neptor.</p>
							<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 18px;">
								<tr>
									<td align="center" style="border-radius:10px;background-color:#ff3b30;background:linear-gradient(135deg,#ff3b30 0%,#ff9500 100%);">
										<a href="${safeAcceptUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">Accept invite</a>
									</td>
								</tr>
							</table>
							<p style="margin:0 0 8px;font-size:14px;line-height:1.55;color:#4a4a4f;text-align:center;">This invite expires in <strong style="color:#111111;">${escapeHtml(expiryLabel)}</strong>.</p>
							<p style="margin:0;font-size:13px;line-height:1.55;color:#7a7a82;text-align:center;">If you did not expect this invite, you can ignore this message.</p>
						</td>
					</tr>
					<tr>
						<td style="padding:0 28px 24px;">
							<p style="margin:0;font-size:12px;line-height:1.6;color:#8b8b93;text-align:center;word-break:break-all;">If the button does not work, paste this link into your browser:<br /><a href="${safeAcceptUrl}" style="color:#ff3b30;text-decoration:underline;">${safeAcceptUrl}</a></p>
						</td>
					</tr>
					<tr>
						<td style="padding:18px 28px 24px;border-top:1px solid #ececee;background-color:#fafafa;">
							<p style="margin:0;font-size:12px;line-height:1.55;color:#8b8b93;text-align:center;">&copy; ${new Date().getFullYear()} Neptor &middot; Built for teams shipping with AI-native tooling.</p>
						</td>
					</tr>
				</table>
			</td>
		</tr>
	</table>
</body>
</html>`;
}

function buildEmail({ to, from, orgName, acceptUrl, inviterDisplayName, expiresAtIso }) {
	const subject = `You're invited to ${orgName}`;
	const expiryLabel = formatInviteExpiry(expiresAtIso);
	const inviterLine = inviterDisplayName?.trim()
		? `${inviterDisplayName.trim()} invited you to collaborate on Neptor.\n\n`
		: '';
	const text = [
		`You've been invited to join ${orgName} on Neptor.`,
		'',
		inviterLine.trim(),
		`Accept invite: ${acceptUrl}`,
		'',
		`This invite expires in ${expiryLabel}.`,
		'',
		'If you did not expect this invite, you can ignore this message.',
	].filter(Boolean).join('\n');
	const html = buildInviteEmailHtml({ orgName, acceptUrl, inviterDisplayName, expiresAtIso });
	return { subject, text, html, source: (SES_FROM_EMAIL || from || '').trim() };
}

async function handleSendInvite(req, res) {
	let payload;
	try {
		payload = await readJsonBody(req);
	} catch {
		sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
		return;
	}

	const to = String(payload.to || '').trim();
	const orgName = String(payload.orgName || 'your team').trim();
	const acceptUrl = String(payload.acceptUrl || '').trim();
	const { subject, text, html, source } = buildEmail({
		to,
		from: payload.from,
		orgName,
		acceptUrl,
		inviterDisplayName: payload.inviterDisplayName,
		expiresAtIso: payload.expiresAtIso,
	});

	if (!to || !acceptUrl) {
		sendJson(res, 400, { ok: false, error: 'Missing required fields: to, acceptUrl' });
		return;
	}
	if (!source) {
		sendJson(res, 500, { ok: false, error: 'SES_FROM_EMAIL not set on server and no from in request' });
		return;
	}

	try {
		await ses.send(new SendEmailCommand({
			Source: source,
			Destination: { ToAddresses: [to] },
			Message: {
				Subject: { Data: subject, Charset: 'UTF-8' },
				Body: {
					Text: { Data: text, Charset: 'UTF-8' },
					Html: { Data: html, Charset: 'UTF-8' },
				},
			},
		}));
		sendJson(res, 200, { ok: true, to, from: source });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[invite-api] SES error:', message);
		sendJson(res, 502, { ok: false, error: message });
	}
}

function handleAcceptInvitePage(req, res) {
	const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
	const token = requestUrl.searchParams.get('token')?.trim() ?? '';
	if (!token) {
		sendJson(res, 400, { ok: false, error: 'Missing token query parameter' });
		return;
	}

	const deepLink = `${NEPTOR_URL_PROTOCOL}://invite/accept?token=${encodeURIComponent(token)}`;
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>Accept organization invite</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #0a0a0a; color: #ededed; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
		.card { max-width: 480px; width: 100%; border: 1px solid #2e2e2e; border-radius: 14px; background: #141414; padding: 24px; }
		h1 { margin: 0 0 8px; font-size: 22px; }
		p { margin: 0 0 14px; color: #8b8b8b; line-height: 1.55; font-size: 14px; }
		.btn { display: inline-flex; align-items: center; justify-content: center; height: 36px; padding: 0 14px; border-radius: 8px; border: none; background: linear-gradient(135deg, #ff3b30, #ff9500); color: #fff; font-weight: 700; font-size: 13px; text-decoration: none; cursor: pointer; }
		.ghost { display: inline-block; margin-top: 12px; color: #8b8b8b; font-size: 12px; word-break: break-all; }
		code { color: #ededed; font-size: 11px; }
	</style>
</head>
<body>
	<div class="card">
		<h1>Organization invite</h1>
		<p>Open this invite in your local Neptor editor. If nothing happens, use Command Palette → <strong>Neptor: Accept Organization Invite</strong> and paste the token below.</p>
		<a class="btn" href="${escapeHtml(deepLink)}">Open in Neptor</a>
		<p class="ghost">Token: <code>${escapeHtml(token)}</code></p>
	</div>
	<script>
		(function () {
			var deepLink = ${JSON.stringify(deepLink)};
			window.setTimeout(function () { window.location.href = deepLink; }, 400);
		})();
	</script>
</body>
</html>`;

	res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() });
	res.end(html);
}

const server = http.createServer(async (req, res) => {
	const url = req.url?.split('?')[0] ?? '/';

	if (req.method === 'OPTIONS') {
		res.writeHead(204, corsHeaders());
		res.end();
		return;
	}

	if (req.method === 'GET' && url === '/health') {
		sendJson(res, 200, {
			ok: true,
			region: AWS_REGION,
			from: SES_FROM_EMAIL || null,
			path: INVITE_PATH,
		});
		return;
	}

	if (req.method === 'POST' && url === INVITE_PATH) {
		await handleSendInvite(req, res);
		return;
	}

	if (req.method === 'GET' && url === ACCEPT_PATH) {
		handleAcceptInvitePage(req, res);
		return;
	}

	sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, () => {
	console.log(`Neptor invite API listening on http://localhost:${PORT}`);
	console.log(`  POST ${INVITE_PATH}`);
	console.log(`  GET  ${ACCEPT_PATH}`);
	console.log(`  GET  /health`);
	console.log(`  Region: ${AWS_REGION}`);
	console.log(`  From:   ${SES_FROM_EMAIL || '(set SES_FROM_EMAIL)'}`);
	if (!SES_FROM_EMAIL) {
		console.warn('  Warning: SES_FROM_EMAIL is empty. Set it in .env before sending.');
	}
});
