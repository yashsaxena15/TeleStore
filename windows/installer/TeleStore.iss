; TeleStore for Windows: the installer (Inno Setup 6). CI builds it from PyInstaller's dist\TeleStore folder:
;   iscc /DAppVersion=1.2.3 installer\TeleStore.iss
; It installs for the signed-in Windows user only (no administrator needed) into
; %LOCALAPPDATA%\Programs\TeleStore, with a Start menu entry, an optional desktop icon and an uninstaller.
; Sign-ins, settings and unfinished uploads are in %APPDATA%\TeleStore and stay through updates and
; uninstalling. The app's own updates run this installer quietly (/SILENT), and it opens TeleStore again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6C1B7E54-2F0B-4C4E-9E3F-7B6C2A1D9E10}
AppName=TeleStore
AppVersion={#AppVersion}
AppVerName=TeleStore {#AppVersion}
AppPublisher=TeleStore
AppPublisherURL=https://github.com/yashsaxena15/TeleStore
AppSupportURL=https://github.com/yashsaxena15/TeleStore/releases
DefaultDirName={localappdata}\Programs\TeleStore
DefaultGroupName=TeleStore
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=Output
OutputBaseFilename=TeleStore-Setup-{#AppVersion}
SetupIconFile=TeleStore.ico
UninstallDisplayIcon={app}\TeleStore.exe
UninstallDisplayName=TeleStore
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no
VersionInfoVersion={#AppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\TeleStore\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; An update replaces the whole program folder (old library versions don't linger)
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{autoprograms}\TeleStore"; Filename: "{app}\TeleStore.exe"
Name: "{autodesktop}\TeleStore"; Filename: "{app}\TeleStore.exe"; Tasks: desktopicon

[Run]
; Shown as a "Launch TeleStore" tick box at the end; an update (/SILENT) opens TeleStore by itself
Filename: "{app}\TeleStore.exe"; Description: "{cm:LaunchProgram,TeleStore}"; Flags: nowait postinstall
