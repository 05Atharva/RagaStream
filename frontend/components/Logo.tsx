import React from 'react';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

interface LogoProps {
  size?: number;
}

export default function Logo({ size = 48 }: LogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#7C3AED" stopOpacity={1} />
          <Stop offset="100%" stopColor="#F5A623" stopOpacity={1} />
        </LinearGradient>
      </Defs>

      {/* Top wave — lightest */}
      <Path
        d="M15,42 C30,10 45,10 50,38 C55,65 70,68 85,40"
        fill="none"
        stroke="url(#lg)"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeOpacity={0.45}
      />

      {/* Middle wave — thickest / primary */}
      <Path
        d="M15,52 C30,18 45,18 50,48 C55,75 70,78 85,50"
        fill="none"
        stroke="url(#lg)"
        strokeWidth={5}
        strokeLinecap="round"
        strokeOpacity={1}
      />

      {/* Bottom wave — medium */}
      <Path
        d="M15,62 C30,28 45,28 50,58 C55,85 70,88 85,60"
        fill="none"
        stroke="url(#lg)"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeOpacity={0.65}
      />
    </Svg>
  );
}
