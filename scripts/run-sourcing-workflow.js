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
    '  node scripts/run-sourcing-workflow.js import-previews --workflow-root <path> --role-id <slug> --input <file.csv|file.json>',
    '  node scripts/run-sourcing-workflow.js export-candidates --workflow-root <path> --role-id <slug> [--output <file.csv>]',
    '  node scripts/run-sourcing-workflow.js update-candidate --workflow-root <path> --role-id <slug> --candidate-id <id> [--operator-decision ...] [--shortlist-status ...] [--lifecycle-stage ...]',
    '  node scripts/run-sourcing-workflow.js update-role-config --workflow-root <path> --role-id <slug> [--shortlist-target-size 10] [--shortlist-mode strict|balanced|broad] [...]',
    '  node scripts/run-sourcing-workflow.js log-contact --workflow-root <path> --role-id <slug> --candidate-id <id> --stage contacted|awaiting_reply|closed [--date 2026-04-20] [--note "..."] [--message-summary "..."]',
    '  node scripts/run-sourcing-workflow.js summarize-role --workflow-root <path> --role-id <slug>',
    '  node scripts/run-sourcing-workflow.js health-check --workflow-root <path>',
    '  node scripts/run-sourcing-workflow.js role-index --workflow-root <path> [--format table|json]',
    '  node scripts/run-sourcing-workflow.js list-roles --workflow-root <path>',
  ].join('\n');
}

function parseBooleanFlag(value) {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

function createUpdatePatch(args) {
  const patch = {};
  const mappings = [
    ['classification', 'classification'],
    ['operator-decision', 'decision'],
    ['shortlist-status', 'shortlist_status'],
    ['outreach-ready', 'outreach_ready_override'],
    ['lifecycle-stage', 'lifecycle_stage'],
    ['manual-notes', 'manual_notes'],
    ['strengths', 'strengths'],
    ['concerns', 'concerns'],
    ['follow-up-questions', 'follow_up_questions'],
    ['override-reason', 'override_reason'],
    ['availability-notes', 'availability_notes'],
    ['appetite-notes', 'appetite_notes'],
    ['compensation-notes', 'compensation_notes'],
  ];

  mappings.forEach(([argKey, patchKey]) => {
    if (Object.prototype.hasOwnProperty.call(args, argKey)) {
      patch[patchKey] = args[argKey];
    }
  });

  return patch;
}

function createRoleConfigPatch(args) {
  const patch = {};
  const mappings = [
    ['shortlist-target-size', 'shortlist_target_size'],
    ['max-previews-per-run', 'max_previews_per_run'],
    ['max-cv-reviews-per-run', 'max_cv_reviews_per_run'],
    ['shortlist-mode', 'shortlist_mode'],
    ['minimum-shortlist-score', 'minimum_shortlist_score'],
    ['minimum-draft-score', 'minimum_draft_score'],
    ['must-have-weighting', 'must_have_weighting'],
    ['preferred-weighting', 'preferred_weighting'],
    ['reject-on-missing-must-have', 'reject_on_missing_must_have'],
    ['location-strictness', 'location_strictness'],
    ['adjacent-title-looseness', 'adjacent_title_looseness'],
    ['sector-strictness', 'sector_strictness'],
    ['continue-until-target-reached', 'continue_until_target_reached'],
  ];

  mappings.forEach(([argKey, patchKey]) => {
    if (Object.prototype.hasOwnProperty.call(args, argKey)) {
      patch[patchKey] = parseBooleanFlag(args[argKey]);
    }
  });

  return patch;
}

function renderRoleIndexTable(rows) {
  const columns = [
    ['Role', 28, (row) => row.role_title || row.role_id],
    ['Updated', 20, (row) => row.last_updated || ''],
    ['Previews', 9, (row) => String(row.previews_processed ?? 0)],
    ['CVs', 5, (row) => String(row.cvs_reviewed ?? 0)],
    ['Shortlist', 10, (row) => String(row.shortlist_count ?? 0)],
    ['Drafts', 7, (row) => String(row.outreach_drafts_prepared ?? 0)],
    ['KPI', 8, (row) => row.current_kpi == null ? 'n/a' : String(row.current_kpi)],
    ['Review?', 8, (row) => row.error ? 'error' : row.operator_review_needed ? 'yes' : 'no'],
  ];

  const lines = [
    columns.map(([label, width]) => label.padEnd(width)).join('  '),
    columns.map(([, width]) => '-'.repeat(width)).join('  '),
    ...rows.map((row) => columns.map(([, width, render]) => {
      const value = String(render(row) || '');
      return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
    }).join('  ')),
  ];
  return `${lines.join('\n')}\n`;
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

  if (command === 'import-previews') {
    const roleId = args['role-id'] || args.id || args.slug;
    const result = core.importPreviewCandidates({
      workflowRoot,
      roleId,
      inputPath: args.input || args.file,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'export-candidates') {
    const roleId = args['role-id'] || args.id || args.slug;
    const result = core.exportCandidateReviewsCsv({
      workflowRoot,
      roleId,
      outputPath: args.output || '',
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'update-candidate') {
    const roleId = args['role-id'] || args.id || args.slug;
    const candidateId = args['candidate-id'] || args.candidate;
    const result = await core.updateCandidateOperatorState({
      workflowRoot,
      roleId,
      candidateId,
      actor: args.actor || 'operator',
      patch: createUpdatePatch(args),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'update-role-config') {
    const roleId = args['role-id'] || args.id || args.slug;
    const result = await core.updateRoleConfig({
      workflowRoot,
      roleId,
      actor: args.actor || 'operator',
      patch: createRoleConfigPatch(args),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'log-contact') {
    const roleId = args['role-id'] || args.id || args.slug;
    const candidateId = args['candidate-id'] || args.candidate;
    const result = await core.logCandidateContactState({
      workflowRoot,
      roleId,
      candidateId,
      stage: args.stage,
      date: args.date || '',
      note: args.note || '',
      messageSummary: args['message-summary'] || '',
      actor: args.actor || 'operator',
    });
    console.log(JSON.stringify(result, null, 2));
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

  if (command === 'role-index') {
    const rows = core.listRoleIndex(workflowRoot);
    if ((args.format || 'table') === 'json') {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      process.stdout.write(renderRoleIndexTable(rows));
    }
    return;
  }

  if (command === 'health-check') {
    console.log(JSON.stringify(core.runHealthCheck(workflowRoot), null, 2));
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
  console.error(error?.message || error);
  if (error?.details) {
    console.error(JSON.stringify(error.details, null, 2));
  } else if (error?.stack) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
