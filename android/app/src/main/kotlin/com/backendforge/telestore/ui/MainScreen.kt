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
import androidx.navigation.compose.navigation
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.backendforge.telestore.core.FolderPaths
import com.backendforge.telestore.core.TeleStoreApi
import com.backendforge.telestore.data.AppContainer
import com.backendforge.telestore.data.Session
import com.backendforge.telestore.ui.browse.FolderScreen
import com.backendforge.telestore.ui.browse.FolderViewModel
import com.backendforge.telestore.ui.more.MoreScreen
import com.backendforge.telestore.ui.search.SearchScreen
import com.backendforge.telestore.ui.search.SearchViewModel
import com.backendforge.telestore.ui.transfers.TransfersPlaceholderScreen

private enum class MainTab(val title: String, val icon: ImageVector, val graphRoute: String) {
    HOME("Home", Icons.Default.Home, "home_graph"),
    STARRED("Starred", Icons.Default.Star, "starred_graph"),
    RECENT("Recent", Icons.Default.Schedule, "recent_graph"),
    TRANSFERS("Transfers", Icons.Default.SwapVert, "transfers"),
    MORE("More", Icons.Default.MoreHoriz, "more_graph"),
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
        currentRoute.startsWith("home_") -> MainTab.HOME
        currentRoute.startsWith("starred_") -> MainTab.STARRED
        currentRoute.startsWith("recent_") -> MainTab.RECENT
        currentRoute == "transfers" -> MainTab.TRANSFERS
        currentRoute.startsWith("more_") -> MainTab.MORE
        else -> MainTab.HOME
    }

    val isSearch = currentRoute == "search"

    fun navigateToFolder(prefix: String, path: String) {
        val encoded = Uri.encode(path)
        navController.navigate("${prefix}_folder?path=$encoded")
    }

    // Go back through this tab's folders inside the crumb's folder, or open it when the history
    // doesn't lead there (a folder opened from Starred or Search). See FolderPaths.crumbStep.
    fun navigateToCrumb(prefix: String, targetPath: String) {
        while (true) {
            val previous = navController.previousBackStackEntry
            val sameTabFolder = previous?.destination?.route?.startsWith("${prefix}_folder") == true
            val previousPath = if (sameTabFolder) previous?.arguments?.getString("path") else null
            when (FolderPaths.crumbStep(previousPath, targetPath)) {
                FolderPaths.CrumbStep.POP_AND_STOP -> {
                    navController.popBackStack()
                    return
                }
                FolderPaths.CrumbStep.POP_AND_CONTINUE -> navController.popBackStack()
                FolderPaths.CrumbStep.OPEN -> {
                    navigateToFolder(prefix, targetPath)
                    return
                }
            }
        }
    }

    fun navigateToTab(tab: MainTab) {
        navController.navigate(tab.graphRoute) {
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
        currentRoute.startsWith("home_folder") -> currentPathArg == TeleStoreApi.HOME
        currentRoute.startsWith("starred_folder") -> currentPathArg == "starred"
        currentRoute.startsWith("recent_folder") -> currentPathArg == "all"
        currentRoute == "transfers" -> true
        currentRoute == "more_root" -> true
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
                            onClick = { navigateToTab(tab) },
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
            startDestination = "home_graph",
            modifier = Modifier.padding(padding),
        ) {
            navigation(
                startDestination = "home_folder?path=${Uri.encode(TeleStoreApi.HOME)}",
                route = "home_graph",
            ) {
                composable(
                    route = "home_folder?path={path}",
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
                        onNavigateFolder = { navigateToFolder("home", it) },
                        onNavigateCrumb = { navigateToCrumb("home", it) },
                        onOpenSearch = { navController.navigate("search") },
                    )
                }
            }

            navigation(
                startDestination = "starred_folder?path=starred",
                route = "starred_graph",
            ) {
                composable(
                    route = "starred_folder?path={path}",
                    arguments = listOf(
                        navArgument("path") {
                            type = NavType.StringType
                            defaultValue = "starred"
                        }
                    ),
                ) { backStackEntry ->
                    val path = backStackEntry.arguments?.getString("path") ?: "starred"
                    val vm: FolderViewModel = viewModel(key = "$path-${session.token}") {
                        FolderViewModel(container, initialPath = path)
                    }
                    FolderScreen(
                        vm = vm,
                        api = container.api(),
                        onNavigateFolder = { navigateToFolder("starred", it) },
                        onNavigateCrumb = { navigateToCrumb("starred", it) },
                        onOpenSearch = { navController.navigate("search") },
                    )
                }
            }

            navigation(
                startDestination = "recent_folder?path=all",
                route = "recent_graph",
            ) {
                composable(
                    route = "recent_folder?path={path}",
                    arguments = listOf(
                        navArgument("path") {
                            type = NavType.StringType
                            defaultValue = "all"
                        }
                    ),
                ) { backStackEntry ->
                    val path = backStackEntry.arguments?.getString("path") ?: "all"
                    val vm: FolderViewModel = viewModel(key = "$path-${session.token}") {
                        FolderViewModel(container, initialPath = path)
                    }
                    FolderScreen(
                        vm = vm,
                        api = container.api(),
                        onNavigateFolder = { navigateToFolder("recent", it) },
                        onNavigateCrumb = { navigateToCrumb("recent", it) },
                        onOpenSearch = { navController.navigate("search") },
                    )
                }
            }

            composable("transfers") {
                TransfersPlaceholderScreen()
            }

            navigation(
                startDestination = "more_root",
                route = "more_graph",
            ) {
                composable("more_root") {
                    MoreScreen(
                        container = container,
                        session = session,
                        onNavigateTrash = { navigateToFolder("more", "trash") },
                        onNavigateInbox = { navigateToFolder("more", "inbox") },
                    )
                }

                composable(
                    route = "more_folder?path={path}",
                    arguments = listOf(
                        navArgument("path") {
                            type = NavType.StringType
                            defaultValue = "trash"
                        }
                    ),
                ) { backStackEntry ->
                    val path = backStackEntry.arguments?.getString("path") ?: "trash"
                    val vm: FolderViewModel = viewModel(key = "$path-${session.token}") {
                        FolderViewModel(container, initialPath = path)
                    }
                    FolderScreen(
                        vm = vm,
                        api = container.api(),
                        onNavigateFolder = { navigateToFolder("more", it) },
                        onNavigateCrumb = { navigateToCrumb("more", it) },
                        onOpenSearch = { navController.navigate("search") },
                    )
                }
            }

            composable("search") {
                val vm: SearchViewModel = viewModel(key = "search-${session.token}") {
                    SearchViewModel(container)
                }
                SearchScreen(
                    vm = vm,
                    api = container.api(),
                    onNavigateFolder = { navigateToFolder("home", it) },
                    onBack = { navController.popBackStack() },
                )
            }
        }
    }
}
