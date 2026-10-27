package io.github.ygfoster.gymmo2;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.widget.FrameLayout;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.lang.ref.WeakReference;

/**
 * Web アプリ（GymMo2）を全画面で表示する。ネイティブの役割は、休憩タイマーの通知・アラームと、
 * システムバー・戻る操作・キーボードまわりの調整。
 */
public class MainActivity extends Activity {
    static final String EXTRA_ROUTE = "route";
    private static final String TAG = "GymMo2";
    /** アプリの住所（Cloudflare）。旧住所（GitHub Pages）は新しい住所へ転送するページなので、アプリ内で開いて転送させる */
    private static final String APP_HOST = Uri.parse(BuildConfig.START_URL).getHost();
    private static final String LEGACY_HOST = "ygfoster.github.io";
    private static final int REQ_NOTIFICATIONS = 4001;

    private static volatile boolean foreground = false;
    private static WeakReference<MainActivity> instance = new WeakReference<>(null);

    private FrameLayout root;
    private WebView webView;
    private boolean pageReady = false;
    private String pendingRoute = null;

    static boolean isInForeground() {
        return foreground;
    }

    /** ネイティブ側で変わった休憩タイマーの状態を、Web 側へ取り込ませる（画面を見ているときだけ） */
    static void deliverEvents() {
        MainActivity a = instance.get();
        if (a == null || !foreground) return;
        a.runOnUiThread(a::pollWebEvents);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = new WeakReference<>(this);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.app_bg));
        setContentView(root);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // システムバーとキーボードの分だけ内側に余白を取る（Web 側の fixed 要素がバーに隠れないように）
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });

        configureWebView();
        registerBackHandler();
        applyTheme(isNight(), getColor(R.color.app_bg));
        TimerNotifier.ensureChannels(this);

        handleIntent(getIntent(), true);
    }

    private boolean isNight() {
        int mode = getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        return mode == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    /* ---------- WebView ---------- */
    private void configureWebView() {
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " GymMo2App/" + BuildConfig.VERSION_NAME);

        webView.addJavascriptInterface(new NativeBridge(this), "GymMoNative");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "[web] " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (isAppUrl(u)) return false;
                // アプリ外のリンクは、ブラウザで開く
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (RuntimeException ignored) {
                    // 開けるアプリがない
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (pendingRoute != null) {
                    navigateWeb(pendingRoute);
                    pendingRoute = null;
                }
                pollWebEvents();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOfflinePage();
            }
        });
    }

    private boolean isAppUrl(Uri u) {
        if (u == null) return false;
        String host = u.getHost();
        if (host == null) return false;
        if (host.equals(APP_HOST)) return true;
        if (host.equals(LEGACY_HOST) && u.getPath() != null && u.getPath().startsWith("/GymMo2")) return true;
        // debug ビルドでは、エミュレーターから見た Mac の開発サーバーも許可
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0 && host.equals("10.0.2.2");
    }

    private void showOfflinePage() {
        String html = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<body style='font-family:sans-serif;background:" + (isNight() ? "#000;color:#fff" : "#f2f2f7;color:#000")
                + ";display:grid;place-items:center;height:100vh;margin:0;text-align:center'>"
                + "<div><div style='font-size:20px;font-weight:700'>接続できません</div>"
                + "<p style='opacity:.6'>ネットワークを確認してから、もう一度お試しください。</p>"
                + "<button onclick='location.href=\"" + BuildConfig.START_URL + "\"' style='font-size:17px;padding:12px 28px;border:0;border-radius:14px;background:" + (isNight() ? "#fff;color:#000" : "#000;color:#fff") + "'>再読み込み</button></div>";
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    /* ---------- 起動・インテント ---------- */
    private void handleIntent(Intent intent, boolean initial) {
        String url = BuildConfig.START_URL;
        String route = null;
        if (intent != null) {
            Uri data = intent.getData();
            if (data != null && isAppUrl(data)) url = data.toString();
            route = intent.getStringExtra(EXTRA_ROUTE);
            // debug ビルドだけ、adb から読み込み先を差し替えられる（例: --es url http://10.0.2.2:5173/）
            if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                String override = intent.getStringExtra("url");
                if (override != null) url = override;
            }
        }
        if (initial || webView.getUrl() == null) {
            pageReady = false;
            pendingRoute = route;
            webView.loadUrl(url);
        } else if (intent != null && intent.getData() != null && isAppUrl(intent.getData())) {
            pageReady = false;
            pendingRoute = route;
            webView.loadUrl(url);
        } else if (route != null) {
            navigateWeb(route);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent, false);
    }

    private void navigateWeb(String route) {
        if (!pageReady) {
            pendingRoute = route;
            return;
        }
        // ルーター（hash）に任せる。JSON エスケープのため、許可した文字だけを通す
        if (!route.matches("^/[A-Za-z0-9/_\\-]*$")) return;
        webView.evaluateJavascript("window.__gymmoNavigate?window.__gymmoNavigate('" + route + "'):(location.hash='#" + route + "')", null);
    }

    void pollWebEvents() {
        if (webView == null || !pageReady) return;
        webView.evaluateJavascript("window.__gymmoNativePoll&&window.__gymmoNativePoll()", null);
    }

    /* ---------- ライフサイクル ---------- */
    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        webView.onResume();
        // 通知のボタンで変わった状態を取り込む。終了通知は見たものとして消す。
        android.app.NotificationManager nm = getSystemService(android.app.NotificationManager.class);
        nm.cancel(TimerNotifier.ID_DONE);
        pollWebEvents();
    }

    @Override
    protected void onPause() {
        foreground = false;
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (instance.get() == this) instance = new WeakReference<>(null);
        root.removeAllViews();
        webView.destroy();
        super.onDestroy();
    }

    /* ---------- 戻る操作 ---------- */
    private void registerBackHandler() {
        if (Build.VERSION.SDK_INT >= 33) {
            OnBackInvokedCallback cb = this::goBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (Build.VERSION.SDK_INT >= 33) {
            super.onBackPressed();
        } else {
            goBack();
        }
    }

    /** 戻る操作: まず Web 側（ルーター・シート）に処理させ、処理されなければアプリを閉じる（バックグラウンドへ） */
    private void goBack() {
        if (!pageReady) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript("window.__gymmoBack ? window.__gymmoBack() : false", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    /* ---------- 通知の許可 ---------- */
    boolean notificationsAllowed() {
        if (Build.VERSION.SDK_INT < 33) return true;
        return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && !notificationsAllowed()) {
            requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFICATIONS && webView != null) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('gymmo-native-permission',{detail:{notifications:" + ok + "}}))", null);
        }
    }

    /* ---------- システムバー ---------- */
    void applyTheme(boolean dark, int bgColor) {
        root.setBackgroundColor(bgColor);
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(bgColor));
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
        c.setAppearanceLightStatusBars(!dark);
        c.setAppearanceLightNavigationBars(!dark);
    }
}
