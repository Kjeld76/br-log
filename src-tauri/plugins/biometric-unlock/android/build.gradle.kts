plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    // Muss mit dem Kotlin-package UND dem PLUGIN_IDENTIFIER in src/lib.rs
    // uebereinstimmen (register_android_plugin loest die Klasse als
    // "<identifier>.BiometricUnlockPlugin" auf).
    namespace = "de.betriebsrat.brzeiten.biometric"
    compileSdk = 36

    defaultConfig {
        // Bibliotheks-minSdk darf <= App-minSdk (29) sein; API-hoehere Aufrufe
        // (StrongBox ab 28, setUserAuthenticationParameters ab 30) sind zur
        // Laufzeit ueber Build.VERSION geguarded.
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    // appcompat zieht androidx.fragment mit (FragmentActivity fuer BiometricPrompt);
    // androidx.biometric liefert BiometricPrompt/BiometricManager/CryptoObject.
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.biometric:biometric:1.1.0")
    // Die von tauri-plugin zur Build-Zeit nach ./.tauri/tauri-api kopierte
    // Tauri-Android-Bibliothek (Plugin/Invoke/JSObject/Annotationen).
    implementation(project(":tauri-android"))
}
