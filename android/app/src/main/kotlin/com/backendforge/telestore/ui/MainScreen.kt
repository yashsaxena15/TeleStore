package com.backendforge.telestore.ui

import android.net.Uri
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.PhotoLibrary
import com.backendforge.telestore.ui.home.HomeScreen
import com.backendforge.telestore.ui.home.HomeShortcut
import com.backendforge.telestore.ui.home.HomeViewModel
import com.backendforge.telestore.ui.home.KindScreen
import com.backendforge.telestore.ui.home.KindViewModel
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import com.backendforge.telestore.core.AppRelease
import com.backendforge.telestore.data.AppVersion
import com.backendforge.telestore.data.openInBrowser
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.ui.platform.LocalConfiguration
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.backendforge.telestore.core.ApiException
import com.backendforge.telestore.transfers.describe
import com.backendforge.telestore.ui.components.FolderPickerSheet
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
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
import com.backendforge.telestore.ui.transfers.TransfersScreen

private const val ROUTE_VIDEO = "video"
private const val ROUTE_PHOTOS = "photos"
private const val ROUTE_NOW_PLAYING = "now_playing"

private enum class MainTab(val title: String, val icon: ImageVector, val graphRoute: String) {
    HOME("Home", Icons.Default.Home, "home_graph"),
    PHOTOS("Photos", Icons.Default.PhotoLibrary, "photos_graph"),
    FILES("Files", Icons.Default.Folder, "files_graph"),
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
        currentRoute.startsWith("photos_") -> MainTab.PHOTOS
        currentRoute.startsWith("files_") -> MainTab.FILES
        currentRoute == "transfers" -> MainTab.TRANSFERS
        currentRoute.startsWith("more_") -> MainTab.MORE
        else -> MainTab.HOME
    }

    val isSearch = currentRoute == "search"
    // The players take the whole screen: no tabs, no mini player
    val isPlayer = currentRoute in setOf(ROUTE_VIDEO, ROUTE_PHOTOS, ROUTE_NOW_PLAYING)
    val music = remember { container.startMusic() }
    val musicState by music.state.collectAsStateWithLifecycle()

    val context = LocalContext.current

    /** Opens a video, song or photo with the folder's others queued after it. False: no viewer. */
    fun openFile(item: FileItem, siblings: List<FileItem>): Boolean {
        val (queue, index) = PlayQueue.around(siblings, item)
        when (item.kind) {
            FileKind.VIDEO -> {
                container.playback.openVideos(queue, index)
                navController.navigate(ROUTE_VIDEO)
            }
            FileKind.AUDIO -> {
                music.play(container.api(), queue, index) { container.transfers.store.offlineCopy(context, it.id) }
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

    // ── Uploads and downloads ─────────────────────────────────────────────
    val scope = rememberCoroutineScope()
    var uploadFolder by remember { mutableStateOf(TeleStoreApi.HOME) }
    var transferMessage by remember { mutableStateOf<String?>(null) }
    val transferItems by container.transfers.store.items.collectAsStateWithLifecycle()
    val offlineIds = remember(transferItems) { container.transfers.store.offlineIds() }
    val pendingShare by container.pendingShare.collectAsStateWithLifecycle()

    // Android 13+ asks before showing the progress notification (transfers run either way)
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    fun askForNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    fun startUploads(uris: List<Uri>, folder: String) {
        if (uris.isEmpty()) return
        askForNotifications()
        val files = uris.map { describe(context, it) }
        val skipped = container.transfers.upload(files, folder)
        val queued = files.size - skipped.size
        transferMessage = buildString {
            if (queued > 0) append("Uploading $queued file${if (queued != 1) "s" else ""}. See Transfers.")
            if (skipped.isNotEmpty()) append(" Skipped (empty or unreadable): ${skipped.joinToString()}")
        }.trim()
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        startUploads(uris, uploadFolder)
    }

    fun upload(folder: String) {
        uploadFolder = folder
        picker.launch(arrayOf("*/*"))
    }

    fun download(item: FileItem) {
        askForNotifications()
        if (item.isFolder) {
            scope.launch {
                transferMessage = try {
                    val count = container.transfers.downloadFolder(container.api(), FolderPaths.childPath(item))
                    if (count == 0) "This folder is empty." else "Downloading ${item.name} as ZIP ($count files). See Transfers."
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    (e as? ApiException)?.message ?: "Couldn't start the download."
                }
            }
        } else {
            container.transfers.download(item)
            transferMessage = "Downloading ${item.name}. See Transfers."
        }
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
        currentRoute == "home_root" || currentRoute == "photos_root" -> true
        currentRoute.startsWith("files_folder") -> currentPathArg == TeleStoreApi.HOME
        currentRoute == "transfers" -> true
        currentRoute == "more_root" -> true
        else -> false
    }

    BackHandler(enabled = isAtTabRoot) {
        activity?.finish()
    }

    val wide = LocalConfiguration.current.screenWidthDp >= 600

    // Once a day, look for a newer APK on GitHub and offer it
    var update by remember { mutableStateOf<AppRelease?>(null) }
    LaunchedEffect(Unit) {
        val settings = container.settings
        if (System.currentTimeMillis() - settings.lastUpdateCheck < 24 * 60 * 60 * 1000L) return@LaunchedEffect
        try {
            update = container.updates.newerThan(AppVersion.of(context).build)
            settings.lastUpdateCheck = System.currentTimeMillis()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Offline or GitHub unreachable: try again next time
        }
    }
    update?.let { release ->
        AlertDialog(
            onDismissRequest = { update = null },
            title = { Text("Update available") },
            text = { Text("TeleStore ${release.version} is ready. Download it, then open the file to install it over this version.") },
            confirmButton = { TextButton(onClick = { openInBrowser(context, release.apkUrl); update = null }) { Text("Download") } },
            dismissButton = { TextButton(onClick = { update = null }) { Text("Later") } },
        )
    }
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(transferMessage) {
        transferMessage?.takeIf { it.isNotEmpty() }?.let {
            snackbar.showSnackbar(it)
            transferMessage = null
        }
    }

    // Files shared into TeleStore from another app: choose the folder, then upload
    if (pendingShare.isNotEmpty()) {
        FolderPickerSheet(
            title = "Upload ${pendingShare.size} file${if (pendingShare.size != 1) "s" else ""} to",
            confirmActionLabel = "Upload here",
            sourceItems = emptyList(),
            api = container.api(),
            onSelectFolder = { folder ->
                val uris = pendingShare.map { it.uri }
                container.pendingShare.value = emptyList()
                startUploads(uris, folder)
            },
            onDismiss = { container.pendingShare.value = emptyList() },
        )
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (!isPlayer) Column {
                if (musicState.hasMedia) MiniPlayer(musicState, music, onOpen = { navController.navigate(ROUTE_NOW_PLAYING) })
                if (!isSearch && !wide) NavigationBar {
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
        // Players draw edge to edge and handle the system bars themselves
        Row(Modifier.fillMaxSize().padding(if (isPlayer) PaddingValues(0.dp) else padding)) {
            // Tablets and landscape: the tabs move to a rail on the left
            if (wide && !isPlayer && !isSearch) {
                NavigationRail {
                    MainTab.entries.forEach { tab ->
                        NavigationRailItem(
                            selected = selectedTab == tab,
                            onClick = { navigateToTab(tab) },
                            icon = { Icon(tab.icon, contentDescription = tab.title) },
                            label = { Text(tab.title) },
                        )
                    }
                }
            }
            NavHost(
                navController = navController,
                startDestination = "home_graph",
                modifier = Modifier.weight(1f).fillMaxHeight(),
            ) {
                navigation(startDestination = "home_root", route = "home_graph") {
                    composable("home_root") {
                        val vm: HomeViewModel = viewModel(key = "home-${session.token}") { HomeViewModel(container) }
                        HomeScreen(
                            vm = vm,
                            container = container,
                            session = session,
                            onSearch = { navController.navigate("search") },
                            onAccount = { navigateToTab(MainTab.MORE) },
                            onKind = { navController.navigate("home_kind/${it.name}") },
                            onShortcut = { shortcut ->
                                navigateToFolder("home", when (shortcut) {
                                    HomeShortcut.STARRED -> "starred"
                                    HomeShortcut.RECENT -> "all"
                                    HomeShortcut.TRASH -> "trash"
                                })
                            },
                            onOpenFolder = { navigateToFolder("home", it) },
                            onOpenFile = ::openFile,
                            onResume = { entry ->
                                container.playback.openVideos(listOf(entry.asFile()), 0)
                                navController.navigate(ROUTE_VIDEO)
                            },
                            onUpload = ::upload,
                            onCreateFolder = { name ->
                                scope.launch {
                                    transferMessage = try {
                                        container.api().createFolder(name, TeleStoreApi.HOME)
                                        vm.refresh()
                                        "Folder \"$name\" created."
                                    } catch (e: CancellationException) {
                                        throw e
                                    } catch (e: Exception) {
                                        (e as? ApiException)?.message ?: "Couldn't create the folder."
                                    }
                                }
                            },
                        )
                    }
                    composable(
                        route = "home_folder?path={path}",
                        arguments = listOf(navArgument("path") { type = NavType.StringType; defaultValue = TeleStoreApi.HOME }),
                    ) { backStackEntry ->
                        val path = backStackEntry.arguments?.getString("path") ?: TeleStoreApi.HOME
                        val vm: FolderViewModel = viewModel(key = "home-$path-${session.token}") { FolderViewModel(container, initialPath = path) }
                        FolderScreen(
                            vm = vm,
                            api = container.api(),
                            onNavigateFolder = { navigateToFolder("home", it) },
                            onNavigateCrumb = { navigateToCrumb("home", it) },
                            onOpenSearch = { navController.navigate("search") },
                            onOpenFile = ::openFile,
                            onUpload = ::upload,
                            onDownload = ::download,
                            offlineIds = offlineIds,
                        )
                    }
                    composable("home_kind/{kind}", arguments = listOf(navArgument("kind") { type = NavType.StringType })) { backStackEntry ->
                        val kind = runCatching { FileKind.valueOf(backStackEntry.arguments?.getString("kind").orEmpty()) }.getOrDefault(FileKind.VIDEO)
                        val vm: KindViewModel = viewModel(key = "kind-$kind-${session.token}") { KindViewModel(container, kind) }
                        KindScreen(vm, container, onBack = { navController.popBackStack() }, onOpenFile = ::openFile)
                    }
                }

                navigation(startDestination = "photos_root", route = "photos_graph") {
                    composable("photos_root") {
                        val vm: KindViewModel = viewModel(key = "photos-${session.token}") { KindViewModel(container, FileKind.PHOTO) }
                        KindScreen(vm, container, onBack = null, onOpenFile = ::openFile)
                    }
                }

                navigation(startDestination = "files_folder?path=${Uri.encode(TeleStoreApi.HOME)}", route = "files_graph") {
                    composable(
                        route = "files_folder?path={path}",
                        arguments = listOf(navArgument("path") { type = NavType.StringType; defaultValue = TeleStoreApi.HOME }),
                    ) { backStackEntry ->
                        val path = backStackEntry.arguments?.getString("path") ?: TeleStoreApi.HOME
                        val vm: FolderViewModel = viewModel(key = "files-$path-${session.token}") { FolderViewModel(container, initialPath = path) }
                        FolderScreen(
                            vm = vm,
                            api = container.api(),
                            onNavigateFolder = { navigateToFolder("files", it) },
                            onNavigateCrumb = { navigateToCrumb("files", it) },
                            onOpenSearch = { navController.navigate("search") },
                            onOpenFile = ::openFile,
                            onUpload = ::upload,
                            onDownload = ::download,
                            offlineIds = offlineIds,
                        )
                    }
                }

                composable("transfers") {
                    TransfersScreen(container)
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
                            onNavigateStarred = { navigateToFolder("more", "starred") },
                            onNavigateRecent = { navigateToFolder("more", "all") },
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
                            onUpload = ::upload,
                            onDownload = ::download,
                            offlineIds = offlineIds,
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
                    VideoScreen(vm, api = container.api(), onBack = { navController.popBackStack() }, onDownload = ::download)
                }

                composable(ROUTE_PHOTOS) {
                    PhotoViewerScreen(
                        photos = container.playback.photos,
                        startIndex = container.playback.photoIndex,
                        api = container.api(),
                        onBack = { navController.popBackStack() },
                        offlineCopy = { container.transfers.store.offlineCopy(context, it.id) },
                    )
                }

                composable(ROUTE_NOW_PLAYING) {
                    NowPlayingScreen(musicState, music, onClose = { navController.popBackStack() })
                }
            }
        }
    }
}
