import React, { useState, useRef, useMemo } from "react";

// MinimalDashboard.jsx
// Minimal replica: Upload XLSX/CSV -> sheet selector -> KPI tiles -> table preview.
// Uses SheetJS (xlsx) client-side. Make sure package.json includes "xlsx".

export default function MinimalDashboard() {
  const [filename, setFilename] = useState("");
  const [sheets, setSheets] = useState([]); // {name, data}
  const [selectedSheet, setSelectedSheet] = useState(null);
  const [error, setError] = useState("");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const fileRef = useRef(null);

  // Automatic metric column mapping (best-effort)
  const [mapping, setMapping] = useState({
    date: "",
    spend: "",
    sales: "",
    clicks: "",
    impressions: "",
    ctr: "",
    acos: "",
    roas: "",
    avgCpc: "",
  });

  // Helper: normalize header text (lowercase, remove non-alphanum)
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const handleFile = async (file) => {
    setError("");
    setSheets([]);
    setSelectedSheet(null);
    setFilename("");
    setMapping({
      date: "",
      spend: "",
      sales: "",
      clicks: "",
      impressions: "",
      ctr: "",
      acos: "",
      roas: "",
      avgCpc: "",
    });

    if (!file) return;
    setFilename(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "array" });
      const parsed = workbook.SheetNames.map((name) => {
        const ws = workbook.Sheets[name];
        const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
        return { name, data: json };
      });
      if (parsed.length === 0) throw new Error("No sheets found");
      setSheets(parsed);
      setSelectedSheet(0);

      // auto-detect mapping from first sheet headers
      const firstHeaders = parsed[0].data && parsed[0].data[0] ? Object.keys(parsed[0].data[0]) : [];
      const newMap = { ...mapping };
      const headerNorms = firstHeaders.map((h) => ({ raw: h, n: norm(h) }));

      headerNorms.forEach(({ raw, n }) => {
        if (!newMap.date && (n.includes("date") || n === "day")) newMap.date = raw;
        if (!newMap.spend && (n.includes("spend") || n.includes("cost") || n.includes("adcost"))) newMap.spend = raw;
        if (!newMap.sales && (n.includes("sales") || n.includes("revenue") || n.includes("net"))) newMap.sales = raw;
        if (!newMap.clicks && (n.includes("clicks") || n.includes("click"))) newMap.clicks = raw;
        if (!newMap.impressions && (n.includes("impr") || n.includes("impressions") || n.includes("views"))) newMap.impressions = raw;
        if (!newMap.ctr && (n === "ctr" || n.includes("ctr") || n.includes("clickthrough"))) newMap.ctr = raw;
        if (!newMap.roas && (n.includes("roas") || n.includes("returnonad"))) newMap.roas = raw;
        if (!newMap.avgCpc && (n.includes("avgcpc") || n.includes("cpc"))) newMap.avgCpc = raw;
        if (!newMap.acos && (n.includes("acos") || n.includes("acost"))) newMap.acos = raw;
      });

      setMapping(newMap);
    } catch (e) {
      console.error(e);
      setError("Failed to read file. Ensure it's a valid .xlsx/.xls/.csv");
    }
  };

  const onFileChange = (e) => handleFile(e.target.files && e.target.files[0]);

  // utilities to safely parse numbers and percents
  const toNumber = (v) => {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return v;
    const s = String(v).replace(/[, \u00A0]/g, "");
    if (s.endsWith("%")) return parseFloat(s.replace("%", "")) / 100;
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const parseDate = (v) => {
    if (!v && v !== 0) return null;
    if (typeof v === "number") {
      const date = new Date(Date.UTC(1899, 11, 30));
      date.setDate(date.getDate() + v);
      return date;
    }
    const d = new Date(v);
    if (!isNaN(d)) return d;
    const parts = String(v).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (parts) return new Date(parts[1], parts[2] - 1, parts[3]);
    return null;
  };

  // derived: current sheet data, filtered by date range if applicable
  const sheet = selectedSheet !== null && sheets[selectedSheet] ? sheets[selectedSheet] : null;

  const filteredData = useMemo(() => {
    if (!sheet) return [];
    const rows = sheet.data || [];
    const from = dateRange.from ? new Date(dateRange.from) : null;
    const to = dateRange.to ? new Date(dateRange.to) : null;
    if (!mapping.date || (!from && !to)) return rows;
    return rows.filter((r) => {
      const d = parseDate(r[mapping.date]);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }, [sheet, dateRange, mapping]);

  // aggregated KPIs
  const kpis = useMemo(() => {
    if (!sheet) return {};
    const rows = filteredData.length > 0 ? filteredData : sheet.data || [];
    let spend = 0,
      sales = 0,
      clicks = 0,
      impressions = 0;

    rows.forEach((r) => {
      spend += toNumber(r[mapping.spend]);
      sales += toNumber(r[mapping.sales]);
      clicks += toNumber(r[mapping.clicks]);
      impressions += toNumber(r[mapping.impressions]);
    });

    const ctr = impressions ? clicks / impressions : 0;
    const roas = spend ? sales / spend : 0;
    const avgCpc = clicks ? spend / clicks : 0;
    const acos = sales ? spend / sales : 0;

    return { spend, sales, clicks, impressions, ctr, roas, avgCpc, acos, rowsCount: rows.length };
  }, [sheet, filteredData, mapping]);

  const downloadCSV = () => {
    const rows = filteredData.length > 0 ? filteredData : sheet ? sheet.data : [];
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const escape = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const csv = [headers.map(escape).join(",")].concat(rows.map((r) => headers.map((h) => escape(r[h])).join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (filename || "data") + "-export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto bg-white rounded-2xl shadow p-6">
        <header className="flex items-center gap-4 mb-6">
          <h1 className="text-xl font-semibold">Minimal Excel Dashboard</h1>

          <div className="ml-auto flex items-center gap-3">
            <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded">
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFileChange} className="hidden" />
              Open XLSX
            </label>

            <button
              onClick={() => {
                setSheets([]);
                setSelectedSheet(null);
                setFilename("");
                if (fileRef.current) fileRef.current.value = null;
              }}
              className="px-3 py-2 border rounded"
            >
              Clear
            </button>
          </div>
        </header>

        {error && <div className="mb-4 p-3 rounded bg-red-50 text-red-700">{error}</div>}

        {!sheet && <div className="text-center text-gray-500 py-20">Upload an Excel/CSV file to get started. The app parses client-side — no file leaves your browser.</div>}

        {sheet && (
          <>
            <div className="flex gap-4 mb-4 items-center">
              <div>
                <label className="block text-sm text-gray-600">Sheet</label>
                <select value={selectedSheet} onChange={(e) => setSelectedSheet(Number(e.target.value))} className="mt-1 px-3 py-2 border rounded">
                  {sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name} ({s.data.length} rows)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-600">Date From</label>
                <input type="date" value={dateRange.from} onChange={(e) => setDateRange((d) => ({ ...d, from: e.target.value }))} className="mt-1 px-3 py-2 border rounded" />
              </div>

              <div>
                <label className="block text-sm text-gray-600">Date To</label>
                <input type="date" value={dateRange.to} onChange={(e) => setDateRange((d) => ({ ...d, to: e.target.value }))} className="mt-1 px-3 py-2 border rounded" />
              </div>

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => {
                    setDateRange({ from: "", to: "" });
                  }}
                  className="px-3 py-2 border rounded"
                >
                  Reset Dates
                </button>
                <button onClick={downloadCSV} className="px-3 py-2 bg-green-600 text-white rounded">
                  Download CSV
                </button>
              </div>
            </div>

            {/* Mapping UI */}
            <div className="mb-4 p-4 border rounded bg-gray-50">
              <div className="text-sm text-gray-700 mb-2">Detected columns — adjust if wrong (this helps KPI calculations)</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "date", label: "Date" },
                  { key: "spend", label: "Spend / Cost" },
                  { key: "sales", label: "Sales / Revenue" },
                  { key: "clicks", label: "Clicks" },
                  { key: "impressions", label: "Impressions" },
                  { key: "ctr", label: "CTR (percent)" },
                  { key: "roas", label: "ROAS" },
                  { key: "avgCpc", label: "Avg CPC" },
                  { key: "acos", label: "ACoS" },
                ].map((m) => (
                  <div key={m.key}>
                    <label className="block text-xs text-gray-600">{m.label}</label>
                    <select value={mapping[m.key]} onChange={(e) => setMapping((mp) => ({ ...mp, [m.key]: e.target.value }))} className="mt-1 px-2 py-2 border rounded w-full">
                      <option value="">-- none --</option>
                      {sheet && sheet.data && sheet.data[0] && Object.keys(sheet.data[0]).map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* KPI tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <Kpi title="Spend" value={kpis.spend} prefix="₹" precision={2} />
              <Kpi title="Sales" value={kpis.sales} prefix="₹" precision={2} />
              <Kpi title="Clicks" value={kpis.clicks} precision={0} />
              <Kpi title="Impressions" value={kpis.impressions} precision={0} />

              <Kpi title="CTR" value={kpis.ctr} suffix="%" scale={100} precision={2} />
              <Kpi title="ROAS" value={kpis.roas} precision={2} />
              <Kpi title="Avg CPC" value={kpis.avgCpc} prefix="₹" precision={2} />
              <Kpi title="ACoS" value={kpis.acos} suffix="%" scale={100} precision={2} />
            </div>

            <div className="mb-4 text-sm text-gray-600">Showing <strong>{kpis.rowsCount}</strong> rows{dateRange.from || dateRange.to ? " (filtered by date)" : ""}.</div>

            {/* table preview */}
            <div className="overflow-x-auto border rounded">
              <table className="min-w-full divide-y">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    {sheet.data && sheet.data[0] && Object.keys(sheet.data[0]).map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-700">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(filteredData.length > 0 ? filteredData : sheet.data).slice(0, 200).map((row, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      {Object.keys(row).map((k) => (
                        <td key={k} className="px-3 py-2 text-sm text-gray-800">{String(row[k] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-2 text-xs text-gray-400">Preview limited to first 200 rows for performance.</div>
          </>
        )}

        <footer className="mt-6 text-sm text-gray-500">Tip: this app runs entirely in your browser. If you want to save uploads to a server or add charts, tell me and I'll extend it.</footer>
      </div>
    </div>
  );
}

function Kpi({ title, value, prefix = "", suffix = "", scale = 1, precision = 2 }) {
  const display = typeof value === "number" ? (value * scale).toFixed(precision) : "-";
  return (
    <div className="p-4 bg-white rounded shadow-sm border">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-lg font-semibold">{prefix}{display}{suffix}</div>
    </div>
  );
}
