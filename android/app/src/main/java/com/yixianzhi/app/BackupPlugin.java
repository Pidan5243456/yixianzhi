package com.yixianzhi.app;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name="Backup")
public class BackupPlugin extends Plugin {
    @PluginMethod public void export(PluginCall call) {
        String data=call.getString("data");
        if(data==null || data.length()>32*1024*1024) { call.reject("备份大小超限"); return; }
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE,"yixianzhi-backup.json");
        startActivityForResult(call,intent,"saved");
    }
    @ActivityCallback private void saved(PluginCall call, ActivityResult result) {
        if(call==null) return;
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null || result.getData().getData()==null) {call.reject("已取消导出");return;}
        try(OutputStream stream=getContext().getContentResolver().openOutputStream(result.getData().getData())) {
            if(stream==null) throw new Exception("无法打开目标文件");
            stream.write(call.getString("data", "{}").getBytes(StandardCharsets.UTF_8));
            JSObject reply=new JSObject();reply.put("saved",true);call.resolve(reply);
        } catch(Exception e) { call.reject("导出失败，请重试", e); }
    }
}
