"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { addPickImage, deletePickImage } from "@/app/(app)/actions";

const BUCKET = "game-images";

export type PickImageItem = { id: string; path: string; url: string };

export default function PickImages({
  pickId,
  images,
}: {
  pickId: string;
  images: PickImageItem[];
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${pickId}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      await addPickImage(pickId, path);
    } catch {
      setError("Não foi possível enviar a imagem.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleRemove(image: PickImageItem) {
    setRemovingId(image.id);
    startTransition(async () => {
      const supabase = createClient();
      await supabase.storage.from(BUCKET).remove([image.path]);
      await deletePickImage(image.id);
      setRemovingId(null);
    });
  }

  return (
    <div className="mb-2">
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((image) => (
            <div key={image.id} className="relative">
              <a href={image.url} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt="Print da aposta"
                  className="h-24 w-24 rounded-lg border border-neutral-800 object-cover transition hover:opacity-90"
                />
              </a>
              <button
                type="button"
                title="Remover print"
                onClick={() => handleRemove(image)}
                disabled={isPending}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-xs text-neutral-300 hover:bg-red-600 hover:text-white disabled:opacity-50"
              >
                {removingId === image.id ? "…" : "✕"}
              </button>
            </div>
          ))}
        </div>
      )}
      <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-emerald-400 hover:underline">
        {uploading ? "A enviar..." : "+ Anexar print"}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
          disabled={uploading}
        />
      </label>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
