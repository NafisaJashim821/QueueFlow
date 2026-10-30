export default function HowItWorks({ settings, compact = false }) {
  const target = settings?.walkin_target_minutes ?? 30;
  const grace = settings?.appointment_grace_minutes ?? 10;
  return (
    <details className="card how" open={!compact}>
      <summary>How is the queue ordered?</summary>
      <ul>
        <li>Every customer gets a <strong>promised time</strong>: an appointment's booked time, or a walk-in's arrival time plus <strong>{target} minutes</strong>. Whoever's promised time comes first is called first.</li>
        <li><strong>Walk-ins</strong> are therefore always served in the order they arrive — a later walk-in never skips an earlier one.</li>
        <li><strong>Appointments</strong> keep their booked slot if they check in no more than {grace} minutes late, but can't push back a walk-in whose promised time is earlier.</li>
        <li>Late appointments join the queue like a walk-in from when they arrive.</li>
        <li>Waiting times are estimates, based on how long recent services actually took, and update live.</li>
      </ul>
    </details>
  );
}
