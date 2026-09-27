; Windows kurulum dosyası (Inno Setup 6). Tek bir .exe üretir:
;   - Yönetici izni istemez; kullanıcının kendi klasörüne kurar: %LOCALAPPDATA%\Programs\Basic Docker
;   - Başlat menüsüne ekler, istenirse masaüstüne kısayol koyar, bitince uygulamayı açar.
;   - Yeni sürümün kurulumu eskisinin üzerine kurar; Ayarlar → Uygulamalar'dan kaldırılabilir.
; Derleme (GitHub Actions yapar): ISCC /DAppVersion=2.1.1 packaging\windows-kurulum.iss
; Önce PyInstaller paketi (dist\Basic Docker\) hazır olmalı.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6D0B474D-B938-4A51-B48D-36309E1AEA2E}
AppName=Basic Docker
AppVersion={#AppVersion}
AppVerName=Basic Docker {#AppVersion}
AppPublisher=Basic Docker
AppPublisherURL=https://github.com/benysff/basic-docker
AppSupportURL=https://github.com/benysff/basic-docker/issues
DefaultDirName={localappdata}\Programs\Basic Docker
DisableDirPage=yes
DefaultGroupName=Basic Docker
DisableProgramGroupPage=yes
DisableReadyPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=Basic-Docker-Windows-Kurulum
SetupIconFile=..\assets\BasicDocker.ico
UninstallDisplayIcon={app}\Basic Docker.exe
UninstallDisplayName=Basic Docker
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Güncellerken açık olan Basic Docker'ı kapatıp sonra yeniden açar
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; Eski sürümden kalan kütüphaneler yenileriyle karışmasın
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "..\dist\Basic Docker\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Basic Docker"; Filename: "{app}\Basic Docker.exe"
Name: "{autodesktop}\Basic Docker"; Filename: "{app}\Basic Docker.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Basic Docker.exe"; Description: "{cm:LaunchProgram,Basic Docker}"; Flags: nowait postinstall skipifsilent
