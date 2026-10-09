// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResizableInspectorPanel } from "./ResizableInspectorPanel";

describe("ResizableInspectorPanel", () => {
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
});
