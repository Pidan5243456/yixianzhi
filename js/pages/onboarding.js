renderStatusbar();
$('#btnBack').onclick=()=>AppNav.back();
$$('#pickPref .pick').forEach(b=>b.onclick=()=>b.classList.toggle('active'));
async function finish(url){Store.set({onboarded:true,profile:{...Store.get().profile,pref:$$('#pickPref .active').map(b=>b.dataset.v)}});await AppNav.go(url);}
$('#btnFinish').onclick=()=>finish('add-clothes.html');$('#btnSkipItems').onclick=()=>finish('wardrobe.html');
