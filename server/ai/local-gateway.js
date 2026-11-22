/* Fixed deployment-side adapter. No endpoint or model comes from the client. */
const sharp=require('sharp'),control=require('../ai-control'),{decodeImage}=require('../state');
const VERSION=1,kinds=['INSPECT','CUTOUT','TRYON'];
function settings(){
 const endpoint=process.env.LOCAL_AI_URL||'',version=process.env.LOCAL_AI_VERSION||'';
 if(!endpoint||!version||version.length>100)throw control.fail('本地 AI 服务尚未配置',503,'AI_UNAVAILABLE');
 let url;try{url=new URL(endpoint);}catch{throw control.fail('本地 AI 地址配置无效',503);}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw control.fail('本地 AI 地址配置无效',503);
 const timeout=control.integer('LOCAL_AI_TIMEOUT_MS',120000);if(timeout<20||timeout>150000)throw control.fail('本地 AI 超时配置无效',503);
 return {url:url.href,version,timeout,kinds:(process.env.LOCAL_AI_CAPABILITIES||'').split(',').map(s=>s.trim())};
}
function ready(kind){const s=settings();if(!control.integer('QUOTA_'+kind+'_PER_DAY',kind==='INSPECT'?30:20)||!control.integer('QUOTA_INSPECT_PER_DAY',30))throw control.fail('此图片处理能力已关闭',503,'AI_UNAVAILABLE');if(!s.kinds.includes(kind)||kind!=='INSPECT'&&!s.kinds.includes('INSPECT'))throw control.fail('所需图片检查或处理能力尚未配置',503,'AI_UNAVAILABLE');
 for(const k of ['AI_GLOBAL_DAILY_MICRO_USD','AI_USER_DAILY_MICRO_USD','AI_MAX_LOCAL_MICRO_USD'])if(!control.integer(k))throw control.fail('AI 调用预算尚未配置或已关闭',503,'BUDGET_DISABLED');return s;}
function capabilities(){return Object.fromEntries(kinds.map(kind=>{try{ready(kind);return [kind,{available:true,connectionVerified:false}];}catch(e){return [kind,{available:false,reason:e.message,code:e.code||'AI_UNAVAILABLE',connectionVerified:false}];}}));}
let decoding=0;const waiting=[];
async function inspectImage(image,options={}){if(decoding>=2)await new Promise(resolve=>waiting.push(resolve));else decoding++;
 try{return await decode(image,options);}finally{const next=waiting.shift();if(next)next();else decoding--;}}
async function decode(image,{cutout=false}={}){
 const {b,mime}=decodeImage(image);let meta;
 try{const decoder=sharp(b,{limitInputPixels:16777216,failOn:'warning'});meta=await decoder.metadata();if(!meta.width||!meta.height||meta.width<64||meta.height<64||meta.width>4096||meta.height>4096||meta.pages>1)throw Error();await decoder.raw().toBuffer();if(cutout&&(mime!=='image/png'||!meta.hasAlpha||(await sharp(b).stats()).isOpaque))throw Error();}
 catch{throw control.fail(cutout?'去背景结果必须是有效的透明 PNG':'图片损坏或尺寸不支持（64～4096 像素）',422,'INVALID_IMAGE');}return meta;
}
async function run(kind,input,operationId){
 const s=ready(kind);if(input.adapterVersion!==s.version)throw control.fail('服务版本已变化，请重新提交',409,'ADAPTER_CHANGED');
 const pictures=kind==='TRYON'?[input.modelImage,...input.items.map(i=>i.image)]:[input.image];
 const sizes=[];for(const picture of pictures)sizes.push(await inspectImage(picture));
 const response=await control.providerFetch('local',s.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(s.timeout),headers:{'Content-Type':'application/json',...(process.env.LOCAL_AI_TOKEN?{Authorization:'Bearer '+process.env.LOCAL_AI_TOKEN}:{})},body:JSON.stringify({protocol:VERSION,kind,operationId,adapterVersion:s.version,model:'local-'+s.version,input})});
 if(!response.ok)throw control.fail('本地 AI 服务拒绝了本次处理',502,'ADAPTER_REJECTED');
 const r=await response.json();if(r.protocol!==VERSION||r.kind!==kind||r.operationId!==operationId||r.adapterVersion!==s.version||r.mock||r.fallback)throw control.fail('AI 响应与任务不匹配',502,'INVALID_ADAPTER_RESPONSE');
 if(kind==='INSPECT'){
  if(!['passed','rejected','needs_selection'].includes(r.status)||typeof r.reason!=='string'||r.reason.length>200||/[<>]/.test(r.reason))throw control.fail('照片检查响应无效',502);
  const suggestions={};for(const [k,v]of Object.entries(r.suggestions||{}))if(['color','warmth','category'].includes(k)&&typeof v==='string'&&v.length<=40&&!/[<>]/.test(v))suggestions[k]=v;
  return {inspection:r.status,reason:r.reason,suggestions};
 }
 const size=await inspectImage(r.image,{cutout:kind==='CUTOUT'});
 if(kind==='CUTOUT'&&(size.width!==sizes[0].width||size.height!==sizes[0].height))throw control.fail('去背景结果尺寸与原图不一致',502);
 return {image:r.image};
}
module.exports={run,ready,settings,capabilities,inspectImage};
