import { useEffect, useState } from "react";
import { desktopShortcutFromEvent, type DesktopSettings } from "./desktop-settings.js";

interface DesktopSettingsSectionProps {
  settings: DesktopSettings;
  onSaveShortcut(shortcut: string | null): Promise<void>;
  onSaveAutostart(enabled: boolean): Promise<void>;
  onError(message: string | undefined): void;
}

export function DesktopSettingsSection({ settings, onSaveShortcut, onSaveAutostart, onError }: DesktopSettingsSectionProps) {
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const listener = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { setCapturing(false); return; }
      if (event.key === "Backspace") {
        setCapturing(false);
        setSaving(true);
        void onSaveShortcut(null).catch((error) => onError((error as Error).message)).finally(() => setSaving(false));
        return;
      }
      if (event.repeat) return;
      const shortcut = desktopShortcutFromEvent(event);
      if (!shortcut) { onError("请选择字母、数字、方向键或功能键；Windows 键不能用于全局快捷键。"); return; }
      setCapturing(false);
      setSaving(true);
      onError(undefined);
      void onSaveShortcut(shortcut).catch((error) => onError((error as Error).message)).finally(() => setSaving(false));
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [capturing, onError, onSaveShortcut]);

  return <section className="desktop-settings-section">
    <h3>后台与启动</h3>
    <div className="reader-menu-shortcut-row settings-interface-shortcut">
      <span>显示/隐藏窗口</span>
      <button
        type="button"
        className="shortcut-binding"
        data-spatial-item
        data-spatial-zone="settings"
        data-spatial-row="25"
        disabled={saving}
        aria-label="设置显示或隐藏窗口全局快捷键"
        onClick={() => { onError(undefined); setCapturing(true); }}
      >{capturing ? "按键…" : settings.toggleWindowShortcut ?? ""}</button>
    </div>
    <button
      className="settings-toggle"
      type="button"
      data-spatial-item
      data-spatial-zone="settings"
      data-spatial-row="26"
      aria-pressed={settings.autostart}
      disabled={saving}
      onClick={() => {
        setSaving(true);
        onError(undefined);
        void onSaveAutostart(!settings.autostart).catch((error) => onError((error as Error).message)).finally(() => setSaving(false));
      }}
    ><span>开机静默启动</span><b>{settings.autostart ? "开" : "关"}</b></button>
    <p className="settings-hint">启动后驻留系统托盘；关闭窗口只会隐藏，需从托盘退出。</p>
  </section>;
}

