package com.backendforge.telestore.ui

import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.backendforge.telestore.core.FileItem
import com.backendforge.telestore.core.FileKind
import com.backendforge.telestore.core.PlayQueue
import com.backendforge.telestore.photos.PhotoViewerScreen
import com.backendforge.telestore.player.MiniPlayer
import com.backendforge.telestore.player.NowPlayingScreen
import com.backendforge.telestore.player.VideoScreen
import com.backendforge.telestore.player.VideoViewModel
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

private const val ROUTE_VIDEO = "video"
private const val ROUTE_PHOTOS = "photos"
private const val ROUTE_NOW_PLAYING = "now_playing"

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
    // The players take the whole screen: no tabs, no mini player
    val isPlayer = currentRoute in setOf(ROUTE_VIDEO, ROUTE_PHOTOS, ROUTE_NOW_PLAYING)
    val music = remember { container.startMusic() }
    val musicState by music.state.collectAsStateWithLifecycle()

    /** Opens a video, song or photo with the folder's others queued after it. False: no viewer. */
    fun openFile(item: FileItem, siblings: List<FileItem>): Boolean {
        val (queue, index) = PlayQueue.around(siblings, item)
        when (item.kind) {
            FileKind.VIDEO -> {
                container.playback.openVideos(queue, index)
                navController.navigate(ROUTE_VIDEO)
            }
            FileKind.AUDIO -> {
                music.play(container.api(), queue, index)
                navController.navigate(ROUTE_NOW_PLAYING)
            }
            FileKind.PHOTO -> {
                container.playback.openPhotos(queue, index)
                navController.navigate(ROUTE_PHOTOS)
            }
            else -> return false
        }
        return true
    }

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
            if (!isPlayer) Column {
                if (musicState.hasMedia) MiniPlayer(musicState, music, onOpen = { navController.navigate(ROUTE_NOW_PLAYING) })
                if (!isSearch) NavigationBar {
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
            // Players draw edge to edge and handle the system bars themselves
            modifier = Modifier.padding(if (isPlayer) PaddingValues(0.dp) else padding),
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
                        onOpenFile = ::openFile,
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
                        onOpenFile = ::openFile,
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
                        onOpenFile = ::openFile,
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
                        onOpenFile = ::openFile,
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
                    onOpenFile = ::openFile,
                )
            }

            composable(ROUTE_VIDEO) {
                val vm: VideoViewModel = viewModel { VideoViewModel(container) }
                VideoScreen(vm, onBack = { navController.popBackStack() })
            }

            composable(ROUTE_PHOTOS) {
                PhotoViewerScreen(
                    photos = container.playback.photos,
                    startIndex = container.playback.photoIndex,
                    api = container.api(),
                    onBack = { navController.popBackStack() },
                )
            }

            composable(ROUTE_NOW_PLAYING) {
                NowPlayingScreen(musicState, music, onClose = { navController.popBackStack() })
            }
        }
    }
}
