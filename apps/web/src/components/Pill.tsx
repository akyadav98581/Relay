// A status with a lit dot. The colour and the pulse come from data-s in the stylesheet.
export default function Pill({ status, label, testId }: { status: string; label?: string; testId?: string }) {
  return <span className="pill" data-s={status} data-testid={testId}>{label ?? status}</span>
}
