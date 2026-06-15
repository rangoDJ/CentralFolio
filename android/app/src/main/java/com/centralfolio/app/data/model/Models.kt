package com.centralfolio.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(
    val password: String
)

@Serializable
data class LoginResponse(
    val token: String
)

@Serializable
data class AuthStatusResponse(
    val configured: Boolean
)

@Serializable
data class Amount(
    val amount: Double = 0.0,
    val currency: String = "USD"
)

@Serializable
data class BalanceDetail(
    val cash: Amount? = null,
    val total: Amount? = null
)

@Serializable
data class Account(
    val id: String,
    val name: String,
    val customName: String? = null,
    val balance: BalanceDetail? = null
)

@Serializable
data class AccountGroup(
    val portfolioId: Int? = null,
    val portfolioName: String? = null,
    val accounts: List<Account> = emptyList()
)

@Serializable
data class SymbolDetails(
    val symbol: String,
    val description: String? = null
)

@Serializable
data class SymbolInfo(
    val symbol: SymbolDetails? = null
)

@Serializable
data class Holding(
    val symbol: SymbolInfo? = null,
    val units: Double? = null,
    val price: Double? = null,
    val marketValue: Double? = null,
    val average_purchase_price: Double? = null,
    val currency: String = "CAD"
)

@Serializable
data class HoldingAccount(
    val accountId: String,
    val accountName: String? = null,
    val holdings: List<Holding> = emptyList(),
    val error: String? = null
)

@Serializable
data class DividendForecast(
    val symbol: String,
    val amount: Double? = null,
    val date: String,
    val status: String? = null,
    val frequency: Int? = null,
    val amountPerShare: Double? = null
)

@Serializable
data class AccountDividendForecast(
    val accountId: String,
    val accountName: String? = null,
    val dividends: List<DividendForecast> = emptyList(),
    val error: String? = null
)

@Serializable
data class UserPortfolio(
    val id: Int,
    val name: String,
    val description: String? = null,
    val color: String? = null,
    val accountIds: List<String> = emptyList()
)
