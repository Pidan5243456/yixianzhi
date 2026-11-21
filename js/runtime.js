/* Shared transport. Never send credentials to an arbitrary resource URL. */
const AppAPI = {
  native: !!(window.Capacitor && window.Capacitor.isNativePlatform()),
  config() { try { return JSON.parse(localStorage.getItem('yxz-connection') || '{}'); } catch { return {}; } },
  get base() { return this.config().base || ''; },
  get demo() { return this.config().mode === 'demo' || (!this.base && (this.native || location.protocol === 'file:')); },
  get scope() { return this.demo ? 'demo' : (this.base || location.origin); },
  validateBase(value) {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('请输入服务根地址，不带路径、账号或参数');
    const h = u.hostname, privateHost = h === 'localhost' || h === '127.0.0.1' || /^10\.\d+\.\d+\.\d+$/.test(h) || /^192\.168\.\d+\.\d+$/.test(h) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h);
    if (u.protocol !== 'https:' && !(window.APP_BUILD?.debug && u.protocol === 'http:' && privateHost)) throw new Error('请使用 HTTPS；测试包仅支持局域网 HTTP');
    return u.origin;
  },
  url(path) {
    if (!path.startsWith('/api/')) throw new Error('接口路径不合法');
    return this.base + path;
  },
  request(path, options = {}) {
    if (this.demo) return Promise.reject(new Error('当前为本地演示，请先配置服务'));
    const headers = new Headers(options.headers || {});
    const account = typeof Store !== 'undefined' ? Store.get().account : null;
    if (account?.token && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + account.token);
    const epoch=window.LocalState ? LocalState.epoch : 0;
    return fetch(this.url(path), { ...options, headers, credentials:'omit', signal: options.signal || AbortSignal.timeout(30000) }).then(r=>{if(window.LocalState && epoch!==LocalState.epoch) throw new Error('会话已切换');return r;});
  }
};

window.addEventListener('DOMContentLoaded', () => {
  if (AppAPI.native) {
    const nativeApp = window.Capacitor.registerPlugin('App');
    nativeApp.addListener('backButton', ({ canGoBack }) => {
      const dialog = document.querySelector('dialog[open]');
      if (dialog) { dialog.close(); return; }
      const modal = document.querySelector('.modal-mask.show');
      if (modal) { modal.classList.remove('show'); return; }
      const sheet = document.querySelector('.sheet.show');
      if (sheet && typeof closeSheet === 'function') { closeSheet(sheet.id); return; }
      if (canGoBack) AppNav.back(); else AppNav.exit();
    });
  }
});
