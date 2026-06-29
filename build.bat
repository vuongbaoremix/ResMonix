@echo off
echo ===================================================
echo Building ResMonix Application...
echo ===================================================

:: Run tauri build using bun as configured in project rules
call bun run tauri build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed!
    pause
    exit /b %errorlevel%
)

echo.
echo ===================================================
echo Updating Portable Executable...
echo ===================================================

:: Copy the compiled exe to the project root as a portable version
copy /y "src-tauri\target\release\resmonix.exe" "ResMonix-Portable.exe"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to copy portable executable!
    pause
    exit /b %errorlevel%
)

echo.
echo ===================================================
echo [SUCCESS] Build completed successfully!
echo.
echo - Portable Version: ResMonix-Portable.exe (Project Root)
echo - Installer (MSI): src-tauri\target\release\bundle\msi\ResMonix_0.1.0_x64_en-US.msi
echo - Installer (EXE): src-tauri\target\release\bundle\nsis\ResMonix_0.1.0_x64-setup.exe
echo ===================================================
pause
