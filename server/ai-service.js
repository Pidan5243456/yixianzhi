const control=require('./ai-control'),media=require('./media'),sync=require('./sync-v2'),{db,transaction}=require('./database'),config=require('./ai/config'),auth=require('./auth');
const fail=control.fail;
function configured(kind){if(auth.demo)return;if(['INSPECT','CUTOUT','TRYON'].includes(kind))return require('./ai/local-gateway').ready(kind);if(!config.OPENROUTER_API_KEY||(kind==='SPLIT'&&!config.DASHSCOPE_API_KEY))throw fail('AI 服务尚未配置，请联系服务部署者',503);for(const key of ['AI_GLOBAL_DAILY_MICRO_USD','AI_USER_DAILY_MICRO_USD','AI_MAX_OPENROUTER_MICRO_USD',...(kind==='SPLIT'?['AI_MAX_DASHSCOPE_MICRO_USD']:[])])if(!control.integer(key))throw fail('AI 预算尚未配置或已关闭',503,'BUDGET_DISABLED');}
function picture(owner,value,write=true){if(typeof value!=='string')throw fail('缺少图片');if(value.startsWith('media:')){media.validateRefs(owner,value);return value;}const {b}=require('./state').decodeImage(value);return write?media.upload(owner,value):'media:'+media.hash(b);}
const text=(v,max=100)=>{if(typeof v!=='string'||v.length>max||/[<>]/.test(v))throw fail('文本字段无效');return v;};
function outfitContext(value){try{return require('../js/wardrobe-model').context(value);}catch(e){throw fail(e.message);}}
function prepare(owner,kind,body){
 if(!['INSPECT','CUTOUT','TRYON','RECOMMEND','VALIDATE'].includes(kind))throw fail('不支持的 AI 功能');
 const adapterVersion=process.env.LOCAL_AI_VERSION||'unconfigured';
 if(['INSPECT','CUTOUT'].includes(kind)){
  const image=picture(owner,body.image,false),purpose=kind==='CUTOUT'?'garment':text(body.purpose||'',30),target=text(body.target||'',30);
  if(!['person','garment'].includes(purpose)||purpose==='person'&&target!=='full_body'||purpose==='garment'&&!['上衣','下装','鞋子','连体裙'].includes(target))throw fail('照片检查用途无效');
  if(kind==='INSPECT')return {image,purpose,target,adapterVersion,processingMode:auth.demo?'demo':'real',inspectionEpoch:Math.floor(Date.now()/(7*86400000))};
  const itemId=text(body.itemId||'',120),item=sync.get(owner,'customItems',itemId);if(!item||item.deleted||(item.data.originalImage||item.data.dataUrl)!==image||item.data.cat!==target)throw fail('衣物或原照片已改变',409);
  return {image,purpose,target,itemId,inspectionId:text(body.inspectionId||'',120),adapterVersion};
 }
 // Validate before charging or uploading. Incoming data never chooses an owner/model/prompt.
 if(kind==='TRYON'){
  if(!Array.isArray(body.items)||!body.items.length||body.items.length>4)throw fail('请选择 1～4 件衣物');
  const items=body.items.map(i=>({id:text(i.id,120),category:text(i.category,10),image:i.image,inspectionId:text(i.inspectionId||'',120)}));
  if(new Set(items.map(i=>i.id)).size!==items.length||items.some(i=>!['上衣','下装','鞋子','连体裙'].includes(i.category)))throw fail('衣物组合无效');
  for(const v of [body.modelImage,...items.map(i=>i.image)])if(typeof v!=='string'||!v.startsWith('media:'))require('./state').decodeImage(v);else media.validateRefs(owner,v);
  return {modelImage:picture(owner,body.modelImage,false),items:items.map(i=>({...i,image:picture(owner,i.image,false)})),modelId:text(body.modelId||'m1',120),outfitId:text(body.outfitId||'',120),scene:text(body.scene||'日常',40),context:outfitContext(body.context||{scene:body.scene||'日常'}),inspectionId:text(body.inspectionId||'',120),adapterVersion};
 }
 if(kind==='VALIDATE'){return {image:picture(owner,body.image,false)};}
 if(!Array.isArray(body.wardrobe)||!body.wardrobe.length||body.wardrobe.length>1000)throw fail('衣橱格式错误');
 const wardrobe=body.wardrobe.map(i=>({id:text(i.id,120),category:text(i.category,10),name:text(i.name||'',80),custom:!!i.custom,gender:text(i.gender||'',20),labels:i.labels&&typeof i.labels==='object'?Object.fromEntries(Object.entries(i.labels).slice(0,12).map(([k,v])=>[text(k,30),text(String(v),100)])):null}));
 const around=body.around?text(body.around,120):null;if(around&&!wardrobe.some(i=>i.id===around))throw fail('指定衣物不在衣橱中');return {wardrobe,around,context:outfitContext(body.context||{})};
}
function verifyInspection(owner,id,image,purpose,target,version){
 const op=control.owned(owner,id),saved=db.prepare('SELECT * FROM operation_inputs WHERE id=? AND expires_at>?').get(id,Date.now());
 const outcome=JSON.parse(op.result||'{}');
 if(op.kind!=='INSPECT'||op.status!=='done'||!saved||outcome.mock||outcome.fallback||outcome.inspection!=='passed')throw fail('照片需要重新检查，未通过前不能生成',422,'INSPECTION_REQUIRED');
 const checked=JSON.parse(saved.data);if(checked.processingMode!=='real'||checked.image!==image||checked.purpose!==purpose||checked.target!==target||checked.adapterVersion!==version)throw fail('照片检查与本次图片或用途不匹配',422,'INSPECTION_REQUIRED');
}
function checkInputs(owner,kind,input){if(auth.demo)return;if(['INSPECT','CUTOUT','TRYON'].includes(kind)&&input.adapterVersion!==(process.env.LOCAL_AI_VERSION||'unconfigured'))throw fail('服务版本已变化，请重新提交',409);
 if(kind==='CUTOUT')verifyInspection(owner,input.inspectionId,input.image,'garment',input.target,input.adapterVersion);
 if(kind==='TRYON'){verifyInspection(owner,input.inspectionId,input.modelImage,'person','full_body',input.adapterVersion);for(const i of input.items)verifyInspection(owner,i.inspectionId,i.image,'garment',i.category,input.adapterVersion);}
}
function execute(owner,kind,input,id){return (async()=>{
 const real=media.inflate(owner,input);let result;
 if(auth.demo)result=kind==='INSPECT'?{inspection:'passed',reason:'演示检查',mock:true}:kind==='CUTOUT'?{image:real.image,mock:true}:kind==='TRYON'?{image:real.modelImage,mock:true}:kind==='VALIDATE'?{pass:true,mock:true}:{items:[...new Map(real.wardrobe.map(i=>[i.category,i.id])).values()].slice(0,4),reason:'演示搭配',mock:true};
 else if(['INSPECT','CUTOUT','TRYON'].includes(kind))result=await require('./ai/local-gateway').run(kind,real,id);
 else result=await require('./ai/'+({TRYON:'tryon',RECOMMEND:'recommend',VALIDATE:'validate'}[kind]))(real);control.assertCurrent();
 if(kind==='CUTOUT'){const image=picture(owner,result.image),value={image,itemId:input.itemId};return {value,commit:()=>Object.assign(value,sync.applyCutout(owner,input.itemId,input.image,image,id,input.adapterVersion))};}
 if(kind==='TRYON'){
  if(!result.image&&!auth.demo)throw fail('模型未返回有效图片',502);
  const image=picture(owner,result.image||(auth.demo?real.modelImage:null));
  const record={id:'h_'+id,operationId:id,modelId:input.modelId,outfitId:input.outfitId||null,items:input.items.map(i=>i.id),scene:input.scene,context:input.context,time:Date.now(),image,kind:auth.demo?'collage':'tryon'};
  return {value:{image,record,mock:auth.demo},commit:()=>sync.generated(owner,{kind:'history',id:record.id,data:record})};
 }
 if(kind==='VALIDATE'&&!auth.demo&&(result.mock||result.fallback))throw fail('照片质检未完成',502);
 return result;
 })();}
function start(owner,kind,body,retry=false){let input=prepare(owner,kind,body),cached=control.find(owner,kind,input);
 // Only a new user action reaches this path. Action receipts are checked first.
 let depth=0;while(kind==='TRYON'&&cached?.status==='done'&&sync.get(owner,'history','h_'+cached.id)?.deleted){if(++depth>1000)throw fail('相同试穿的生成次数已达上限',429);input={...input,previousOperation:cached.id};cached=control.find(owner,kind,input);}
 if(cached&&['done','queued','running'].includes(cached.status))return result(owner,cached.id);configured(kind);checkInputs(owner,kind,input);control.requireConsent(owner);if(kind==='TRYON'){picture(owner,body.modelImage);for(const i of body.items)picture(owner,i.image);}else if(['VALIDATE','INSPECT','CUTOUT'].includes(kind))picture(owner,body.image);return control.start(owner,kind,input,id=>execute(owner,kind,input,id),{retry,renewExpired:retry});}

function retry(owner,id){const op=control.owned(owner,id);if(op.kind==='SPLIT')return require('./jobs').retry(owner,id,-1);if(['done','queued','running'].includes(op.status))return control.output(op);
 const saved=db.prepare('SELECT * FROM operation_inputs WHERE id=? AND expires_at>?').get(id,Date.now());if(!saved)throw fail('原输入已过期，请重新选择',410);configured(op.kind);const input=JSON.parse(saved.data);checkInputs(owner,op.kind,input);media.validateRefs(owner,input);return control.start(owner,op.kind,input,opId=>execute(owner,op.kind,input,opId),{retry:true});}
function result(owner,id){const op=control.owned(owner,id),r=control.output(op);if(op.kind==='TRYON'&&op.status==='done'){const record=sync.get(owner,'history','h_'+id);if(record?.deleted)return {...r,image:undefined,record:undefined,deleted:true};}media.touch(owner,r);return r;}
module.exports={start,retry,result,configured};
