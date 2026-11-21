/* Local Tabler SVGs (MIT). This layer has no access to business state. */
function uiIcon(name) {
  if(!/^[a-z-]+$/.test(name)) return '';
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="assets/ui/icons.svg#${name}"></use></svg>`;
}
document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=uiIcon(el.dataset.icon);});
document.addEventListener('keydown',e=>{
  if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role="button"]')){e.preventDefault();e.target.click();}
});
