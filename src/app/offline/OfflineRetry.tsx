"use client";

export function OfflineRetry() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="mt-6 inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5"
    >
      Reintentar
    </button>
  );
}
