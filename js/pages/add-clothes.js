renderStatusbar();
const editingId=new URLSearchParams(location.search).get('id');
const original=Store.get().customItems.find(i=>i.id===editingId);
let photo=original?.dataUrl||null,picking=0,saving=false,savedId=original?.id||'c_'+crypto.randomUUID();
const pending=Store.get().pendingUpload;
if(!photo&&pending&&pending!=='ph')photo=pending.image||pending;
function showForm(){if(!photo)return;$('#garmentPhoto').src=MediaCache.src(photo);$('#garmentForm').hidden=false;}
if(original){$('.entry h1').textContent='编辑衣物';$('#garmentName').value=original.name;$('#garmentCategory').value=original.cat;$('#garmentScene').value=original.scene||'日常';}
showForm();
$('#wayAlbum').onclick=()=>$('#fileInput').click();$('#wayCam').onclick=()=>$('#camInput').click();
async function onPick(e){const f=e.target.files[0];e.target.value='';if(!f)return;
if(!f.type.startsWith('image/')||f.size>20*1024*1024){toast('请选择不超过20MB的图片');return;}
const seq=++picking,epoch=LocalState.epoch,key=LocalState.key;
try{const data=await LocalState.prepare(async()=>{const raw=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=()=>no(r.error);r.readAsDataURL(f);});return compressImage(raw,1200,.85);});
if(seq!==picking||epoch!==LocalState.epoch||key!==LocalState.key||LocalState.locked)return;photo=data;showForm();if(!$('#garmentName').value)$('#garmentName').value='我的衣物';
}catch(err){toast('照片无法打开，请换一张');}}
$('#fileInput').onchange=onPick;$('#camInput').onchange=onPick;
$('#garmentForm').onsubmit=async e=>{e.preventDefault();if(saving||!photo)return;const name=$('#garmentName').value.trim();if(!name)return;
saving=true;$('#saveGarment').disabled=true;
try{const s=Store.get();if(s.customItems.length>=1000&&!original)throw Error('已达到衣物数量上限');const item={...original,id:savedId,name,cat:$('#garmentCategory').value,scene:$('#garmentScene').value,dataUrl:photo,ph:'tee',source:'manual',createdAt:original?.createdAt||Date.now(),updatedAt:Date.now()};
if(Store.set({customItems:[item,...s.customItems.filter(i=>i.id!==savedId)],pendingUpload:null})===false)throw Error('资料正在切换，请稍后重试');await LocalState.flush();await AppNav.go('wardrobe.html');
}catch(err){toast(err.message||'保存失败，请重试');}finally{saving=false;$('#saveGarment').disabled=false;}};
