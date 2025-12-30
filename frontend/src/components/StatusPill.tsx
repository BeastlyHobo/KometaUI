type StatusPillProps = {
  status: string | null | undefined;
};

const statusLabel = (status: string | null | undefined) => {
  if (!status) {
    return "unknown";
  }
  return status;
};

export default function StatusPill({ status }: StatusPillProps) {
  const normalized = statusLabel(status).toLowerCase();
  return <span className={`status-pill ${normalized}`}>{statusLabel(status)}</span>;
}
