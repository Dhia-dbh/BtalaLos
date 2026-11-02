"use client";
import { STATUSES } from "@/lib/status";
import { useState } from "react";
import { SEARCH_FIELDS, dateField, type FieldFilter, type SearchField } from "@/lib/application-search";
export function SearchFilters({ filters, onChange }: { filters: FieldFilter[]; onChange: (filters: FieldFilter[]) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<FieldFilter>({ field: "company", value: "" });
  return <div className="flex flex-wrap items-center gap-2 px-10 pb-3">
    {filters.map((filter, index) => <span key={index} className="flex rounded-control border border-line bg-card text-sm">
      <button className="px-2 py-1" onClick={() => { setDraft(filter); setEditing(index); }}>{SEARCH_FIELDS[filter.field]}: {filter.value}{filter.to ? ` – ${filter.to}` : ""}</button>
      <button className="px-2" aria-label={`Remove ${SEARCH_FIELDS[filter.field]} filter`} onClick={() => onChange(filters.filter((_, i) => i !== index))}>×</button>
    </span>)}
    <button className="rounded-control border border-line px-3 py-1 text-sm" onClick={() => { setDraft({ field: "company", value: "" }); setEditing(filters.length); }}>Add filter</button>
    {filters.length > 0 && <button className="text-sm underline" onClick={() => { onChange([]); setEditing(null); }}>Clear filters</button>}
    {editing !== null && <form aria-label="Edit search filter" className="flex w-full flex-wrap items-end gap-2 rounded-control border border-line bg-card p-3" onSubmit={(event) => { event.preventDefault(); const next = [...filters]; next[editing] = draft; onChange(next); setEditing(null); }}>
      <label className="text-sm">Field<select className="ml-2 rounded border border-line bg-input p-2" value={draft.field} onChange={(event) => setDraft({ field: event.target.value as SearchField, value: "" })}>{Object.entries(SEARCH_FIELDS).map(([field, label]) => <option key={field} value={field}>{label}</option>)}</select></label>
      <label className="text-sm">{dateField(draft.field) ? "From" : "Value"}{draft.field === "status" ? <select className="ml-2 rounded border border-line bg-input p-2" value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })}><option value="">Any status</option>{STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select> : <input className="ml-2 rounded border border-line bg-input p-2" type={dateField(draft.field) ? "date" : "text"} value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} />}</label>
      {dateField(draft.field) && <label className="text-sm">To<input className="ml-2 rounded border border-line bg-input p-2" type="date" min={draft.value} value={draft.to ?? ""} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>}
      <button className="p-2 text-sm underline" type="submit">Apply filter</button><button className="p-2 text-sm" type="button" onClick={() => setEditing(null)}>Cancel</button>
    </form>}
  </div>;
}
