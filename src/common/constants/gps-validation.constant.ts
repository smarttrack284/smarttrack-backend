/** GPS fixes worse than this are unreliable enough to discard rather than trust — common in dense urban canyons or indoors. */
export const MAX_ACCEPTABLE_ACCURACY_METERS = 100;

/** A delivery vehicle exceeding this implied speed between two points is almost certainly a bad GPS fix, not real movement. */
export const MAX_PLAUSIBLE_SPEED_KPH = 140;

/** If more time than this has passed since the last accepted point, a large jump is plausible on its own (device was offline, tunnel, app was backgrounded) — don't quarantine it. */
export const LARGE_GAP_THRESHOLD_SECONDS = 300;

/** How close a follow-up point must be to a quarantined candidate to confirm it as real movement rather than a one-off glitch. */
export const CONFIRM_RADIUS_METERS = 50;

export const MIN_MOVEMENT_METERS = 15;
export const HEARTBEAT_INTERVAL_MS = 60_000;