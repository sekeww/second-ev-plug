package com.github.continuedev.continueintellijextension.auth

import com.github.continuedev.continueintellijextension.error.ContinueSentryService
import com.github.continuedev.continueintellijextension.services.ContinueExtensionSettings
import com.github.continuedev.continueintellijextension.services.ContinuePluginService
import com.google.gson.Gson
import com.intellij.credentialStore.Credentials
import com.intellij.ide.BrowserUtil
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.remoteServer.util.CloudConfigurationUtil.createCredentialAttributes
import com.intellij.util.io.HttpRequests
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.minutes

@Service
class ContinueAuthService {
    private val coroutineScope = CoroutineScope(Dispatchers.IO)
    private val log = Logger.getInstance(ContinueAuthService::class.java)

    companion object {
        private const val CREDENTIALS_USER = "ContinueAuthUser"
        private const val ACCESS_TOKEN_KEY = "ContinueAccessToken"
        private const val REFRESH_TOKEN_KEY = "ContinueRefreshToken"
        private const val ACCOUNT_ID_KEY = "ContinueAccountId"
        private const val ACCOUNT_LABEL_KEY = "ContinueAccountLabel"
    }

    private fun getControlPlaneUrl(): String {
        // Stage 2 POC: control-plane disabled. No external auth endpoint.
        return "http://disabled.invalid"
    }

    init {
        setupRefreshTokenInterval()
    }

    fun startAuthFlow(project: Project, useOnboarding: Boolean) {
        // Open login page
        val url = openSignInPage(project, useOnboarding)

        // Open a dialog where the user should paste their sign-in token
        ApplicationManager.getApplication().invokeLater {
            val dialog = ContinueAuthDialog(useOnboarding, url) { token ->
                // Store the token
                updateRefreshToken(token)
            }
            dialog.show()
        }
    }

    fun signOut() {
        // Clear the stored tokens
        setAccessToken("")
        setRefreshToken("")
        setAccountId("")
        setAccountLabel("")

        ApplicationManager.getApplication().messageBus.syncPublisher(AuthListener.TOPIC)
            .handleUpdatedSessionInfo(null)
    }

    private fun updateRefreshToken(token: String) {
        try {
            val response = refreshToken(token)
            val accountLabel = "${response.user.firstName} ${response.user.lastName}"

            // Persist the session info
            setRefreshToken(response.refreshToken)
            val account = ControlPlaneSessionInfo.Account(response.user.email, accountLabel)
            val sessionInfo = ControlPlaneSessionInfo(response.accessToken, account)
            setControlPlaneSessionInfo(sessionInfo)

            // Notify listeners
            ApplicationManager.getApplication().messageBus.syncPublisher(AuthListener.TOPIC)
                .handleUpdatedSessionInfo(sessionInfo)
        } catch (e: Exception) {
            service<ContinueSentryService>().report(e, "Exception while refreshing token ${e.message}")
        }
    }

    private fun setupRefreshTokenInterval() {
        // Stage 2 POC: no-op. Token refresh would call an external control-plane
        // endpoint; in this build there is no hub to refresh against.
    }

    private fun refreshToken(refreshToken: String): RefreshTokenResponse {
        // Stage 2 POC: control-plane disabled; never invoked. Left declared so the
        // class compiles without touching every call site.
        throw UnsupportedOperationException("Continue hub disabled in this build")
    }

    private fun openSignInPage(project: Project, useOnboarding: Boolean): String? {
        var authUrl: String? = null
        val coreMessenger = project.service<ContinuePluginService>().coreMessenger

        // Use a blocking approach to get the URL
        val latch = java.util.concurrent.CountDownLatch(1)

        coreMessenger?.request(
            "auth/getAuthUrl", mapOf(
                "useOnboarding" to useOnboarding
            ), null
        ) { response ->
            authUrl = ((response as? Map<*, *>)?.get("content") as? Map<*, *>)?.get("url") as? String
            latch.countDown()
        }

        // Wait for the response with a reasonable timeout
        latch.await(5, java.util.concurrent.TimeUnit.SECONDS)

        // Still open the URL in the browser (keeping existing behavior)
        if (authUrl != null) {
            BrowserUtil.open(authUrl!!)
        }

        return authUrl
    }

    private fun retrieveSecret(key: String): String? {
        return try {
            val attributes = createCredentialAttributes(key, CREDENTIALS_USER)
            val passwordSafe: PasswordSafe = PasswordSafe.instance

            val credentials: Credentials? = passwordSafe[attributes!!]
            credentials?.getPasswordAsString()
        } catch (e: Exception) {
            // Log the exception or handle it as needed
            println("Error retrieving secret for key $key: ${e.message}")
            null
        }
    }

    private fun storeSecret(key: String, secret: String) {
        try {
            val attributes = createCredentialAttributes(key, CREDENTIALS_USER)
            val passwordSafe: PasswordSafe = PasswordSafe.instance

            val credentials = Credentials(CREDENTIALS_USER, secret)
            passwordSafe.set(attributes!!, credentials)
        } catch (e: Exception) {
            // Log the exception or handle it as needed
            println("Error storing secret for key $key: ${e.message}")
        }
    }

    private fun getAccessToken(): String? {
        return retrieveSecret(ACCESS_TOKEN_KEY)
    }

    private fun setAccessToken(token: String) {
        storeSecret(ACCESS_TOKEN_KEY, token)
    }

    private fun getRefreshToken(): String? {
        return retrieveSecret(REFRESH_TOKEN_KEY)
    }

    private fun setRefreshToken(token: String) {
        storeSecret(REFRESH_TOKEN_KEY, token)
    }

    fun getAccountId(): String? {
        return PropertiesComponent.getInstance().getValue(ACCOUNT_ID_KEY)
    }

    fun setAccountId(id: String) {
        PropertiesComponent.getInstance().setValue(ACCOUNT_ID_KEY, id)
    }

    fun getAccountLabel(): String? {
        return PropertiesComponent.getInstance().getValue(ACCOUNT_LABEL_KEY)
    }

    fun setAccountLabel(label: String) {
        PropertiesComponent.getInstance().setValue(ACCOUNT_LABEL_KEY, label)
    }

    // New method to load all info as an object
    fun loadControlPlaneSessionInfo(): ControlPlaneSessionInfo? {
        val accessToken = getAccessToken()
        val accountId = getAccountId()
        val accountLabel = getAccountLabel()

        return if ((accessToken != null && accessToken != "") && accountId != null && accountLabel != null) {
            ControlPlaneSessionInfo(
                accessToken = accessToken,
                account = ControlPlaneSessionInfo.Account(
                    id = accountId,
                    label = accountLabel
                )
            )
        } else {
            null
        }
    }

    // New method to set all info from a ControlPlaneSessionInfo object
    fun setControlPlaneSessionInfo(info: ControlPlaneSessionInfo) {
        setAccessToken(info.accessToken)
        setAccountId(info.account.id)
        setAccountLabel(info.account.label)
    }

    private data class RefreshTokenResponse(
        val accessToken: String,
        val refreshToken: String,
        val user: User,
    ) {
        data class User(
            val firstName: String,
            val lastName: String,
            val email: String
        )
    }
}

// Data class to represent the ControlPlaneSessionInfo
data class ControlPlaneSessionInfo(
    val accessToken: String,
    val account: Account
) {
    data class Account(
        val id: String,
        val label: String
    )
}
