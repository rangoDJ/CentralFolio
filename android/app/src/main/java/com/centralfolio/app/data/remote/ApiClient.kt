package com.centralfolio.app.data.remote

import com.centralfolio.app.BuildConfig
import com.centralfolio.app.security.SecurityManager
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class ApiClient(private val securityManager: SecurityManager) {

    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }

    fun getApiService(): CentralFolioApiService {
        val serverUrl = securityManager.getServerUrl() ?: throw IllegalStateException("Server URL not configured")

        // Logging must NEVER include the Authorization header or response bodies:
        // logcat is readable by other apps / adb, so a BODY-level interceptor would
        // leak the bearer token. Debug builds get BASIC (request line + status code
        // only); release builds disable logging entirely.
        val logLevel = if (BuildConfig.DEBUG) {
            HttpLoggingInterceptor.Level.BASIC
        } else {
            HttpLoggingInterceptor.Level.NONE
        }

        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val requestBuilder = chain.request().newBuilder()
                securityManager.getToken()?.let { token ->
                    requestBuilder.addHeader("Authorization", "Bearer $token")
                }
                chain.proceed(requestBuilder.build())
            }
            .addInterceptor(HttpLoggingInterceptor().apply {
                level = logLevel
            })
            .build()

        return Retrofit.Builder()
            .baseUrl("$serverUrl/")
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(CentralFolioApiService::class.java)
    }
}
