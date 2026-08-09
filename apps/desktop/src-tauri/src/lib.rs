use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
#[cfg(not(debug_assertions))]
use std::{sync::mpsc, time::Duration};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use uuid::Uuid;

const DEFAULT_GLOBAL_SHORTCUT: &str = "Ctrl+Alt+E";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendConnection {
    base_url: Option<String>,
    token: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettingsFile {
    version: u8,
    toggle_window_shortcut: Option<String>,
}

impl Default for DesktopSettingsFile {
    fn default() -> Self {
        Self {
            version: 1,
            toggle_window_shortcut: Some(DEFAULT_GLOBAL_SHORTCUT.to_string()),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettingsResponse {
    version: u8,
    toggle_window_shortcut: Option<String>,
    autostart: bool,
}

struct DesktopRuntime {
    backend: Mutex<BackendConnection>,
    shortcut: Mutex<Option<String>>,
    sidecar: Mutex<Option<CommandChild>>,
    quitting: AtomicBool,
}

impl Default for DesktopRuntime {
    fn default() -> Self {
        Self {
            backend: Mutex::new(BackendConnection {
                base_url: None,
                token: None,
            }),
            shortcut: Mutex::new(None),
            sidecar: Mutex::new(None),
            quitting: AtomicBool::new(false),
        }
    }
}

fn desktop_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("desktop-settings.json"))
        .map_err(|error| error.to_string())
}

fn read_desktop_settings(app: &AppHandle) -> DesktopSettingsFile {
    let Ok(path) = desktop_settings_path(app) else {
        return DesktopSettingsFile::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return DesktopSettingsFile::default();
    };
    let Ok(settings) = serde_json::from_str::<DesktopSettingsFile>(&raw) else {
        return DesktopSettingsFile::default();
    };
    if settings.version == 1 {
        settings
    } else {
        DesktopSettingsFile::default()
    }
}

fn write_desktop_settings(app: &AppHandle, settings: &DesktopSettingsFile) -> Result<(), String> {
    let path = desktop_settings_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "桌面设置目录无效。".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let temporary = directory.join(format!(".desktop-settings-{}.tmp", Uuid::new_v4()));
    let bytes = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = window.hide();
        } else {
            show_window(app);
        }
    }
}

#[cfg(not(debug_assertions))]
fn start_sidecar(app: &AppHandle) -> Result<(BackendConnection, CommandChild), String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let library_directory = executable
        .parent()
        .ok_or_else(|| "无法确定 Airnobe 安装目录。".to_string())?
        .join("AirnobeLibrary");
    fs::create_dir_all(&library_directory).map_err(|error| error.to_string())?;
    let dictionary_directory = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("resources")
        .join("kuromoji-dict");
    let getting_started_epub = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("resources")
        .join("airnobe-getting-started.epub");
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let command = app
        .shell()
        .sidecar("airnobe-sidecar")
        .map_err(|error| error.to_string())?
        .arg("--sidecar")
        .env("AIRNOBE_LIBRARY_DIRECTORY", &library_directory)
        .env("AIRNOBE_KUROMOJI_DICTIONARY", &dictionary_directory)
        .env("AIRNOBE_BUNDLED_GETTING_STARTED_EPUB", &getting_started_epub)
        .env("AIRNOBE_APP_DIRECTORY", &library_directory)
        .env("AIRNOBE_API_TOKEN", &token)
        .env("AIRNOBE_API_PORT", "0");
    let (mut receiver, child) = command.spawn().map_err(|error| error.to_string())?;
    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<u16, String>>(1);
    tauri::async_runtime::spawn(async move {
        let mut ready_sent = false;
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                        if value.get("event").and_then(|value| value.as_str()) == Some("ready") {
                            if let Some(port) = value
                                .get("port")
                                .and_then(|value| value.as_u64())
                                .and_then(|port| u16::try_from(port).ok())
                            {
                                let _ = ready_tx.send(Ok(port));
                                ready_sent = true;
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("Airnobe sidecar: {}", String::from_utf8_lossy(&bytes))
                }
                CommandEvent::Error(error) => {
                    if !ready_sent {
                        let _ = ready_tx.send(Err(error));
                    }
                    return;
                }
                CommandEvent::Terminated(status) => {
                    if !ready_sent {
                        let _ = ready_tx.send(Err(format!("本地服务提前退出：{status:?}")));
                    }
                    return;
                }
                _ => {}
            }
        }
        if !ready_sent {
            let _ = ready_tx.send(Err("本地服务没有返回启动状态。".to_string()));
        }
    });
    let port = ready_rx
        .recv_timeout(Duration::from_secs(30))
        .map_err(|_| "本地服务启动超时。".to_string())??;
    Ok((
        BackendConnection {
            base_url: Some(format!("http://127.0.0.1:{port}")),
            token: Some(token),
        },
        child,
    ))
}

#[tauri::command]
fn desktop_backend_connection(state: State<'_, DesktopRuntime>) -> BackendConnection {
    state.backend.lock().unwrap().clone()
}

#[tauri::command]
fn desktop_settings(
    app: AppHandle,
    state: State<'_, DesktopRuntime>,
) -> Result<DesktopSettingsResponse, String> {
    desktop_settings_response(&app, &state)
}

fn desktop_settings_response(
    app: &AppHandle,
    state: &DesktopRuntime,
) -> Result<DesktopSettingsResponse, String> {
    Ok(DesktopSettingsResponse {
        version: 1,
        toggle_window_shortcut: state.shortcut.lock().unwrap().clone(),
        autostart: app
            .autolaunch()
            .is_enabled()
            .map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
fn set_desktop_autostart(app: AppHandle, enabled: bool) -> Result<DesktopSettingsResponse, String> {
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|error| error.to_string())?;
    let state = app.state::<DesktopRuntime>();
    desktop_settings_response(&app, &state)
}

#[tauri::command]
fn set_desktop_shortcut(
    app: AppHandle,
    shortcut: Option<String>,
) -> Result<DesktopSettingsResponse, String> {
    let normalized = shortcut
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(value) = &normalized {
        Shortcut::from_str(value).map_err(|_| "全局快捷键格式无效。".to_string())?;
    }
    let state = app.state::<DesktopRuntime>();
    let previous = state.shortcut.lock().unwrap().clone();
    if previous == normalized {
        return desktop_settings_response(&app, &state);
    }
    if let Some(value) = &normalized {
        app.global_shortcut()
            .register(value.as_str())
            .map_err(|error| format!("无法注册全局快捷键：{error}"))?;
    }
    if let Some(value) = &previous {
        if let Err(error) = app.global_shortcut().unregister(value.as_str()) {
            if let Some(next) = &normalized {
                let _ = app.global_shortcut().unregister(next.as_str());
            }
            return Err(format!("无法替换原全局快捷键：{error}"));
        }
    }
    let settings = DesktopSettingsFile {
        version: 1,
        toggle_window_shortcut: normalized.clone(),
    };
    if let Err(error) = write_desktop_settings(&app, &settings) {
        if let Some(value) = &normalized {
            let _ = app.global_shortcut().unregister(value.as_str());
        }
        if let Some(value) = &previous {
            let _ = app.global_shortcut().register(value.as_str());
        }
        return Err(format!("无法保存桌面设置：{error}"));
    }
    *state.shortcut.lock().unwrap() = normalized;
    desktop_settings_response(&app, &state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(DesktopRuntime::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app)
        }))
        .invoke_handler(tauri::generate_handler![
            desktop_backend_connection,
            desktop_settings,
            set_desktop_autostart,
            set_desktop_shortcut
        ])
        .setup(|app| {
            let settings = read_desktop_settings(app.handle());
            if let Some(shortcut) = &settings.toggle_window_shortcut {
                if app.global_shortcut().register(shortcut.as_str()).is_ok() {
                    *app.state::<DesktopRuntime>().shortcut.lock().unwrap() =
                        Some(shortcut.clone());
                }
            }

            #[cfg(not(debug_assertions))]
            {
                let (connection, child) =
                    start_sidecar(app.handle()).map_err(std::io::Error::other)?;
                *app.state::<DesktopRuntime>().backend.lock().unwrap() = connection;
                *app.state::<DesktopRuntime>().sidecar.lock().unwrap() = Some(child);
            }

            let toggle_item = MenuItem::with_id(app, "toggle", "显示/隐藏", true, None::<&str>)?;
            let exit_item = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_item, &exit_item])?;
            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .expect("missing application icon")
                        .clone(),
                )
                .tooltip("Airnobe")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_window(app),
                    "exit" => {
                        app.state::<DesktopRuntime>()
                            .quitting
                            .store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            if !std::env::args().any(|argument| argument == "--hidden") {
                show_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !window
                    .state::<DesktopRuntime>()
                    .quitting
                    .load(Ordering::SeqCst)
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Airnobe desktop failed to start");

    app.run(|app, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Some(child) = app.state::<DesktopRuntime>().sidecar.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
