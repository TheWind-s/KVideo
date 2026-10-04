package com.kvideo.tv

import android.content.Context
import android.graphics.BitmapFactory
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * 开屏广告云端配置
 *
 * 网站端 public/apk/splash.json：
 * { "enabled": true, "duration": 3, "imageUrl": "/apk/splash-ad.jpg" }
 *
 * 策略：App 启动先用本地缓存（首次安装用内置默认 3 秒 + 包内广告图）展示，
 * 同时后台静默拉取最新配置，下次冷启动生效。拉取失败/JSON 损坏/图片解码
 * 失败全部静默回退，绝不影响正常启动。
 */
data class SplashConfig(
    val enabled: Boolean,
    val durationSec: Int,
    /** 下载到内部存储的广告图路径；null 表示使用 APK 内置图 */
    val localImagePath: String?,
)

object SplashConfigLoader {
    private const val PREFS = "kvideo_splash"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_DURATION = "duration"
    private const val KEY_IMAGE_URL = "image_url"
    private const val IMAGE_FILE = "splash_ad_remote.jpg"
    private const val TMP_FILE = "splash_ad.tmp"

    private const val DEFAULT_DURATION = 3
    private const val MIN_DURATION = 1
    private const val MAX_DURATION = 15
    private const val MAX_IMAGE_BYTES = 5 * 1024 * 1024

    val DEFAULT: SplashConfig = SplashConfig(true, DEFAULT_DURATION, null)

    /** 读取上次成功拉取并缓存的配置；从未拉取过则返回内置默认值 */
    fun loadCached(context: Context): SplashConfig {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.contains(KEY_ENABLED)) return DEFAULT

        val enabled = prefs.getBoolean(KEY_ENABLED, true)
        val duration = prefs.getInt(KEY_DURATION, DEFAULT_DURATION)
            .coerceIn(MIN_DURATION, MAX_DURATION)
        val imgFile = File(context.filesDir, IMAGE_FILE)
        val localPath = if (imgFile.exists() && imgFile.length() > 0L) imgFile.absolutePath else null
        return SplashConfig(enabled, duration, localPath)
    }

    /** 后台拉取最新配置并缓存（含图片），任何异常都静默吞掉 */
    fun refreshAsync(context: Context, serverBase: String) {
        Thread {
            try {
                val appContext = context.applicationContext
                val base = serverBase.trimEnd('/')
                val conn = (URL("$base/apk/splash.json").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 2000
                    readTimeout = 2000
                    instanceFollowRedirects = true
                    setRequestProperty("Cache-Control", "no-cache")
                }
                val body = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                conn.disconnect()

                val obj = JSONObject(body)
                val enabled = obj.optBoolean("enabled", true)
                val duration = obj.optInt("duration", DEFAULT_DURATION)
                    .coerceIn(MIN_DURATION, MAX_DURATION)
                var imageUrl = obj.optString("imageUrl", "").trim()
                if (imageUrl.startsWith("/")) imageUrl = base + imageUrl

                val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

                // 图片 URL 变化才重新下载，下载失败保留旧图、不更新 URL 记录
                if (imageUrl.isNotEmpty() && imageUrl != prefs.getString(KEY_IMAGE_URL, null)) {
                    if (downloadImage(appContext, imageUrl)) {
                        prefs.edit().putString(KEY_IMAGE_URL, imageUrl).apply()
                    }
                }

                prefs.edit()
                    .putBoolean(KEY_ENABLED, enabled)
                    .putInt(KEY_DURATION, duration)
                    .apply()
            } catch (e: Exception) {
                Log.w("KVideoSplash", "config refresh failed: ${e.message}")
            }
        }.start()
    }

    private fun downloadImage(context: Context, urlStr: String): Boolean {
        return try {
            val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                connectTimeout = 3000
                readTimeout = 5000
                instanceFollowRedirects = true
            }
            if (conn.responseCode != HttpURLConnection.HTTP_OK) return false

            val bytes = conn.inputStream.use { input ->
                val out = ByteArrayOutputStream()
                val buf = ByteArray(8192)
                var total = 0
                while (true) {
                    val n = input.read(buf)
                    if (n == -1) break
                    total += n
                    // 超大文件直接放弃，防止异常配置耗流量
                    if (total > MAX_IMAGE_BYTES) return false
                    out.write(buf, 0, n)
                }
                out.toByteArray()
            }
            conn.disconnect()

            // 先验证可解码，杜绝坏图下次启动显示空白
            val probe = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return false
            probe.recycle()

            val target = File(context.filesDir, IMAGE_FILE)
            val tmp = File(context.filesDir, TMP_FILE)
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(target)) {
                target.delete()
                tmp.renameTo(target)
            }
            true
        } catch (e: Exception) {
            Log.w("KVideoSplash", "image download failed: ${e.message}")
            false
        }
    }
}
