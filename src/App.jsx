import { useEffect, useState, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { BrowserQRCodeReader } from "@zxing/library";
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
  const fileInputRef = useRef(null);
  const generalFileInputRef = useRef(null);

  const logStatus = (msg) => setStatusLog(prev => [msg, ...prev.slice(0, 9)]);

  const loadFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const loadImageElement = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  const resizeDataUrl = async (dataUrl, maxDim = 100000) => {
    const img = await loadImageElement(dataUrl);
    const maxSide = Math.max(img.width, img.height);
    if (maxSide <= maxDim) return dataUrl;

    const scale = maxDim / maxSide;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  };

  const scanQrFileWithZXing = async (file) => {
    const dataUrl = await loadFileAsDataUrl(file);
    const smallDataUrl = await resizeDataUrl(dataUrl, 1200);
    const reader = new BrowserQRCodeReader();
    try {
      try {
        const result = await reader.decodeFromImageUrl(smallDataUrl);
        return result?.getText ? result.getText() : result?.text || result;
      } catch (firstError) {
        if (smallDataUrl !== dataUrl) {
          const fallbackResult = await reader.decodeFromImageUrl(dataUrl);
          return fallbackResult?.getText ? fallbackResult.getText() : fallbackResult?.text || fallbackResult;
        }
        throw firstError;
      }
    } finally {
      reader.reset();
    }
  };

  const handleQrFileChange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    logStatus(`📁 Scanning file: ${file.name}`);

    const text = await scanQrFileWithZXing(file);

    console.log("📷 File QR text:", text); // DEBUG

    handleScanResult(text);

    logStatus(`✅ File scanned: ${file.name}`);

  } catch (error) {

    console.error("❌ File scan error:", error);

    logStatus(
      `❌ File scan failed: ${
        error?.message || error
      }`
    );

  } finally {
    event.target.value = "";
  }
};

  const scanQrImage = () => {
  fileInputRef.current?.click();
};

  const scanGeneralQrImage = () => {
    generalFileInputRef.current?.click();
  };

  const handleGeneralQrFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const result = await scanQrFileWithZXing(file);
      console.log("General QR scan result:", result);
      logStatus(`📁 General file scan: ${result.substring(0, 50)}...`);
    } catch (error) {
      console.error("General QR scan failed:", error);
      logStatus(`❌ General file scan failed: ${error?.message || error}`);
    } finally {
      event.target.value = "";
    }
  };

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
  const parseScannedText = (text) => {
    const raw = text.trim();
    let fields = raw.includes("\t")
      ? raw.split("\t")
      : raw.includes("|")
      ? raw.split("|")
      : raw.split(",");

    fields = fields.map((field) => field?.trim()).filter(Boolean);

    if (fields.length >= 4) {
      const [hhid, lastName, firstName, imageBase64, school, birthday, phone] = fields;
      const name = [lastName, firstName].filter(Boolean).join(" ");
      const photo = imageBase64 ? `data:image/jpeg;base64,${imageBase64}` : null;
      return { name, hhid, photo, school, birthday, phone };
    }

    const [name, hhid] = fields;
    return { name: name?.trim() || "", hhid: hhid?.trim() || "", photo: null, school: "", birthday: "", phone: "" };
  };

  const addRecord = (record) => {
    const { name, hhid, photo, school, birthday, phone } = record || {};
    if (!name || !hhid) return;
    const now = Date.now();
    if (now - lastScanRef.current < 700) return; // cooldown
    lastScanRef.current = now;

    setRecords((prev) => {
      if (prev.some((r) => r.hhid === hhid)) {
        logStatus(`⚠️ Duplicate skipped: ${hhid}`);
        return prev;
      }
      const rec = {
        name,
        hhid,
        photo: photo || null,
        school: school || "",
        birthday: birthday || "",
        phone: phone || "",
        time: new Date().toLocaleString(),
      };
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

const videoRef = useRef(null);
const zxingReaderRef = useRef(null);

const startScanner = async () => {
  try {

    if (zxingReaderRef.current) return;

    logStatus("📷 Starting ZXing camera...");

    const reader = new BrowserQRCodeReader();

    zxingReaderRef.current = reader;

    const devices =
      await navigator.mediaDevices.enumerateDevices();

    const videoDevices =
      devices.filter(
        device =>
          device.kind === "videoinput"
      );

    if (!videoDevices.length) {

      logStatus("❌ No camera found.");
      return;

    }

    let deviceId =
      videoDevices[0].deviceId;

    const backCam =
      videoDevices.find(d =>
        d.label
          .toLowerCase()
          .includes("back") ||

        d.label
          .toLowerCase()
          .includes("environment")
      );

    if (backCam)
      deviceId = backCam.deviceId;

    await reader.decodeFromVideoDevice(

      deviceId,

      videoRef.current,

      (result, err) => {

        if (result) {

          const text =
            result.getText();

          // DEBUG OUTPUT
          console.log(
            "📷 LIVE QR:",
            text
          );

          logStatus(
            `📷 QR Detected`
          );

          const now = Date.now();

          if (
            now - lastScanRef.current
            < 800
          ) return;

          lastScanRef.current = now;

          handleScanResult(text);
        }

        if (
          err &&
          err.name !==
            "NotFoundException"
        ) {

          console.error(err);

        }

      }

    );

  } catch (err) {

    console.error(err);

    logStatus(
      `❌ ZXing camera start failed: ${err.message}`
    );

  }
};

const handleScanResult = (result) => {

  const text =
    result?.decodedText ||
    result?.text ||
    result;

  console.log("📦 handleScanResult:", text);

  if (!text) {

    logStatus("⚠️ No QR data");
    return;

  }

  const parsed =
    parseScannedText(text);

  console.log("📦 Parsed:", parsed);

  addRecord(parsed);
};

  const stopScanner = async () => {
  try {
    if (zxingReaderRef.current) {

      zxingReaderRef.current.reset();

      zxingReaderRef.current = null;

      logStatus("🛑 ZXing camera stopped");
    }

  } catch (err) {
    console.error(err);
  }
};

  const startGeneralScanner = () => {
    scanGeneralQrImage();
  };

  /* ================================ EXPORT ================================= */
  const exportExcel = async () => {
    const data = [["Item", "Name", "HH_ID", "School", "Birthday", "Phone", "Timestamp"], ...records.map((r, i) => [i + 1, r.name, r.hhid, r.school, r.birthday, r.phone, r.time])];
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
const filename = `SFC Attendance - ${dateStr}.csv`;


  // Your data, including headers
  const data = [
    ["Item", "Name", "HH_ID", "School", "Birthday", "Phone", "Timestamp"],
    ...records.map((r, i) => [i + 1, r.name, r.hhid, r.school, r.birthday, r.phone, r.time])
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
        <h2>📋 SFC Attendance Scanner</h2> 
        {syncing && <span className="spinner" style={{ marginLeft: 8 }}></span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={startScanner}>Start</button>
          <button className="btn" onClick={stopScanner}>Stop</button>
          <button className="btn" onClick={startGeneralScanner}>Scan Any QR</button>
          <button className="btn" onClick={scanQrImage}>Scan QR Image</button>
          <button className="btn" onClick={clearRecords}>Clear</button>
          <button className="btn" onClick={saveOnline}>Save Online</button>
          <button className="btn" onClick={exportToCSV}>Export CSV</button>
          <button className="btn" onClick={() => window.location.reload()}>Refresh</button>
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleQrFileChange}
          />
          <input
            type="file"
            ref={generalFileInputRef}
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleGeneralQrFileChange}
          />
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

        <video
  ref={videoRef}
  style={{
    width: "100%",
    maxWidth: 400,
    borderRadius: 10
  }}
/>

       <div className="records-table-container">
  <table className="records-table">
    <thead>
      <tr>
        <th>Item</th>
        <th>Photo</th>
        <th>Name</th>
        <th>SFC_ID</th>
        <th>School</th>
        <th>Birthday</th>
        <th>Phone</th>
        
        <th>Timestamp</th>
        <th />
      </tr>
    </thead>
    <tbody>
      {records.map((r, i) => (
        <tr key={r.hhid}>
          <td>{i + 1}</td>
          <td>{r.photo ? <img src={r.photo} alt="Photo" className="record-photo" /> : "—"}</td>
          <td>{r.name}</td>
          <td>{r.hhid}</td>
          <td>{r.school || "—"}</td>
          <td>{r.birthday || "—"}</td>
          <td>{r.phone || "—"}</td>
          
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
