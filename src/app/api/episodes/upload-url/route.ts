import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDbPool } from "@/server/db";
import { createEpisodeUpload } from "@/server/episodes/create-upload";
import { createEpisodeUploadSchema } from "@/server/episodes/upload-contract";
import {
  createEpisodeRecord,
  setEpisodeAudioFilePath,
} from "@/server/episodes/repository";
import { createMp3UploadUrl } from "@/server/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = createEpisodeUploadSchema.parse(await request.json());
    const result = await createEpisodeUpload(input, {
      pool: getDbPool(),
      signUpload: createMp3UploadUrl,
      createRecord: createEpisodeRecord,
      setAudioPath: setEpisodeAudioFilePath,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "入力内容が不正です", details: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "JSON形式が不正です" }, { status: 400 });
    }

    console.error("Failed to create episode upload URL", error);
    return NextResponse.json(
      { error: "アップロードの準備に失敗しました" },
      { status: 500 },
    );
  }
}
