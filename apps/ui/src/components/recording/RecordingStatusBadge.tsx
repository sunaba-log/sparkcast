import { RECORDING_STATUS_LABELS, type RecordingSessionStatus } from "@/lib/recording/types";

const STATUS_CLASSES: Record<RecordingSessionStatus, string> = {
  waiting: "bg-gray-100 text-gray-700",
  recording: "bg-red-100 text-red-700",
  uploading: "bg-blue-100 text-blue-800",
  mixing: "bg-yellow-100 text-yellow-800",
  done: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  expired: "bg-gray-100 text-gray-500",
};

export function RecordingStatusBadge({ status }: { status: RecordingSessionStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_CLASSES[status]}`}
    >
      {RECORDING_STATUS_LABELS[status]}
    </span>
  );
}
