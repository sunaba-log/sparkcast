"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 360;
const MAX_WIDTH = 860;
const KEYBOARD_STEP = 24;
const MIN_MASTER_WIDTH = 320;

function getMaximumWidth() {
  if (typeof window === "undefined") return MAX_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - MIN_MASTER_WIDTH));
}

function clampWidth(width: number) {
  return Math.min(getMaximumWidth(), Math.max(MIN_WIDTH, width));
}

export function ResizableInspectorPanel({
  children,
  className = "",
  resizable = true,
}: {
  children: ReactNode;
  className?: string;
  resizable?: boolean;
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const resizeStartRef = useRef<{ clientX: number; width: number } | null>(null);

  const resizeBy = (amount: number) => {
    setWidth((currentWidth) => clampWidth(currentWidth + amount));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeStartRef.current = { clientX: event.clientX, width };
    setIsDragging(true);
  };

  const stopResizing = useCallback(() => {
    resizeStartRef.current = null;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const resizeStart = resizeStartRef.current;
      if (!resizeStart) return;
      setWidth(clampWidth(resizeStart.width + resizeStart.clientX - event.clientX));
    };

    const handlePointerUp = () => {
      stopResizing();
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [isDragging, stopResizing]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      resizeBy(KEYBOARD_STEP);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      resizeBy(-KEYBOARD_STEP);
    } else if (event.key === "Home") {
      event.preventDefault();
      setWidth(MIN_WIDTH);
    } else if (event.key === "End") {
      event.preventDefault();
      setWidth(getMaximumWidth());
    }
  };

  const style = {
    "--inspector-width": `${width}px`,
  } as CSSProperties;

  return (
    <aside
      className={`relative flex w-full min-h-0 flex-col rounded-xs border-t border-brand/30 bg-app-bg ${
        resizable ? "lg:w-[var(--inspector-width)] lg:flex-none lg:shrink-0 lg:self-stretch lg:border-t-0 lg:border-l" : ""
      } ${className}`}
      style={style}
    >
      {resizable && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="インスペクターパネルの幅を変更"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={getMaximumWidth()}
          aria-valuenow={width}
          tabIndex={0}
          className="group absolute top-0 -left-2 z-40 hidden h-full w-4 cursor-col-resize items-center justify-center select-none touch-none lg:flex"
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
        >
          <div
            className={`h-10 w-1 rounded-full transition-colors ${
              isDragging
                ? "bg-brand ring-2 ring-brand/40"
                : "bg-brand/30 group-hover:bg-brand group-focus:bg-brand"
            }`}
          />
        </div>
      )}
      <div className="flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </aside>
  );
}
