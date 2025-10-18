<!-- /admin/common.js -->
<script>
/* Admin bootstrap + shared helpers */
(function(){
  const S = sel => document.querySelector(sel);

  function toast(msg, type='info'){
    let box = S('#toast');
    if(!box){ box = document.createElement('div'); box.id='toast'; box.style.position='fixed'; box.style.right='16px'; box.style.bottom='16px'; box.style.display='grid'; box.style.gap='8px'; document.body.appendChild(box); }
    const n = document.createElement('div');
    n.className='toast';
    n.style.cssText = 'background:#0f172a;border:1px solid #233044;border-radius:10px;padding:10px 12px;color:#e6eef7;font:14px/1.3 system-ui';
    n.textContent = msg;
    box.appendChild(n);
    setTimeout(()=>n.remove(), 2600);
  }

  const isAdmin = u => (u?.app_metadata?.roles || u?.roles || []).includes('admin');

  async function api(path, method='GET', body=null){
    const u = window.netlifyIdentity?.currentUser();
    if(!u) throw new Error('No session');
    const t = await u.jwt();
    const r = await fetch(`/.netlify/functions${path}`, {
      method,
      headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer '+t },
      body: body ? JSON.stringify(body) : null
    });
    const text = await r.text();
    if(!r.ok){
      let msg=text; try{ const j=JSON.parse(text); msg=j.error||j.message||text; }catch{}
      throw new Error(msg);
    }
    try{ return JSON.parse(text); }catch{ throw new Error('bad_json_response'); }
  }

  function show(el, yes){ el.style.display = yes ? '' : 'none'; }

  async function bootAdmin(){
    const gate = S('#gate') || {style:{}};
    const app  = S('#app')  || {style:{}};
    const u = window.netlifyIdentity?.currentUser();
    if(!u || !isAdmin(u)){
      show(gate, true); show(app,false);
      const why = gate.querySelector('.why');
      if(why) why.textContent = u ? 'Your account is not an admin.' : 'You are not logged in.';
      return;
    }
    show(gate,false); show(app,true);
    if(typeof window.main === 'function'){
      try{ await window.main({ api, user:u, sel:S, toast }); }
      catch(e){ toast('Init failed: '+(e.message||e)); console.error(e); }
    }
  }

  // One-time Identity wiring
  document.addEventListener('DOMContentLoaded', ()=>{
    window.netlifyIdentity?.on('init', bootAdmin);
    window.netlifyIdentity?.on('login', ()=>location.reload());
    window.netlifyIdentity?.on('logout', ()=>location.href='/');
    // if the widget has already loaded the session:
    setTimeout(()=>{ if(window.netlifyIdentity?.currentUser()) bootAdmin(); else show(S('#gate'), true); }, 600);
  });
})();
</script>
