"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { Database, Plus, Trash2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface TableInfo {
  name: string;
  columns: { name: string; type: string; pk: boolean }[];
  rowCount: number;
}

interface TablesResponse {
  hasDatabase: boolean;
  tables: TableInfo[];
  totalRows?: number;
}

interface RowsResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
}

export function SkillDatabasePage({ skillId, skillName }: { skillId: string; skillName: string }) {
  const queryClient = useQueryClient();
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowid: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const [dropTableOpen, setDropTableOpen] = useState(false);
  const limit = 50;

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch tables
  const { data: tablesData, isLoading: tablesLoading } = useQuery<TablesResponse>({
    queryKey: ["skill-db-tables", skillId],
    queryFn: async () => {
      const res = await fetch(`/api/skills/${skillId}/db/tables`);
      if (!res.ok) throw new Error("Failed to load tables");
      return res.json();
    },
    refetchOnWindowFocus: false,
  });

  // Auto-select first table
  useEffect(() => {
    if (tablesData?.tables?.length && !selectedTable) {
      setSelectedTable(tablesData.tables[0].name);
    }
  }, [tablesData, selectedTable]);

  // Fetch rows
  const { data: rowsData, isLoading: rowsLoading } = useQuery<RowsResponse>({
    queryKey: ["skill-db-rows", skillId, selectedTable, page, limit, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      const res = await fetch(`/api/skills/${skillId}/db/tables/${selectedTable}/rows?${params}`);
      if (!res.ok) throw new Error("Failed to load rows");
      return res.json();
    },
    enabled: !!selectedTable,
    refetchOnWindowFocus: false,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["skill-db-tables", skillId] });
    queryClient.invalidateQueries({ queryKey: ["skill-db-rows", skillId, selectedTable] });
    setSelectedRows(new Set());
  }, [queryClient, skillId, selectedTable]);

  // ── Inline edit ──
  const startEdit = useCallback((rowid: number, col: string, value: unknown) => {
    setEditingCell({ rowid, col });
    setEditValue(value === null || value === undefined ? "" : String(value));
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingCell) return;
    const { rowid, col } = editingCell;
    try {
      const res = await fetch(`/api/skills/${skillId}/db/tables/${selectedTable}/rows/${rowid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [col]: editValue }),
      });
      if (!res.ok) throw new Error("Update failed");
      invalidate();
    } catch {
      toast.error("Failed to update cell");
    }
    setEditingCell(null);
  }, [editingCell, editValue, skillId, selectedTable, invalidate]);

  const cancelEdit = useCallback(() => setEditingCell(null), []);

  // Focus input when editing
  useEffect(() => {
    if (editingCell && editRef.current) editRef.current.focus();
  }, [editingCell]);

  // ── Add row ──
  const handleAddRow = useCallback(async () => {
    if (!selectedTable || !tablesData?.tables) return;
    const table = tablesData.tables.find((t) => t.name === selectedTable);
    if (!table) return;

    const defaults: Record<string, unknown> = {};
    for (const col of table.columns) {
      // Skip integer PKs — SQLite auto-assigns them
      if (col.pk && /^integer$/i.test(col.type)) continue;
      defaults[col.name] = "";
    }

    try {
      const res = await fetch(`/api/skills/${skillId}/db/tables/${selectedTable}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(defaults),
      });
      if (!res.ok) throw new Error("Insert failed");
      invalidate();
      toast.success("Row added");
    } catch {
      toast.error("Failed to add row");
    }
  }, [selectedTable, tablesData, skillId, invalidate]);

  // ── Delete selected ──
  const handleDeleteSelected = useCallback(async () => {
    if (selectedRows.size === 0) return;
    try {
      const res = await fetch(`/api/skills/${skillId}/db/tables/${selectedTable}/rows`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowids: Array.from(selectedRows) }),
      });
      if (!res.ok) throw new Error("Delete failed");
      invalidate();
      toast.success(`${selectedRows.size} row(s) deleted`);
    } catch {
      toast.error("Failed to delete rows");
    }
  }, [selectedRows, skillId, selectedTable, invalidate]);

  // ── Drop table ──
  const handleDropTable = useCallback(async () => {
    if (!selectedTable) return;
    try {
      const res = await fetch(`/api/skills/${skillId}/db/tables`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: selectedTable }),
      });
      if (!res.ok) throw new Error("Drop failed");
      setSelectedTable("");
      invalidate();
      toast.success(`Table "${selectedTable}" dropped`);
    } catch {
      toast.error("Failed to drop table");
    }
    setDropTableOpen(false);
  }, [selectedTable, skillId, invalidate]);

  const hasDb = tablesData?.hasDatabase;
  const tables = tablesData?.tables ?? [];
  const rows = rowsData?.rows ?? [];
  const total = rowsData?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const TIMESTAMP_RE = /^(created_at|updated_at|timestamp)$/i;
  const rawColumns = tables.find((t) => t.name === selectedTable)?.columns ?? [];
  const columns = [...rawColumns].sort((a, b) => {
    const aTs = TIMESTAMP_RE.test(a.name);
    const bTs = TIMESTAMP_RE.test(b.name);
    if (aTs === bTs) return 0;
    return aTs ? 1 : -1;
  });
  const allSelected = rows.length > 0 && rows.every((r) => selectedRows.has(r.rowid as number));

  return (
    <div className="flex flex-col h-full">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/skills">Skills</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={`/skills/${skillId}`}>{skillName}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Database</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>

      <div className="flex-1 overflow-auto p-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Database</h1>
            {hasDb && tablesData?.totalRows !== undefined && (
              <Badge variant="secondary" className="text-xs">
                {tablesData.totalRows} rows
              </Badge>
            )}
          </div>

          {tablesLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : !hasDb ? (
            <div className="rounded-md border border-dashed border-border p-12 text-center">
              <Database className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No database yet. The agent will create one automatically when the skill needs persistent storage.
              </p>
            </div>
          ) : tables.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-12 text-center">
              <p className="text-sm text-muted-foreground">
                Database exists but has no tables.
              </p>
            </div>
          ) : (
            <>
              {/* Controls */}
              <div className="flex items-center gap-2">
                <Select value={selectedTable} onValueChange={(v) => { setSelectedTable(v); setPage(1); setSelectedRows(new Set()); }}>
                  <SelectTrigger className="h-8 w-[200px] text-sm">
                    <SelectValue placeholder="Select table" />
                  </SelectTrigger>
                  <SelectContent>
                    {tables.map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        {t.name} ({t.rowCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setDropTableOpen(true)}
                  title="Delete table"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>

                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 pl-8 text-sm"
                  />
                </div>

                <div className="flex-1" />

                {selectedRows.size > 0 && (
                  <Button variant="ghost" size="sm" className="h-8 px-3 text-xs text-destructive" onClick={handleDeleteSelected}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete {selectedRows.size}
                  </Button>
                )}

                <Button variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={handleAddRow}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add row
                </Button>
              </div>

              {/* Data grid */}
              <div className="rounded-md border border-border overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-10 px-3 py-2">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedRows(new Set(rows.map((r) => r.rowid as number)));
                            } else {
                              setSelectedRows(new Set());
                            }
                          }}
                        />
                      </th>
                      {columns.map((col, i) => {
                        const isLast = i === columns.length - 1;
                        return (
                          <th key={col.name} className={`px-3 py-2 font-medium text-muted-foreground whitespace-nowrap ${isLast ? "text-right w-full" : "text-left"}`}>
                            {col.name}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsLoading ? (
                      <tr key="__loading">
                        <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                          Loading...
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr key="__empty">
                        <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-muted-foreground">
                          No rows found.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, idx) => {
                        const rowid = row.rowid as number;
                        return (
                          <tr key={`${rowid}-${idx}`} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                            <td className="w-10 px-3 py-1.5">
                              <Checkbox
                                checked={selectedRows.has(rowid)}
                                onCheckedChange={(checked) => {
                                  setSelectedRows((prev) => {
                                    const next = new Set(prev);
                                    if (checked) next.add(rowid);
                                    else next.delete(rowid);
                                    return next;
                                  });
                                }}
                              />
                            </td>
                            {columns.map((col, i) => {
                              const isEditing = editingCell?.rowid === rowid && editingCell?.col === col.name;
                              const cellValue = row[col.name];
                              const readOnly = (col.pk && /^integer$/i.test(col.type)) || /^(created_at|updated_at|timestamp)$/i.test(col.name);
                              const isLast = i === columns.length - 1;
                              return (
                                <td
                                  key={col.name}
                                  className={`px-3 py-1.5 ${isEditing ? "min-w-[200px]" : "max-w-[400px] whitespace-nowrap"} ${isLast ? "text-right" : ""} ${readOnly ? "" : "cursor-pointer"}`}
                                  onClick={() => !readOnly && !isEditing && startEdit(rowid, col.name, cellValue)}
                                >
                                  {isEditing ? (
                                    <Input
                                      ref={editRef}
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onBlur={saveEdit}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") saveEdit();
                                        if (e.key === "Escape") cancelEdit();
                                      }}
                                      className="h-6 !text-xs px-2 py-0"
                                    />
                                  ) : (
                                    <span className="truncate block">
                                      {cellValue === null ? (
                                        <span className="text-muted-foreground/40 italic">null</span>
                                      ) : (
                                        String(cellValue)
                                      )}
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{total} rows total</span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span>{page} / {totalPages}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Drop table confirmation */}
      <AlertDialog open={dropTableOpen} onOpenChange={setDropTableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete table</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the table &quot;{selectedTable}&quot; and all its data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDropTable}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
