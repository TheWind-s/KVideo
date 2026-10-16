package com.kvideo.tv

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.database.Cursor
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
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
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat as MediaStyleNotificationCompat
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

        // 系统媒体通知栏（WebView 页面视频）：通知渠道 / 通知 id / 按钮广播 action
        private const val MEDIA_CHANNEL_ID = "kvideo_media_playback"
        private const val MEDIA_NOTIFICATION_ID = 2001
        private const val ACTION_MEDIA_PLAY = "com.kvideo.tv.media.PLAY"
        private const val ACTION_MEDIA_PAUSE = "com.kvideo.tv.media.PAUSE"
        private const val ACTION_MEDIA_NEXT = "com.kvideo.tv.media.NEXT"
        private const val ACTION_MEDIA_PREV = "com.kvideo.tv.media.PREV"
        private const val ACTION_MEDIA_STOP = "com.kvideo.tv.media.STOP"

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
    private var splashDialog: android.app.Dialog? = null
    private var splashAdCountDown: android.os.CountDownTimer? = null
    private var customView: View? = null
    private var customViewCallback: CustomViewCallback? = null
    private var wasSetupVisibleBeforeFullscreen = false
    private var lastBackPressedAt = 0L

    // APK 自更新：DownloadManager 任务 id 与完成广播接收器
    private var enqueuedApkDownloadId = -1L
    private var downloadCompleteReceiver: BroadcastReceiver? = null

    // 系统媒体通知栏：MediaSession 与按钮广播接收器（首次播放时懒创建）
    private var mediaSession: MediaSessionCompat? = null
    private var mediaReceiver: BroadcastReceiver? = null
    private var mediaNotificationShown = false
    private var mediaPermissionRequested = false

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

    /**
     * 开屏广告：以独立 Dialog 窗口展示，倒计时结束自动关闭，也可点「跳过」手动关闭。
     *
     * 秒数、开关、广告图均来自云端配置（/apk/splash.json），由 SplashConfigLoader
     * 缓存到本地，本次启动读缓存、后台静默更新，下次冷启动生效；首次安装或
     * 拉取失败时使用内置默认（3 秒 + APK 内置广告图）。
     */
    private fun showSplashAd(config: SplashConfig) {
        if (!config.enabled) return

        val dialog = android.app.Dialog(this, R.style.SplashAdDialog)
        dialog.setContentView(R.layout.splash_ad)
        dialog.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        dialog.setCancelable(false)
        dialog.setCanceledOnTouchOutside(false)

        val countdown = dialog.findViewById<TextView>(R.id.splash_ad_countdown)
        val version = dialog.findViewById<TextView>(R.id.splash_ad_version)
        val adImage = dialog.findViewById<ImageView>(R.id.splash_ad_image)
        version.text = "v${BuildConfig.VERSION_NAME}"

        // 优先使用云端下发的本地缓存图，解码失败保持 XML 中的内置图
        config.localImagePath?.let { path ->
            try {
                val bmp = android.graphics.BitmapFactory.decodeFile(path)
                if (bmp != null) adImage.setImageBitmap(bmp)
            } catch (_: Exception) { }
        }

        // 手动关闭
        countdown.setOnClickListener { hideSplashAd() }

        splashDialog = dialog
        dialog.show()

        val durationMs = config.durationSec.coerceIn(1, 15) * 1000L

        // 倒计时从广告图真正绘制的第一帧才开始计，保证看满完整秒数
        splashAdCountDown?.cancel()
        adImage.post {
            if (splashDialog !== dialog) return@post
            splashAdCountDown = object : android.os.CountDownTimer(durationMs, 1000L) {
                override fun onTick(millisUntilFinished: Long) {
                    val remain = ((millisUntilFinished + 999) / 1000L).toInt()
                    countdown.text = "跳过 ${remain}s"
                }

                override fun onFinish() {
                    hideSplashAd()
                }
            }.start()
        }
    }

    private fun hideSplashAd() {
        splashAdCountDown?.cancel()
        splashAdCountDown = null
        val dialog = splashDialog ?: return
        splashDialog = null
        val decor = dialog.window?.decorView ?: run { dialog.dismiss(); return }
        decor.animate()
            .alpha(0f)
            .setDuration(200)
            .withEndAction { dialog.dismiss() }
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

        // 开屏广告：本次启动用本地缓存配置，同时后台静默拉取云端最新配置（下次启动生效）
        val splashConfig = SplashConfigLoader.loadCached(this)
        showSplashAd(splashConfig)
        SplashConfigLoader.refreshAsync(this, getConfiguredUrl().ifEmpty { DEFAULT_SERVER_URL })

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
        DlnaManager.releaseMulticastLock()
        splashAdCountDown?.cancel()
        splashAdCountDown = null
        splashDialog?.dismiss()
        splashDialog = null
        exitCustomFullscreen()
        downloadCompleteReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (error: Throwable) {
                Log.w(TAG, "Failed to unregister download receiver", error)
            }
        }
        downloadCompleteReceiver = null
        mediaReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (_: Throwable) { }
        }
        mediaReceiver = null
        try {
            mediaSession?.release()
        } catch (_: Throwable) { }
        mediaSession = null
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
    // 系统媒体通知栏：由网页 JS 桥（KVideoAndroid.mediaUpdate/mediaStop）驱动，
    // 通知按钮 / 锁屏控件 / 耳机媒体键 → MediaSession.Callback / 广播 →
    // evaluateJavascript 调回网页 window.__kvideoMediaCommand
    // ------------------------------------------------------------------

    /** 懒创建：通知渠道 + MediaSession + 按钮广播接收器 +（Android 13+）请求通知权限 */
    private fun ensureMediaSession() {
        if (mediaSession != null) return

        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !mediaPermissionRequested &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            mediaPermissionRequested = true
            try {
                requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 2001)
            } catch (error: Throwable) {
                Log.w(TAG, "request POST_NOTIFICATIONS failed", error)
            }
        }

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                MEDIA_CHANNEL_ID,
                "视频播放控制",
                NotificationManager.IMPORTANCE_LOW
            ).apply { setShowBadge(false) }
        )

        val session = MediaSessionCompat(this, "KVideoMedia").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = dispatchMediaCommandToJs("play")
                override fun onPause() = dispatchMediaCommandToJs("pause")
                override fun onSkipToNext() = dispatchMediaCommandToJs("next")
                override fun onSkipToPrevious() = dispatchMediaCommandToJs("prev")
                override fun onStop() = dispatchMediaCommandToJs("stop")
                override fun onSeekTo(pos: Long) = dispatchMediaCommandToJs("seekto", pos / 1000L)
            })
            isActive = true
        }
        mediaSession = session

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                when (intent?.action) {
                    ACTION_MEDIA_PLAY -> dispatchMediaCommandToJs("play")
                    ACTION_MEDIA_PAUSE -> dispatchMediaCommandToJs("pause")
                    ACTION_MEDIA_NEXT -> dispatchMediaCommandToJs("next")
                    ACTION_MEDIA_PREV -> dispatchMediaCommandToJs("prev")
                    ACTION_MEDIA_STOP -> dispatchMediaCommandToJs("stop")
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(ACTION_MEDIA_PLAY)
            addAction(ACTION_MEDIA_PAUSE)
            addAction(ACTION_MEDIA_NEXT)
            addAction(ACTION_MEDIA_PREV)
            addAction(ACTION_MEDIA_STOP)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(receiver, filter)
        }
        mediaReceiver = receiver
    }

    /** 网页上报播放状态：更新 MediaSession 元数据 / 进度，并刷新媒体通知 */
    private fun updateMediaSession(json: String) {
        runOnUiThread {
            try {
                ensureMediaSession()
                val session = mediaSession ?: return@runOnUiThread
                val data = org.json.JSONObject(json)
                val isPlaying = data.optBoolean("isPlaying", false)
                val title = data.optString("title", "洋芋影视")
                val artist = data.optString("artist", "")
                val album = data.optString("album", "洋芋影视")
                val positionMs = data.optLong("position", 0L).coerceAtLeast(0L)
                val durationMs = data.optLong("duration", 0L).coerceAtLeast(0L)
                val canNext = data.optBoolean("canNext", false)
                val canPrev = data.optBoolean("canPrev", false)

                session.setMetadata(
                    MediaMetadataCompat.Builder()
                        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
                        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                        .build()
                )
                session.setPlaybackState(
                    PlaybackStateCompat.Builder()
                        .setActions(
                            PlaybackStateCompat.ACTION_PLAY
                                or PlaybackStateCompat.ACTION_PAUSE
                                or PlaybackStateCompat.ACTION_PLAY_PAUSE
                                or PlaybackStateCompat.ACTION_SEEK_TO
                                or PlaybackStateCompat.ACTION_STOP
                                or PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                                or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                        )
                        .setState(
                            if (isPlaying) PlaybackStateCompat.STATE_PLAYING
                            else PlaybackStateCompat.STATE_PAUSED,
                            positionMs,
                            if (isPlaying) 1f else 0f
                        )
                        .build()
                )

                showMediaNotification(session, isPlaying, title, artist, canNext, canPrev)
            } catch (error: Throwable) {
                Log.w(TAG, "mediaUpdate failed", error)
            }
        }
    }

    private fun showMediaNotification(
        session: MediaSessionCompat,
        isPlaying: Boolean,
        title: String,
        artist: String,
        canNext: Boolean,
        canPrev: Boolean
    ) {
        try {
            fun mediaAction(action: String, icon: Int, label: String): NotificationCompat.Action =
                NotificationCompat.Action.Builder(
                    icon,
                    label,
                    PendingIntent.getBroadcast(
                        this,
                        action.hashCode(),
                        Intent(action).setPackage(packageName),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                ).build()

            val actions = mutableListOf<NotificationCompat.Action>()
            if (canPrev) {
                actions.add(mediaAction(ACTION_MEDIA_PREV, android.R.drawable.ic_media_previous, "上一集"))
            }
            actions.add(
                mediaAction(
                    if (isPlaying) ACTION_MEDIA_PAUSE else ACTION_MEDIA_PLAY,
                    if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                    if (isPlaying) "暂停" else "播放"
                )
            )
            if (canNext) {
                actions.add(mediaAction(ACTION_MEDIA_NEXT, android.R.drawable.ic_media_next, "下一集"))
            }

            val contentIntent = PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val builder = NotificationCompat.Builder(this, MEDIA_CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(artist)
                .setContentIntent(contentIntent)
                .setOngoing(isPlaying)
                .setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            for (action in actions) builder.addAction(action)
            builder.setStyle(
                MediaStyleNotificationCompat.MediaStyle()
                    .setMediaSession(session.sessionToken)
                    .setShowActionsInCompactView(
                        *IntArray(actions.size.coerceAtMost(3)) { it }
                    )
            )

            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .notify(MEDIA_NOTIFICATION_ID, builder.build())
            mediaNotificationShown = true
        } catch (error: Throwable) {
            // 通知权限被拒等场景静默失败，不影响页面播放
            Log.w(TAG, "show media notification failed", error)
        }
    }

    /** 网页离开播放页 / 停止播放：取消通知并清空会话状态 */
    private fun stopMediaSession() {
        runOnUiThread {
            try {
                if (mediaNotificationShown) {
                    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                        .cancel(MEDIA_NOTIFICATION_ID)
                    mediaNotificationShown = false
                }
                mediaSession?.setPlaybackState(
                    PlaybackStateCompat.Builder()
                        .setActions(0)
                        .setState(PlaybackStateCompat.STATE_NONE, 0L, 0f)
                        .build()
                )
            } catch (error: Throwable) {
                Log.w(TAG, "mediaStop failed", error)
            }
        }
    }

    /** 通知按钮 / 耳机媒体键 / 锁屏控件 → 转发给网页统一入口 */
    private fun dispatchMediaCommandToJs(cmd: String, seekSec: Long = -1L) {
        runOnUiThread {
            try {
                val arg = if (seekSec >= 0) ", $seekSec" else ""
                webView.evaluateJavascript(
                    "window.__kvideoMediaCommand && window.__kvideoMediaCommand('$cmd'$arg);",
                    null
                )
            } catch (error: Throwable) {
                Log.w(TAG, "dispatch media command failed", error)
            }
        }
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
                val fileName = "洋芋影视1.0.12.apk"
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

        /** 网页点击「分享」时拉起系统分享面板（分享站点链接文案） */
        @JavascriptInterface
        fun shareText(text: String) {
            runOnUiThread {
                try {
                    val sendIntent = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, text)
                    }
                    startActivity(Intent.createChooser(sendIntent, "分享洋芋影视"))
                } catch (error: Exception) {
                    Log.w(TAG, "shareText failed", error)
                }
            }
        }

        /**
         * 网页播放器上报媒体状态（JSON）：
         * { isPlaying, title, artist, album, position(ms), duration(ms), canNext, canPrev }
         * 用于驱动系统媒体通知栏（锁屏 / 下拉媒体卡片）
         */
        @JavascriptInterface
        fun mediaUpdate(json: String) {
            updateMediaSession(json)
        }

        /** 网页离开播放页 / 停止播放：取消系统媒体通知 */
        @JavascriptInterface
        fun mediaStop() {
            stopMediaSession()
        }

        /**
         * 网页播放器请求屏幕方向：
         * "landscape" → 视频全屏，SENSOR_LANDSCAPE（横左/横右跟随传感器，不倒立，
         *               并覆盖系统旋转锁定——视频全屏强制横屏是行业惯例）；
         * "reset"     → 退出全屏，交还系统设置（USER：尊重旋转锁定，且不出现倒立竖屏）
         */
        @JavascriptInterface
        fun setOrientation(mode: String) {
            runOnUiThread {
                requestedOrientation = when (mode) {
                    "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    else -> ActivityInfo.SCREEN_ORIENTATION_USER
                }
            }
        }

        // ------------------------------------------------------------------
        // DLNA 投屏：SSDP 搜索 + AVTransport 控制，结果经 CustomEvent 回推网页
        // ------------------------------------------------------------------

        /** 网页请求搜索局域网 DLNA 设备；结果经 kvideo-dlna-devices 事件回推 */
        @JavascriptInterface
        fun dlnaSearch() {
            DlnaManager.ensureMulticastLock(this@MainActivity)
            DlnaManager.search { devices ->
                val array = org.json.JSONArray()
                for (device in devices) {
                    array.put(
                        org.json.JSONObject()
                            .put("udn", device.udn)
                            .put("name", device.name)
                    )
                }
                dispatchDlnaEvent("kvideo-dlna-devices", array.toString())
            }
        }

        /**
         * 网页发起投屏（udn 来自最近一次搜索结果）；
         * 结果经 kvideo-dlna-cast 事件回推 { ok, udn, name, message? }
         */
        @JavascriptInterface
        fun dlnaCast(udn: String, url: String, title: String) {
            val device = DlnaManager.findDevice(udn)
            if (device == null) {
                dispatchDlnaEvent(
                    "kvideo-dlna-cast",
                    org.json.JSONObject()
                        .put("ok", false)
                        .put("udn", udn)
                        .put("message", "设备已失效，请重新搜索")
                        .toString()
                )
                return
            }
            DlnaManager.cast(device, url, title) { ok, message ->
                val payload = org.json.JSONObject()
                    .put("ok", ok)
                    .put("udn", udn)
                    .put("name", device.name)
                if (!message.isNullOrBlank()) payload.put("message", message)
                dispatchDlnaEvent("kvideo-dlna-cast", payload.toString())
            }
        }

        @JavascriptInterface
        fun dlnaPause() = DlnaManager.pause { _, _ -> }

        @JavascriptInterface
        fun dlnaResume() = DlnaManager.resume { _, _ -> }

        @JavascriptInterface
        fun dlnaStop() = DlnaManager.stop { _, _ -> }

        /** 原生 → 网页事件统一出口（payload 为 JSON 对象/数组字面量） */
        private fun dispatchDlnaEvent(name: String, payload: String) {
            runOnUiThread {
                try {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('$name', { detail: $payload }));",
                        null
                    )
                } catch (error: Throwable) {
                    Log.w(TAG, "dispatch $name failed", error)
                }
            }
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
