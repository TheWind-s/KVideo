package com.kvideo.tv

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.database.Cursor
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.util.Log
import android.util.Rational
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebChromeClient.CustomViewCallback
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {

    companion object {
        private const val PREFS_NAME = "kvideo_tv_settings"
        private const val PREF_SERVER_URL = "server_url"
        private const val TAG = "KVideoMainActivity"

        // Fixed server endpoint; users cannot change it in the app.
        private const val DEFAULT_SERVER_URL = "https://kvideo-d38.pages.dev"

        // Applied at the very start of every navigation: forces the light theme
        // and paints the light-green base frame, eliminating the dark frame the
        // WebView can show before the first paint (esp. on system dark mode).
        private const val ANTI_FLASH_JS = """
            (function () {
              try { localStorage.setItem('theme', 'light'); } catch (e) {}
              document.documentElement.classList.remove('dark');
              if (!document.getElementById('__kv_antiflash')) {
                var s = document.createElement('style');
                s.id = '__kv_antiflash';
                s.textContent = 'html,body{background-color:#f4faf3!important;' +
                  'color-scheme:light;}';
                (document.head || document.documentElement).appendChild(s);
              }
            })();
        """
    }

    private lateinit var webView: WebView
    private lateinit var setupContainer: View
    private lateinit var fullscreenContainer: FrameLayout
    private lateinit var errorContainer: View
    private lateinit var errorDetailText: TextView
    private lateinit var retryButton: Button
    private lateinit var backOverlay: View
    private lateinit var urlInput: EditText
    private lateinit var statusText: TextView
    private lateinit var openButton: Button
    private lateinit var saveButton: Button
    private lateinit var prefs: android.content.SharedPreferences
    private var customView: View? = null
    private var customViewCallback: CustomViewCallback? = null
    private var wasSetupVisibleBeforeFullscreen = false
    private var lastBackPressedAt = 0L

    // APK 自更新：DownloadManager 任务 id 与完成广播接收器
    private var enqueuedApkDownloadId = -1L
    private var downloadCompleteReceiver: BroadcastReceiver? = null

    private val hideBackOverlayRunnable = Runnable {
        if (!::backOverlay.isInitialized) return@Runnable
        backOverlay.animate().cancel()
        backOverlay.animate()
            .alpha(0f)
            .setDuration(120)
            .withEndAction {
                backOverlay.visibility = View.GONE
                backOverlay.alpha = 1f
            }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        applyImmersiveMode()

        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webview)
        setupContainer = findViewById(R.id.setup_container)
        fullscreenContainer = findViewById(R.id.fullscreen_container)
        errorContainer = findViewById(R.id.error_container)
        errorDetailText = findViewById(R.id.error_detail)
        retryButton = findViewById(R.id.retry_button)
        backOverlay = findViewById(R.id.back_overlay)
        urlInput = findViewById(R.id.url_input)
        statusText = findViewById(R.id.status_text)
        openButton = findViewById(R.id.open_button)
        saveButton = findViewById(R.id.save_button)

        retryButton.setOnClickListener {
            errorContainer.visibility = View.GONE
            webView.reload()
        }

        saveButton.setOnClickListener {
            openConfiguredUrl()
        }
        urlInput.setOnEditorActionListener { _, actionId, event ->
            val isKeyboardConfirmAction = actionId == EditorInfo.IME_NULL ||
                actionId == EditorInfo.IME_ACTION_DONE ||
                actionId == EditorInfo.IME_ACTION_GO ||
                actionId == EditorInfo.IME_ACTION_SEND ||
                actionId == EditorInfo.IME_ACTION_NEXT
            val isEnterKey = event?.action == KeyEvent.ACTION_DOWN && (
                event.keyCode == KeyEvent.KEYCODE_ENTER ||
                    event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
                )

            if (isKeyboardConfirmAction || isEnterKey) {
                openConfiguredUrl()
                true
            } else {
                false
            }
        }

        webView.apply {
            // NOTE: no setLayerType(HARDWARE) here. Forcing a hardware layer on the
            // whole WebView causes a white compositing flash during back/forward
            // navigation. WebView is already hardware accelerated by the manifest.
            // 不透明浅绿底：网页首帧绘制前 WebView 自身不显示黑色（透明底在部分
            // 机型上会透出黑色 Surface），颜色与网页渐变顶色一致。
            setBackgroundColor(android.graphics.Color.parseColor("#F4FAF3"))

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                loadWithOverviewMode = true
                useWideViewPort = true
                cacheMode = WebSettings.LOAD_DEFAULT
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                databaseEnabled = true
                // Keep back/forward pages rasterised off-screen to avoid flicker
                offscreenPreRaster = true
            }

            // 锁死浅色渲染：即使手机系统开启深色模式，WebView 也不自动加深页面、
            // prefers-color-scheme 恒为 light（全 API 21+，由 androidx.webkit 兜底）
            try {
                androidx.webkit.WebSettingsCompat.setAlgorithmicDarkeningAllowed(
                    settings, false
                )
            } catch (error: Throwable) {
                Log.w(TAG, "setAlgorithmicDarkeningAllowed unavailable", error)
            }

            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                    errorContainer.visibility = View.GONE
                    // 首帧前注入浅色锁定脚本，前进/后退/冷启动都不会出现深色底
                    view?.evaluateJavascript(ANTI_FLASH_JS, null)
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    // Cross-document back restored: drop the mask as soon as
                    // the page is painted; the 320ms timer remains as a fallback.
                    backOverlay.removeCallbacks(hideBackOverlayRunnable)
                    backOverlay.postDelayed(hideBackOverlayRunnable, 60)
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: WebResourceError?
                ) {
                    // Only react to main-frame failures; ignore broken iframes/ads
                    if (request?.isForMainFrame != true) return
                    showLoadError(describeError(error?.errorCode), error?.description?.toString())
                }

                override fun onReceivedHttpError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    errorResponse: android.webkit.WebResourceResponse?
                ) {
                    if (request?.isForMainFrame != true) return
                    val code = errorResponse?.statusCode ?: 0
                    if (code in 400..599) {
                        showLoadError("服务器错误（HTTP $code）", null)
                    }
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                    if (view == null || callback == null) {
                        callback?.onCustomViewHidden()
                        return
                    }

                    if (customView != null) {
                        callback.onCustomViewHidden()
                        return
                    }

                    wasSetupVisibleBeforeFullscreen = isSetupVisible()
                    customView = view
                    customViewCallback = callback

                    fullscreenContainer.removeAllViews()
                    fullscreenContainer.addView(
                        view,
                        FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                    )
                    fullscreenContainer.visibility = View.VISIBLE
                    webView.visibility = View.GONE
                    setupContainer.visibility = View.GONE
                    applyImmersiveMode()
                }

                override fun onHideCustomView() {
                    exitCustomFullscreen()
                }
            }
            addJavascriptInterface(AndroidPlayerBridge(), "KVideoAndroid")

            // 网页直接点 APK 链接（非 JS 桥调用）时也交给系统下载器
            setDownloadListener { url, _, contentDisposition, mimeType, _ ->
                val isApk = mimeType?.contains("package-archive", ignoreCase = true) == true ||
                    url.contains(".apk", ignoreCase = true) ||
                    contentDisposition?.contains(".apk", ignoreCase = true) == true
                if (isApk) {
                    startApkDownload(url)
                }
            }
        }

        registerApkDownloadReceiver()

        // Always open the fixed server URL; the setup/URL input screen is never shown.
        urlInput.setText(DEFAULT_SERVER_URL)
        loadConfiguredUrl(DEFAULT_SERVER_URL)

        // Modern back handling via OnBackPressedDispatcher: works reliably on
        // Android 8-14 (including TV remotes and Android 14 predictive back),
        // unlike the deprecated onBackPressed() override.
        onBackPressedDispatcher.addCallback(this) {
            handleBackPress()
        }
    }

    private fun handleBackPress() {
        // 1) Exit video fullscreen first
        if (customView != null) {
            exitCustomFullscreen()
            return
        }

        // 2) Navigate back inside the WebView (covers SPA history.pushState).
        // Cover with an opaque black mask during bfcache restore to hide the
        // white compositing flash the system WebView emits on back navigation.
        if (webView.canGoBack()) {
            backOverlay.removeCallbacks(hideBackOverlayRunnable)
            backOverlay.alpha = 1f
            backOverlay.visibility = View.VISIBLE
            webView.goBack()
            // Same-document SPA backs fire no page callbacks; hide on a timer too.
            backOverlay.postDelayed(hideBackOverlayRunnable, 320)
            return
        }

        // 3) Already at root: double-press to exit
        val now = System.currentTimeMillis()
        if (now - lastBackPressedAt < 2000) {
            finish()
        } else {
            lastBackPressedAt = now
            Toast.makeText(this, "再按一次退出洋芋影视", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // BACK is handled by OnBackPressedDispatcher (see handleBackPress).

        // Map D-pad center to Enter for spatial navigation
        if (!isSetupVisible() && keyCode == KeyEvent.KEYCODE_DPAD_CENTER) {
            webView.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER))
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean {
        if (!isSetupVisible() && keyCode == KeyEvent.KEYCODE_DPAD_CENTER) {
            webView.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER))
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    override fun onResume() {
        super.onResume()
        applyImmersiveMode()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            applyImmersiveMode()
        }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        dispatchPictureInPictureChange(isInPictureInPictureMode)
        if (!isInPictureInPictureMode) {
            applyImmersiveMode()
        }
    }

    override fun onDestroy() {
        exitCustomFullscreen()
        downloadCompleteReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (error: Throwable) {
                Log.w(TAG, "Failed to unregister download receiver", error)
            }
        }
        downloadCompleteReceiver = null
        webView.destroy()
        super.onDestroy()
    }

    private fun openConfiguredUrl() {
        val normalizedUrl = normalizeUrl(urlInput.text.toString())
        if (!isValidUrl(normalizedUrl)) {
            statusText.text = getString(R.string.status_invalid_url)
            urlInput.requestFocus()
            return
        }

        prefs.edit().putString(PREF_SERVER_URL, normalizedUrl).apply()
        loadConfiguredUrl(normalizedUrl)
    }

    private fun loadConfiguredUrl(url: String) {
        setupContainer.visibility = View.GONE
        statusText.text = getString(R.string.status_ready)
        errorContainer.visibility = View.GONE
        webView.loadUrl(url)
    }

    private fun showLoadError(title: String, detail: String?) {
        errorDetailText.text = buildString {
            append("当前网络无法访问 $DEFAULT_SERVER_URL\n")
            append(title)
            if (!detail.isNullOrBlank()) append("（$detail）")
            append("\n\n可尝试：切换 WiFi / 移动数据后点击重新加载")
        }
        errorContainer.post { errorContainer.visibility = View.VISIBLE }
    }

    private fun describeError(code: Int?): String = when (code) {
        WebViewClient.ERROR_HOST_LOOKUP -> "域名解析失败（DNS），当前网络可能无法访问该站点"
        WebViewClient.ERROR_CONNECT, WebViewClient.ERROR_IO -> "无法连接到服务器（连接被中断或拒绝）"
        WebViewClient.ERROR_TIMEOUT -> "连接超时，请检查网络"
        WebViewClient.ERROR_FAILED_SSL_HANDSHAKE -> "安全连接失败（SSL），网络可能被拦截"
        WebViewClient.ERROR_PROXY_AUTHENTICATION -> "代理认证失败"
        WebViewClient.ERROR_TOO_MANY_REQUESTS -> "请求过于频繁"
        WebViewClient.ERROR_UNSUPPORTED_SCHEME -> "不支持的网址协议"
        WebViewClient.ERROR_FILE_NOT_FOUND, WebViewClient.ERROR_REDIRECT_LOOP -> "页面资源异常"
        else -> "网络请求失败（错误码 $code）"
    }

    private fun showSetup(message: String) {
        val currentUrl = getConfiguredUrl()
        if (currentUrl.isNotEmpty() && urlInput.text.toString().isBlank()) {
            urlInput.setText(currentUrl)
        }

        if (currentUrl.isNotEmpty()) {
            openButton.text = getString(R.string.button_open_saved)
            openButton.setOnClickListener {
                urlInput.setText(currentUrl)
                loadConfiguredUrl(currentUrl)
            }
        } else {
            openButton.text = getString(R.string.button_exit)
            openButton.setOnClickListener {
                finish()
            }
        }

        statusText.text = message
        setupContainer.visibility = View.VISIBLE
        urlInput.requestFocus()
    }

    private fun getConfiguredUrl(): String {
        val savedUrl = prefs.getString(PREF_SERVER_URL, null)?.trim().orEmpty()
        if (isValidUrl(savedUrl)) {
            return savedUrl
        }

        val defaultUrl = normalizeUrl(BuildConfig.DEFAULT_KVIDEO_URL)
        return if (isValidUrl(defaultUrl)) defaultUrl else ""
    }

    private fun isSetupVisible(): Boolean = setupContainer.visibility == View.VISIBLE

    private fun normalizeUrl(rawUrl: String): String {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) {
            return ""
        }

        val withScheme = if (
            trimmed.startsWith("http://", ignoreCase = true) ||
            trimmed.startsWith("https://", ignoreCase = true)
        ) {
            trimmed
        } else {
            "https://$trimmed"
        }

        return withScheme.removeSuffix("/")
    }

    private fun isValidUrl(url: String): Boolean {
        if (url.isBlank()) {
            return false
        }

        val uri = Uri.parse(url)
        val scheme = uri.scheme?.lowercase()
        return (scheme == "http" || scheme == "https") && !uri.host.isNullOrBlank()
    }

    private fun applyImmersiveMode() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )
    }

    private fun exitCustomFullscreen() {
        val currentCustomView = customView ?: return
        fullscreenContainer.removeView(currentCustomView)
        fullscreenContainer.visibility = View.GONE
        customView = null
        webView.visibility = View.VISIBLE
        if (wasSetupVisibleBeforeFullscreen) {
            setupContainer.visibility = View.VISIBLE
        }
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        wasSetupVisibleBeforeFullscreen = false
        applyImmersiveMode()
    }

    private fun isPictureInPictureSupported(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return false
        }

        return packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    }

    private fun dispatchPictureInPictureChange(isInPictureInPictureMode: Boolean) {
        val js = """
            window.dispatchEvent(new CustomEvent('kvideo-android-pip-change', {
                detail: { inPictureInPicture: ${if (isInPictureInPictureMode) "true" else "false"} }
            }));
        """.trimIndent()

        webView.post {
            try {
                webView.evaluateJavascript(js, null)
            } catch (error: Throwable) {
                Log.w(TAG, "Failed to dispatch Picture-in-Picture change event", error)
            }
        }
    }

    private fun createSourceRectHint(left: Int, top: Int, right: Int, bottom: Int): Rect? {
        if (right <= left || bottom <= top) {
            return null
        }

        val density = resources.displayMetrics.density
        return Rect(
            (left * density).roundToInt(),
            (top * density).roundToInt(),
            (right * density).roundToInt(),
            (bottom * density).roundToInt()
        )
    }

    // ------------------------------------------------------------------
    // APK 自更新：DownloadManager 下载到公共 Download 目录，完成后拉起安装
    // ------------------------------------------------------------------

    @SuppressLint("UnspecifiedRegisterReceiverFlag")
    private fun registerApkDownloadReceiver() {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val downloadId = intent?.getLongExtra(
                    DownloadManager.EXTRA_DOWNLOAD_ID, -1L
                ) ?: -1L
                if (downloadId == -1L || downloadId != enqueuedApkDownloadId) return

                val manager = getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
                    ?: return
                val query = DownloadManager.Query().setFilterById(downloadId)
                var localUri: Uri? = null
                var failed = false
                manager.query(query)?.use { cursor: Cursor ->
                    if (cursor.moveToFirst()) {
                        when (cursor.getInt(
                            cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)
                        )) {
                            DownloadManager.STATUS_SUCCESSFUL -> {
                                val raw = cursor.getString(
                                    cursor.getColumnIndexOrThrow(
                                        DownloadManager.COLUMN_LOCAL_URI
                                    )
                                )
                                localUri = raw?.let(Uri::parse)
                            }
                            DownloadManager.STATUS_FAILED -> failed = true
                        }
                    }
                }

                enqueuedApkDownloadId = -1L
                when {
                    localUri != null -> promptInstall(localUri as Uri)
                    failed -> Toast.makeText(
                        this@MainActivity,
                        "安装包下载失败，请检查网络后重试",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }

        // 系统下载完成广播属于系统广播，Android 14 需显式声明导出状态
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_EXPORTED
            )
        } else {
            registerReceiver(
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
            )
        }
        downloadCompleteReceiver = receiver
    }

    /** JS 桥 / DownloadListener 均可在非 UI 线程调用，统一切回主线程 */
    private fun startApkDownload(rawUrl: String) {
        runOnUiThread {
            try {
                val url = when {
                    rawUrl.startsWith("http://", true) || rawUrl.startsWith("https://", true) ->
                        rawUrl
                    rawUrl.startsWith("/") -> "$DEFAULT_SERVER_URL$rawUrl"
                    else -> "$DEFAULT_SERVER_URL/$rawUrl"
                }

                // 时间戳文件名避免重复下载时目标文件已存在导致失败
                val fileName = "洋芋影视-${System.currentTimeMillis()}.apk"
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setTitle("洋芋影视")
                    setDescription("正在下载最新版安装包，完成后点击安装")
                    setMimeType("application/vnd.android.package-archive")
                    setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                    )
                    setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS,
                        fileName
                    )
                    @Suppress("DEPRECATION")
                    allowScanningByMediaScanner()
                }

                val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                enqueuedApkDownloadId = manager.enqueue(request)
                Toast.makeText(
                    this,
                    "开始下载安装包，完成后点击通知即可安装",
                    Toast.LENGTH_LONG
                ).show()
            } catch (error: Throwable) {
                Log.e(TAG, "Failed to enqueue APK download", error)
                Toast.makeText(this, "无法启动下载，请稍后重试", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun promptInstall(uri: Uri) {
        try {
            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            }
            startActivity(installIntent)
        } catch (error: Throwable) {
            Log.e(TAG, "Failed to launch package installer", error)
            Toast.makeText(
                this,
                "下载已完成，请在系统下载通知中点击安装",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private inner class AndroidPlayerBridge {
        @JavascriptInterface
        fun isPictureInPictureSupported(): Boolean = this@MainActivity.isPictureInPictureSupported()

        /** 网页导航栏更新按钮用于比对 versionCode */
        @JavascriptInterface
        fun getAppVersionCode(): Int = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageManager.getPackageInfo(packageName, 0).longVersionCode.toInt()
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(packageName, 0).versionCode
            }
        } catch (error: PackageManager.NameNotFoundException) {
            Log.w(TAG, "getAppVersionCode failed", error)
            0
        }

        @JavascriptInterface
        fun getAppVersionName(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        } catch (error: PackageManager.NameNotFoundException) {
            ""
        }

        /** 网页点击「更新」时触发系统下载器下载 APK */
        @JavascriptInterface
        fun downloadUpdate(url: String) {
            startApkDownload(url)
        }

        @JavascriptInterface
        fun enterPictureInPicture(
            width: Int,
            height: Int,
            left: Int,
            top: Int,
            right: Int,
            bottom: Int
        ): Boolean {
            if (!this@MainActivity.isPictureInPictureSupported()) {
                return false
            }

            val didEnterPiP = AtomicBoolean(false)
            val latch = CountDownLatch(1)

            runOnUiThread {
                try {
                    val builder = android.app.PictureInPictureParams.Builder()
                    if (width > 0 && height > 0) {
                        builder.setAspectRatio(Rational(width, height))
                    }
                    createSourceRectHint(left, top, right, bottom)?.let(builder::setSourceRectHint)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        builder.setSeamlessResizeEnabled(true)
                    }
                    didEnterPiP.set(enterPictureInPictureMode(builder.build()))
                } catch (error: IllegalStateException) {
                    Log.w(TAG, "Failed to enter Picture-in-Picture mode", error)
                } finally {
                    latch.countDown()
                }
            }

            return try {
                latch.await(1500, TimeUnit.MILLISECONDS)
                didEnterPiP.get()
            } catch (error: InterruptedException) {
                Thread.currentThread().interrupt()
                Log.w(TAG, "Interrupted while waiting for Picture-in-Picture result", error)
                false
            }
        }
    }
}
