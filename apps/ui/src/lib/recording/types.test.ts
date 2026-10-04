import { describe, expect, it } from "vitest";
import { recordingDisplayStatus } from "@/lib/recording/types";

describe("recordingDisplayStatus", () => {
  it("shows a finished recording whose episode failed as failed", () => {
    expect(recordingDisplayStatus("done", "failed")).toBe("failed");
  });

  it("keeps the recording status otherwise", () => {
    expect(recordingDisplayStatus("done", "completed")).toBe("done");
    expect(recordingDisplayStatus("done", "processing")).toBe("done");
    expect(recordingDisplayStatus("mixing", "failed")).toBe("mixing");
    expect(recordingDisplayStatus("uploading", null)).toBe("uploading");
  });
});
