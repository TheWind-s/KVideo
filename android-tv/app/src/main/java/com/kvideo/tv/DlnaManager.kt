package com.kvideo.tv

import android.content.Context
import android.net.wifi.WifiManager
import android.util.Log
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.StringReader
import java.net.DatagramPacket
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.MulticastSocket
import java.net.SocketTimeoutException
import java.net.URL
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 轻量 DLNA/UPnP 控制点（Control Point）：
 * SSDP 组播发现局域网 MediaRenderer 设备 + AVTransport SOAP 指令控制。
 *
 * 不引入第三方 UPnP 库，用 JDK 原生 DatagramSocket / HttpURLConnection /
 * XmlPullParser 实现，规避依赖冲突。APK WebView 环境不支持 Google Cast 与
 * MediaSession 投屏，DLNA 是网页无法实现、只能由原生层提供的投屏通道。
 */
object DlnaManager {

    private const val TAG = "KVideoDlna"
    private const val SSDP_ADDRESS = "239.255.255.250"
    private const val SSDP_PORT = 1900
    private const val DEFAULT_AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1"
    /** M-SEARCH 后监听 SSDP 应答 / NOTIFY 的窗口 */
    private const val SEARCH_DURATION_MS = 5500L
    /** 最多拉取多少台设备的描述 XML（防御性上限，避免超大楼宇网络拖慢结果） */
    private const val MAX_DESCRIPTION_FETCH = 24

    /** 一台可投屏设备（已确认描述 XML 带 AVTransport 服务） */
    data class DlnaDevice(
        val udn: String,
        val name: String,
        val controlUrl: String,
        val serviceType: String
    )

    private val searchExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "kvideo-dlna-search").apply { isDaemon = true }
    }
    private val actionExecutor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "kvideo-dlna-action").apply { isDaemon = true }
    }

    private val searching = AtomicBoolean(false)
    private var multicastLock: WifiManager.MulticastLock? = null

    @Volatile
    var lastFoundDevices: List<DlnaDevice> = emptyList()
        private set

    /** 当前正在投屏的设备（dlnaStop/dlnaPause/dlnaResume 无参控制的对象） */
    @Volatile
    var currentDevice: DlnaDevice? = null
        private set

    // ------------------------------------------------------------------
    // 组播锁：部分手机 WiFi 驱动默认丢弃组播包，必须持有 MulticastLock
    // 才能收到 SSDP 应答与 NOTIFY 通知
    // ------------------------------------------------------------------

    fun ensureMulticastLock(context: Context) {
        if (multicastLock?.isHeld == true) return
        try {
            val wifi = context.applicationContext
                .getSystemService(Context.WIFI_SERVICE) as WifiManager
            val lock = wifi.createMulticastLock("kvideo_dlna")
            lock.setReferenceCounted(false)
            lock.acquire()
            multicastLock = lock
        } catch (error: Throwable) {
            Log.w(TAG, "acquire multicast lock failed", error)
        }
    }

    fun releaseMulticastLock() {
        try {
            multicastLock?.release()
        } catch (_: Throwable) { }
        multicastLock = null
    }

    // ------------------------------------------------------------------
    // 对网页桥暴露的操作（全部异步，结果经 callback 回到调用线程）
    // ------------------------------------------------------------------

    /** 异步搜索局域网内支持投屏的设备（约 6-8 秒出结果） */
    fun search(onFinished: (List<DlnaDevice>) -> Unit) {
        if (!searching.compareAndSet(false, true)) {
            // 已有搜索在跑：稍后一起回调最后结果，避免并发双份
            searchExecutor.execute {
                onFinished(lastFoundDevices)
            }
            return
        }
        searchExecutor.execute {
            val devices = try {
                discover()
            } catch (error: Throwable) {
                Log.w(TAG, "dlna discover failed", error)
                emptyList<DlnaDevice>()
            }
            searching.set(false)
            lastFoundDevices = devices
            onFinished(devices)
        }
    }

    fun findDevice(udn: String): DlnaDevice? =
        lastFoundDevices.firstOrNull { it.udn == udn }
            ?: currentDevice?.takeIf { it.udn == udn }

    /** 设置播放地址并开始播放（SetAVTransportURI + Play） */
    fun cast(device: DlnaDevice, url: String, title: String, callback: (Boolean, String?) -> Unit) {
        actionExecutor.execute {
            try {
                val didl = buildDidlMetadata(title)
                soap(
                    device.controlUrl,
                    device.serviceType,
                    "SetAVTransportURI",
                    "<InstanceID>0</InstanceID>" +
                        "<CurrentURI>${escapeXml(url)}</CurrentURI>" +
                        "<CurrentURIMetaData>${escapeXml(didl)}</CurrentURIMetaData>"
                )
                Thread.sleep(300)
                soap(
                    device.controlUrl,
                    device.serviceType,
                    "Play",
                    "<InstanceID>0</InstanceID><Speed>1</Speed>"
                )
                currentDevice = device
                callback(true, null)
            } catch (error: Throwable) {
                Log.w(TAG, "dlna cast failed", error)
                callback(false, error.message ?: "投屏失败")
            }
        }
    }

    fun pause(callback: (Boolean, String?) -> Unit) =
        control("Pause", "<InstanceID>0</InstanceID>", callback)

    fun resume(callback: (Boolean, String?) -> Unit) =
        control("Play", "<InstanceID>0</InstanceID><Speed>1</Speed>", callback)

    fun stop(callback: (Boolean, String?) -> Unit) {
        control("Stop", "<InstanceID>0</InstanceID>") { ok, message ->
            if (ok) currentDevice = null
            callback(ok, message)
        }
    }

    private fun control(action: String, body: String, callback: (Boolean, String?) -> Unit) {
        val device = currentDevice ?: run {
            callback(false, "当前没有正在投屏的设备")
            return
        }
        actionExecutor.execute {
            try {
                soap(device.controlUrl, device.serviceType, action, body)
                callback(true, null)
            } catch (error: Throwable) {
                Log.w(TAG, "dlna $action failed", error)
                callback(false, error.message)
            }
        }
    }

    // ------------------------------------------------------------------
    // SSDP 发现
    // ------------------------------------------------------------------

    private fun discover(): List<DlnaDevice> {
        val locations = LinkedHashSet<String>()
        // 端口 1900 被其他投屏应用占用时退化为随机端口（仍可收 M-SEARCH 单播应答）
        val socket = try {
            MulticastSocket(SSDP_PORT)
        } catch (_: Throwable) {
            MulticastSocket()
        }
        try {
            socket.soTimeout = 400
            val group = InetAddress.getByName(SSDP_ADDRESS)
            try {
                socket.joinGroup(group)
            } catch (_: Throwable) { }

            // 依次按三种 ST 发送 M-SEARCH，覆盖仅响应特定 ST 的电视
            for (st in listOf(
                "urn:schemas-upnp-org:device:MediaRenderer:1",
                "urn:schemas-upnp-org:service:AVTransport:1",
                "upnp:rootdevice"
            )) {
                val message = buildString {
                    append("M-SEARCH * HTTP/1.1\r\n")
                    append("HOST: $SSDP_ADDRESS:$SSDP_PORT\r\n")
                    append("MAN: \"ssdp:discover\"\r\n")
                    append("MX: 3\r\n")
                    append("ST: $st\r\n")
                    append("\r\n")
                }.toByteArray(Charsets.UTF_8)
                try {
                    socket.send(DatagramPacket(message, message.size, group, SSDP_PORT))
                } catch (_: Throwable) { }
                Thread.sleep(250)
            }

            val deadline = System.currentTimeMillis() + SEARCH_DURATION_MS
            val buffer = ByteArray(2048)
            while (System.currentTimeMillis() < deadline) {
                val packet = DatagramPacket(buffer, buffer.size)
                try {
                    socket.receive(packet)
                } catch (error: SocketTimeoutException) {
                    continue
                }
                val text = String(packet.data, packet.offset, packet.length, Charsets.UTF_8)
                val location = extractLocation(text)
                if (location != null && locations.size < MAX_DESCRIPTION_FETCH) {
                    locations.add(location)
                }
            }
        } finally {
            try {
                socket.close()
            } catch (_: Throwable) { }
        }

        // 逐台拉取设备描述 XML，确认带 AVTransport 服务的才是可投屏的渲染设备
        val devices = LinkedHashMap<String, DlnaDevice>()
        for (location in locations) {
            try {
                val info = fetchRendererInfo(location) ?: continue
                devices.putIfAbsent(info.udn, info)
            } catch (error: Throwable) {
                Log.d(TAG, "skip non-renderer device $location", error)
            }
        }
        return devices.values.sortedBy { it.name }
    }

    /** 从 SSDP 报文（M-SEARCH 应答 / NOTIFY alive）中提取 LOCATION 头 */
    private fun extractLocation(text: String): String? {
        for (rawLine in text.split("\r\n", "\n")) {
            val line = rawLine.trim()
            if (line.startsWith("LOCATION:", ignoreCase = true)) {
                val location = line.substring("LOCATION:".length).trim()
                if (location.startsWith("http://") || location.startsWith("https://")) {
                    return location
                }
            }
        }
        return null
    }

    /**
     * 拉取并解析设备描述 XML：取根设备 friendlyName / UDN，
     * 以及 AVTransport 服务的 controlURL；非渲染设备返回 null。
     * controlURL 通常为相对路径，需基于 LOCATION 解析为绝对地址。
     */
    private fun fetchRendererInfo(location: String): DlnaDevice? {
        val xml = httpGet(location) ?: return null
        val parser = XmlPullParserFactory.newInstance().newPullParser()
        parser.setInput(StringReader(xml))

        var friendlyName: String? = null
        var udn: String? = null
        var controlUrl: String? = null
        var serviceType: String? = null
        var inService = false
        var currentServiceType: String? = null
        var currentServiceControl: String? = null
        val tagStack = ArrayDeque<String>()

        while (true) {
            val event = parser.next()
            if (event == XmlPullParser.END_DOCUMENT) break
            when (event) {
                XmlPullParser.START_TAG -> {
                    tagStack.addLast(parser.name)
                    if (parser.name == "service") {
                        inService = true
                        currentServiceType = null
                        currentServiceControl = null
                    }
                }

                XmlPullParser.TEXT -> {
                    val tag = tagStack.lastOrNull() ?: continue
                    val text = parser.text?.trim().orEmpty()
                    if (text.isEmpty()) continue
                    when (tag) {
                        "friendlyName" -> if (friendlyName == null) friendlyName = text
                        "UDN" -> if (udn == null) udn = text
                        "serviceType" ->
                            if (inService && currentServiceType == null) currentServiceType = text
                        "controlURL" ->
                            if (inService && currentServiceControl == null) {
                                currentServiceControl = text
                            }
                    }
                }

                XmlPullParser.END_TAG -> {
                    if (parser.name == "service") {
                        inService = false
                        if (controlUrl == null &&
                            currentServiceType?.contains(
                                "AVTransport", ignoreCase = true
                            ) == true &&
                            !currentServiceControl.isNullOrBlank()
                        ) {
                            controlUrl = currentServiceControl
                            serviceType = currentServiceType
                        }
                    }
                    if (tagStack.isNotEmpty()) tagStack.removeLast()
                }
            }
        }

        if (controlUrl.isNullOrBlank()) return null
        val absoluteControlUrl = try {
            URL(URL(location), controlUrl).toString()
        } catch (_: Throwable) {
            return null
        }
        return DlnaDevice(
            udn = udn?.takeIf { it.isNotBlank() } ?: "udn-$absoluteControlUrl",
            name = friendlyName?.takeIf { it.isNotBlank() } ?: "DLNA 设备",
            controlUrl = absoluteControlUrl,
            serviceType = serviceType ?: DEFAULT_AV_TRANSPORT
        )
    }

    // ------------------------------------------------------------------
    // SOAP 控制（AVTransport）
    // ------------------------------------------------------------------

    private fun soap(
        controlUrl: String,
        serviceType: String,
        action: String,
        body: String
    ) {
        val connection = URL(controlUrl).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 6000
            connection.readTimeout = 6000
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"")
            connection.setRequestProperty("SOAPACTION", "\"$serviceType#$action\"")
            connection.setRequestProperty("Connection", "close")
            val payload = "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
                "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" " +
                "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body>" +
                "<u:$action xmlns:u=\"$serviceType\">$body</u:$action>" +
                "</s:Body></s:Envelope>"
            connection.outputStream.use { output ->
                output.write(payload.toByteArray(Charsets.UTF_8))
            }
            val code = connection.responseCode
            val stream: InputStream? = try {
                connection.inputStream
            } catch (_: Throwable) {
                connection.errorStream
            }
            val response = stream?.use { readAll(it) }.orEmpty()
            if (code !in 200..299) {
                throw RuntimeException(
                    "设备拒绝 $action（HTTP $code）${response.take(160)}"
                )
            }
        } finally {
            connection.disconnect()
        }
    }

    /** 投屏元数据（DIDL-Lite）：部分电视（如索尼）没有它会拒绝播放 */
    private fun buildDidlMetadata(title: String): String =
        "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" " +
            "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" " +
            "xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">" +
            "<item id=\"kvideo-0\" parentID=\"0\" restricted=\"0\">" +
            "<dc:title>${escapeXml(title)}</dc:title>" +
            "<upnp:class>object.item.videoItem.movie</upnp:class>" +
            "</item></DIDL-Lite>"

    private fun escapeXml(value: String): String = value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&apos;")

    // ------------------------------------------------------------------
    // HTTP 工具
    // ------------------------------------------------------------------

    private fun httpGet(url: String): String? {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("User-Agent", "KVideo/Android DLNA")
            if (connection.responseCode !in 200..299) return null
            return connection.inputStream.use { readAll(it) }
        } finally {
            connection.disconnect()
        }
    }

    private fun readAll(stream: InputStream): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = stream.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
            // 设备描述 XML 不可能超过 512KB，防御性截断
            if (output.size() > 512 * 1024) break
        }
        return output.toString("UTF-8")
    }
}
