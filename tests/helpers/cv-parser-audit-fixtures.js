'use strict';

const fs = require('node:fs');
const path = require('node:path');

function buildTrialJobSpecYaml(roleId = 'HMJ-AUDIT-SECM-001') {
  return [
    `role_id: ${roleId}`,
    'client_name: "Audit Client"',
    'consultant: Joe',
    'date_opened: "2026-04-21"',
    '',
    'role_summary:',
    '  canonical_title: "Senior Electrical Commissioning Manager"',
    '  hiring_reason: "Synthetic parser-and-workflow audit role for repeatable sourcing tests."',
    '  employment_type: "Contract"',
    '  salary_min: 70000',
    '  salary_max: 90000',
    '  salary_notes: "Day-rate or fixed-term options considered for the right mission critical candidate."',
    '  location_base: "Leeds"',
    '  radius_miles: 60',
    '  remote_hybrid_onsite: "Site-based with travel across Yorkshire and the North."',
    '  relocation_considered: true',
    '  driving_licence_required: true',
    '',
    'title_mapping:',
    '  direct_titles:',
    '    - "Senior Electrical Commissioning Manager"',
    '    - "Electrical Commissioning Manager"',
    '    - "Electrical Package Manager"',
    '    - "Electrical Project Manager"',
    '    - "Electrical Site Manager"',
    '  adjacent_titles:',
    '    - "Commissioning Lead"',
    '    - "Senior Commissioning Engineer"',
    '    - "Electrical Construction Manager"',
    '    - "Senior Electrical Supervisor"',
    '  seniority_variants:',
    '    - "Lead"',
    '    - "Manager"',
    '    - "Senior"',
    '  misleading_titles_to_exclude:',
    '    - "Mechanical Commissioning Manager"',
    '    - "Facilities Maintenance Electrician"',
    '    - "Domestic Electrician"',
    '',
    'must_have:',
    '  skills:',
    '    - "electrical commissioning"',
    '    - "QA/QC"',
    '    - "subcontractor management"',
    '    - "package management"',
    '    - "handover"',
    '  tools_or_qualifications:',
    '    - "SMSTS"',
    '    - "ECS"',
    '    - "SSSTS"',
    '  sector_or_project_context:',
    '    - "data centre"',
    '    - "mission critical"',
    '    - "pharma"',
    '    - "cleanroom"',
    '',
    'nice_to_have:',
    '  skills:',
    '    - "integrated systems testing"',
    '    - "energisation"',
    '    - "commissioning scripts"',
    '  sectors:',
    '    - "advanced manufacturing"',
    '  qualifications:',
    '    - "AP"',
    '',
    'rejection_rules:',
    '  hard_disqualifiers:',
    '    - "mechanical-only background"',
    '    - "facilities maintenance only"',
    '  excluded_titles:',
    '    - "Mechanical Commissioning Manager"',
    '    - "Facilities Maintenance Electrician"',
    '  excluded_contexts:',
    '    - "reactive maintenance"',
    '    - "small works only"',
    '  excluded_sectors:',
    '    - "domestic"',
    '  unacceptable_location_patterns: []',
    '',
    'quality_signals:',
    '  preferred_employers_or_project_types:',
    '    - "hyperscale data centre"',
    '    - "regulated pharma"',
    '    - "cleanroom expansion"',
    '  evidence_of_scale:',
    '    - "campus"',
    '    - "MW"',
    '    - "fast-track handover"',
    '  evidence_of_outcomes:',
    '    - "client handover"',
    '    - "QA close-out"',
    '    - "IST readiness"',
    '  stability_expectations: []',
    '',
    'candidate_judgment_areas:',
    '  direct_match_definition: "Electrical commissioning or package leadership on mission critical, data centre, pharma or cleanroom schemes."',
    '  transferable_match_definition: "Construction-management or senior-supervisory candidates are acceptable if they clearly show commissioning, QA/QC and handover ownership."',
    '  location_mobility_definition: "Leeds-based delivery or practical travel across Yorkshire and the North."',
    '  work_history_definition: "Multiple dated site-delivery roles with responsibility progression and no obvious trade mismatch."',
    '  appetite_relevance_signals:',
    '    - "available"',
    '    - "open to"',
    '    - "travel"',
    '  follow_up_questions_needed:',
    '    - "What is your current availability?"',
    '    - "Is Leeds workable day to day?"',
    '    - "What rate or package would you need?"',
    '',
    'outreach:',
    '  role_hook: "Senior electrical commissioning leadership across mission critical and regulated projects in the North."',
    '  likely_motivators:',
    '    - "ownership of delivery and handover"',
    '    - "complex electrical packages"',
    '    - "mission critical programme exposure"',
    '  draft_questions:',
    '    - "Would Leeds-based delivery be workable?"',
    '    - "How close is your recent work to commissioning and handover leadership?"',
    '',
    'notes: "Used for parser and shortlist audit coverage only."',
    '',
  ].join('\n');
}

function buildTrialRoleConfig() {
  return {
    shortlist_target_size: 4,
    max_previews_per_run: 0,
    max_cv_reviews_per_run: 0,
    shortlist_mode: 'balanced',
    minimum_shortlist_score: 45,
    minimum_draft_score: 60,
    must_have_weighting: 1,
    preferred_weighting: 1,
    reject_on_missing_must_have: false,
    location_strictness: 'balanced',
    adjacent_title_looseness: 'balanced',
    sector_strictness: 'balanced',
    continue_until_target_reached: true,
  };
}

function buildMockOcrFetch(outputText) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      id: 'resp-hmj-audit-ocr',
      status: 'completed',
      output_text: String(outputText || ''),
    }),
  });
}

function buildBulkUploadFiles(baseDir, manifest) {
  return (Array.isArray(manifest) ? manifest : []).map((entry) => {
    const absolutePath = path.join(baseDir, entry.relative_path || entry.file_name);
    const buffer = fs.readFileSync(absolutePath);
    return {
      name: entry.file_name,
      size: buffer.byteLength,
      data: buffer.toString('base64'),
      contentType: guessContentType(entry.file_name),
    };
  });
}

function guessContentType(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

module.exports = {
  buildBulkUploadFiles,
  buildMockOcrFetch,
  buildTrialJobSpecYaml,
  buildTrialRoleConfig,
  guessContentType,
};
