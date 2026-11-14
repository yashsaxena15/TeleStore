package com.backendforge.telestore.ui.signin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.core.LoginResponse
import com.backendforge.telestore.core.ServerAddress
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.Session
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SignInState(
    val server: String,
    val username: String = "",
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
)

class SignInViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(SignInState(server = container.session.lastServer.removePrefix("https://")))
    val state: StateFlow<SignInState> = _state.asStateFlow()

    fun onServer(value: String) {
        _state.update { it.copy(server = value, error = null) }
    }

    fun onUsername(value: String) = _state.update { it.copy(username = value, error = null) }
    fun onPassword(value: String) = _state.update { it.copy(password = value, error = null) }
    fun showError(message: String) = _state.update { it.copy(busy = false, error = message) }

    fun signIn() {
        val s = _state.value
        if (s.username.isBlank() || s.password.isEmpty()) return showError("Enter your username or email, and your password.")
        signInWith { api -> api.login(s.username, s.password) }
    }

    private fun signInWith(call: suspend (TeleStoreApi) -> LoginResponse) {
        val api = currentApi() ?: return showError("That server address doesn't look right.")
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                val res = call(api)
                container.session.signedIn(Session(api.baseUrl.toString().trimEnd('/'), res.account, res.authToken))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Anything unexpected is shown, never a crash
                showError((e as? ApiException)?.message ?: "Sign-in failed: ${e.message ?: e.javaClass.simpleName}")
            }
        }
    }

    /** For "Forgot password?": the server typed above, or null when the address isn't valid. */
    fun forgotPasswordApi(): TeleStoreApi? = currentApi()

    /** After a reset: fill in the username, ready for the new password. */
    fun passwordReset(username: String) = _state.update { it.copy(username = username, password = "", error = "Password changed. Sign in with the new one.") }

    private fun currentApi(): TeleStoreApi? = ServerAddress.normalize(_state.value.server)?.let { container.apiFor(it) }
}
