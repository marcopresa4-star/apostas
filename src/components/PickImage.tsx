"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { setPickImage } from "@/app/(app)/actions";

const BUCKET = "game-images";

export default function PickImage({
  pickId,
  imagePath,
  imageUrl,
}: {
  pickId: string;
  imagePath: string | null;
  imageUrl: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

      if (imagePath) {
        await supabase.storage.from(BUCKET).remove([imagePath]);
      }

      await setPickImage(pickId, path);
    } catch {
      setError("Não foi possível enviar a imagem.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleRemove() {
    startTransition(async () => {
      const supabase = createClient();
      if (imagePath) {
        await supabase.storage.from(BUCKET).remove([imagePath]);
      }
      await setPickImage(pickId, null);
    });
  }

  if (imageUrl) {
    return (
      <div className="mb-2">
        <a href={imageUrl} target="_blank" rel="noreferrer" className="inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Print da aposta"
            className="max-h-48 rounded-lg border border-neutral-800 object-cover transition hover:opacity-90"
          />
        </a>
        <button
          type="button"
          onClick={handleRemove}
          disabled={isPending}
          className="mt-1 block text-xs text-neutral-500 hover:text-red-400 disabled:opacity-50"
        >
          Remover print
        </button>
      </div>
    );
  }

  return (
    <div className="mb-2">
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
