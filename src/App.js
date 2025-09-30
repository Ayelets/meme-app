import React, { useEffect, useMemo, useRef, useState } from "react";

// small color utils for textarea contrast
const hexToRgb = (hex) => {
  if (!hex) return [255,255,255];
  const h = hex.replace('#','');
  const v = h.length===3 ? h.split('').map(c=>c+c).join('') : h;
  const int = parseInt(v, 16);
  return [(int>>16)&255, (int>>8)&255, int&255];
};
const relLuma = (hex) => {
  const [r,g,b] = hexToRgb(hex).map(v=>{ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); });
  return 0.2126*r+0.7152*g+0.0722*b;
};
const isLightColor = (hex) => relLuma(hex) > 0.5;

// --- Simple, single-file meme generator ---
// Features
// - Image roller with popular templates + upload your own
// - Add multiple text boxes, drag to position
// - Controls: font size, color, stroke (outline), shadow, alignment, font family
// - Toggle uppercase, bold, italic, and all-caps meme style
// - Download as PNG with proper high-DPI scaling
// - No AI options :)

const BASE = process.env.PUBLIC_URL || "";
const DEFAULT_TEMPLATES = [
  `${BASE}/images/1.png`,
  `${BASE}/images/2.png`,
  `${BASE}/images/3.png`,
  `${BASE}/images/4.png`,
  `${BASE}/images/5.png`,
  `${BASE}/images/6.png`,
  `${BASE}/images/7.png`,
  `${BASE}/images/8.png`,
];

const FONTS = [
  { label: "Impact (classic)", css: "Impact, Haettenschweiler, 'Arial Black', sans-serif" },
  { label: "Arial Black", css: "'Arial Black', Arial, sans-serif" },
  { label: "Inter", css: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
  { label: "Georgia", css: "Georgia, 'Times New Roman', serif" },
  { label: "Comic Sans", css: "'Comic Sans MS', 'Comic Sans', cursive" },
];

// Global RTL detector utilities (module scope)
// Strip bidi control chars (RLM/LRM/LRE/RLE/PDF/LRI/RLI/FSI/PDI) before detection
const stripBidi = (s = "") => s.replace(/[‎‏‪-‮⁦-⁩؜]/g, "");
// Detect true RTL scripts (Hebrew/Arabic blocks)
// RTL = Hebrew/Arabic בלבד (ללא טווחים אחרים)
const isRTL = (s = "") => /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(stripBidi(s));


function useImage(url) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    if (!url) return;
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.onerror = () => setImg(null);
    i.src = url;
  }, [url]);
  return img;
}

const defaultText = (id) => ({
  id,
  text: id === 1 ? "TOP TEXT" : "BOTTOM TEXT",
  x: 0.5, // relative position (0..1)
  y: id === 1 ? 0.08 : 0.92,
  fontSize: 48,
  color: "#ffffff",
  strokeColor: "#000000",
  strokeWidth: 2,
  fontFamily: FONTS[0].css,
  align: "center",
  bold: true,
  italic: false,
  uppercase: true,
  shadow: true,
});

export default function App() {
  const [exportBlocked, setExportBlocked] = useState(false);
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const fileInputRef = useRef(null);
  const lastObjectUrlRef = useRef(null);
  const [activeUrl, setActiveUrl] = useState(DEFAULT_TEMPLATES[0]);
  const img = useImage(activeUrl);

  const [boxesByImage, setBoxesByImage] = useState(() => ({ [DEFAULT_TEMPLATES[0]]: [defaultText(1), defaultText(2)] }));
  const boxes = useMemo(() => boxesByImage[activeUrl] ?? [], [boxesByImage, activeUrl]);
    // Helpers to update boxes for the active image (generic for every image)
  const setBoxesForActive = (updater) => {
    setBoxesByImage((prev) => {
      const current = prev[activeUrl] ?? [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [activeUrl]: next };
    });
  };
  const [editingId, setEditingId] = useState(null);

  // Ensure defaults for any newly selected image
  useEffect(() => {
    setBoxesByImage(prev => {
      const cur = prev[activeUrl];
      if (cur && cur.length) return prev;
      return { ...prev, [activeUrl]: [defaultText(1), defaultText(2)] };
    });
  }, [activeUrl]);
  const [activeBoxId, setActiveBoxId] = useState(null);
  useEffect(() => {
    const list = boxesByImage[activeUrl] ?? [];
    if (!list.length) { setActiveBoxId(null); return; }
    if (!list.some(b => b.id === activeBoxId)) setActiveBoxId(list[0].id);
  }, [activeUrl, boxesByImage]);

  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // תצוגה ולינק שנוצר
 const [generated, setGenerated] = useState({ previewUrl: "", linkUrl: "" });

 // קידוד/פענוח מצב למחרוזת URL
 const encodeState = (obj) =>
   encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(obj)))));
 const decodeState = (s) => {
   try { return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(s))))); }
   catch { return null; }
 };

 // בניית פרמלינק מהמצב הנוכחי
 const makePermalink = () => {
  const payload = {
    img: activeUrl,
    boxes: boxes.map(({id,text,x,y,fontSize,color,strokeColor,strokeWidth,fontFamily,align,bold,italic,uppercase,shadow}) =>
      ({id,text,x,y,fontSize,color,strokeColor,strokeWidth,fontFamily,align,bold,italic,uppercase,shadow}))
  };
  const q = encodeState(payload);
  const url = `${window.location.origin}${window.location.pathname}?m=${q}`;
  return url;
 };


  const activeBox = useMemo(() => boxes.find((b) => b.id === activeBoxId), [boxes, activeBoxId]);

  // Draw to canvas for download preview (hidden canvas)
  useEffect(() => {
    drawPreview();
  }, [img, boxes, activeUrl]);
  // (Removed proactive CORS pre-blocking to avoid false positives, esp. on Wikimedia)
  useEffect(() => { setExportBlocked(false); }, [img]);

  // Mount-time lightweight tests for direction detection
  useEffect(() => {
    if (typeof window === 'undefined' || window.__meme_tests_ran) return;
    window.__meme_tests_ran = true;
    try {
      console.assert(isRTL('TOP') === false, 'TOP should be LTR');
      console.assert(isRTL('שלום') === true, 'שלום should be RTL');
      console.assert(isRTL('hey שלום') === true, 'mixed should be RTL');
      console.assert(isRTL('123 abc') === false, 'numbers+latin should be LTR');
      // ensure Arabic Letter Mark (U+061C) does not flip LTR
      const ALM = '؜';
      console.assert(isRTL('ALL' + ALM) === false, 'ALM must not force RTL for latin');
      console.assert(stripBidi('ALL' + ALM) === 'ALL', 'stripBidi removes ALM');
      console.log('[meme-tests] OK');
    } catch (e) {
      console.warn('[meme-tests] failed', e);
    }
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('m');
    const state = p && decodeState(p);
    if (state && state.img) {
      setTemplates((t) => t.includes(state.img) ? t : [state.img, ...t]);
      setBoxesByImage((prev) => ({ ...prev, [state.img]: state.boxes || [] }));
      setActiveUrl(state.img);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drawPreview = () => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;

    const dpi = 2; // export scale
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    canvas.width = width * dpi;
    canvas.height = height * dpi;

    const ctx = canvas.getContext("2d");
    ctx.scale(dpi, dpi);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    boxes.forEach((b) => drawTextBox(ctx, b, width, height));
  };

  const drawTextBox = (ctx, b, width, height) => {
    const x = b.x * width;
    const y = b.y * height;
    const font = `${b.italic ? "italic " : ""}${b.bold ? "700 " : ""}${b.fontSize}px ${b.fontFamily}`;
    const text = b.uppercase ? b.text.toUpperCase() : b.text;
    // קובעים כיוון לפי המקור (b.text) כדי שהאנגלית לא תתהפך
    ctx.direction = isRTL(b.text) ? 'rtl' : 'ltr';

    ctx.font = font;
    ctx.textAlign = b.align;
    ctx.textBaseline = "middle";

    // Shadow
    if (b.shadow) {
      ctx.shadowColor = "rgba(0,0,0,.5)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }

    // Stroke (outline)
    if (b.strokeWidth > 0) {
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = b.strokeWidth;
      ctx.strokeStyle = b.strokeColor;
      wrapText(ctx, text, x, y, width * 0.9, b.fontSize * 1.2, (line, ly) => ctx.strokeText(line, x, ly));
    }

    // Fill
    ctx.fillStyle = b.color;
    wrapText(ctx, text, x, y, width * 0.9, b.fontSize * 1.2, (line, ly) => ctx.fillText(line, x, ly));
  };

  // isRTL defined at module scope above



  const wrapText = (ctx, text, x, y, maxWidth, lineHeight, drawFn) => {
    const words = text.split(" ");
    const lines = [];
    let line = "";
    for (let n = 0; n < words.length; n++) {
      const testLine = line + (line ? " " : "") + words[n];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        lines.push(line);
        line = words[n];
      } else {
        line = testLine;
      }
    }
    lines.push(line);

    // y refers to middle of block
    const totalHeight = (lines.length - 1) * lineHeight;
    let drawY = y - totalHeight / 2;
    lines.forEach((ln) => {
      drawFn(ln, drawY);
      drawY += lineHeight;
    });
  };

  // Dragging logic for positioned overlays in the editor view (relative positions)
  const [dragState, setDragState] = useState(null);

  const onPointerDown = (e, id) => {
    if (editingId === id) return; // don't start drag while editing
    setActiveBoxId(id);
    const rect = containerRef.current.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    setDragState({ id, ox: rx, oy: ry, startX: rx, startY: ry });
  };
  const onPointerMove = (e) => {
    if (!dragState) return;
    const rect = containerRef.current.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    const dx = rx - dragState.ox;
    const dy = ry - dragState.oy;
    setDragState((s) => ({ ...s, ox: rx, oy: ry }));
    setBoxesForActive((prev) =>
      prev.map((b) =>
        b.id === dragState.id
          ? { ...b, x: clamp(b.x + dx, 0.02, 0.98), y: clamp(b.y + dy, 0.02, 0.98) }
          : b
      )
    );
  };
  const onPointerUp = () => setDragState(null);

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const addTextBox = () => {
    const id = Math.max(0, ...boxes.map((b) => b.id)) + 1;
    setBoxesForActive((bxs) => [...bxs, { ...defaultText(id), text: 'NEW TEXT', y: 0.5 }]);
    setActiveBoxId(id);
  };
  const removeActive = () => setBoxesForActive((bxs) => bxs.filter((b) => b.id !== activeBoxId));

  const onChangeActive = (patch) =>
    setBoxesForActive((bxs) => bxs.map((b) => (b.id === activeBoxId ? { ...b, ...patch } : b)));

  const onUpload = (file) => {
    if (!file) return;
    // Revoke previous object URL to avoid memory leaks
    if (lastObjectUrlRef.current) URL.revokeObjectURL(lastObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    lastObjectUrlRef.current = url;
    setTemplates((t) => [url, ...t]);
    setBoxesByImage((prev)=> ({ ...prev, [url]: [defaultText(1), defaultText(2)] }));
    setActiveUrl(url);
  };

  const onAddFromUrl = async () => {
    const url = prompt("Paste an image URL");
    if (url) {
      setTemplates((t) => [url, ...t]);
      setBoxesByImage((prev)=> ({ ...prev, [url]: [defaultText(1), defaultText(2)] }));
      setActiveUrl(url);
    }
  };

  const download = () => {
    drawPreview();
    const canvas = canvasRef.current;
    if (!canvas || !img) {
      alert("אין קנבס מוכן לייצוא. נסי/ה שוב אחרי שהתמונה נטענה.");
      return;
    }
    // Detect tainted canvas (CORS) — if tainted, toDataURL throws
    try { canvas.toDataURL('image/png'); } catch (e) {
      alert("נראה שהתמונה חוסמת ייצוא (CORS). העלאה מקומית תמיד תעבוד, או השתמש/י בתמונה עם כותרות CORS (כמו Wikimedia).");
      return;
    }

    const saveWithFS = async (blobOrUrl) => {
      // Use File System Access API when available (most reliable in Chrome)
      try {
        if (!('showSaveFilePicker' in window)) return false;
        const blob = typeof blobOrUrl === 'string' ? await (await fetch(blobOrUrl)).blob() : blobOrUrl;
        const handle = await window.showSaveFilePicker({
          suggestedName: 'meme.png',
          types: [{ description: 'PNG Image', accept: { 'image/png': ['.png'] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch {
        return false;
      }
    };

    const triggerDownload = (blobOrUrl) => {
      const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'meme.png';
      a.style.display = 'none';
      document.body.appendChild(a);

      let downloaded = false;
      try {
        if (typeof a.click === 'function') { a.click(); downloaded = true; }
        else { const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window }); downloaded = a.dispatchEvent(evt); }
      } catch {}

      if (!downloaded) {
        try { window.open(url, '_blank', 'noopener'); } catch {}
      }

      setTimeout(() => {
        a.remove();
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      }, 0);
    };

    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        (async () => {
          if (blob) {
            if (await saveWithFS(blob)) return; // Chrome (when allowed)
            triggerDownload(blob); // fallback
          } else {
            try {
              const dataURL = canvas.toDataURL('image/png');
              if (await saveWithFS(dataURL)) return;
              triggerDownload(dataURL);
            } catch { alert('הורדה נכשלה. נסי/ה תמונה מקומית או דפדפן אחר.'); }
          }
        })();
      }, 'image/png');
      return;
    }

    try {
      const dataURL = canvas.toDataURL('image/png');
      (async () => { if (await saveWithFS(dataURL)) return; triggerDownload(dataURL); })();
    } catch { alert('Export blocked. ייתכן ש-CORS או סביבת Sandbox חוסמים הורדה.'); }
  };

const generateAndLink = () => {
    drawPreview();
    const canvas = canvasRef.current;
    if (!canvas || !img) {
      alert("אין קנבס מוכן לייצוא. נסי/ה שוב אחרי שהתמונה נטענה.");
      return;
    }
    // Detect tainted canvas (CORS) — if tainted, toDataURL throws
    try { canvas.toDataURL('image/png'); } catch (e) {
      alert("נראה שהתמונה חוסמת ייצוא (CORS). העלאה מקומית תמיד תעבוד, או השתמש/י בתמונה עם כותרות CORS (כמו Wikimedia).");
      return;
    }

    const triggerDownload = (blobOrUrl) => {
      const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'meme.png';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Fallback: some sandboxed environments ignore a.click(); open in new tab
      setTimeout(() => {
        if (!document.hidden) { // heuristics; if download didn't trigger
          try { window.open(url, '_blank', 'noopener'); } catch {}
        }
        if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 1500);
      }, 50);
    };

    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (blob) {
          triggerDownload(blob);
        } else {
          // Safari/edge cases: fall back to data URL
          try { triggerDownload(canvas.toDataURL('image/png')); }
          catch { alert('הורדה נכשלה. נסי/ה תמונה מקומית או דפדפן אחר.'); }
        }
      }, 'image/png');
      return;
    }

    try { triggerDownload(canvas.toDataURL('image/png')); }
    catch { alert('Export blocked. ייתכן ש-CORS או סביבת Sandbox חוסמים הורדה.'); }
  };


  return (
    <div className="h-screen flex flex-col overflow-hidden bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="w-full px-4 py-3 flex items-center gap-3">
          <span className="text-2xl font-bold">Meme Eshelerator</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={addTextBox} className="px-3 py-2 rounded-xl bg-zinc-900 text-white hover:opacity-90">Add Text</button>
            <button onClick={generateAndLink} className="px-3 py-2 rounded-xl bg-blue-600 text-white hover:opacity-90">Generate Meme</button>
          </div>
        </div>
      </header>

      <main className="max-w-none w-full px-4 md:px-6 py-4 flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 items-stretch overflow-hidden">
        {/* Editor */}
        <section className="bg-white rounded-2xl shadow p-4 flex flex-col min-h-0">
          {/* Image roller */}
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => fileInputRef.current?.click()} className="px-3 py-2 rounded-xl bg-zinc-200 hover:bg-zinc-300 whitespace-nowrap">Upload…</button>
            <input ref={fileInputRef} id="file-input" type="file" accept="image/*" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
            <button onClick={onAddFromUrl} className="px-3 py-2 rounded-xl bg-zinc-200 hover:bg-zinc-300 whitespace-nowrap">Add from URL</button>

            {/* גלריית תמונות נגללת אופקית */}
            <div className="flex-1 overflow-x-auto">
              <div className="inline-flex gap-2 pr-1 snap-x snap-mandatory">
                {templates.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveUrl(t)}
                    className={`relative h-20 w-28 shrink-0 rounded-xl overflow-hidden border snap-start ${activeUrl===t? 'ring-2 ring-blue-500':''}`}
                  >
                    <img src={t} alt="template" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          </div>


          {/* Canvas-like editor with draggable text overlays */}
          <div
            ref={containerRef}
            onPointerDown={(e) => {
              // Only start drag if clicked on a text handle; handled per box
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            className="relative flex-1 min-h-0 bg-zinc-100 rounded-xl overflow-hidden border"
          >
            <img src={activeUrl} alt="active" className="absolute inset-0 h-full w-full object-contain select-none pointer-events-none"/>

            {boxes.map((b) => (
              <DraggableText
                key={b.id}
                data={b}
                isActive={b.id === activeBoxId}
                containerRef={containerRef}
                onPointerDown={onPointerDown}
                onChange={(patch)=> setBoxesForActive((arr)=> arr.map(x=> x.id===b.id? {...x, ...patch}: x))}
                editingId={editingId}
                setEditingId={setEditingId}
              />
            ))}
          </div>
        </section>

        {/* Controls */}
        <aside className="bg-white rounded-2xl shadow p-4 space-y-4 flex flex-col min-h-0 overflow-auto lg:overflow-visible">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Text Controls</h2>
            <div className="flex items-center gap-2">
              <select value={activeBoxId} onChange={(e)=>setActiveBoxId(Number(e.target.value))} className="border rounded-lg px-2 py-1">
                {boxes.map((b)=> (<option key={b.id} value={b.id}>Text #{b.id}</option>))}
              </select>
              <button onClick={removeActive} className="px-2 py-1 rounded-lg bg-red-100 text-red-700">Remove</button>
            </div>
          </div>

          {activeBox && (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Text</label>
                <textarea
                  dir={isRTL(activeBox.text) ? 'rtl' : 'ltr'}
                  value={activeBox.text}
                  onChange={(e)=>onChangeActive({ text: e.target.value })}
                  rows={3}
                  className="w-full border rounded-xl p-2 mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Font Size</label>
                  <input type="range" min={18} max={128} value={activeBox.fontSize} onChange={(e)=>onChangeActive({fontSize: Number(e.target.value) })} className="w-full"/>
                  <div className="text-xs text-zinc-500">{activeBox.fontSize}px</div>
                </div>
                <div>
                  <label className="text-sm font-medium">Font Family</label>
                  <select value={activeBox.fontFamily} onChange={(e)=>onChangeActive({fontFamily: e.target.value })} className="w-full border rounded-xl p-2 mt-1">
                    {FONTS.map((f)=> <option key={f.label} value={f.css}>{f.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium">Fill</label>
                  <input type="color" value={activeBox.color} onChange={(e)=>onChangeActive({ color: e.target.value })} className="w-full h-10 rounded-xl border p-0"/>
                </div>
                <div>
                  <label className="text-sm font-medium">Outline</label>
                  <input type="color" value={activeBox.strokeColor} onChange={(e)=>onChangeActive({ strokeColor: e.target.value })} className="w-full h-10 rounded-xl border p-0"/>
                </div>
                <div>
                  <label className="text-sm font-medium">Outline px</label>
                  <input type="number" min={0} max={20} value={activeBox.strokeWidth} onChange={(e)=>onChangeActive({ strokeWidth: Number(e.target.value) })} className="w-full border rounded-xl p-2 mt-1"/>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(["left","center","right"]).map((a)=> (
                  <button key={a} onClick={()=>onChangeActive({ align: a })} className={`px-2 py-2 rounded-xl border ${activeBox.align===a? 'bg-zinc-900 text-white':'bg-white'}`}>{a}</button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Toggle label="Bold" active={activeBox.bold} onClick={()=>onChangeActive({ bold: !activeBox.bold })} />
                <Toggle label="Italic" active={activeBox.italic} onClick={()=>onChangeActive({ italic: !activeBox.italic })} />
                <Toggle label="Uppercase" active={activeBox.uppercase} onClick={()=>onChangeActive({ uppercase: !activeBox.uppercase })} />
                <Toggle label="Shadow" active={activeBox.shadow} onClick={()=>onChangeActive({ shadow: !activeBox.shadow })} />
              </div>

              <div className="text-xs text-zinc-500">Position: X {(activeBox.x*100).toFixed(0)}% · Y {(activeBox.y*100).toFixed(0)}%</div>
            </div>
          )}

          <hr className="my-4"/>
          <div>
            <h3 className="text-sm font-semibold mb-2">Export</h3>
            <p className="text-sm text-zinc-600 mb-2">PNG download uses the original image resolution for crisp results.</p>
            <canvas ref={canvasRef} className="hidden"/>
            
            {(generated.previewUrl || generated.linkUrl) && (
            <div className="mt-3 space-y-2">
              {generated.previewUrl && (
                <img src={generated.previewUrl} alt="Generated meme" className="w-full rounded-lg border" />
              )}
              {generated.linkUrl && (
                <div className="text-sm">
                  <div className="font-medium mb-1">Image link (PNG Data URL):</div>
                  <a href={generated.linkUrl} target="_blank" rel="noopener" className="text-blue-600 underline break-all">
                    {generated.linkUrl}
                  </a>
                  <div className="text-xs text-zinc-500 mt-1">הקישור הועתק ללוח — אפשר להדביק ולשתף.</div>
                </div>
              )}
             </div>
           )}
          </div>
        </aside>
      </main>
    </div>
  );
}

function Toggle({ label, active, onClick }) {
  return (
    <button onClick={onClick} className={`px-3 py-2 rounded-xl border ${active? 'bg-zinc-900 text-white':'bg-white'}`}>{label}</button>
  );
}

function DraggableText({ data, isActive, containerRef, onPointerDown, onChange, editingId, setEditingId }) {
  const isEditing = editingId === data.id;

  if (isEditing) {
    // Render a positioned <textarea> while editing for reliable caret behavior
    return (
      <textarea
        autoFocus
        rows={(data.text ? data.text.split('\n').length : 1)}
        cols={Math.min(Math.max(((data.text||'').split('\n').reduce((m,l)=> Math.max(m, l.length), 0)) + 2, 8), 48)}
        value={data.text}
        onChange={(e)=> onChange({ text: e.target.value })}
        onBlur={()=> setEditingId(null)}
        dir={isRTL(data.text) ? 'rtl' : 'ltr'}
        className={`absolute px-2 py-1 rounded-md outline-none ring-2 ${isActive? 'ring-blue-500':'ring-zinc-300'}`}
        style={{
          left: `${data.x * 100}%`,
          top: `${data.y * 100}%`,
          transform: 'translate(-50%, -50%)',
          fontFamily: data.fontFamily,
          fontWeight: data.bold ? 700 : 400,
          fontStyle: data.italic ? 'italic' : 'normal',
          textAlign: data.align,
          textTransform: data.uppercase ? 'uppercase' : 'none',
          fontSize: `${data.fontSize}px`,
          lineHeight: 1.2,
          letterSpacing: 0,
          color: data.color,
          WebkitTextStroke: `${data.strokeWidth}px ${data.strokeColor}`,
          textShadow: data.shadow ? '0 2px 8px rgba(0,0,0,.4)' : 'none',
          background: isLightColor(data.color) ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)',
          backdropFilter: 'blur(2px)',
          caretColor: isLightColor(data.color) ? '#111' : '#fff',
          display: 'inline-block',
          width: 'fit-content',
          height: 'fit-content',
          maxWidth: '90%',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap'
        }}
      />
    );
  }

  const style = {
    left: `${data.x * 100}%`,
    top: `${data.y * 100}%`,
    transform: 'translate(-50%, -50%)',
    fontFamily: data.fontFamily,
    fontWeight: data.bold ? 700 : 400,
    fontStyle: data.italic ? 'italic' : 'normal',
    textAlign: data.align,
    textTransform: data.uppercase ? 'uppercase' : 'none',
    textShadow: data.shadow ? '0 2px 8px rgba(0,0,0,.4)' : 'none',
    fontSize: `${data.fontSize}px`,
    color: data.color,
    WebkitTextStroke: `${data.strokeWidth}px ${data.strokeColor}`,
  };

  return (
    <div
      className={`absolute px-2 py-1 select-none cursor-grab active:cursor-grabbing ${isActive? 'ring-2 ring-blue-500 rounded-xl':'ring-0'}`}
      style={style}
      onPointerDown={(e)=> onPointerDown(e, data.id)}
      onDoubleClick={() => setEditingId(data.id)}
    >
      {data.text || ''}
    </div>
  );
}
