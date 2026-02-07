import { Select } from "./Select";
import { Input } from "./Input";

export function FilterModeField({
  filterMode,
  setFilterMode,
  filterList,
  setFilterList,
  filterLabel = "Filter mode",
  filterListLabel = "Filter list (comma-separated)",
  filterListPlaceholder = "",
  options,
}: {
  filterMode: string;
  setFilterMode: (v: string) => void;
  filterList: string;
  setFilterList: (v: string) => void;
  filterLabel?: string;
  filterListLabel?: string;
  filterListPlaceholder?: string;
  options?: { value: string; label: string }[];
}) {
  return (
    <>
      <Select
        label={filterLabel}
        value={filterMode}
        onChange={(value) => setFilterMode(value)}
        options={
          options ?? [
            { value: "all", label: "All" },
            { value: "allowlist", label: "Allowlist" },
            { value: "blocklist", label: "Blocklist" },
          ]
        }
      />
      {filterMode !== "all" && (
        <Input
          label={filterListLabel}
          placeholder={filterListPlaceholder}
          value={filterList}
          onChange={(e) => setFilterList(e.target.value)}
        />
      )}
    </>
  );
}
