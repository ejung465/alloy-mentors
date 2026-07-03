import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { qrMatrix } from '@/lib/qrcode';
import { font } from '@/lib/theme';

const INK = '#22271F';
const CREAM_BG = '#F2ECDE';
const PINE = '#375946';
const CREAM = '#F5EFE3';

/**
 * The branded Alloy QR: locally generated (lib/qrcode.ts, EC level H), ink
 * modules on the app's warm cream so it blends with the page instead of
 * sitting in a stark white box, and the pine "A" brand chip in the middle
 * (EC-H tolerates the occlusion — verified against a reference decoder up to
 * a 30%-width overlay; we use ~20%).
 *
 * Rendered as horizontal runs of dark modules (one View per run) rather than
 * one View per module — ~4x fewer nodes, and the rounded run ends give it a
 * softer, designed look while staying fully scannable.
 */
export function AlloyQR({ value, size = 240 }: { value: string; size?: number }) {
  const { runs, count } = useMemo(() => {
    const matrix = qrMatrix(value);
    const n = matrix.length;
    const collected: { row: number; start: number; len: number }[] = [];
    for (let r = 0; r < n; r++) {
      let start = -1;
      for (let c = 0; c <= n; c++) {
        const dark = c < n && matrix[r][c];
        if (dark && start === -1) start = c;
        if (!dark && start !== -1) {
          collected.push({ row: r, start, len: c - start });
          start = -1;
        }
      }
    }
    return { runs: collected, count: n };
  }, [value]);

  const quiet = 3; // quiet-zone modules on each side, same cream as the frame
  const cell = size / (count + quiet * 2);
  const chip = Math.round(size * 0.2);

  return (
    <View style={{ width: size, height: size, backgroundColor: CREAM_BG, borderRadius: 12 }}>
      {runs.map((seg, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: (quiet + seg.start) * cell,
            top: (quiet + seg.row) * cell,
            width: seg.len * cell,
            height: cell + 0.35, // slight overlap kills hairline row gaps
            borderRadius: cell * 0.32,
            backgroundColor: INK,
          }}
        />
      ))}
      {/* brand chip */}
      <View
        style={{
          position: 'absolute',
          left: (size - chip) / 2,
          top: (size - chip) / 2,
          width: chip,
          height: chip,
          borderRadius: chip * 0.28,
          backgroundColor: PINE,
          borderWidth: 2,
          borderColor: CREAM_BG,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: font.black, fontSize: chip * 0.5, color: CREAM, letterSpacing: -1 }}>A</Text>
      </View>
    </View>
  );
}
