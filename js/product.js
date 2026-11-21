/* Saved outfits are garment references; generated photos are separate history records. */
function allOutfits() { return [...Store.get().customOutfits, ...availableOutfits()]; }
function outfitById(id) { return allOutfits().find(o => o.id === id); }
function missingPieces(o) { return o.items.filter(id => !itemById(id)); }
function outfitImages(o) {
  const items = o.items.map(itemById).filter(Boolean);
  return items.length ? itemImg(items[0]) + '<div class="side">' + items.slice(1,4).map(i=>itemImg(i)).join('') + '</div>' : '<span class="missing-piece">衣物已移除</span>';
}
function toggleFavorite(id) {
  const s=Store.get(),on=s.favorites.includes(id);
  Store.set({favorites:on?s.favorites.filter(v=>v!==id):[...s.favorites,id]});
  savedToast(on?'已取消收藏':'已收藏');
}
function saveOutfitDialog(ids, currentId=null, favorite=false) {
  const items=[...new Set(ids)].filter(id=>itemById(id));
  if(!items.length) {toast('请先选择衣物');return Promise.resolve(null);}
  const existing=Store.get().customOutfits.find(o=>o.id===currentId);
  const key=LocalState.key,epoch=LocalState.epoch,id=existing?.id||'o_'+crypto.randomUUID();
  let saving=false;
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='product-dialog';
    dialog.innerHTML='<form><h2>保存搭配</h2><label>名称<input name="name" maxlength="80" required></label><label>场景<select name="scene">'+['日常','通勤','约会','旅行','其他'].map(v=>'<option>'+v+'</option>').join('')+'</select></label><div class="product-actions"><button type="button" class="btn btn-ghost" data-cancel>取消</button><button class="btn btn-primary">保存</button></div></form>';
    const form=dialog.querySelector('form');form.elements.name.value=existing?.name||'我的搭配';form.elements.scene.value=existing?.scene||'日常';
    let result=null;
    dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
    dialog.onclose=()=>{dialog.remove();resolve(result);};
    form.onsubmit=async e=>{e.preventDefault();if(saving)return;if(key!==LocalState.key||epoch!==LocalState.epoch)return dialog.close();
      const name=form.elements.name.value.trim();if(!name)return;
      const o={id,name,items,scene:form.elements.scene.value,createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};
      const s=Store.get();if(s.customOutfits.length>=1000&&!existing){toast('已达到搭配数量上限');return;}
      if(Store.set({customOutfits:[o,...s.customOutfits.filter(v=>v.id!==o.id)],...(favorite?{favorites:[...new Set([...s.favorites,o.id])]}:{})})===false)return;
      saving=true;form.querySelector('button[type=button]').disabled=true;
      try{await LocalState.flush();result=o;dialog.close();toast('搭配已保存');}catch{toast('保存失败，请重试');}finally{saving=false;form.querySelector('button[type=button]').disabled=false;}
    };
    document.body.append(dialog);dialog.showModal();form.elements.name.focus();
  });
}
function renderOutfitCards(root,list) {
  root.innerHTML=list.map(o=>'<article class="ocard" data-id="'+escapeHTML(o.id)+'"><button class="outfit-open" data-open="'+escapeHTML(o.id)+'" aria-label="查看'+escapeHTML(o.name)+'"><div class="collage">'+outfitImages(o)+'</div><h3>'+escapeHTML(o.name)+'</h3>'+(missingPieces(o).length?'<span class="missing-piece">有衣物已移除</span>':'')+'</button><div class="ofoot"><button class="star '+(Store.get().favorites.includes(o.id)?'on':'')+'" data-fav="'+escapeHTML(o.id)+'" aria-label="收藏搭配">'+uiIcon('star')+'</button><button class="try-pill" data-try="'+escapeHTML(o.id)+'">搭配预览</button></div></article>').join('');
  $$('[data-open]',root).forEach(b=>b.onclick=()=>AppNav.go('outfit-detail.html?id='+encodeURIComponent(b.dataset.open)));
  $$('[data-try]',root).forEach(b=>b.onclick=()=>AppNav.go('tryon.html?outfit='+encodeURIComponent(b.dataset.try)));
  $$('[data-fav]',root).forEach(b=>b.onclick=()=>{toggleFavorite(b.dataset.fav);b.classList.toggle('on',Store.get().favorites.includes(b.dataset.fav));});
}
