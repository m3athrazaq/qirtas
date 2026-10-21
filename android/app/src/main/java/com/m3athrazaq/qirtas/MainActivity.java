package com.m3athrazaq.qirtas;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(QirtasNativePlugin.class);
        super.onCreate(savedInstanceState);
        QirtasNativePlugin.handleShareIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        QirtasNativePlugin.handleShareIntent(this, intent);
    }
}
