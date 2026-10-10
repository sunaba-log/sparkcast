// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResizableInspectorPanel } from "./ResizableInspectorPanel";

describe("ResizableInspectorPanel", () => {
  afterEach(() => {
    cleanup();
  });
  it("adjusts its width with the keyboard-accessible resize handle", () => {
    render(
      <ResizableInspectorPanel>
        <p>Inspector content</p>
      </ResizableInspectorPanel>
    );

    const handle = screen.getByRole("separator", {
      name: "インスペクターパネルの幅を変更",
    });
    expect(handle.getAttribute("aria-valuenow")).toBe("560");

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle.getAttribute("aria-valuenow")).toBe("584");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("560");
  });

  it("adjusts its width via pointer drag events on window", () => {
    render(
      <ResizableInspectorPanel>
        <p>Inspector content</p>
      </ResizableInspectorPanel>
    );

    const handle = screen.getByRole("separator", {
      name: "インスペクターパネルの幅を変更",
    });
    expect(handle.getAttribute("aria-valuenow")).toBe("560");

    // Start dragging at clientX = 800
    fireEvent.pointerDown(handle, { clientX: 800, button: 0 });

    // Move left to clientX = 750 (delta +50px width)
    fireEvent.pointerMove(window, { clientX: 750 });
    expect(handle.getAttribute("aria-valuenow")).toBe("610");

    // Move right to clientX = 850 (delta -50px width from start = 510px)
    fireEvent.pointerMove(window, { clientX: 850 });
    expect(handle.getAttribute("aria-valuenow")).toBe("510");

    // Release drag
    fireEvent.pointerUp(window);

    // Further move should not change width
    fireEvent.pointerMove(window, { clientX: 700 });
    expect(handle.getAttribute("aria-valuenow")).toBe("510");
  });
});
