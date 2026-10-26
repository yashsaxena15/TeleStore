package com.backendforge.telestore

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.ui.MainScreen
import com.backendforge.telestore.ui.signin.SignInScreen
import com.backendforge.telestore.ui.theme.TeleStoreTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as TeleStoreApplication).container
        setContent {
            TeleStoreTheme {
                val session by container.session.state.collectAsStateWithLifecycle()
                val current = session
                if (current == null) {
                    SignInScreen(container)
                } else {
                    MainScreen(container, current)
                }
            }
        }
    }
}
