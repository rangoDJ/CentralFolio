package com.centralfolio.app.data.remote

import com.centralfolio.app.data.model.*
import retrofit2.http.*

interface CentralFolioApiService {

    @GET("auth/status")
    suspend fun getAuthStatus(): AuthStatusResponse

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @POST("auth/setup")
    suspend fun setup(@Body request: LoginRequest): LoginResponse

    @GET("api/accounts")
    suspend fun getAccounts(
        @Query("forceRefresh") forceRefresh: Boolean = false
    ): List<AccountGroup>

    @GET("api/holdings/{portfolioId}/{accountId}")
    suspend fun getHoldings(
        @Path("portfolioId") portfolioId: Int,
        @Path("accountId") accountId: String,
        @Query("forceRefresh") forceRefresh: Boolean = false
    ): List<Holding>

    @GET("api/user-portfolios")
    suspend fun getUserPortfolios(): List<UserPortfolio>
}
