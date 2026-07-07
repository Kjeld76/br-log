package de.betriebsrat.brzeiten

import android.graphics.Bitmap
import android.os.Bundle
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // A-UI-Fix (Gerätetest): Ohne Insets-Handling zeichnet die WebView unter
    // die Status- und Gestenleiste (TopBar-Logo/Sperren-Button lagen hinter
    // der Statusleiste). Ursachen: enableEdgeToEdge() oben (Tauri-2-Template)
    // UND targetSdk 36 -- ab Android 15 ist Edge-to-Edge ohnehin erzwungen,
    // das Opt-out-Flag windowOptOutEdgeToEdgeEnforcement ist ab targetSdk 36
    // wirkungslos. Ein CSS-Weg scheidet aus: env(safe-area-inset-*) liefert
    // in der Android-WebView 0px (offizielle Android-Dev-Guidance "Make
    // WebViews edge-to-edge"). Daher der dort empfohlene native Weg: die
    // System-Insets (Statusleiste, Gestenleiste, Display-Cutout, Tastatur)
    // als Padding auf den Content-Container legen -- die WebView sitzt damit
    // ZWISCHEN den Systemleisten. Die Fläche dahinter füllt windowBackground
    // aus dem Theme (hell/dunkel, siehe res/values*/themes.xml).
    //
    // Type.ime() ersetzt dabei zugleich adjustResize aus dem Manifest, das
    // unter erzwungenem Edge-to-Edge (API 35+) wirkungslos ist: öffnet sich
    // die Tastatur, schrumpft der Inhalt um die IME-Höhe, statt verdeckt zu
    // werden.
    val content = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val insets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars()
          or WindowInsetsCompat.Type.displayCutout()
          or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  // A-Fix (Gerätetest, Hypothese "Renderer-Kill"): Marios sporadischer Bug --
  // App aus dem Hintergrund zurückgeholt (nach 1-2 Min.) zeigt nur noch einen
  // blauen Bildschirm (= windowBackground aus values-night/colors.xml scheint
  // durch, siehe Kommentar oben), die Activity lebt, aber die WebView zeichnet
  // nichts mehr -- nur ein Kill über den App-Switcher hilft.
  //
  // Recherche: der von WRY generierte RustWebViewClient (gen/android wird bei
  // jedem Build frisch aus dem wry-Crate-Template erzeugt, taucht deshalb NICHT
  // im Git-Diff auf) überschreibt WebViewClient.onRenderProcessGone NICHT.
  // Laut offizieller Doku (developer.android.com/reference/android/webkit/
  // WebViewClient#onRenderProcessGone) ist das Rückgabeverhalten ohne Override:
  // "application will crash if render process crashed, or be killed if render
  // process was killed by the system" -- Android killt bei Speicherdruck im
  // Hintergrund reihenweise WebView-Renderer-Prozesse (bekanntes, sehr
  // verbreitetes Verhalten, u. a. in vielen Hybrid-App-Bugreports). In der
  // Praxis setzen aber nicht alle OEM-Android-Varianten das "App crasht/wird
  // gekillt"-Verhalten sauber um -- manche lassen die Activity am Leben mit
  // einer toten, nie wieder zeichnenden WebView zurück. Genau das passt zu
  // Marios Symptom (Activity lebt, WebView tot, kein Crash-Dialog).
  //
  // Fix (offizielles Android-Muster "Manage WebView objects"/onRenderProcessGone):
  // WryActivity (Basisklasse von TauriActivity) bietet extra für sowas den Hook
  // onWebViewCreate(webView) -- hier klinken wir uns NACH der WebView-Erstellung
  // ein, holen den von WRY bereits gesetzten WebViewClient per WebViewCompat
  // (Feature-Check: GET_WEB_VIEW_CLIENT) und wrappen ihn: alle bisherigen
  // Overrides (shouldInterceptRequest/shouldOverrideUrlLoading/onPageStarted/
  // onPageFinished/onReceivedError -- Asset-Loader, IPC, Redirect-Handling)
  // bleiben 1:1 erhalten (reines Delegieren), zusätzlich fangen wir
  // onRenderProcessGone ab und lösen return true (== "wir kümmern uns") +
  // Activity.recreate() aus statt den Nutzer zum manuellen Force-Kill zu
  // zwingen. Kein Datenverlust: die App sperrt beim Verstecken sofort
  // (visibilitychange-Handler in App.tsx), ein recreate() lädt einfach frisch
  // auf den ohnehin schon aktiven LockScreen neu -- gleicher Endzustand wie
  // Marios bisheriger manueller Force-Kill + Neustart, nur automatisch.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    installRenderProcessGoneGuard(webView)
  }

  private fun installRenderProcessGoneGuard(webView: WebView) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.GET_WEB_VIEW_CLIENT)) {
      // Sehr altes/kaputtes WebView-APK ohne die Jetpack-Feature-API -- dann
      // bleibt es beim (unveränderten) Standardverhalten, siehe Doku oben.
      Log.w(TAG, "GET_WEB_VIEW_CLIENT nicht unterstützt -- Renderer-Kill-Guard übersprungen.")
      return
    }
    val original = WebViewCompat.getWebViewClient(webView)
    webView.webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest
      ): WebResourceResponse? = original.shouldInterceptRequest(view, request)

      override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest
      ): Boolean = original.shouldOverrideUrlLoading(view, request)

      override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) =
        original.onPageStarted(view, url, favicon)

      override fun onPageFinished(view: WebView, url: String) =
        original.onPageFinished(view, url)

      override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError
      ) = original.onReceivedError(view, request, error)

      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        // Schutz gegen einen theoretischen recreate()-Loop (Renderer stirbt
        // sofort wieder, z. B. bei defektem WebView-APK): nach N Versuchen
        // aufgeben und dem System-Default überlassen (Review-Anmerkung).
        if (renderGoneRecreates >= MAX_RENDER_GONE_RECREATES) {
          Log.e(
            TAG,
            "WebView-Renderer erneut weg (Versuch ${renderGoneRecreates + 1}) -- gebe auf, System-Default."
          )
          return false
        }
        renderGoneRecreates++
        Log.w(
          TAG,
          "WebView-Renderer weg (didCrash=${detail.didCrash()}) -- Activity wird neu aufgebaut (Versuch $renderGoneRecreates)."
        )
        // Doku: "the given WebView can't be used ... should be removed from
        // the view hierarchy" -- wir bauen deshalb die ganze Activity neu,
        // statt zu versuchen die tote WebView weiterzuverwenden.
        runOnUiThread { recreate() }
        return true
      }
    }
  }

  companion object {
    private const val TAG = "MainActivity"
    private const val MAX_RENDER_GONE_RECREATES = 3

    // Prozessweiter Zähler (recreate() behält den Prozess -- der Zähler
    // überlebt also genau die Zyklen, die er begrenzen soll).
    private var renderGoneRecreates = 0
  }
}
