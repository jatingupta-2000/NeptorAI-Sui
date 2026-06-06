#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Reset Neptor org rules.
 *
 *  MemWal's current SDK does not expose delete/forget for stored memories. To stop
 *  old rules from coming back, this rotates the namespace prefix and clears the
 *  Supabase org_rules cache/pointer.
 *--------------------------------------------------------------------------------------*/

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const orgApiDir = resolve(__dirname, '..');
const envPath = resolve(orgApiDir, '.env');

function usage() {
	console.log(`Usage:
  npm run reset-rules -- --org-id <org_id> --yes
  npm run reset-rules -- --all --yes

Options:
  --org-id <id>             Clear Supabase rules for one org.
  --all                     Clear Supabase rules for every org.
  --namespace-prefix <name> Set the new MEMWAL_NAMESPACE_PREFIX.
  --no-rotate               Do not edit MEMWAL_NAMESPACE_PREFIX.
  --yes                     Actually write changes. Without this, dry-run only.

Notes:
  This makes old MemWal rules unreachable by moving future reads to a new namespace.
  It does not delete old Walrus blobs because the MemWal SDK has no delete API.`);
}

function parseArgs(argv) {
	const args = {
		orgId: null,
		all: false,
		namespacePrefix: `neptor-org-reset-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
		rotate: true,
		yes: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--org-id') {
			args.orgId = argv[++i] ?? null;
		} else if (arg === '--all') {
			args.all = true;
		} else if (arg === '--namespace-prefix') {
			args.namespacePrefix = argv[++i] ?? args.namespacePrefix;
		} else if (arg === '--no-rotate') {
			args.rotate = false;
		} else if (arg === '--yes') {
			args.yes = true;
		} else if (arg === '--help' || arg === '-h') {
			usage();
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!args.all && !args.orgId) {
		throw new Error('Pass either --org-id <id> or --all.');
	}
	if (args.all && args.orgId) {
		throw new Error('Use either --org-id or --all, not both.');
	}
	return args;
}

function loadEnvFile() {
	if (!existsSync(envPath)) {
		throw new Error(`Missing ${envPath}. Create it from .env.example first.`);
	}
	const raw = readFileSync(envPath, 'utf8');
	const env = {};
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const eq = trimmed.indexOf('=');
		if (eq <= 0) {
			continue;
		}
		env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
	}
	return { raw, env };
}

function updateEnvNamespace(raw, namespacePrefix) {
	if (/^MEMWAL_NAMESPACE_PREFIX=/m.test(raw)) {
		return raw.replace(/^MEMWAL_NAMESPACE_PREFIX=.*$/m, `MEMWAL_NAMESPACE_PREFIX=${namespacePrefix}`);
	}
	const suffix = raw.endsWith('\n') ? '' : '\n';
	return `${raw}${suffix}MEMWAL_NAMESPACE_PREFIX=${namespacePrefix}\n`;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const { raw, env } = loadEnvFile();

	const supabaseUrl = env.SUPABASE_URL;
	const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!supabaseUrl || !supabaseKey) {
		throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in tools/org-api/.env.');
	}

	console.log(args.yes ? 'Resetting rules...' : 'Dry run. Add --yes to write changes.');
	console.log(args.all ? 'Target: all orgs' : `Target org: ${args.orgId}`);
	if (args.rotate) {
		console.log(`New MEMWAL_NAMESPACE_PREFIX: ${args.namespacePrefix}`);
	} else {
		console.log('Namespace rotation: disabled');
	}

	if (!args.yes) {
		return;
	}

	if (args.rotate) {
		writeFileSync(envPath, updateEnvNamespace(raw, args.namespacePrefix));
	}

	const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
	let query = supabase
		.from('org_rules')
		.update({
			rules: [],
			walrus_blob_id: null,
			updated_at: new Date().toISOString(),
		});

	if (!args.all) {
		query = query.eq('org_id', args.orgId);
	}

	const { error, count } = await query.select('org_id', { count: 'exact' });
	if (error) {
		throw error;
	}

	console.log(`Cleared Supabase org_rules rows: ${count ?? 'unknown'}`);
	if (args.rotate) {
		console.log('Restart org-api so it uses the new namespace.');
	}
}

main().catch(err => {
	console.error(err instanceof Error ? err.message : err);
	usage();
	process.exit(1);
});
