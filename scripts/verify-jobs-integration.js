#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function read(file){
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

const adminJobs = read('admin/jobs.html');
const publicJobs = read('jobs.html');
const contact = read('contact.html');

const issues = [];

if(!/id\s*=\s*['"]jobs-data['"]/i.test(adminJobs)){
  issues.push('admin/jobs.html is missing the #jobs-data wrapper required for public ingestion.');
}

const adminBoards = new Set();
for(const match of adminJobs.matchAll(/data-board\s*=\s*["']([^"']+)["']/gi)){
  adminBoards.add(match[1]);
}
if(!adminBoards.size){
  issues.push('admin/jobs.html has no data-board sections available for syncing to the public page.');
}

const publicBoards = new Set();
for(const match of publicJobs.matchAll(/data-board\s*=\s*["']([^"']+)["']/gi)){
  publicBoards.add(match[1]);
}

for(const board of adminBoards){
  if(!publicBoards.has(board)){
    issues.push(`Public jobs page is missing a matching data-board section for ${board}.`);
  }
}

if(!/fetch\(\s*['"]\/admin\/jobs\.html['"]/i.test(publicJobs)){
  issues.push('jobs.html no longer fetches admin/jobs.html; admin updates would not sync.');
}

if(!/normalizeJobCards\(/.test(publicJobs)){
  issues.push('jobs.html is missing normalizeJobCards to rewrite admin links to the contact form.');
}

if(!/window\.HmjJobsApply/.test(publicJobs)){
  issues.push('jobs.html no longer loads the shared apply URL helper.');
}

if(!/new URLSearchParams\(location.search\)/.test(contact)){
  issues.push('contact.html no longer reads the role query parameter.');
}

if(!/subjectEl\.value\s*=\s*`Application: \${role}`/.test(contact)){
  issues.push('contact.html stopped prefilling the hidden subject with the selected role.');
}

if(!/applyingFor\.textContent\s*=\s*`Applying for: \${role}`/.test(contact)){
  issues.push('contact.html stopped showing the Applying for helper when a role is provided.');
}

if(!/roleHint\.textContent\s*=\s*`Role: \${role}`/.test(contact)){
  issues.push('contact.html stopped surfacing the selected role in the quick contact card.');
}

if(issues.length){
  console.error('\nFound integration issue(s) between admin/jobs.html, jobs.html, and contact.html:');
  for(const issue of issues){
    console.error(` - ${issue}`);
  }
  process.exit(1);
}

console.log(`Validated admin jobs feed integration across ${adminBoards.size} board(s).`);
