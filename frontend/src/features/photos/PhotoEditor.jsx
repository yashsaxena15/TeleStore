// The photo editor (as in the app): Crop (rotate, a few shapes, drag the corners or move the
// frame) and Adjust (brightness, contrast, saturation). "Save copy" uploads a JPEG next to the
// original; the original is kept.
import { useEffect, useRef, useState } from "react";
import { Crop, Loader2, RotateCw, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { uploadManager } from "@/features/transfers/uploadManager";
import { adjustFilter, ASPECTS, centredCrop, cropPixels, dragCorner, editedName, FULL, moveCrop } from "./edits";
import { mediaUrl } from "./media";

/** The photo turned by quarter turns, drawn on a canvas. */
function rotated(img, turns) {
    const c = document.createElement("canvas");
    const odd = turns % 2 === 1;
    c.width = odd ? img.naturalHeight : img.naturalWidth;
    c.height = odd ? img.naturalWidth : img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    return c;
}

const CropFrame = ({ crop, ratio, photoAspect, onChange }) => {
    const box = useRef(null);
    const drag = useRef(null);
    const start = (corner) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        drag.current = { corner, x: e.clientX, y: e.clientY, rect: crop };
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
        const d = drag.current;
        if (!d || !box.current) return;
        const r = box.current.getBoundingClientRect();
        const dx = (e.clientX - d.x) / r.width;
        const dy = (e.clientY - d.y) / r.height;
        onChange(d.corner >= 0 ? dragCorner(d.rect, d.corner, dx, dy, ratio, photoAspect) : moveCrop(d.rect, dx, dy));
    };
    const end = () => { drag.current = null; };
    const pct = (v) => `${v * 100}%`;
    const corners = [[crop.left, crop.top], [crop.right, crop.top], [crop.right, crop.bottom], [crop.left, crop.bottom]];
    return (<div ref={box} className="absolute inset-0 touch-none" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {/* Dimmed outside the frame */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: "rgba(0,0,0,.6)", clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${pct(crop.left)} ${pct(crop.top)},${pct(crop.left)} ${pct(crop.bottom)},${pct(crop.right)} ${pct(crop.bottom)},${pct(crop.right)} ${pct(crop.top)},${pct(crop.left)} ${pct(crop.top)})` }}/>
      <div className="absolute border-2 border-white cursor-move" onPointerDown={start(-1)}
          style={{ left: pct(crop.left), top: pct(crop.top), width: pct(crop.right - crop.left), height: pct(crop.bottom - crop.top),
              backgroundImage: "linear-gradient(to right,transparent 33%,rgba(255,255,255,.4) 33%,rgba(255,255,255,.4) calc(33% + 1px),transparent calc(33% + 1px),transparent 66%,rgba(255,255,255,.4) 66%,rgba(255,255,255,.4) calc(66% + 1px),transparent calc(66% + 1px)),linear-gradient(to bottom,transparent 33%,rgba(255,255,255,.4) 33%,rgba(255,255,255,.4) calc(33% + 1px),transparent calc(33% + 1px),transparent 66%,rgba(255,255,255,.4) 66%,rgba(255,255,255,.4) calc(66% + 1px),transparent calc(66% + 1px))" }}/>
      {corners.map(([x, y], i) => (<div key={i} role="slider" aria-label={`Crop corner ${i + 1}`} aria-valuenow={Math.round(x * 100)} tabIndex={-1} onPointerDown={start(i)}
          className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full bg-white shadow cursor-nwse-resize" style={{ left: pct(x), top: pct(y) }}/>))}
    </div>);
};

export const PhotoEditor = ({ item, onClose }) => {
    const [img, setImg] = useState(null);
    const [failed, setFailed] = useState(false);
    const [turns, setTurns] = useState(0);
    const [crop, setCrop] = useState(FULL);
    const [aspect, setAspect] = useState(ASPECTS[0]);
    const [tool, setTool] = useState("crop");
    const [adjust, setAdjust] = useState({ brightness: 0, contrast: 0, saturation: 0 });
    const [saving, setSaving] = useState(false);
    const [preview, setPreview] = useState(null);

    useEffect(() => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => setImg(image);
        image.onerror = () => setFailed(true);
        image.src = mediaUrl(item);
    }, [item]);
    // The turned photo, shown as an image under the crop frame
    useEffect(() => {
        if (!img) return;
        setPreview(rotated(img, turns).toDataURL("image/jpeg", 0.85));
    }, [img, turns]);

    const width = img ? (turns % 2 ? img.naturalHeight : img.naturalWidth) : 1;
    const height = img ? (turns % 2 ? img.naturalWidth : img.naturalHeight) : 1;

    const save = () => {
        if (!img) return;
        setSaving(true);
        const source = rotated(img, turns);
        const [x, y, w, h] = cropPixels(crop, source.width, source.height);
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        const ctx = out.getContext("2d");
        ctx.filter = adjustFilter(adjust);
        ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
        const done = (blob) => {
            if (!blob) {
                setSaving(false);
                toast.error("Couldn't make the copy.");
                return;
            }
            const file = new File([blob], editedName(item.name), { type: "image/jpeg" });
            uploadManager.addUpload(file, item.file_path || "/Home/Phone Backup");
            toast.success("Saving a copy next to the original (see Transfers)");
            onClose(true);
        };
        try {
            out.toBlob(done, "image/jpeg", 0.95);
        } catch {
            // A photo from another address without permission to read it back (canvas "tainted")
            setSaving(false);
            toast.error("This browser won't let the editor save this photo. Edit it in the TeleStore app.");
        }
    };

    return (<div className="gphotos dark fixed inset-0 z-[60] bg-black text-white flex flex-col" role="dialog" aria-label={`Edit ${item.name}`}>
      <div className="flex items-center gap-2 px-2 py-2">
        <button type="button" onClick={() => onClose(false)} className="w-11 h-11 grid place-items-center rounded-full hover:bg-white/10" aria-label="Close without saving"><X className="w-6 h-6"/></button>
        <span className="flex-1 text-lg">Edit</span>
        {saving ? <Loader2 className="w-6 h-6 mr-4 animate-spin"/> : <Button onClick={save} disabled={!img} className="rounded-full">Save copy</Button>}
      </div>
      <div className="flex-1 min-h-0 grid place-items-center p-4">
        {failed ? <p>Couldn't load this photo.</p> : !preview ? <Loader2 className="w-8 h-8 animate-spin"/> : (<div className="relative max-w-full max-h-full" style={{ aspectRatio: `${width} / ${height}`, height: "100%", maxHeight: "100%" }}>
            <img src={preview} alt="" className="w-full h-full object-contain" style={{ filter: adjustFilter(adjust) }} draggable={false}/>
            {tool === "crop" && <CropFrame crop={crop} ratio={aspect.ratio} photoAspect={width / height} onChange={setCrop}/>}
          </div>)}
      </div>
      <div className="px-4 pb-5 grid gap-4">
        {tool === "crop" ? (<div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={() => { setTurns((t) => (t + 1) % 4); setCrop(FULL); setAspect(ASPECTS[0]); }} className="w-11 h-11 grid place-items-center rounded-full hover:bg-white/10" aria-label="Rotate"><RotateCw className="w-5 h-5"/></button>
            {ASPECTS.map((a) => (<button key={a.key} type="button" aria-pressed={aspect.key === a.key} onClick={() => { setAspect(a); setCrop(centredCrop(a.ratio, width, height)); }}
                className={cn("px-4 py-1.5 rounded-full border text-sm", aspect.key === a.key ? "bg-primary text-primary-foreground border-primary" : "border-white/30 hover:bg-white/10")}>{a.label}</button>))}
          </div>) : (<div className="grid gap-3 max-w-xl w-full mx-auto">
            {[["brightness", "Brightness"], ["contrast", "Contrast"], ["saturation", "Saturation"]].map(([key, label]) => (<label key={key} className="grid grid-cols-[96px_1fr_40px] items-center gap-3 text-sm">
                {label}
                <Slider min={-100} max={100} step={1} value={[Math.round(adjust[key] * 100)]} onValueChange={([v]) => setAdjust((a) => ({ ...a, [key]: v / 100 }))} aria-label={label}/>
                <span className="text-right tabular-nums">{Math.round(adjust[key] * 100)}</span>
              </label>))}
          </div>)}
        <div className="flex justify-center gap-3">
          {[["crop", Crop, "Crop"], ["adjust", SlidersHorizontal, "Adjust"]].map(([key, Icon, label]) => (<button key={key} type="button" onClick={() => setTool(key)} aria-pressed={tool === key}
              className={cn("flex items-center gap-2 px-4 py-2 rounded-full", tool === key ? "bg-primary text-primary-foreground" : "hover:bg-white/10")}><Icon className="w-5 h-5"/>{label}</button>))}
        </div>
      </div>
    </div>);
};
