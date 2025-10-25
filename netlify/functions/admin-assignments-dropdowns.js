// netlify/functions/admin-assignments-dropdowns.js
const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');

async function safeSelect(run) {
  try {
    const { data, error } = await run();
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('[assignments-dropdowns] select failed:', err.message || err);
    return [];
  }
}

const baseHandler = async (event, context) => {
  try {
    const { supabase } = await getContext(event, context, { requireAdmin: true });

    const contractors = await safeSelect(() =>
      supabase.from('contractors').select('id,name,email').order('name', { ascending: true })
    );

    const clients = await safeSelect(() =>
      supabase.from('clients').select('id,name').order('name', { ascending: true })
    );

    const projectsRaw = await safeSelect(() =>
      supabase.from('projects').select('id,name,client_id').order('name', { ascending: true })
    );

    const siteRows = await safeSelect(() =>
      supabase.from('sites').select('id,name,client_id').order('name', { ascending: true })
    );

    const assignmentSites = await safeSelect(() =>
      supabase
        .from('assignments')
        .select('site_id,client_site,client_name,project_id')
        .not('site_id', 'is', null)
    );

    const clientMap = new Map(clients.map((c) => [c.id, c]));

    const projects = projectsRaw.map((project) => ({
      ...project,
      client_name: clientMap.get(project.client_id)?.name || null,
    }));

    const siteMap = new Map();

    siteRows.forEach((row) => {
      if (!row || row.id == null) return;
      siteMap.set(row.id, {
        id: row.id,
        name: row.name || null,
        client_name: clientMap.get(row.client_id)?.name || null,
        project_id: null,
      });
    });

    assignmentSites.forEach((row) => {
      if (!row || row.site_id == null) return;
      const existing = siteMap.get(row.site_id) || { id: row.site_id };
      siteMap.set(row.site_id, {
        ...existing,
        id: row.site_id,
        name: existing.name || row.client_site || null,
        client_name: existing.client_name || row.client_name || null,
        project_id: row.project_id || existing.project_id || null,
      });
    });
    const sites = Array.from(siteMap.values()).sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      if (aName === bName) return 0;
      return aName > bName ? 1 : -1;
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        contractors,
        clients,
        projects,
        sites,
      }),
    };
  } catch (e) {
    const status = e.code === 401 ? 401 : e.code === 403 ? 403 : 500;
    return { statusCode: status, body: JSON.stringify({ error: e.message }) };
  }
};

exports.handler = withAdminCors(baseHandler);
