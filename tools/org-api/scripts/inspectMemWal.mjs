#!/usr/bin/env node
/*--------------------------------------------------------------------------------------
 *  Inspect MemWal directly, without going through Neptor's org API.
 *--------------------------------------------------------------------------------------*/

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemWal } from '@mysten-incubation/memwal';

const __dirname = dirname(fileURLToPath(import.meta.url));
const orgApiDir = resolve(__dirname, '..');
const envPath = resolve(orgApiDir, '.env');

function usage() {
	console.log(`Usage:
  npm run inspect-memwal -- --org-id <org_id>

Options:
  --org-id <id>       Inspect the namespace for one org.
  --namespace <name>  Inspect an exact namespace instead of deriving one from org id.
  --query <text>      Recall query. Default: "team coding guidelines".
  --limit <number>    Max results. Default: 50.
  --raw               Print raw SDK response.
`);
}

function parseArgs(argv) {
	const args = {
		orgId: null,
		namespace: null,
		query: 'team coding guidelines',
		limit: 50,
		raw: false,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--org-id') {
			args.orgId = argv[++i] ?? null;
		} else if (arg === '--namespace') {
			args.namespace = argv[++i] ?? null;
		} else if (arg === '--query') {
			args.query = argv[++i] ?? args.query;
		} else if (arg === '--limit') {
			args.limit = Number(argv[++i] ?? args.limit);
		} else if (arg === '--raw') {
			args.raw = true;
		} else if (arg === '--help' || arg === '-h') {
			usage();
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (!args.namespace && !args.orgId) {
		throw new Error('Pass either --org-id <id> or --namespace <name>.');
	}
	return args;
}

function loadEnvFile() {
	if (!existsSync(envPath)) {
		throw new Error(`Missing ${envPath}. Create it from .env.example first.`);
	}
	const env = {};
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
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
	return env;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const env = loadEnvFile();
	const key = env.MEMWAL_PRIVATE_KEY;
	const accountId = env.MEMWAL_ACCOUNT_ID;
	if (!key || !accountId) {
		throw new Error('MEMWAL_PRIVATE_KEY and MEMWAL_ACCOUNT_ID are required in tools/org-api/.env.');
	}

	const namespace = args.namespace ?? `${env.MEMWAL_NAMESPACE_PREFIX || 'neptor-org'}-${args.orgId}`;
	const memwal = MemWal.create({
		key,
		accountId,
		serverUrl: env.MEMWAL_SERVER_URL || 'https://relayer.memwal.ai',
		namespace,
	});

	const result = await memwal.recall({
		query: args.query,
		namespace,
		limit: args.limit,
	});

	if (args.raw) {
		console.dir(result, { depth: null });
		return;
	}

	console.log(`namespace: ${namespace}`);
	console.log(`results: ${result.results?.length ?? 0}`);
	for (const row of result.results ?? []) {
		console.log(`\nblob_id: ${row.blob_id}`);
		console.log(`distance: ${row.distance}`);
		console.log(row.text);
	}
}

main().catch(err => {
	console.error(err instanceof Error ? err.message : err);
	usage();
	process.exit(1);
});
