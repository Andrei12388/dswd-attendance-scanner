import { useEffect, useState, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import * as XLSX from "xlsx";
import "./App.css";
import { dbCloud } from "./firebase";
import { collection, setDoc, doc, deleteDoc, getDocs, query } from "firebase/firestore";
import { getAllFiles } from "./db";
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

export default function App() {
  const [records, setRecords] = useState([]);
  const [scanner, setScanner] = useState(null);
  const [statusLog, setStatusLog] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [autoSync, setAutoSync] = useState(false);
  const [onlineStatus, setOnlineStatus] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [vibrate, setVibrate] = useState(true);
  const [beep, setBeep] = useState(true);
  const [syncMessage, setSyncMessage] = useState("");
  const lastScanRef = useRef(0);

  const logStatus = (msg) => setStatusLog(prev => [msg, ...prev.slice(0, 9)]);

  // ✅ Check Firebase + navigator.onLine
  const checkFirebaseConnection = async () => {
    if (!selectedFile) return;
    try {
      await getDocs(query(collection(dbCloud, selectedFile), { source: "server" }));
      setOnlineStatus(true);
    } catch {
      setOnlineStatus(navigator.onLine);
    }
  };

  useEffect(() => {
    if (!selectedFile) return;
    checkFirebaseConnection();
    const id = setInterval(checkFirebaseConnection, 4000);
    return () => clearInterval(id);
  }, [selectedFile]);

  /* ================================ LOAD COLLECTIONS ================================= */
  useEffect(() => {
    async function fetchCollections() {
      const list = await getAllFiles();
      setFiles(list);
      if (list.length) setSelectedFile(list[0]);
    }
    fetchCollections();
  }, []);

  useEffect(() => {
    if (selectedFile) loadRecords(selectedFile);
  }, [selectedFile]);

  const loadRecords = async (name) => {
    const snap = await getDocs(collection(dbCloud, name));
    const data = snap.docs.map(d => d.data());
    setRecords(data);
  };

  /* ================================ ADD RECORD ================================= */
  const addRecord = (name, hhid) => {
    if (!name || !hhid) return;
    const now = Date.now();
    if (now - lastScanRef.current < 700) return; // cooldown
    lastScanRef.current = now;

    setRecords(prev => {
      if (prev.some(r => r.hhid === hhid)) {
        logStatus(`⚠️ Duplicate skipped: ${hhid}`);
        return prev;
      }
      const rec = { name, hhid, time: new Date().toLocaleString() };
      if (beep) new Audio("/beep.mp3").play().catch(() => {});
      if (vibrate && navigator.vibrate) navigator.vibrate(120);
      if (autoSync && selectedFile) saveOnlineRecord(rec);
      return [rec, ...prev];
    });
  };

  /* ================================ FIREBASE ================================= */
  const saveOnlineRecord = async (rec) => {
    if (!selectedFile) return;
    setSyncing(true);
    try {
      await setDoc(doc(dbCloud, selectedFile, rec.hhid), rec);
      setOnlineStatus(true);
      logStatus(`✅ Synced: ${rec.hhid}`);
      setSyncMessage(`✅ Synced: ${rec.hhid}`);
    } catch {
      setOnlineStatus(false);
      logStatus(`❌ Failed to sync: ${rec.hhid}`);
      setSyncMessage(`❌ Failed to sync: ${rec.hhid}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(""), 3000);
    }
  };

  const deleteRecord = async (r) => {
    setRecords(prev => prev.filter(x => x.hhid !== r.hhid));
    if (!selectedFile) return;
    await deleteDoc(doc(dbCloud, selectedFile, r.hhid));
  };

  const clearRecords = async () => {
    if (!selectedFile) return;
    const snap = await getDocs(collection(dbCloud, selectedFile));
    for (const d of snap.docs) {
      await deleteDoc(doc(dbCloud, selectedFile, d.id));
    }
    setRecords([]);
  };

  /* ================================ SCANNER ================================= */
  const startScanner = () => {
    if (scanner) return;
    const qr = new Html5Qrcode("reader");
    setScanner(qr);
    qr.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      (text) => {
        const [name, hhid] = text.split(",");
        addRecord(name?.trim(), hhid?.trim());
      }
    );
  };

  const stopScanner = async () => {
    if (!scanner) return;
    await scanner.stop();
    setScanner(null);
  };

  /* ================================ EXPORT ================================= */
  const exportExcel = async () => {
    const data = [["Item", "Name", "HH_ID", "Timestamp"], ...records.map((r, i) => [i + 1, r.name, r.hhid, r.time])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Records");
    const blob = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const handle = await window.showSaveFilePicker({ suggestedName: `${selectedFile}.xlsx` });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  };

  async function exportToCSV() {
 const now = new Date();
const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).replace(/,/g, '');
const filename = `City Link Attendance - ${dateStr}.csv`;


  // Your data, including headers
  const data = [
    ["Item", "Name", "HH_ID", "Timestamp"],
    ...records.map((r, i) => [i + 1, r.name, r.hhid, r.time])
  ];

  // Convert array of arrays to CSV string
  const csvRows = data.map(row =>
    row.map(value => `"${('' + value).replace(/"/g, '""')}"`).join(',')
  );
  const csvString = csvRows.join('\n');

  // Detect platform
  if (Capacitor.getPlatform() === 'web') {
    // Web: Use Blob + link download
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else {
    // Mobile (Capacitor): Save to device and optionally share
    try {
      const savedFile = await Filesystem.writeFile({
        path: filename,
        data: csvString,
        directory: Directory.Documents,
        encoding: Encoding.UTF8,
      });

      console.log('File saved at:', savedFile.uri);

      // Optional: prompt user to share the CSV
      await Share.share({
        title: 'CSV Export',
        text: 'Here is your CSV file',
        url: savedFile.uri,
        dialogTitle: 'Share CSV',
      });
    } catch (err) {
      console.error('Error saving CSV:', err);
    }
  }
}


  const saveOnline = async () => {
    if (!selectedFile) return alert("Select a collection first!");
    if (!records.length) return alert("No records to save!");
    setSyncing(true);
    try {
      for (const r of records) await setDoc(doc(collection(dbCloud, selectedFile), r.hhid), r);
      logStatus(`✅ Saved ${records.length} records to Firebase (${selectedFile})`);
      setOnlineStatus(true);
      setSyncMessage(`✅ Saved ${records.length} records!`);
    } catch (e) {
      logStatus(`❌ Failed to save online: ${e.message}`);
      setOnlineStatus(false);
      setSyncMessage(`❌ Failed to save online!`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(""), 3000);
    }
  };

  /* ================================ UI ================================= */
  return (
    <div className="app">
      <div className="sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0 }}>Database</h3>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              background: onlineStatus ? "#22c55e" : "#ef4444",
              color: "#fff",
            }}
          >
            {onlineStatus ? "🟢 Online" : "🔴 Offline"}
          </span>
         
        </div>
        {files.map(f => (
          <div key={f} onClick={() => setSelectedFile(f)} style={{ cursor: "pointer", padding: 4 }}>
            {f}
          </div>
        ))}
        <hr />
        <label>
          <input type="checkbox" checked={vibrate} onChange={e => setVibrate(e.target.checked)} /> Vibrate
        </label>
        <label>
          <input type="checkbox" checked={beep} onChange={e => setBeep(e.target.checked)} /> Beep
        </label>
      </div>
      <div className="main">
        <div className="titleHead"> 
        <h2>📋 DSWD City Link Attendance Scanner</h2> 
        {syncing && <span className="spinner" style={{ marginLeft: 8 }}></span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={startScanner}>Start</button>
          <button className="btn" onClick={stopScanner}>Stop</button>
          <button className="btn" onClick={clearRecords}>Clear</button>
          <button className="btn" onClick={saveOnline}>Save Online</button>
          <button className="btn" onClick={exportToCSV}>Export CSV</button>
          <button className="btn" onClick={() => window.location.reload()}>Refresh</button>
        </div>

        {syncMessage && (
          <div
            style={{
              padding: "8px 12px",
              margin: "8px 0",
              borderRadius: 6,
              background: syncMessage.startsWith("✅") ? "#22c55e" : "#ef4444",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            {syncMessage}
          </div>
        )}

        <h3>Status Log</h3>
        <div className="status-box">{statusLog.map((s, i) => <div key={i}>{s}</div>)}</div>

        <div id="reader" />

       <div className="records-table-container">
  <table className="records-table">
    <thead>
      <tr>
        <th>Item</th>
        <th>Name</th>
        <th>HH_ID</th>
        <th>Timestamp</th>
        <th />
      </tr>
    </thead>
    <tbody>
      {records.map((r, i) => (
        <tr key={r.hhid}>
          <td>{i + 1}</td>
          <td>{r.name}</td>
          <td>{r.hhid}</td>
          <td>{r.time}</td>
          <td>
            <button onClick={() => deleteRecord(r)}>Delete</button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>

      </div>
    </div>
  );
}
