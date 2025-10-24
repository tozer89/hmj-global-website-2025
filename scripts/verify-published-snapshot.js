#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function read(file){
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function extractNav(html){
  const navStart = html.indexOf('<nav');
  if(navStart === -1) return '';
  const navEnd = html.indexOf('</nav>', navStart);
  if(navEnd === -1) return '';
  return html.slice(navStart, navEnd + '</nav>'.length);
}

function normalize(str){
  return str.replace(/\s+/g, ' ').trim();
}

const pagesWithNav = [
  'index.html',
  'about.html',
  'clients.html',
  'candidates.html',
  'contact.html',
  'jobs.html'
];

const issues = [];

const requiredLinks = [
  'index.html',
  'clients.html',
  'candidates.html',
  'jobs.html'
];

pagesWithNav.forEach(page => {
  const html = read(page);
  const nav = extractNav(html);
  if(!nav){
    issues.push(`${page} is missing a <nav> element.`);
    return;
  }
  const normalized = normalize(nav);
  requiredLinks.forEach(link => {
    if(!normalized.includes(`href="${link}"`)){
      issues.push(`${page} navigation does not reference ${link}.`);
    }
  });
});

const adminJobs = read('admin/jobs.html');
if(!/id\s*=\s*['"]jobs-data['"]/i.test(adminJobs)){
  issues.push('admin/jobs.html no longer exposes #jobs-data for the public feed.');
}
if(!/class\s*=\s*['"][^'"]*\bjob\b/i.test(adminJobs)){
  issues.push('admin/jobs.html does not contain any .job card markup.');
}

const jobsHtml = read('jobs.html');
if(!/fetch\(\s*['"]\/admin\/jobs\.html['"]/.test(jobsHtml)){
  issues.push('jobs.html stopped fetching /admin/jobs.html; it would fall back to stale data.');
}
if(!/contact\.html\?role=/i.test(jobsHtml)){
  issues.push('jobs.html no longer generates contact.html apply links with a role query.');
}
if(!/querySelectorAll\(\s*['"]a\[href\*="contact\.html"\]['"]/.test(jobsHtml)){
  issues.push('jobs.html no longer attaches apply button feedback handlers.');
}

const contactHtml = read('contact.html');
if(!/const\s+params\s*=\s*new\s+URLSearchParams/.test(contactHtml)){
  issues.push('contact.html does not read the role from the query string.');
}
if(!/Applying for:\s*\$\{role\}/.test(contactHtml)){
  issues.push('contact.html no longer surfaces the selected role in the helper text.');
}

const forbidden = /admin-v2|admin_v2/;
if(forbidden.test(read('jobs.html')) || forbidden.test(adminJobs)){
  issues.push('Found legacy admin-v2 reference that should not be present.');
}

if(issues.length){
  console.error('\nSnapshot verification failed.');
  for(const issue of issues){
    console.error(` - ${issue}`);
  }
  process.exitCode = 1;
}else{
  console.log(`Verified navigation on ${pagesWithNav.length} page(s) and checked jobs/contact integration.`);
}
