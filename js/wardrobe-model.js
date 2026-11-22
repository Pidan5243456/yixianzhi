/* Shared business rules. Image inspection is authoritative only on the server. */
(function(root){
  const categories=['上衣','下装','鞋子','连体裙'],scenes=['日常','通勤','约会','旅行','其他'];
  function normalize(i){const x={...i,ownership:i.ownership===undefined?'owned':i.ownership};
    x.originalImage=i.originalImage||i.dataUrl||null;x.cutoutImage=i.cutoutImage||null;
    x.dataUrl=x.cutoutImage||x.originalImage;return x;}
  function validate(i){
    if(!i||typeof i.name!=='string'||i.name.length>80||!categories.includes(i.cat))throw Error('衣物格式无效');
    if(i.ownership!==undefined&&!['owned','wishlist'].includes(i.ownership))throw Error('衣物归属无效');
    if(i.warmth!==undefined&&!['','light','medium','warm'].includes(i.warmth))throw Error('保暖标签无效');
    if(i.color!==undefined&&(typeof i.color!=='string'||i.color.length>30))throw Error('颜色格式无效');
    if(i.scene!==undefined&&!scenes.includes(i.scene))throw Error('衣物场景无效');
    if(i.processing!==undefined){const p=i.processing;if(!p||typeof p!=='object'||Array.isArray(p)||!/^media:[a-f0-9]{64}$/.test(p.source)||typeof p.operationId!=='string'||p.operationId.length>120||typeof p.version!=='string'||p.version.length>100)throw Error('图片处理关联无效');}
    return i;
  }
  function context(value={}){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('穿搭条件无效');
    const {date='',scene='日常',temperature=null}=value;
    if(typeof date!=='string'||(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)))throw Error('日期无效');
    if(!scenes.includes(scene)||temperature!==null&&(!Number.isFinite(temperature)||temperature<-50||temperature>60))throw Error('场景或温度无效');
    return {date,scene,temperature};
  }
  function tomorrow(){const d=new Date();d.setDate(d.getDate()+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function recommend(pool,around,settings={}){
    const ctx=context(settings),anchor=pool.find(i=>i.id===around),temp=ctx.temperature;
    const target=temp===null?'':temp<=12?'warm':temp>=25?'light':'medium';
    const score=i=>(i.scene===ctx.scene?4:0)+(target&&i.cat!=='鞋子'?(i.warmth===target?6:i.warmth?-3:0):0);
    const available=pool.filter(i=>!anchor?.gender||!i.gender||i.gender===anchor.gender).slice().sort((a,b)=>score(b)-score(a)||String(a.id).localeCompare(String(b.id)));
    const pick=cat=>anchor?.cat===cat?anchor:available.find(i=>i.cat===cat);
    const dress=anchor?.cat==='连体裙'||(!['上衣','下装'].includes(anchor?.cat)&&pick('连体裙')&&(!pick('上衣')||!pick('下装')));
    const need=dress?['连体裙','鞋子']:['上衣','下装','鞋子'];
    const chosen=need.map(pick).filter(Boolean),missing=need.filter(c=>!pick(c));
    const notes=[];if(missing.length)notes.push('还缺'+missing.join('、'));
    if(chosen.some(i=>i.cat!=='鞋子'&&!i.warmth))notes.push('部分衣物未填写保暖标签');
    if(temp!==null&&temp<=12)notes.push('低温出行请另确认外套及实际保暖程度');
    return {items:chosen.map(i=>i.id),missing,reason:notes.join('；')||'已按场景和保暖标签选搭',context:ctx,method:'rules'};
  }
  const api={categories,scenes,normalize,validate,context,tomorrow,recommend};
  if(typeof module!=='undefined')module.exports=api;else root.WardrobeModel=api;
})(globalThis);
