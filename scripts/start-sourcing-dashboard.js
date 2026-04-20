#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { startDashboardServer } = require('../lib/sourcing-dashboard-server.js');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--')
      ? argv[++index]
      : 'true';
    args[key] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const workflowRoot = path.resolve(args['workflow-root'] || process.cwd());
  const host = args.host || '127.0.0.1';
  const port = Number(args.port) || 4287;
  const started = await startDashboardServer({ workflowRoot, host, port });
  console.log(JSON.stringify({
    ok: true,
    url: `http://${started.host}:${started.port}/`,
    workflowRoot: started.workflowRoot,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
