/* Shared canonical entity representation; no credentials or device-only drafts. */
(function(root){
  const lists=['customItems','customOutfits','models','history'];
  const members=['favorites','wardrobe','deletedItems','processedSegmentTargets'];
  const settings=['account','profile','onboarded','privacyOk','curModel','historySeeded'];
  function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
  const json=v=>JSON.stringify(canonical(v));
  function flatten(s){const out={};for(const kind of lists)for(const data of s[kind]||[])out[kind+'/'+data.id]={kind,id:data.id,data};
    for(const kind of members)for(const id of s[kind]||[])out[kind+'/'+id]={kind,id,data:true};
    for(const id of settings)if(s[id]!==undefined)out['setting/'+id]={kind:'setting',id,data:id==='account'?{nick:s.account?.nick||'',avatar:s.account?.avatar||''}:s[id]};return out;}
  function apply(s,e){if(lists.includes(e.kind)){s[e.kind]=(s[e.kind]||[]).filter(v=>v.id!==e.id);if(!e.deleted)s[e.kind].push(e.data);s[e.kind].sort((a,b)=>(b.createdAt||b.time||0)-(a.createdAt||a.time||0));}
    else if(members.includes(e.kind)){s[e.kind]=(s[e.kind]||[]).filter(id=>id!==e.id);if(!e.deleted)s[e.kind].push(e.id);}
    else if(e.kind==='setting'){if(e.id==='account')s.account={...(e.deleted?{}:e.data),email:s.account?.email,token:s.account?.token};else if(e.deleted)delete s[e.id];else s[e.id]=e.data;}return s;}
  const api={lists,members,settings,canonical,json,flatten,apply};if(typeof module!=='undefined')module.exports=api;else root.Entities=api;
})(globalThis);
