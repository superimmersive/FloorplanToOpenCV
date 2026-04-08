const API = "/api";
let jobId = null;

const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const uploadBtn = $("uploadBtn");
const uploadStatus = $("uploadStatus");
const jobIdEl = $("jobId");
const pipelineSection = $("pipelineSection");
const runPipelineBtn = $("runPipelineBtn");
const pipelineStatus = $("pipelineStatus");
const viewerSection = $("viewerSection");
const layerSelect = $("layerSelect");
const mainImage = $("mainImage");
const canvasWrap = document.querySelector(".canvas-wrap");
const maskCanvas = $("maskCanvas");
const vectorEditorSection = $("vectorEditorSection"); // May be null in walls-only scope
const vectorLayerSelect = $("vectorLayerSelect");
const saveVectorMaskBtn = $("saveVectorMaskBtn");
const vectorStatus = $("vectorStatus");

function setStatus(el, text, className = "") {
  el.textContent = text;
  el.className = "status " + className;
}

fileInput.addEventListener("change", () => {
  uploadBtn.disabled = !fileInput.files?.length;
});

uploadBtn.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  uploadBtn.disabled = true;
  setStatus(uploadStatus, "Uploading…");
  try {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`${API}/upload`, { method: "POST", body: form });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.detail || r.statusText);
    }
    const data = await r.json();
    jobId = data.job_id;
    jobIdEl.textContent = `Job: ${jobId}`;
    setStatus(uploadStatus, "Uploaded. You can run the pipeline.", "success");
    pipelineSection.hidden = false;
    viewerSection.hidden = false;
    loadImage();
    loadLayer("walls");
  } catch (e) {
    const msg = e.message || "Upload failed";
    const hint = (msg === "Method Not Allowed" || msg === "Failed to fetch")
      ? " Open this app at http://localhost:8000 (Run Task → Start Web App) instead of Live Server."
      : "";
    setStatus(uploadStatus, msg + hint, "error");
  } finally {
    uploadBtn.disabled = false;
  }
});

async function loadImage() {
  if (!jobId) return;
  mainImage.src = `${API}/image/${jobId}?t=${Date.now()}`;
}

const vectorCanvas = $("vectorCanvas");
let currentVectors = null;
let vectorEditorAttached = false;
let vectorDrag = null;

function getLayerUrl(layer) {
  if (layer === "image") return `${API}/image/${jobId}`;
  if (layer === "vectors") return `${API}/image/${jobId}`;
  return `${API}/overlay/${jobId}/${layer}`;
}

async function loadLayer(layer) {
  if (!jobId) return;
  maskCanvas.hidden = true;
  maskCanvas.classList.remove("editing");
  vectorCanvas.hidden = true;
  if (layer === "vectors") {
    // Vectors layer not available in walls-only scope
    mainImage.src = `${API}/image/${jobId}?t=${Date.now()}`;
    mainImage.hidden = false;
    await drawVectorsLayer();
    return;
  }
  const url = getLayerUrl(layer);
  mainImage.onerror = () => {
    mainImage.onerror = null;
    mainImage.src = `${API}/image/${jobId}?t=${Date.now()}`;
  };
  mainImage.src = `${url}?t=${Date.now()}`;
  mainImage.hidden = false;
}

async function drawVectorsLayer() {
  try {
    const r = await fetch(`${API}/json/${jobId}/vectors`);
    if (!r.ok) {
      vectorCanvas.hidden = true;
      currentVectors = null;
      return;
    }
    const data = await r.json();
    currentVectors = data;
    const [imgW, imgH] = data.image_size || [mainImage.naturalWidth || 1920, mainImage.naturalHeight || 1080];
    vectorCanvas.width = imgW;
    vectorCanvas.height = imgH;
    vectorCanvas.hidden = false;
    vectorCanvas.style.width = "100%";
    vectorCanvas.style.height = "auto";
    vectorCanvas.style.maxWidth = "100%";
    vectorCanvas.style.pointerEvents = "auto";
    redrawVectors();
    if (!vectorEditorAttached) {
      attachVectorEditor();
      vectorEditorAttached = true;
    }
  } catch (_) {
    vectorCanvas.hidden = true;
    currentVectors = null;
  }
}

function attachVectorEditor() {
  vectorCanvas.addEventListener("mousedown", (e) => {
    if (!currentVectors || !jobId) return;
    const layer = vectorLayerSelect?.value || "walls";
    const { x, y } = vectorCanvasCoords(e);
    const hit = findNearestVertex(layer, x, y, 10);
    if (!hit) return;
    vectorDrag = hit;
  });

  window.addEventListener("mousemove", (e) => {
    if (!vectorDrag || !currentVectors) return;
    const { x, y } = vectorCanvasCoords(e);
    const { layer, polyIndex, vertexIndex } = vectorDrag;
    const layerData = getLayerPolygons(currentVectors, layer);
    if (!layerData || !layerData[polyIndex]) return;
    layerData[polyIndex][vertexIndex][0] = x;
    layerData[polyIndex][vertexIndex][1] = y;
    redrawVectors();
  });

  window.addEventListener("mouseup", () => {
    vectorDrag = null;
  });
}

function vectorCanvasCoords(e) {
  const rect = vectorCanvas.getBoundingClientRect();
  const scaleX = vectorCanvas.width / rect.width;
  const scaleY = vectorCanvas.height / rect.height;
  return {
    x: Math.floor((e.clientX - rect.left) * scaleX),
    y: Math.floor((e.clientY - rect.top) * scaleY),
  };
}

function getLayerPolygons(vectors, layer) {
  if (!vectors) return null;
  if (layer === "rooms") {
    if (!Array.isArray(vectors.rooms)) return [];
    return vectors.rooms.map((r) => r.polygon || r);
  }
  const arr = vectors[layer];
  if (!Array.isArray(arr)) return [];
  return arr;
}

function findNearestVertex(layer, x, y, maxDist) {
  const polys = getLayerPolygons(currentVectors, layer);
  if (!polys || !polys.length) return null;
  let best = null;
  let bestD2 = maxDist * maxDist;
  polys.forEach((poly, pi) => {
    poly.forEach((pt, vi) => {
      const dx = pt[0] - x;
      const dy = pt[1] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = { layer, polyIndex: pi, vertexIndex: vi };
      }
    });
  });
  return best;
}

function redrawVectors() {
  if (!currentVectors) return;
  const data = currentVectors;
  const [imgW, imgH] = data.image_size || [vectorCanvas.width, vectorCanvas.height];
  vectorCanvas.width = imgW;
  vectorCanvas.height = imgH;
  const ctx = vectorCanvas.getContext("2d");
  ctx.clearRect(0, 0, imgW, imgH);
  const colors = {
    walls: "rgba(220, 60, 60, 0.6)",
    doors: "rgba(60, 100, 220, 0.6)",
    windows: "rgba(60, 180, 220, 0.6)",
    fixtures: "rgba(200, 60, 200, 0.6)",
    kitchen_counter: "rgba(220, 180, 0, 0.5)",
    rooms: "rgba(80, 200, 120, 0.25)",
  };
  const strokeColors = {
    walls: "#c03030",
    doors: "#2040c0",
    windows: "#20a0c0",
    fixtures: "#a020a0",
    kitchen_counter: "#b09000",
    rooms: "#209060",
  };
  function drawPoly(ctx, polygon, fill, stroke) {
    if (!polygon || polygon.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i][0], polygon[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }
  for (const key of ["walls", "doors", "windows", "fixtures", "kitchen_counter"]) {
    const list = data[key];
    if (!Array.isArray(list)) continue;
    const fill = colors[key];
    const stroke = strokeColors[key];
    for (const poly of list) drawPoly(ctx, poly, fill, stroke);
  }
  if (Array.isArray(data.rooms)) {
    for (const r of data.rooms) {
      const poly = r.polygon || r;
      drawPoly(ctx, poly, colors.rooms, strokeColors.rooms);
    }
  }
}

async function rasterizeVectorsToMask(layer) {
  if (!currentVectors) throw new Error("No vectors loaded");
  const vectors = currentVectors;
  const [imgW, imgH] = vectors.image_size || [vectorCanvas.width, vectorCanvas.height];
  const canvas = document.createElement("canvas");
  canvas.width = imgW;
  canvas.height = imgH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, imgW, imgH);
  ctx.fillStyle = "white";
  const polys = getLayerPolygons(vectors, layer);
  if (polys && polys.length) {
    polys.forEach((poly) => {
      if (!poly || poly.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      ctx.fill();
    });
  }
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      "image/png",
      1
    );
  });
}

layerSelect.addEventListener("change", () => {
  loadLayer(layerSelect.value);
});

runPipelineBtn.addEventListener("click", async () => {
  if (!jobId) return;
  runPipelineBtn.disabled = true;
  setStatus(pipelineStatus, "Running pipeline… (this may take a minute)");
  try {
    const r = await fetch(`${API}/run/${jobId}`, { method: "POST" });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.detail || r.statusText);
    }

    const data = await r.json();
    const failed = data.results?.find((x) => !x.success);
    if (failed) {
      setStatus(pipelineStatus, `Stopped at ${failed.step}: ${failed.message}`, "error");
    } else {
      setStatus(pipelineStatus, "Pipeline finished.", "success");
      if (vectorEditorSection) vectorEditorSection.hidden = false;
      const editorLinkWrap = $("editorLinkWrap");
      const editorLink = $("editorLink");
      if (editorLinkWrap && editorLink) {
        editorLinkWrap.hidden = false;
        editorLink.href = `/editor/?job_id=${jobId}`;
      }
      loadLayer(layerSelect.value);
    }
  } catch (e) {
    setStatus(pipelineStatus, e.message || "Pipeline failed", "error");
  } finally {
    runPipelineBtn.disabled = false;
  }
});

if (saveVectorMaskBtn) saveVectorMaskBtn.addEventListener("click", async () => {
  if (!jobId) {
    setStatus(vectorStatus, "Upload a floor plan and run the pipeline first.", "error");
    return;
  }
  if (!currentVectors) {
    setStatus(vectorStatus, "Load the Vectors layer first so vectors.json is available.", "error");
    return;
  }
  const layer = vectorLayerSelect?.value || "walls";
  saveVectorMaskBtn.disabled = true;
  setStatus(vectorStatus, `Rasterizing ${layer} vectors to mask…`);
  try {
    const blob = await rasterizeVectorsToMask(layer);
    const form = new FormData();
    form.append("file", blob, `${layer}_mask.png`);
    const r = await fetch(`${API}/mask/${jobId}/${layer}`, {
      method: "PUT",
      body: form,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Save failed");
    setStatus(vectorStatus, `Mask for ${layer} saved. You can re-run the pipeline if needed.`, "success");
  } catch (e) {
    setStatus(vectorStatus, e.message || "Failed to save mask from vectors.", "error");
  } finally {
    saveVectorMaskBtn.disabled = false;
  }
});
