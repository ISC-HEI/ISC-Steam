// Banner crop tool: shows the selected image inside a frame shaped like the
// profile hero, lets the user drag / zoom to pick what's visible, then
// exports the visible region as the file that actually gets uploaded.
import { useEffect, useRef, useState } from 'react';

const OUT_W = 1920; // exported banner width
const ASPECT = 6; // frame width : height, roughly the hero's on-screen shape

export default function BannerCrop({ file, onCancel, onApply }) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [img, setImg] = useState(null); // natural size { w, h }
  const [frame, setFrame] = useState(null); // measured frame { w, h }
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const imgRef = useRef(null);
  const frameRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const measure = () => {
      const el = frameRef.current;
      if (el) setFrame({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const base = img && frame ? Math.max(frame.w / img.w, frame.h / img.h) : 1;
  const scale = base * zoom;

  // keep the image covering the frame (no gaps at the edges)
  function clampOff(o, z) {
    if (!img || !frame) return o;
    const s = base * z;
    const mx = Math.max(0, (img.w * s - frame.w) / 2);
    const my = Math.max(0, (img.h * s - frame.h) / 2);
    return {
      x: Math.max(-mx, Math.min(mx, o.x)),
      y: Math.max(-my, Math.min(my, o.y)),
    };
  }

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX - off.x, y: e.clientY - off.y };
  }
  function onPointerMove(e) {
    if (!drag.current) return;
    setOff(clampOff({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }, zoom));
  }
  function onPointerUp() {
    drag.current = null;
  }
  function onZoom(z) {
    setZoom(z);
    setOff((o) => clampOff(o, z));
  }

  function apply() {
    if (!img || !frame || busy) return;
    setBusy(true);
    const k = OUT_W / frame.w;
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W;
    canvas.height = Math.round(OUT_W / ASPECT);
    const ctx = canvas.getContext('2d');
    const dx = ((frame.w - img.w * scale) / 2 + off.x) * k;
    const dy = ((frame.h - img.h * scale) / 2 + off.y) * k;
    ctx.drawImage(imgRef.current, dx, dy, img.w * scale * k, img.h * scale * k);
    canvas.toBlob(
      (blob) => onApply(new File([blob], 'banner.jpg', { type: 'image/jpeg' })),
      'image/jpeg',
      0.9,
    );
  }

  return (
    <div className="banner-crop-backdrop" role="dialog" aria-label="Position your banner">
      <div className="banner-crop">
        <h3>Position your banner</h3>
        <p className="banner-crop-hint">
          Drag the image to choose what shows on your profile. The shading previews the final look.
        </p>

        <div
          className="banner-crop-frame"
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            ref={imgRef}
            src={url}
            alt=""
            draggable="false"
            onLoad={(e) => setImg({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
            style={
              img && frame
                ? {
                    width: img.w * scale,
                    height: img.h * scale,
                    transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))`,
                  }
                : undefined
            }
          />
        </div>

        <label className="banner-crop-zoom">
          Zoom
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(e) => onZoom(Number(e.target.value))}
          />
        </label>

        <div className="banner-crop-buttons">
          <button type="button" className="btn btn-primary" onClick={apply} disabled={!img || busy}>
            {busy ? 'Uploading...' : 'Use this crop'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
