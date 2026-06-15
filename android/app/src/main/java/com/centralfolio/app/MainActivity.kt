package com.centralfolio.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.centralfolio.app.security.SecurityManager
import com.centralfolio.app.ui.screens.DashboardScreen
import com.centralfolio.app.ui.screens.LoginScreen
import com.centralfolio.app.ui.theme.CentralFolioTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        val securityManager = SecurityManager(applicationContext)

        setContent {
            CentralFolioTheme {
                val navController = rememberNavController()
                
                val startDestination = if (securityManager.getToken() != null) {
                    "dashboard"
                } else {
                    "login"
                }

                NavHost(
                    navController = navController,
                    startDestination = startDestination
                ) {
                    composable("login") {
                        LoginScreen(
                            securityManager = securityManager,
                            onLoginSuccess = {
                                navController.navigate("dashboard") {
                                    popUpTo("login") { inclusive = true }
                                }
                            }
                        )
                    }
                    composable("dashboard") {
                        DashboardScreen(
                            securityManager = securityManager,
                            onLogout = {
                                navController.navigate("login") {
                                    popUpTo("dashboard") { inclusive = true }
                                }
                            }
                        )
                    }
                }
            }
        }
    }
}
