import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import { GlassCard } from "../../design/glass/GlassCard";
import "./ImportPage.css";

// Mirrors the backend's ALLOWED_SUFFIXES (backend/app/api/imports.py) so an
// obviously wrong file is rejected on the spot, without a round trip. The
// backend re-checks regardless -- this is only an earlier, friendlier no.
const ALLOWED_EXTENSIONS = [".csv", ".txt", ".tsv"];

interface DropZoneProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
  fileName?: string | null;
}

function hasAllowedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function DropZone({ onFileSelected, disabled = false, fileName = null }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!hasAllowedExtension(file.name)) {
      setLocalError(`Format non pris en charge : « ${file.name} » n'est pas un fichier CSV.`);
      return;
    }
    setLocalError(null);
    onFileSelected(file);
  }

  function openPicker() {
    if (disabled) return;
    inputRef.current?.click();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) setIsOver(true);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsOver(false);
    if (disabled) return;
    handleFiles(event.dataTransfer.files);
  }

  return (
    <GlassCard
      as="div"
      tone="raised"
      interactive
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Déposez votre fichier CSV"
      aria-disabled={disabled || undefined}
      data-over={isOver || undefined}
      className="yd-dropzone"
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,.tsv,text/csv"
        className="sr-only"
        onChange={(event) => handleFiles(event.target.files)}
        disabled={disabled}
      />
      <p className="yd-dropzone__title">
        {fileName ? fileName : "Déposez votre fichier ici"}
      </p>
      <p className="yd-dropzone__hint">
        ou cliquez pour parcourir vos fichiers — CSV, 20 Mo maximum.
      </p>

      {localError ? (
        <p role="alert" className="yd-dropzone__error">
          {localError}
        </p>
      ) : null}
    </GlassCard>
  );
}
