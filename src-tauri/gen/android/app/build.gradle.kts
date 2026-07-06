import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release-Signing (Tauri-2-Doku "Android Code Signing"): liest optionale
// keystore.properties aus dem gen/android-Wurzelverzeichnis (rootProject,
// NICHT app/ -- analog zur bestehenden .gitignore-Regel dort). Die Datei
// enthaelt keyAlias/keyPassword/storeFile/storePassword und wird NIE
// eingecheckt (siehe gen/android/.gitignore). Fehlt sie -- lokale Dev-Builds,
// WSL, jeder Checkout ohne CI-Secrets --, bleibt der Release-Build wie bisher
// UNSIGNIERT: es wird dann gar kein "release"-SigningConfig angelegt und der
// buildType referenziert keinen. Nichts darf brechen, wenn die Datei fehlt.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        FileInputStream(keystorePropertiesFile).use { load(it) }
    }
}
val hasReleaseSigning = keystorePropertiesFile.exists()

android {
    compileSdk = 36
    namespace = "de.betriebsrat.brzeiten"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "de.betriebsrat.brzeiten"
        minSdk = 29
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    // Nur angelegt, wenn keystore.properties existiert (siehe hasReleaseSigning
    // oben) -- sonst bleibt buildTypes.release ohne signingConfig und Gradle
    // erzeugt eine unsignierte Release-APK wie bisher.
    if (hasReleaseSigning) {
        signingConfigs {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                // rootProject.file(), NICHT file(): relative storeFile-Pfade
                // sollen sich auf gen/android/ beziehen (dort liegen
                // keystore.properties UND der von der CI abgelegte
                // keystore.jks), nicht auf app/. Absolute Pfade reicht
                // rootProject.file() unveraendert durch, die bleiben moeglich.
                storeFile = rootProject.file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")