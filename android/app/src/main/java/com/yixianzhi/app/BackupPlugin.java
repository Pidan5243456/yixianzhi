package com.yixianzhi.app;

import android.app.Activity;
import android.content.Intent;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;

@CapacitorPlugin(name="Backup")
public class BackupPlugin extends Plugin {
    private OutputStream output;
    private String session;
    private int nextSequence;
    private byte[] lastHash;
    private long total;
    private boolean picking;

    @PluginMethod public synchronized void begin(PluginCall call) {
        if(output!=null || picking) {call.reject("已有备份正在导出");return;}
        picking=true;
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/x-ndjson");
        intent.putExtra(Intent.EXTRA_TITLE,"yixianzhi-backup.yxz");
        startActivityForResult(call,intent,"selected");
    }
    @ActivityCallback private synchronized void selected(PluginCall call,ActivityResult result) {
        picking=false;if(call==null)return;
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null || result.getData().getData()==null){call.reject("已取消导出");return;}
        try {
            output=getContext().getContentResolver().openOutputStream(result.getData().getData());
            if(output==null)throw new Exception("无法打开目标文件");
            session=UUID.randomUUID().toString();nextSequence=0;lastHash=null;total=0;
            JSObject reply=new JSObject();reply.put("session",session);call.resolve(reply);
        }catch(Exception e){close();call.reject("无法创建备份",e);}
    }
    private boolean valid(PluginCall call){return output!=null && session!=null && session.equals(call.getString("session"));}
    @PluginMethod public synchronized void write(PluginCall call) {
        if(!valid(call)){call.reject("导出会话已失效");return;}
        try {
            Integer sequence=call.getInt("seq");String data=call.getString("data");
            if(sequence==null || data==null || data.length()>100000)throw new Exception("数据块无效");
            byte[] bytes=Base64.decode(data,Base64.NO_WRAP);
            byte[] digest=MessageDigest.getInstance("SHA-256").digest(bytes);
            if(sequence==nextSequence-1 && lastHash!=null && Arrays.equals(lastHash,digest)){call.resolve();return;}
            if(sequence!=nextSequence)throw new Exception("数据块顺序错误");
            if(total+bytes.length>300L*1024*1024)throw new Exception("备份大小超限");
            output.write(bytes);total+=bytes.length;lastHash=digest;nextSequence++;call.resolve();
        }catch(Exception e){close();call.reject("备份写入失败，未完成的文件不能导入",e);}
    }
    @PluginMethod public synchronized void finish(PluginCall call) {
        if(!valid(call) || call.getInt("seq",-1)!=nextSequence){call.reject("备份尚未完整写入");return;}
        try {output.flush();output.close();output=null;session=null;JSObject reply=new JSObject();reply.put("saved",true);call.resolve(reply);}
        catch(Exception e){close();call.reject("备份未能保存完成",e);}
    }
    @PluginMethod public synchronized void cancel(PluginCall call){if(valid(call))close();call.resolve();}
    private void close(){if(output!=null)try{output.close();}catch(Exception ignored){}output=null;session=null;}
    @Override protected synchronized void handleOnDestroy(){close();super.handleOnDestroy();}
}
