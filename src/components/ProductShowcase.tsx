"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Expand, ExternalLink, Image as ImageIcon, Play, RotateCcw, X } from "lucide-react";
import { getYoutubeThumbnailUrl } from "@/lib/product-details";

type Props = {
  images: string[];
  productName: string;
  videoUrl: string;
  videoEmbedUrl: string | null;
  tutorialUrl: string;
};

export function ProductShowcase({ images, productName, videoUrl, videoEmbedUrl, tutorialUrl }: Props) {
  const [activeImage, setActiveImage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const mainImageRef = useRef<HTMLImageElement>(null);
  const [zoomPoint, setZoomPoint] = useState<{
    lensX: number;
    lensY: number;
    lensSize: number;
    imageLeft: number;
    imageTop: number;
    imageSize: number;
    imageHeight: number;
  } | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const videoThumbnail = getYoutubeThumbnailUrl(videoUrl) ?? images[0] ?? null;
  const hasVideo = Boolean(videoUrl);
  const isDirectVideo = /\.(?:mp4|webm|ogg)(?:$|[?#])/i.test(videoUrl);
  const currentImage = images[activeImage];

  function moveImage(direction: -1 | 1) {
    if (!images.length) return;
    setActiveImage((index) => (index + direction + images.length) % images.length);
    setZoomPoint(null);
  }

  useEffect(() => {
    if (!lightboxOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setLightboxOpen(false);
      if (event.key === "ArrowLeft") {
        setActiveImage((index) => (index - 1 + images.length) % images.length);
        setZoomPoint(null);
      }
      if (event.key === "ArrowRight") {
        setActiveImage((index) => (index + 1) % images.length);
        setZoomPoint(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [lightboxOpen, images.length]);

  function updateZoomPoint(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const image = mainImageRef.current;
    if (!image?.naturalWidth || !image.naturalHeight) return;
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const fitScale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
    const renderedWidth = image.naturalWidth * fitScale;
    const renderedHeight = image.naturalHeight * fitScale;
    const imageOffsetX = (bounds.width - renderedWidth) / 2;
    const imageOffsetY = (bounds.height - renderedHeight) / 2;
    const imageX = x - imageOffsetX;
    const imageY = y - imageOffsetY;
    if (imageX < 0 || imageY < 0 || imageX > renderedWidth || imageY > renderedHeight) {
      setZoomPoint(null);
      return;
    }
    const lensSize = Math.min(bounds.width * 0.58, 280);
    const halfLens = lensSize / 2;
    const zoom = 3;
    const lensX = x;
    const lensY = y;
    const focusX = Math.min(renderedWidth, Math.max(0, imageX));
    const focusY = Math.min(renderedHeight, Math.max(0, imageY));
    setZoomPoint({
      lensX,
      lensY,
      lensSize,
      imageLeft: halfLens - focusX * zoom,
      imageTop: halfLens - focusY * zoom,
      imageSize: renderedWidth * zoom,
      imageHeight: renderedHeight * zoom,
    });
  }

  const zoomStyle = currentImage && zoomPoint
    ? {
        left: `${zoomPoint.lensX}px`,
        top: `${zoomPoint.lensY}px`,
        width: `${zoomPoint.lensSize}px`,
        height: `${zoomPoint.lensSize}px`,
      }
    : undefined;
  const zoomImageStyle = zoomPoint
    ? {
        width: `${zoomPoint.imageSize}px`,
      height: `${zoomPoint.imageHeight}px`,
        left: `${zoomPoint.imageLeft}px`,
        top: `${zoomPoint.imageTop}px`,
      }
    : undefined;

  return (
    <section className="product-showcase min-w-0 p-4 sm:p-6 lg:p-8" aria-label={`Fotos y video de ${productName}`}>
      <div className="product-showcase-main group relative overflow-hidden rounded-[28px]">
        {currentImage ? (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            onPointerMove={updateZoomPoint}
            onPointerLeave={() => setZoomPoint(null)}
            className="product-showcase-image-button relative block aspect-square w-full cursor-zoom-in overflow-hidden text-left"
            aria-label={`Ampliar imagen ${activeImage + 1} de ${productName}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={mainImageRef}
              key={currentImage}
              src={currentImage}
              alt={`${productName}, imagen ${activeImage + 1}`}
              className="product-showcase-image h-full w-full object-contain"
            />
            <span className="product-showcase-expand absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100">
              <Expand size={14} /> Ampliar
            </span>
          </button>
        ) : (
          <div className="product-showcase-empty grid aspect-square place-items-center">
            <ImageIcon size={52} strokeWidth={1.2} />
          </div>
        )}
        {images.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => moveImage(-1)}
              className="product-showcase-arrow absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full opacity-0 shadow-lg transition group-hover:opacity-100 focus-visible:opacity-100"
              aria-label="Ver imagen anterior"
            >
              <ArrowLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => moveImage(1)}
              className="product-showcase-arrow absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full opacity-0 shadow-lg transition group-hover:opacity-100 focus-visible:opacity-100"
              aria-label="Ver imagen siguiente"
            >
              <ArrowRight size={18} />
            </button>
            <span className="product-showcase-counter absolute bottom-4 right-4 rounded-full px-3 py-1 text-xs font-bold">
              {activeImage + 1} / {images.length}
            </span>
          </>
        ) : null}
        {zoomStyle ? (
          <div className="product-showcase-zoom-lens pointer-events-none absolute" style={zoomStyle} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentImage}
              alt=""
              className="product-showcase-zoom-image absolute max-w-none object-cover"
              style={zoomImageStyle}
            />
            <span className="product-showcase-zoom-label absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold">
              Zoom 3×
            </span>
          </div>
        ) : null}
      </div>

      {images.length > 1 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2" aria-label="Seleccionar imagen">
          {images.map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              onClick={() => {
                setActiveImage(index);
                setZoomPoint(null);
              }}
              className={`product-showcase-thumb shrink-0 overflow-hidden rounded-xl border-2 transition ${
                activeImage === index ? "is-active" : ""
              }`}
              aria-label={`Mostrar imagen ${index + 1}`}
              aria-pressed={activeImage === index}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="" className="h-16 w-16 object-cover sm:h-[4.5rem] sm:w-[4.5rem]" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}

      {hasVideo ? (
        <div className="product-video-preview mt-5 overflow-hidden rounded-[26px]">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-65">Míralo en acción</p>
              <p className="mt-0.5 text-sm font-bold">Un vistazo más de cerca</p>
            </div>
            {playing ? (
              <button type="button" onClick={() => setPlaying(false)} className="product-video-reset inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold">
                <RotateCcw size={14} /> Vista previa
              </button>
            ) : null}
          </div>
          <div className="relative aspect-video overflow-hidden">
            {playing ? (
              videoEmbedUrl ? (
                <iframe
                  src={`${videoEmbedUrl}?autoplay=1&rel=0`}
                  title={`Video de ${productName}`}
                  className="absolute inset-0 h-full w-full"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              ) : isDirectVideo ? (
                <video src={videoUrl} className="absolute inset-0 h-full w-full bg-black object-contain" controls autoPlay playsInline />
              ) : (
                <div className="absolute inset-0 grid place-items-center p-6 text-center">
                  <div>
                    <p className="font-bold">Este video se abre en su plataforma</p>
                    <a href={videoUrl} target="_blank" rel="noreferrer" className="product-landing-tutorial-link mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold">
                      Abrir video <ArrowRight size={15} />
                    </a>
                  </div>
                </div>
              )
            ) : (
              <>
                {videoThumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={videoThumbnail} alt={`Vista previa del video de ${productName}`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                ) : <div className="product-video-fallback absolute inset-0" />}
                <div className="product-video-overlay absolute inset-0" />
                {videoEmbedUrl || isDirectVideo ? (
                  <button
                    type="button"
                    onClick={() => setPlaying(true)}
                    className="product-video-play absolute left-1/2 top-1/2 grid h-[4.5rem] w-[4.5rem] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-2xl transition hover:scale-110"
                    aria-label={`Reproducir video de ${productName}`}
                  >
                    <Play size={25} fill="currentColor" className="ml-1" />
                  </button>
                ) : (
                  <a
                    href={videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="product-video-play absolute left-1/2 top-1/2 grid h-[4.5rem] w-[4.5rem] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-2xl transition hover:scale-110"
                    aria-label={`Abrir video de ${productName}`}
                  >
                    <Play size={25} fill="currentColor" className="ml-1" />
                  </a>
                )}
                <span className="absolute bottom-4 left-4 rounded-full bg-black/55 px-3 py-1.5 text-xs font-bold text-white backdrop-blur">
                  Reproducir video
                </span>
              </>
            )}
          </div>
        </div>
      ) : null}

      {tutorialUrl ? (
        <a
          href={tutorialUrl}
          target="_blank"
          rel="noreferrer"
          className="product-showcase-tutorial mt-4 flex items-center justify-between gap-4 rounded-[24px] border p-4 transition hover:-translate-y-0.5 sm:p-5"
        >
          <span className="min-w-0">
            <span className="product-showcase-tutorial-kicker block text-[11px] font-extrabold uppercase tracking-[0.16em]">GUÍA PASO A PASO</span>
            <span className="mt-1 block text-base font-black sm:text-lg">¿Quieres aprender a usarlo?</span>
            <span className="mt-1 block text-xs opacity-70">Abre el tutorial completo en otra pestaña.</span>
          </span>
          <span className="product-showcase-tutorial-icon grid h-11 w-11 shrink-0 place-items-center rounded-2xl">
            <ExternalLink size={19} />
          </span>
        </a>
      ) : null}

      {lightboxOpen && currentImage && typeof document !== "undefined"
        ? createPortal(
        <div
          className="product-lightbox fixed inset-0 z-[120]"
          role="dialog"
          aria-modal="true"
          aria-label={`Visor de imágenes de ${productName}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) setLightboxOpen(false);
          }}
        >
          <div className="product-lightbox-panel relative flex h-full w-full flex-col overflow-hidden">
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              className="product-lightbox-control absolute right-4 top-4 z-20 grid h-10 w-10 place-items-center rounded-full sm:right-6 sm:top-6"
              aria-label="Cerrar visor de imagen"
            >
              <X size={20} />
            </button>
            <div className="product-lightbox-stage relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
              {images.length > 1 ? (
                <button
                  type="button"
                  onClick={() => moveImage(-1)}
                  className="product-lightbox-control absolute left-3 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full sm:left-6 sm:h-12 sm:w-12"
                  aria-label="Ver foto anterior"
                >
                  <ArrowLeft size={20} />
                </button>
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={`lightbox-${currentImage}`}
                src={currentImage}
                alt={`${productName}, imagen ${activeImage + 1} de ${images.length}`}
                className="product-lightbox-image"
              />
              {images.length > 1 ? (
                <button
                  type="button"
                  onClick={() => moveImage(1)}
                  className="product-lightbox-control absolute right-3 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full sm:right-6 sm:h-12 sm:w-12"
                  aria-label="Ver foto siguiente"
                >
                  <ArrowRight size={20} />
                </button>
              ) : null}
            </div>
          </div>
        </div>,
        document.body,
      )
        : null}
    </section>
  );
}
