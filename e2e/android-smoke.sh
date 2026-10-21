#!/usr/bin/env bash
# Runs inside the Android emulator job: installs the app, drives its WebView over the
# DevTools protocol, and saves screenshots + logs in ./smoke.
set -u
mkdir -p smoke
APK=android/app/build/outputs/apk/debug/app-debug.apk
PKG=com.m3athrazaq.qirtas
adb install -r "$APK" > smoke/install.txt 2>&1
adb logcat -c
adb shell am start -n "$PKG/.MainActivity" > smoke/start.txt 2>&1
sleep 8
adb exec-out screencap -p > smoke/01a-launch-8s.png
adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp|Splash" >> smoke/start.txt 2>&1
sleep 17
adb exec-out screencap -p > smoke/01b-launch-25s.png
adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp|Splash" >> smoke/start.txt 2>&1
PID=$(adb shell pidof "$PKG" | tr -d '\r')
echo "pid=$PID" >> smoke/start.txt
adb forward tcp:9222 "localabstract:webview_devtools_remote_${PID}" >> smoke/start.txt 2>&1
node e2e/android-webview.cjs > smoke/webview.txt 2>&1
echo "exit=$?" >> smoke/webview.txt
adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp|Splash" >> smoke/start.txt 2>&1
adb logcat -d -v brief '*:W' > smoke/logcat-warnings.txt 2>&1
adb logcat -d -v brief -s Capacitor:V Capacitor/Console:V chromium:V > smoke/logcat-app.txt 2>&1
exit 0
