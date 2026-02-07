import { useState } from "react";
import { Input } from "./Input";
import { Checkbox } from "./Checkbox";
import { FilterModeField } from "./FilterModeField";

export function EmailConfigForm({
  id,
  config,
  onSave,
}: {
  id: string;
  config: Record<string, unknown>;
  onSave: (c: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const imap = (config.imap ?? {}) as Record<string, unknown>;
  const smtp = (config.smtp ?? {}) as Record<string, unknown>;
  const [host, setHost] = useState(String(imap.host ?? ""));
  const [port, setPort] = useState(String(imap.port ?? "993"));
  const [user, setUser] = useState(String(imap.user ?? ""));
  const [password, setPassword] = useState(String(imap.password ?? ""));
  const [tls, setTls] = useState(imap.tls !== false);
  const [smtpHost, setSmtpHost] = useState(String(smtp.host ?? ""));
  const [smtpPort, setSmtpPort] = useState(String(smtp.port ?? "465"));
  const [smtpTls, setSmtpTls] = useState(smtp.tls !== false);
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(
    String(
      Math.max(1, Math.round((Number(config.pollIntervalMs) || 60000) / 60000)),
    ),
  );
  const [folders, setFolders] = useState(
    Array.isArray(config.folders) ? config.folders.join(", ") : "INBOX",
  );
  const [identityAddresses, setIdentityAddresses] = useState(
    Array.isArray(config.identityAddresses)
      ? config.identityAddresses.join(", ")
      : "",
  );
  const [filterMode, setFilterMode] = useState(
    String(config.filterMode ?? "all"),
  );
  const [filterList, setFilterList] = useState(
    Array.isArray(config.filterList) ? config.filterList.join(", ") : "",
  );

  return (
    <form
      id={id}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...config,
          enabled: config.enabled ?? false,
          imap: { host, port: parseInt(port, 10) || 993, user, password, tls },
          smtp: smtpHost.trim()
            ? {
                host: smtpHost.trim(),
                port: parseInt(smtpPort, 10) || 465,
                tls: smtpTls,
              }
            : undefined,
          pollIntervalMs:
            Math.max(1, parseInt(pollIntervalMinutes, 10) || 1) * 60 * 1000,
          folders: folders
            ? folders
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          identityAddresses: identityAddresses
            ? identityAddresses
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          filterMode: filterMode || "all",
          filterList: filterList
            ? filterList
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        });
      }}
    >
      <Input
        label="IMAP host"
        value={host}
        onChange={(e) => setHost(e.target.value)}
      />
      <Input
        label="IMAP port"
        type="number"
        value={port}
        onChange={(e) => setPort(e.target.value)}
      />
      <Input
        label="IMAP user"
        value={user}
        onChange={(e) => setUser(e.target.value)}
      />
      <Input
        label="IMAP password"
        type="password"
        placeholder="Leave blank to keep current"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Checkbox
        id="email-tls"
        checked={tls}
        onChange={setTls}
        label="Use TLS"
      />
      <p className="text-sm font-medium text-hooman-fg mt-4">
        SMTP (for sending / reply; uses same username &amp; password as IMAP)
      </p>
      <Input
        label="SMTP host"
        placeholder="smtp.gmail.com"
        value={smtpHost}
        onChange={(e) => setSmtpHost(e.target.value)}
      />
      <Input
        label="SMTP port"
        type="number"
        value={smtpPort}
        onChange={(e) => setSmtpPort(e.target.value)}
      />
      <Checkbox
        id="email-smtp-tls"
        checked={smtpTls}
        onChange={setSmtpTls}
        label="SMTP TLS"
      />
      <Input
        label="Poll interval (minutes)"
        type="number"
        min={1}
        value={pollIntervalMinutes}
        onChange={(e) => setPollIntervalMinutes(e.target.value)}
      />
      <Input
        label="Folders (comma-separated)"
        placeholder="INBOX"
        value={folders}
        onChange={(e) => setFolders(e.target.value)}
      />
      <Input
        label="Identity addresses (To/CC/BCC, comma-separated)"
        placeholder="me@example.com"
        value={identityAddresses}
        onChange={(e) => setIdentityAddresses(e.target.value)}
      />
      <p className="text-xs text-hooman-muted -mt-2">
        Leave empty to use the IMAP inbox user as your identity for directness.
      </p>
      <FilterModeField
        filterMode={filterMode}
        setFilterMode={setFilterMode}
        filterList={filterList}
        setFilterList={setFilterList}
        filterListLabel="Filter list (addresses/domains, comma-separated)"
      />
    </form>
  );
}
