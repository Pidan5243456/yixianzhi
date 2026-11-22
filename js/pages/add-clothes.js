renderStatusbar();
const editingId=new URLSearchParams(location.search).get('id');
const initial=Store.get().customItems.find(i=>i.id===editingId),key=LocalState.key,epoch=LocalState.epoch;
let photo=initial?.originalImage||initial?.dataUrl||null,changedPhoto=false,picking=0,saving=false,savedId=initial?.id||'c_'+crypto.randomUUID();
const pending=Store.get().pendingUpload;
if(!photo&&pending&&pending!=='ph')photo=pending.image||pending;
const current=()=>key===LocalState.key&&epoch===LocalState.epoch&&!LocalState.locked;
function showForm(){if(!photo)return;$('#garmentPhoto').src=MediaCache.src(photo);$('#garmentForm').hidden=false;}
if(initial){$('.entry h1').textContent='编辑衣物';for(const [field,k]of Object.entries({Name:'name',Category:'cat',Scene:'scene',Ownership:'ownership',Warmth:'warmth',Color:'color'}))$('#garment'+field).value=initial[k]??({scene:'日常',ownership:'owned'}[k]||'');}
showForm();
$('#wayAlbum').onclick=()=>$('#fileInput').click();$('#wayCam').onclick=()=>$('#camInput').click();
async function onPick(e){const f=e.target.files[0];e.target.value='';if(!f)return;
if(!f.type.startsWith('image/')||f.size>20*1024*1024){toast('请选择不超过20MB的图片');return;}
const seq=++picking;
try{const data=await LocalState.prepare(async()=>{const raw=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(r.error);r.readAsDataURL(f);});return compressImage(raw,1200,.85);});
if(seq!==picking||!current())return;photo=data;changedPhoto=true;showForm();if(!$('#garmentName').value)$('#garmentName').value='我的衣物';
}catch(err){toast('照片无法打开，请换一张');}}
$('#fileInput').onchange=onPick;$('#camInput').onchange=onPick;
$('#garmentForm').onsubmit=async e=>{e.preventDefault();if(saving||!photo||!current())return;const name=$('#garmentName').value.trim();if(!name)return;
saving=true;$('#saveGarment').disabled=true;
try{const s=Store.get(),latest=s.customItems.find(i=>i.id===savedId);
if(editingId&&!latest)throw Error('这件衣物已移除，请返回衣橱');
if(initial&&latest.updatedAt!==initial.updatedAt)throw Error('衣物已在其他页面更新，请重新打开后编辑');
if(s.customItems.length>=1000&&!latest)throw Error('已达到衣物数量上限');
const item=WardrobeModel.normalize({...latest,id:savedId,name,cat:$('#garmentCategory').value,scene:$('#garmentScene').value,ownership:$('#garmentOwnership').value,warmth:$('#garmentWarmth').value,color:$('#garmentColor').value.trim(),originalImage:photo,cutoutImage:changedPhoto?null:latest?.cutoutImage||null,ph:'tee',source:'manual',createdAt:latest?.createdAt||Date.now(),updatedAt:Date.now()});
if(changedPhoto)delete item.processing;WardrobeModel.validate(item);
if(Store.set({customItems:[item,...s.customItems.filter(i=>i.id!==savedId)],pendingUpload:null})===false)throw Error('资料正在切换，请稍后重试');await LocalState.flush();await AppNav.go('wardrobe.html');
}catch(err){toast(err.message||'保存失败，请重试');}finally{saving=false;$('#saveGarment').disabled=false;}};
