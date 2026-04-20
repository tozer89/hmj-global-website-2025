#!/usr/bin/env node
'use strict';

const path = require('node:path');
const core = require('../lib/sourcing-assistant-core.js');

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith('--')
      ? argv[++index]
      : 'true';
    args[key] = value;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/run-sourcing-workflow.js init-role --workflow-root <path> --role-id <slug> [--role-title "Title"]',
    '  node scripts/run-sourcing-workflow.js run --workflow-root <path> --role-id <slug> [--action run_all]',
    '  node scripts/run-sourcing-workflow.js generate-search-pack --workflow-root <path> --role-id <slug>',
    '  node scripts/run-sourcing-workflow.js triage-previews --workflow-root <path> --role-id <slug>',
    '  node scripts/run-sourcing-workflow.js review-cvs --workflow-root <path> --role-id <slug>',
    '  node scripts/run-sourcing-workflow.js prepare-drafts --workflow-root <path> --role-id <slug>',
    '  node scripts/run-sourcing-workflow.js summarize-role --workflow-root <path> --role-id <slug>',
    '  node scripts/run-sourcing-workflow.js list-roles --workflow-root <path>',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const command = args._[0];
  const workflowRoot = path.resolve(args['workflow-root'] || process.cwd());

  if (!command) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  if (command === 'init-role') {
    const roleId = args['role-id'] || args.id || args.slug;
    const result = core.scaffoldRoleWorkspace({
      workflowRoot,
      roleId,
      roleTitle: args['role-title'] || '',
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'run') {
    const roleId = args['role-id'] || args.id || args.slug;
    const summary = await core.runRoleWorkspace({
      workflowRoot,
      roleId,
      action: args.action || 'run_all',
    });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const actionMap = {
    'generate-search-pack': 'generate_search_pack',
    'triage-previews': 'run_preview_triage',
    'review-cvs': 'review_downloaded_cvs',
    'prepare-drafts': 'generate_outreach_drafts',
  };

  if (actionMap[command]) {
    const roleId = args['role-id'] || args.id || args.slug;
    const summary = await core.runRoleWorkspace({
      workflowRoot,
      roleId,
      action: actionMap[command],
    });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (command === 'summarize-role') {
    const roleId = args['role-id'] || args.id || args.slug;
    console.log(JSON.stringify(core.summariseRoleFromDisk(workflowRoot, roleId), null, 2));
    return;
  }

  if (command === 'list-roles') {
    console.log(JSON.stringify(core.listRoles(workflowRoot), null, 2));
    return;
  }

  console.error(usage());
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
