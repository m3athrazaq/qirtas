package com.m3athrazaq.qirtas;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Base64;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

/**
 * Native helpers for Qirtas: printing / PDF, "share to Qirtas", speech recognition
 * and data for the home-screen widget.
 */
@CapacitorPlugin(
    name = "QirtasNative",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") }
)
public class QirtasNativePlugin extends Plugin {

    private static JSObject pendingShare = null;
    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private String speechLang = "ar-SA";

    // ---------------------------------------------------------------- printing

    @PluginMethod
    public void print(PluginCall call) {
        final String name = call.getString("name", "Qirtas");
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(name);
                pm.print(name, adapter, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    // ---------------------------------------------------------------- sharing

    static void handleShareIntent(Context ctx, Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        if (type == null) return;
        JSObject data = new JSObject();
        if (type.startsWith("text/")) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (text != null) data.put("text", text);
            if (subject != null) data.put("subject", subject);
        } else if (type.startsWith("image/")) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) {
                try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
                    if (in != null) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] buf = new byte[16384];
                        int n;
                        int total = 0;
                        while ((n = in.read(buf)) != -1 && total < 15 * 1024 * 1024) {
                            out.write(buf, 0, n);
                            total += n;
                        }
                        String b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                        data.put("image", "data:" + type + ";base64," + b64);
                    }
                } catch (Exception ignored) {
                }
            }
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) data.put("text", text);
        }
        if (data.length() > 0) pendingShare = data;
    }

    @PluginMethod
    public void getSharedContent(PluginCall call) {
        JSObject data = pendingShare;
        pendingShare = null;
        call.resolve(data != null ? data : new JSObject());
    }

    // ---------------------------------------------------------------- widget data

    @PluginMethod
    public void setWidgetData(PluginCall call) {
        String json = call.getString("json", "{}");
        SharedPreferences prefs = getContext().getSharedPreferences("qirtas_widget", Context.MODE_PRIVATE);
        prefs.edit().putString("data", json).apply();
        call.resolve();
    }

    // ---------------------------------------------------------------- speech

    @PluginMethod
    public void startSpeech(PluginCall call) {
        speechLang = call.getString("lang", "ar-SA");
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermissionCallback");
            return;
        }
        beginListening(call);
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            beginListening(call);
        } else {
            call.reject("Microphone permission denied");
        }
    }

    private void beginListening(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                call.reject("Speech recognition unavailable");
                return;
            }
            if (recognizer != null) recognizer.destroy();
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onEvent(int eventType, Bundle params) {}

                @Override
                public void onError(int error) {
                    if (listening && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) {
                        startRecognizer();
                        return;
                    }
                    if (listening) {
                        JSObject o = new JSObject();
                        o.put("error", error);
                        notifyListeners("speechError", o);
                    }
                }

                @Override
                public void onResults(Bundle results) {
                    emit(results, true);
                    if (listening) startRecognizer();
                }

                @Override
                public void onPartialResults(Bundle partialResults) {
                    emit(partialResults, false);
                }
            });
            listening = true;
            startRecognizer();
            call.resolve();
        });
    }

    private void emit(Bundle bundle, boolean isFinal) {
        if (bundle == null) return;
        ArrayList<String> list = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list == null || list.isEmpty()) return;
        JSObject o = new JSObject();
        o.put("text", list.get(0));
        o.put("final", isFinal);
        notifyListeners("speech", o);
    }

    private void startRecognizer() {
        if (recognizer == null) return;
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, speechLang);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        recognizer.startListening(intent);
    }

    @PluginMethod
    public void stopSpeech(final PluginCall call) {
        listening = false;
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) {
                recognizer.stopListening();
                recognizer.destroy();
                recognizer = null;
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        listening = false;
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        super.handleOnDestroy();
    }
}
