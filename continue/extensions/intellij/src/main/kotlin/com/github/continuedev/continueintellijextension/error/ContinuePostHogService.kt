package com.github.continuedev.continueintellijextension.error

import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger

// Stage 2 POC: PostHog disabled. No external calls, no network.
// Public `capture` signature preserved so callers compile unchanged.
@Service
class ContinuePostHogService {
    private val log = Logger.getInstance(ContinuePostHogService::class.java)

    fun capture(eventName: String, properties: Map<String, *>) {
        log.debug("PostHog capture no-op: $eventName")
    }
}
