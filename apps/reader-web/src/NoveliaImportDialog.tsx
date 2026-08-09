import { useCallback, useEffect, useRef, useState } from "react";
import { openExternalUrl } from "./external-links.js";
import { useSpatialNavigation } from "./spatial-navigation.js";

const SITE_URL = "https://n.novelia.cc/";
const EXAMPLE_URL = "n.novelia.cc/novel/syosetu/n5562he";

interface NoveliaImportDialogProps {
  onDownload(url: string): Promise<File>;
  onDownloaded(file: File): void;
  onClose(): void;
}

export function NoveliaImportDialog({ onDownload, onDownloaded, onClose }: NoveliaImportDialogProps) {
  const [url, setUrl] = useState(EXAMPLE_URL);
  const [editing, setEditing] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputEntryRef = useRef<HTMLDivElement>(null);

  const beginEditing = useCallback(() => {
    if (downloading) return;
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [downloading]);

  useEffect(() => {
    const frame = requestAnimationFrame(beginEditing);
    return () => cancelAnimationFrame(frame);
  }, [beginEditing]);

  const submit = useCallback(async () => {
    if (downloading) return;
    setDownloading(true);
    setError(undefined);
    try {
      const file = await onDownload(url);
      onDownloaded(file);
    } catch (downloadError) {
      setError((downloadError as Error).message);
      setDownloading(false);
      beginEditing();
    }
  }, [beginEditing, downloading, onDownload, onDownloaded, url]);

  const activateItem = useCallback((element: HTMLElement): boolean => {
    if (element.dataset.spatialAction !== "edit-novelia-url") return false;
    beginEditing();
    return true;
  }, [beginEditing]);

  useSpatialNavigation({
    rootRef,
    enabled: true,
    editing,
    onActivate: activateItem,
    onCancel: () => {
      if (downloading) return false;
      onClose();
      return true;
    },
    keys: "both",
  });

  return <div className="reader-menu-backdrop novelia-import-backdrop" ref={rootRef} onMouseDown={(event) => { if (event.target === event.currentTarget && !downloading) onClose(); }}>
    <div className="novelia-import-dialog" role="dialog" aria-modal="true" aria-label="从轻小说机翻机器人导入">
      <header><h2>从轻小说机翻机器人导入</h2><button type="button" aria-label="关闭" disabled={downloading} data-spatial-item data-spatial-zone="novelia" data-spatial-row="0" onClick={onClose}>×</button></header>
      <button className="novelia-site-link" type="button" data-spatial-item data-spatial-zone="novelia" data-spatial-row="1" onClick={() => void openExternalUrl(SITE_URL).catch((openError) => setError((openError as Error).message))}>n.novelia.cc</button>
      <label htmlFor="novelia-url">小说地址</label>
      <div
        className="novelia-url-entry"
        ref={inputEntryRef}
        tabIndex={0}
        data-spatial-item
        data-spatial-zone="novelia"
        data-spatial-row="2"
        data-spatial-action="edit-novelia-url"
        aria-label="小说地址输入项"
        onClick={beginEditing}
      >
        <input
          id="novelia-url"
          ref={inputRef}
          value={url}
          disabled={downloading}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => setEditing(true)}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setEditing(false);
              event.currentTarget.blur();
              requestAnimationFrame(() => inputEntryRef.current?.focus({ preventScroll: true }));
            }
          }}
          onBlur={() => setEditing(false)}
        />
      </div>
      <p className="novelia-download-summary">中日 · Sakura → GPT 优先 · EPUB · 中文文件名</p>
      {downloading && <p className="novelia-download-status" role="status">正在从轻小说机翻机器人下载……</p>}
      {error && <p className="novelia-download-error" role="alert">{error}</p>}
      <div className="novelia-import-actions">
        <button className="primary-action" type="button" disabled={downloading} data-spatial-item data-spatial-zone="novelia" data-spatial-row="3" onClick={() => void submit()}>导入</button>
        <button className="secondary-action" type="button" disabled={downloading} data-spatial-item data-spatial-zone="novelia" data-spatial-row="3" onClick={onClose}>取消</button>
      </div>
    </div>
  </div>;
}
