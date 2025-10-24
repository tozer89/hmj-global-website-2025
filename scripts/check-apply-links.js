#!/usr/bin/env node
const { normalizeApplyUrl, applyHref } = require('../js/jobs-apply.js');
const jobs = require('../data/jobs.json').jobs || [];

const contexts = [
  { name: 'production', location: { origin: 'https://hmj-global.com', hostname: 'hmj-global.com' } },
  { name: 'preview', location: { origin: 'https://deploy-preview.example.netlify.app', hostname: 'deploy-preview.example.netlify.app' } }
];

let checked = 0;
const failures = [];

for(const ctx of contexts){
  for(const job of jobs){
    checked++;
    const locText = job.locationText || '';
    const normalized = normalizeApplyUrl(job, locText, ctx.location);
    if(typeof normalized !== 'string' || !normalized.trim()){
      failures.push(`${ctx.name}: ${job.title} produced empty apply URL`);
      continue;
    }
    const trimmed = normalized.trim();

    const raw = job.applyUrl && job.applyUrl.trim();
    const base = ctx.location.origin;
    const original = raw ? new URL(raw, base) : null;

    if(trimmed.startsWith('http')){
      try{
        // Ensure absolute URLs retain their target when external
        const parsed = new URL(trimmed);
        if(!original){
          failures.push(`${ctx.name}: ${job.title} normalized to absolute URL without original`);
        }else if(parsed.href !== original.href && (original.origin !== ctx.location.origin || original.hostname)){
          failures.push(`${ctx.name}: ${job.title} external apply URL changed from ${original.href} to ${parsed.href}`);
        }
      }catch(err){
        failures.push(`${ctx.name}: ${job.title} has invalid normalized URL ${trimmed}`);
      }
      continue;
    }

    // Relative URL checks
    if(!trimmed.startsWith('/')){
      failures.push(`${ctx.name}: ${job.title} normalized to unexpected URL ${trimmed}`);
      continue;
    }

    const normalizedUrl = new URL(`https://hmj-global.com${trimmed}`);
    const roleValue = normalizedUrl.searchParams.get('role');
    const expectedRole = `${job.title}${locText ? ` (${locText})` : ''}`;

    if(!raw){
      if(!trimmed.startsWith('/contact.html')){
        failures.push(`${ctx.name}: ${job.title} fallback should target /contact.html but got ${trimmed}`);
      }
      if(roleValue !== expectedRole){
        failures.push(`${ctx.name}: ${job.title} fallback role mismatch (expected "${expectedRole}" got "${roleValue}")`);
      }
      continue;
    }

    const contactPath = original.pathname.replace(/\/+$/,'');
    const isContact = /\/contact(?:\.html)?$/i.test(contactPath);
    const originalHost = (original.hostname || '').replace(/^www\./i,'');
    const currentHost = ctx.location.hostname.replace(/^www\./i,'');
    const isSameHost = originalHost === currentHost;
    const isHmjHost = originalHost === 'hmj-global.com';

    if(isContact && (isSameHost || isHmjHost || !original.hostname)){
      if(!trimmed.startsWith('/contact.html')){
        failures.push(`${ctx.name}: ${job.title} contact apply link should rewrite to /contact.html but got ${trimmed}`);
      }
      if(roleValue !== expectedRole){
        failures.push(`${ctx.name}: ${job.title} contact role mismatch (expected "${expectedRole}" got "${roleValue}")`);
      }
      continue;
    }

    if(original.origin === ctx.location.origin || !original.hostname){
      const expectedPath = `${original.pathname}${original.search}${original.hash}` || applyHref(job.title, locText);
      if(trimmed !== expectedPath){
        failures.push(`${ctx.name}: ${job.title} same-origin apply link mismatch (expected ${expectedPath}, got ${trimmed})`);
      }
      continue;
    }

    // External URLs should remain absolute and were handled earlier
    failures.push(`${ctx.name}: ${job.title} normalized to unexpected relative path ${trimmed}`);
  }
}

if(failures.length){
  console.error(`\nFound ${failures.length} job apply link issue(s):`);
  for(const issue of failures){
    console.error(` - ${issue}`);
  }
  process.exit(1);
}

console.log(`Checked ${checked} job apply link scenarios across ${contexts.length} context(s).`);
