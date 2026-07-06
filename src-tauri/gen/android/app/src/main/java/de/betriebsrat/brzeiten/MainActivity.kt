package de.betriebsrat.brzeiten

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

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
}
