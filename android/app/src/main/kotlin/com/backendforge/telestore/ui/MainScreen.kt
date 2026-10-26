package com.backendforge.telestore.ui

import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.Session
import com.backendforge.telestore.ui.browse.FolderScreen
import com.backendforge.telestore.ui.browse.FolderViewModel
import com.backendforge.telestore.ui.more.MoreScreen
import com.backendforge.telestore.ui.search.SearchScreen
import com.backendforge.telestore.ui.search.SearchViewModel
import com.backendforge.telestore.ui.transfers.TransfersPlaceholderScreen

private enum class MainTab(val title: String, val icon: ImageVector) {
    HOME("Home", Icons.Default.Home),
    STARRED("Starred", Icons.Default.Star),
    RECENT("Recent", Icons.Default.Schedule),
    TRANSFERS("Transfers", Icons.Default.SwapVert),
    MORE("More", Icons.Default.MoreHoriz),
}

@Composable
fun MainScreen(
    container: AppContainer,
    session: Session,
    modifier: Modifier = Modifier,
) {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route ?: ""
    val currentPathArg = navBackStackEntry?.arguments?.getString("path")

    val selectedTab = when {
        currentRoute.startsWith("folder") -> when (currentPathArg) {
            "starred" -> MainTab.STARRED
            "all" -> MainTab.RECENT
            "trash", "inbox" -> MainTab.MORE
            else -> MainTab.HOME
        }
        currentRoute == "transfers" -> MainTab.TRANSFERS
        currentRoute == "more" -> MainTab.MORE
        else -> MainTab.HOME
    }

    val isSearch = currentRoute == "search"

    fun navigateToFolder(path: String) {
        val encoded = Uri.encode(path)
        val route = "folder?path=$encoded"
        if (!navController.popBackStack(route, inclusive = false)) {
            navController.navigate(route)
        }
    }

    fun navigateToTab(route: String) {
        navController.navigate(route) {
            popUpTo(navController.graph.findStartDestination().id) {
                saveState = true
            }
            launchSingleTop = true
            restoreState = true
        }
    }

    // Back handling: leaving on root tabs
    val activity = LocalContext.current as? ComponentActivity
    val isAtTabRoot = when {
        currentRoute.startsWith("folder") -> currentPathArg in setOf(TeleStoreApi.HOME, "starred", "all")
        currentRoute in setOf("transfers", "more") -> true
        else -> false
    }

    BackHandler(enabled = isAtTabRoot) {
        activity?.finish()
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        bottomBar = {
            if (!isSearch) {
                NavigationBar {
                    MainTab.entries.forEach { tab ->
                        val isSelected = selectedTab == tab
                        NavigationBarItem(
                            selected = isSelected,
                            onClick = {
                                when (tab) {
                                    MainTab.HOME -> navigateToTab("folder?path=${Uri.encode(TeleStoreApi.HOME)}")
                                    MainTab.STARRED -> navigateToTab("folder?path=starred")
                                    MainTab.RECENT -> navigateToTab("folder?path=all")
                                    MainTab.TRANSFERS -> navigateToTab("transfers")
                                    MainTab.MORE -> navigateToTab("more")
                                }
                            },
                            icon = { Icon(tab.icon, contentDescription = tab.title) },
                            label = { Text(tab.title) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = "folder?path=${Uri.encode(TeleStoreApi.HOME)}",
            modifier = Modifier.padding(padding),
        ) {
            composable(
                route = "folder?path={path}",
                arguments = listOf(
                    navArgument("path") {
                        type = NavType.StringType
                        defaultValue = TeleStoreApi.HOME
                    }
                ),
            ) { backStackEntry ->
                val path = backStackEntry.arguments?.getString("path") ?: TeleStoreApi.HOME
                val vm: FolderViewModel = viewModel(key = "$path-${session.token}") {
                    FolderViewModel(container, initialPath = path)
                }
                FolderScreen(
                    vm = vm,
                    api = container.api(),
                    onNavigateFolder = { navigateToFolder(it) },
                    onOpenSearch = { navController.navigate("search") },
                )
            }

            composable("transfers") {
                TransfersPlaceholderScreen()
            }

            composable("more") {
                MoreScreen(
                    container = container,
                    session = session,
                    onNavigateTrash = { navigateToFolder("trash") },
                    onNavigateInbox = { navigateToFolder("inbox") },
                )
            }

            composable("search") {
                val vm: SearchViewModel = viewModel(key = "search-${session.token}") {
                    SearchViewModel(container)
                }
                SearchScreen(
                    vm = vm,
                    api = container.api(),
                    onNavigateFolder = { navigateToFolder(it) },
                    onBack = { navController.popBackStack() },
                )
            }
        }
    }
}
