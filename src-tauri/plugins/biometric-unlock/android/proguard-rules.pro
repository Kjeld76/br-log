# Das Tauri-Plugin-Framework findet @Command-Methoden per Reflection -- die
# Plugin-Klasse und ihre annotierten Methoden duerfen daher nicht wegoptimiert/
# umbenannt werden.
-keep class de.betriebsrat.brzeiten.biometric.** { *; }
