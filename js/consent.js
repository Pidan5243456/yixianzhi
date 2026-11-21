const Consent=window.Consent={
 async state(){if(AppAPI.demo)return {ai_processing:!!Store.get().aiConsent,analytics:!!Store.get().privacyOk};const r=await AppAPI.request('/api/consents'),data=await r.json();if(!r.ok)throw Error(data.error||'授权状态无法读取');return data;},
 async set(purpose,granted){if(AppAPI.demo){Store.set(purpose==='ai_processing'?{aiConsent:granted}:{privacyOk:granted});await LocalState.flush();return;}
  const r=await AppAPI.request('/api/consents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose,granted})}),data=await r.json();if(!r.ok)throw Error(data.error||'授权更新失败');if(purpose==='analytics'){Store.set({privacyOk:granted});await LocalState.flush();}
 },
 async ensure(){if(AppAPI.demo)return;const key=LocalState.key,epoch=LocalState.epoch,state=await this.state();if(key!==LocalState.key||epoch!==LocalState.epoch)throw Error('账号已切换');if(state.ai_processing)return;
  if(!confirm('AI 会将本次选择的照片或衣物资料发送到你的服务器，并由 OpenRouter 或百炼处理。生成可能消耗可用额度。是否同意？'))throw Object.assign(Error('已取消'),{handled:true});await this.set('ai_processing',true);
 }
};
