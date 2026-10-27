package com.backendforge.telestore.ui.signin

import androidx.compose.ui.unit.sp
import com.backendforge.telestore.ui.home.AppLogo
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.material3.TextButton
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.backendforge.telestore.data.AppContainer
import kotlinx.coroutines.launch

@Composable
fun SignInScreen(container: AppContainer) {
    val vm: SignInViewModel = viewModel { SignInViewModel(container) }
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var forgotOpen by rememberSaveable { mutableStateOf(false) }
    if (forgotOpen) {
        ForgotPasswordDialog(
            api = vm.forgotPasswordApi(),
            initialUsername = state.username,
            onDismiss = { forgotOpen = false },
            onDone = vm::passwordReset,
        )
    }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), contentAlignment = Alignment.TopCenter) {
            Column(
                modifier = Modifier
                    .widthIn(max = 440.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 48.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    AppLogo(84)
                    Text("TELESTORE", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold, letterSpacing = 1.sp)
                    Text(
                        "UNLIMITED TELEGRAM CLOUD STORAGE",
                        style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, letterSpacing = 0.5.sp,
                    )
                }
                Spacer(Modifier.height(8.dp))

                OutlinedTextField(
                    value = state.server, onValueChange = vm::onServer, label = { Text("Server") },
                    singleLine = true, enabled = !state.busy, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                )
                OutlinedTextField(
                    value = state.username, onValueChange = vm::onUsername, label = { Text("Username") },
                    singleLine = true, enabled = !state.busy, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                )
                OutlinedTextField(
                    value = state.password, onValueChange = vm::onPassword, label = { Text("Password") },
                    singleLine = true, enabled = !state.busy, modifier = Modifier.fillMaxWidth(),
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { vm.signIn() }),
                )

                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                TextButton(onClick = { forgotOpen = true }, enabled = !state.busy) { Text("Forgot password?") }

                Button(
                    onClick = vm::signIn, enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(14.dp),
                ) {
                    if (state.busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Sign in")
                }

                state.googleClientId?.let { clientId ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        HorizontalDivider(Modifier.weight(1f))
                        Text("or", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        HorizontalDivider(Modifier.weight(1f))
                    }
                    OutlinedButton(
                        onClick = {
                            scope.launch {
                                try {
                                    requestGoogleIdToken(context, clientId)?.let(vm::signInWithGoogle)
                                } catch (e: IllegalStateException) {
                                    vm.showError(e.message ?: "Google sign-in failed.")
                                }
                            }
                        },
                        enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(14.dp),
                    ) { Text("Continue with Google") }
                }

                Spacer(Modifier.height(8.dp))
                Text(
                    "You stay signed in on this phone for 90 days. Don't have an account? Ask the owner to add you.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
