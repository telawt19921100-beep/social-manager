package com.example.pagemanager;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

// Lets the user pick a notification sound from the phone, then creates a
// notification channel that uses that sound for prayer alerts.
@CapacitorPlugin(name = "Ringtone")
public class RingtonePlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_NOTIFICATION);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
        JSObject ret = new JSObject();
        ret.put("uri", uri == null ? "" : uri.toString());
        call.resolve(ret);
    }

    // Android cannot change an existing channel's sound, so each sound gets its own channel id.
    @PluginMethod
    public void ensureChannel(PluginCall call) {
        String uriStr = call.getString("uri", "");
        String channelId = "prayer_" + Math.abs(uriStr.hashCode());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel ch = new NotificationChannel(channelId, "مواقيت الصلاة", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("تنبيهات مواقيت الصلاة");
            if (!uriStr.isEmpty()) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                ch.setSound(Uri.parse(uriStr), attrs);
            }
            nm.createNotificationChannel(ch);
        }
        JSObject ret = new JSObject();
        ret.put("channelId", channelId);
        call.resolve(ret);
    }
}
