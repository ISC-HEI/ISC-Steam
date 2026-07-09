// Image grid with a lightbox. Used by screenshot/artwork showcases.
import { useState } from 'react';

export default function Gallery({ images }) {
  const [open, setOpen] = useState(null); // index | null
  if (!images?.length) return <p className="social-empty">No images yet.</p>;

  return (
    <>
      <div className="gallery-grid">
        {images.map((src, i) => (
          <button type="button" key={src} className="gallery-item" onClick={() => setOpen(i)}>
            <img src={src} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      {open !== null && (
        <div className="lightbox" onClick={() => setOpen(null)} role="dialog" aria-modal="true">
          <button
            type="button"
            className="lightbox-nav prev"
            onClick={(e) => { e.stopPropagation(); setOpen((open + images.length - 1) % images.length); }}
            aria-label="Previous"
          >
            ‹
          </button>
          <img src={images[open]} alt="" onClick={(e) => e.stopPropagation()} />
          <button
            type="button"
            className="lightbox-nav next"
            onClick={(e) => { e.stopPropagation(); setOpen((open + 1) % images.length); }}
            aria-label="Next"
          >
            ›
          </button>
          <button type="button" className="lightbox-close" onClick={() => setOpen(null)} aria-label="Close">✕</button>
        </div>
      )}
    </>
  );
}
