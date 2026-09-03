import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Toggle } from "./ui/toggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { SettingsPanel, SettingsPanelRow } from "./ui/SettingsSection";
import { ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import type {
  McpServerConfigInput,
  McpServerDescriptor,
  McpServerTransport,
} from "../types/electron";

function parseArgs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseKeyValueLines(text: string, separator: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(separator);
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + separator.length).trim();
    if (key) out[key] = value;
  }
  return out;
}

const STATUS_VARIANT: Record<McpServerDescriptor["status"], "success" | "destructive" | "outline"> =
  {
    connected: "success",
    error: "destructive",
    connecting: "outline",
    disconnected: "outline",
  };

function emptyForm(): {
  name: string;
  transport: McpServerTransport;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
} {
  return {
    name: "",
    transport: "stdio",
    command: "",
    argsText: "",
    envText: "",
    url: "",
    headersText: "",
  };
}

export default function McpServersCard() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<McpServerDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<McpServerDescriptor | null>(null);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await window.electronAPI?.mcpListServers?.();
    setServers(list || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAdd = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const config: McpServerConfigInput =
      form.transport === "stdio"
        ? {
            name: form.name.trim(),
            transport: "stdio",
            command: form.command.trim(),
            args: parseArgs(form.argsText),
            env: parseKeyValueLines(form.envText, "="),
          }
        : {
            name: form.name.trim(),
            transport: form.transport,
            url: form.url.trim(),
            headers: parseKeyValueLines(form.headersText, ":"),
          };
    try {
      const result = await window.electronAPI?.mcpAddServer?.(config);
      if (!result?.success) {
        setSaveError(result?.error || t("integrations.mcpServers.addFailed"));
        return;
      }
      setAddOpen(false);
      setForm(emptyForm());
      await refresh();
    } finally {
      setSaving(false);
    }
  }, [form, refresh, t]);

  const handleToggle = useCallback(
    async (server: McpServerDescriptor, enabled: boolean) => {
      await window.electronAPI?.mcpUpdateServer?.(server.id, { enabled });
      await refresh();
    },
    [refresh]
  );

  const handleReconnect = useCallback(
    async (server: McpServerDescriptor) => {
      setReconnectingId(server.id);
      try {
        await window.electronAPI?.mcpReconnectServer?.(server.id);
        await refresh();
      } finally {
        setReconnectingId(null);
      }
    },
    [refresh]
  );

  const handleRemove = useCallback(async () => {
    if (!removeTarget) return;
    await window.electronAPI?.mcpRemoveServer?.(removeTarget.id);
    setRemoveTarget(null);
    await refresh();
  }, [removeTarget, refresh]);

  const canSave =
    form.name.trim().length > 0 &&
    (form.transport === "stdio" ? form.command.trim().length > 0 : form.url.trim().length > 0);

  return (
    <div>
      <SettingsPanel>
        {loading ? (
          <SettingsPanelRow>
            <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("common.loading")}
            </div>
          </SettingsPanelRow>
        ) : servers.length === 0 ? (
          <SettingsPanelRow>
            <p className="text-xs text-muted-foreground/70">{t("integrations.mcpServers.empty")}</p>
          </SettingsPanelRow>
        ) : (
          servers.map((server) => (
            <SettingsPanelRow key={server.id}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/5 dark:bg-primary/10 flex items-center justify-center shrink-0">
                  <Plug className="h-4 w-4 text-primary/80" strokeWidth={2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-foreground truncate">
                      {server.name || server.id}
                    </p>
                    <Badge variant={STATUS_VARIANT[server.status]} className="shrink-0">
                      {t(`integrations.mcpServers.status.${server.status}`)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                    {server.status === "error" && server.error
                      ? server.error
                      : t("integrations.mcpServers.toolCount", { count: server.tools.length })}
                  </p>
                </div>
                <button
                  onClick={() => handleReconnect(server)}
                  disabled={reconnectingId === server.id}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/8 transition-colors disabled:opacity-50 shrink-0"
                  aria-label={t("integrations.mcpServers.reconnect")}
                >
                  {reconnectingId === server.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </button>
                <Toggle
                  checked={server.enabled}
                  onChange={(enabled) => handleToggle(server, enabled)}
                />
                <button
                  onClick={() => setRemoveTarget(server)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                  aria-label={t("integrations.mcpServers.remove")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </SettingsPanelRow>
          ))
        )}

        <SettingsPanelRow>
          <button
            onClick={() => {
              setForm(emptyForm());
              setSaveError(null);
              setAddOpen(true);
            }}
            className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("integrations.mcpServers.addServer")}
          </button>
        </SettingsPanelRow>
      </SettingsPanel>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("integrations.mcpServers.addServer")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground/80 mb-1 block">
                {t("integrations.mcpServers.form.name")}
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("integrations.mcpServers.form.namePlaceholder")}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-foreground/80 mb-1 block">
                {t("integrations.mcpServers.form.transport")}
              </label>
              <Select
                value={form.transport}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, transport: v as McpServerTransport }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">{t("integrations.mcpServers.form.stdio")}</SelectItem>
                  <SelectItem value="http">{t("integrations.mcpServers.form.http")}</SelectItem>
                  <SelectItem value="sse">{t("integrations.mcpServers.form.sse")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.transport === "stdio" ? (
              <>
                <div>
                  <label className="text-xs font-medium text-foreground/80 mb-1 block">
                    {t("integrations.mcpServers.form.command")}
                  </label>
                  <Input
                    value={form.command}
                    onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                    placeholder="npx"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground/80 mb-1 block">
                    {t("integrations.mcpServers.form.args")}
                  </label>
                  <Textarea
                    value={form.argsText}
                    onChange={(e) => setForm((f) => ({ ...f, argsText: e.target.value }))}
                    placeholder={"-y\n@my-org/mcp-server"}
                    rows={2}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground/80 mb-1 block">
                    {t("integrations.mcpServers.form.env")}
                  </label>
                  <Textarea
                    value={form.envText}
                    onChange={(e) => setForm((f) => ({ ...f, envText: e.target.value }))}
                    placeholder={"API_KEY=..."}
                    rows={2}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="text-xs font-medium text-foreground/80 mb-1 block">
                    {t("integrations.mcpServers.form.url")}
                  </label>
                  <Input
                    value={form.url}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                    placeholder="https://example.com/mcp"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-foreground/80 mb-1 block">
                    {t("integrations.mcpServers.form.headers")}
                  </label>
                  <Textarea
                    value={form.headersText}
                    onChange={(e) => setForm((f) => ({ ...f, headersText: e.target.value }))}
                    placeholder={"Authorization: Bearer ..."}
                    rows={2}
                  />
                </div>
              </>
            )}

            {saveError && <p className="text-xs text-destructive">{saveError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={handleAdd} disabled={!canSave || saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("common.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={t("integrations.mcpServers.removeConfirm", { name: removeTarget?.name || "" })}
        description={t("integrations.mcpServers.removeDescription")}
        confirmText={t("integrations.mcpServers.remove")}
        variant="destructive"
        onConfirm={handleRemove}
      />
    </div>
  );
}
