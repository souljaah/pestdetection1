import { containBox, coverBox, type LiveZoneDetection } from '../lib/detection';

/**
 * Draws every box the model found on the current frame (place inside the 16:9 feed container).
 * `fit` must match how the picture is shown: live feeds use object-cover, the recordings player object-contain.
 */
export default function DetectionBoxes({
  detection,
  fit = 'cover',
}: {
  detection: Pick<LiveZoneDetection, 'boxes' | 'width' | 'height'>;
  fit?: 'cover' | 'contain';
}) {
  const place = fit === 'contain' ? containBox : coverBox;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {detection.boxes.map((raw, i) => {
        const box = place(raw, detection.width, detection.height);
        return (
          <div
            key={i}
            className="absolute border-2 border-red-500 rounded transition-all duration-200"
            style={{
              top: `${box.y * 100}%`,
              left: `${box.x * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
              boxShadow: '0 0 0 1px #00000060',
            }}
          >
            <div
              className="absolute left-0 px-1.5 py-0.5 font-mono text-xs text-white rounded flex items-center gap-1"
              style={{ background: '#ef4444', whiteSpace: 'nowrap', top: box.y > 0.08 ? -22 : 2 }}
            >
              <span>⚠</span>
              <span>
                {raw.pestClass} — {raw.confidence.toFixed(1)}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
