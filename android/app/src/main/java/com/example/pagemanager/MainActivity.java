package com.example.pagemanager;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RingtonePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
