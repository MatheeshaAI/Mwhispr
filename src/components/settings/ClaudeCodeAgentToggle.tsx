import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Terminal } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { SettingsRow } from "../ui/SettingsSection";
import { Toggle } from "../ui/toggle";

export default function ClaudeCodeAgentToggle() {
  const { t } = useTranslation();
  const useClaudeCode = useSettingsStore((s) => s.chatAgentUseClaudeCode);
  const setUseClaudeCode = useSettingsStore((s) => s.setChatAgentUseClaudeCode);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    window.electronAPI?.acpCheckAvailability?.().then((result) => {
      setAvailable(result?.available ?? false);
    });
  }, []);

  return (
    <div className="space-y-2">
      <SettingsRow
        label={t("agentMode.settings.claudeCode.label")}
        description={t("agentMode.settings.claudeCode.description")}
      >
        <Toggle checked={useClaudeCode} onChange={setUseClaudeCode} />
      </SettingsRow>

      {useClaudeCode && available === false && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <p className="text-xs text-muted-foreground">
            {t("agentMode.settings.claudeCode.unavailable")}
          </p>
        </div>
      )}

      {useClaudeCode && (
        <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-muted/20 p-2.5">
          <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground">
            {t("agentMode.settings.claudeCode.loginHint")}
          </p>
        </div>
      )}
    </div>
  );
}
