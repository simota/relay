"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TrackReposDialogProps {
  open: boolean;
  onClose: () => void;
}

export function TrackReposDialog({ open, onClose }: TrackReposDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { mutate } = useSWRConfig();

  // `rows` is the editable list; each row carries the user-supplied path
  // plus a (refreshed-on-save) status flag for "does it exist on disk".
  const [rows, setRows] = useState<Array<{ path: string; exists?: boolean; isDir?: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load current allowlist when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    api
      .getTrackedRepos()
      .then(({ trackedRepos }) => {
        setRows(
          trackedRepos.length > 0
            ? trackedRepos.map((r) => ({ path: r.path, exists: r.exists, isDir: r.isDir }))
            : [{ path: "" }],
        );
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed to load tracked repos");
      })
      .finally(() => setLoading(false));
  }, [open]);

  // Drive the underlying <dialog open> attribute from the `open` prop.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  // Esc => onClose via the cancel event (so React state stays the source of truth)
  const handleCancel = useCallback(
    (e: Event) => {
      e.preventDefault();
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    el.addEventListener("cancel", handleCancel);
    return () => el.removeEventListener("cancel", handleCancel);
  }, [handleCancel]);

  const updateRow = (idx: number, path: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { path } : r)));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length <= 1 ? [{ path: "" }] : prev.filter((_, i) => i !== idx)));
  };

  const addRow = () => {
    setRows((prev) => [...prev, { path: "" }]);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const paths = rows.map((r) => r.path.trim()).filter((p) => p.length > 0);
      const { trackedRepos } = await api.setTrackedRepos(paths);
      // Reflect normalized / deduped paths back into the UI before closing.
      setRows(
        trackedRepos.length > 0
          ? trackedRepos.map((r) => ({ path: r.path, exists: r.exists, isDir: r.isDir }))
          : [{ path: "" }],
      );
      // Refresh both the cards (/api/repos) and the sidebar counts
      // (/api/counts) — without the second mutate the Repos badge would
      // stay stale until SWR's 30s auto-refresh.
      await Promise.all([mutate("/api/repos"), mutate("/api/counts")]);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      // `flex` is opt-in via `open:` so the closed dialog falls back to the
      // user-agent `display: none` rule for `dialog:not([open])` instead of
      // staying visible at mount time.
      className="hidden fixed inset-0 m-auto w-full max-w-[640px] max-h-[80vh] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-0 shadow-xl backdrop:bg-black/40 open:flex open:flex-col"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
        <h2 className="text-[14px] font-semibold">Track repositories</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] text-[18px] leading-none"
        >
          ×
        </button>
      </div>

      <div className="px-5 py-3 border-b border-[var(--color-border)] shrink-0 text-[11.5px] text-[var(--color-fg-muted)] leading-relaxed">
        Each row is an absolute path to a local repository directory (e.g.{" "}
        <code className="font-mono text-[11px] text-[var(--color-fg)]">
          ~/repos/github.com/relay
        </code>
        ). Only repos in this list will have their tasks ingested by sync. Leave the list empty to
        track every repo under <code className="font-mono text-[11px]">scan.roots</code>.
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {loading && (
          <div className="py-8 text-center text-[13px] text-[var(--color-fg-muted)]">
            Loading…
          </div>
        )}

        {!loading && (
          <ul className="space-y-2">
            {rows.map((row, idx) => {
              const trimmed = row.path.trim();
              // Existence info is only meaningful for rows that survived a
              // save (or initial load) — fresh in-memory rows have undefined.
              const stale = trimmed.length > 0 && row.exists === false;
              const notDir =
                trimmed.length > 0 && row.exists === true && row.isDir === false;
              return (
                <li key={idx} className="flex items-center gap-2">
                  <Input
                    value={row.path}
                    onChange={(e) => updateRow(idx, e.target.value)}
                    placeholder="/Users/you/repos/github.com/relay  or  ~/projects/foo"
                    className="flex-1 font-mono text-[12px]"
                    spellCheck={false}
                  />
                  {(stale || notDir) && (
                    <span
                      className="text-[10.5px] font-mono text-[var(--color-warm,var(--color-fg-muted))] shrink-0"
                      title={stale ? "Directory does not exist" : "Path is not a directory"}
                    >
                      {stale ? "missing" : "not a dir"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    aria-label="Remove this entry"
                    className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-elev)]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && (
          <button
            type="button"
            onClick={addRow}
            className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-mono text-[var(--color-cool)] hover:text-[var(--color-fg)]"
          >
            <Plus className="w-3 h-3" />
            Add path
          </button>
        )}
      </div>

      <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--color-border)] shrink-0 gap-3">
        <span className="text-[11px] text-[var(--color-fg-muted)] truncate">
          {error ? (
            <span className={cn("text-[var(--color-critical,var(--color-warm))]", "truncate")}>
              {error}
            </span>
          ) : (
            "Empty list = sync all repos under scan.roots"
          )}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
