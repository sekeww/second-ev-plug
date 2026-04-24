package com.github.continuedev.continueintellijextension.error

import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Attachment
import com.intellij.openapi.diagnostic.Logger

// Stage 2 POC: Sentry disabled. No external calls, no SDK init.
// Public `report` / `reportMessage` signatures preserved so callers compile unchanged.
@Service
class ContinueSentryService {
    private val log = Logger.getInstance(ContinueSentryService::class.java.simpleName)

    fun report(
        throwable: Throwable,
        message: String? = null,
        attachments: List<Attachment>? = null,
        ignoreTelemetrySettings: Boolean = false
    ) {
        log.debug("Sentry report no-op: ${message ?: throwable.message}")
    }

    fun reportMessage(message: String) {
        log.debug("Sentry message no-op: $message")
    }
}
