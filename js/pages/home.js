renderStatusbar();renderTabbar('home');
let scene='全部',examples=false;
function renderOutfits(){const list=(examples?availableOutfits():Store.get().customOutfits).filter(o=>scene==='全部'||o.scene===scene);$('#outfitCount').textContent=list.length+' 套';$('#outfitSection').textContent=examples?'灵感示例':'已保存';
$('#showMine').className='btn '+(!examples?'btn-primary':'btn-ghost');$('#showExamples').className='btn '+(examples?'btn-primary':'btn-ghost');
if(list.length)renderOutfitCards($('#outfitGrid'),list);else $('#outfitGrid').innerHTML='<div class="empty product-empty"><h3>还没有保存穿搭</h3><a class="btn btn-primary" href="tryon.html">搭配我的衣服</a></div>';}
$('#showMine').onclick=()=>{examples=false;renderOutfits();};$('#showExamples').onclick=()=>{examples=true;renderOutfits();};renderChips($('#sceneChips'),SCENES,s=>{scene=s;renderOutfits();});renderOutfits();

window.addEventListener('data-synced',()=>renderOutfits());
